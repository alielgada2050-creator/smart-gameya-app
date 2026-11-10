"""
Real-browser journey (Chrome) for the redesigned app: three members and a platform reviewer.
Covers sign-in, payout methods, business identity, tiers, invite/join, draw, the three-party
transfer flow (receipt upload, organizer approval/rejection, recipient confirmation, dispute),
circle chat with the assistant, the large-circle promissory-note approval, skins, RTL/LTR,
the mobile menu sheet, and no horizontal scroll at 390 px.
Run via scripts/test-ui.sh.
"""
import os, re, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3100")
SHOTS = os.environ.get("SHOTS_DIR", "screenshots")
os.makedirs(SHOTS, exist_ok=True)
problems: list[str] = []
def _png(w=48, h=24, rgb=(47, 102, 144)):
    """A genuine PNG (solid colour) for receipts and the organisation logo."""
    import struct, zlib
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PNG = _png()
_rc = [0]
RECORDED = {}
def record(page, who):
    """RECORD_API=file: keep real API response samples (used to build the in-browser demo). Off by default."""
    if not os.environ.get("RECORD_API"): return
    import json as _j
    def on(r):
        if "/api/v1/" not in r.url or "json" not in (r.headers.get("content-type") or ""): return
        key = r.request.method + " " + re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", ":id", r.url.split("/api/v1")[1].split("?")[0])
        try: body = r.json()
        except Exception: return
        req = r.request.post_data
        RECORDED.setdefault(key, [])
        if len(RECORDED[key]) < 3: RECORDED[key].append({"who": who, "status": r.status, "req": req, "res": body})
        with open(os.environ["RECORD_API"], "w") as f: _j.dump(RECORDED, f, ensure_ascii=False, indent=1)
    page.on("response", on)

def receipt_png():
    """Every real receipt is a different file; the app refuses to reuse one receipt for two payments."""
    _rc[0] += 1
    return _png(rgb=(40 + _rc[0] % 200, 90, 140))
PDF = b"%PDF-1.4\n% promissory note (test)\n%%EOF"
IBAN = "SA0380000000608010167519"


def watch(page, who):
    is_font = lambda url: "fonts.googleapis.com" in url or "fonts.gstatic.com" in url
    page.on("pageerror", lambda e: problems.append(f"{who} pageerror: {e}"))
    # 400 responses are the app's own validation answers (e.g. the deliberately wrong IBAN); anything else is a problem.
    expected = lambda m: "status of 400" in m.text and "/api/" in m.location.get("url", "")
    page.on("console", lambda m: m.type == "error" and not is_font(m.location.get("url", "")) and not expected(m) and problems.append(f"{who} console: {m.text} @ {m.location.get('url')}"))
    page.on("requestfailed", lambda r: not is_font(r.url) and "blob:" not in r.url and problems.append(f"{who} request failed: {r.url}"))


def shot(page, name):
    page.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)


def no_hscroll(page, where):
    w = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    if w[0] > w[1] + 1:
        problems.append(f"horizontal scroll at {where}: {w}")


def sign_in(page, phone, name):
    page.goto(BASE + "/")
    page.locator("[data-testid=onboarding], main input").first.wait_for()
    if page.get_by_test_id("onboarding").count():
        page.get_by_role("button", name="تخطَّ").click()
    vw = page.viewport_size["width"]
    used = page.evaluate("document.querySelector('main').getBoundingClientRect().width")
    if used < vw * 0.7: problems.append(f"signed-out page uses {used}px of {vw}px")   # regression: sidebar column without a sidebar
    page.get_by_label("رقم الجوال").fill(phone)
    page.get_by_role("button", name="أرسل الرمز").click()
    code = re.search(r"\d{6}", page.get_by_test_id("dev-code").inner_text()).group(0)
    page.get_by_label("رمز التحقق").fill(code)
    page.get_by_label("اسمك كما يراه أعضاء الجمعية").fill(name)
    page.get_by_role("button", name="دخول").click()
    expect(page.get_by_role("heading", name=f"أهلاً {name}")).to_be_visible()


def nav(page, label):
    """Sidebar at >=1024px, bottom nav below; only the visible one is in the accessibility tree."""
    page.get_by_role("navigation", name="جمعيتي").get_by_role("link", name=label).click()


def add_iban(page):
    nav(page, "حسابي")
    page.get_by_label("وسيلة التحويل").select_option("IBAN_SA")
    page.get_by_label("الرقم أو الآيبان").fill("SA04 8000 0000 6080 1016 7519")
    page.get_by_role("button", name="أضف وسيلة").click()
    expect(page.get_by_role("alert")).to_be_visible()  # bad checksum rejected
    page.get_by_label("الرقم أو الآيبان").fill("SA03 8000 0000 6080 1016 7519")
    page.get_by_role("button", name="أضف وسيلة").click()
    expect(page.get_by_test_id("payout-list")).to_contain_text("••••7519")


def watch_draw(page, skip=True):
    """Members who missed the live draw see the wheel once; watch (or skip) and close it like a member would."""
    stage = page.get_by_test_id("draw-stage")
    if skip:
        page.get_by_role("button", name="تخطَّ إلى النتيجة").click()
    expect(stage).to_have_attribute("data-phase", "reveal", timeout=25000)
    winner = page.get_by_test_id("draw-winner").inner_text()
    stage.get_by_role("button", name="إغلاق").click()
    expect(stage).to_have_count(0)
    return winner


def open_circle(page, name, tab=None):
    nav(page, "جمعياتي")
    page.get_by_role("link", name=re.compile(name)).first.click()
    expect(page.get_by_role("heading", name=name, level=1)).to_be_visible()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(600)                     # an unseen draw mounts its stage right after the lottery state loads
    if page.get_by_test_id("draw-stage").count():
        watch_draw(page)
    if tab:
        page.get_by_role("tab", name=tab).click()
        if tab == "المدفوعات":
            expect(page.get_by_role("heading", name="مطلوب منك")).to_be_visible()
        page.wait_for_load_state("networkidle")


def sign_pledge(page, name, scope=None):
    """Tick every clause of the payment pledge and type the registered name as the signature."""
    box = (scope or page).get_by_test_id("pledge").last
    for cb in box.locator(".pledge-clauses input[type=checkbox]").all():
        cb.check()
    box.get_by_label("اكتب اسمك الكامل توقيعاً").fill(name)


def create_circle(page, name, contribution, members, start, expect_tier, signer="سارة", kind="جمعية الأصدقاء"):
    """Wizard: type → details (server preview) → pledge. Leaves the page ready for «أنشئ الجمعية»."""
    nav(page, "جمعياتي")
    page.get_by_role("link", name="جمعية جديدة").click()
    page.get_by_role("radio", name=re.compile(kind)).click()
    page.get_by_role("button", name="التالي").click()
    page.get_by_label("اسم الجمعية").fill(name)
    page.get_by_label(re.compile("مساهمة كل عضو")).fill(contribution)
    page.get_by_label("عدد الأعضاء").fill(str(members))
    page.get_by_label("تاريخ أول دورة").fill(start)
    expect(page.locator(".tier").first).to_have_text(expect_tier)
    page.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    page.get_by_role("button", name="التالي").click()
    expect(page.get_by_test_id("pledge")).to_be_visible()
    expect(page.get_by_role("button", name="أنشئ الجمعية")).to_be_disabled()     # not before the pledge is signed
    sign_pledge(page, signer)
    return page


def invite_and_join(org, joiners, circle_name):
    org.get_by_role("button", name="ادعُ أعضاء").click()
    link = org.get_by_test_id("invite-link").inner_text().strip()
    for p, who in joiners:
        p.goto(link)
        expect(p.get_by_test_id("invite-card")).to_contain_text(circle_name)
        p.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
        sign_pledge(p, who)
        p.get_by_role("button", name="انضم إلى الجمعية").click()
        expect(p.get_by_role("heading", name=circle_name)).to_be_visible()
        cele = p.get_by_test_id("celebration")
        expect(cele).to_contain_text("أهلاً بك في الجمعية")
        cele.get_by_role("button", name="إغلاق").click()


def run_draw(org, approver, circle_name):
    open_circle(org, circle_name)
    org.get_by_test_id("draw-invite").locator("summary").click()       # invite everyone to watch
    org.get_by_role("button", name="أرسل الدعوة للجميع").click()
    expect(org.get_by_text(re.compile(r"أُرسلت الدعوة إلى \d+ أعضاء"))).to_be_visible()
    org.get_by_role("button", name="جهّز القرعة الرسمية").click()
    expect(org.get_by_test_id("commitment")).to_be_visible()
    open_circle(approver, circle_name)
    approver.get_by_role("button", name="أوافق على إجراء القرعة").click()
    expect(approver.get_by_text("وافقت. بانتظار تنفيذ المنظم.")).to_be_visible()
    org.reload()
    org.get_by_role("button", name="ابدأ القرعة على العجلة").click()
    stage = org.get_by_test_id("draw-stage")
    expect(stage).to_be_visible()
    expect(stage).to_contain_text("تبدأ العجلة خلال")                 # countdown 10 → 1
    winner = watch_draw(org)
    expect(org.get_by_test_id("verification")).to_contain_text("تحققنا")
    return winner


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    phone = {"width": 390, "height": 844}
    desk = {"width": 1280, "height": 900}
    A = browser.new_context(viewport=desk, locale="ar-SA", timezone_id="Asia/Riyadh").new_page()   # organizer, desktop
    B = browser.new_context(viewport=phone, locale="ar-SA", timezone_id="Asia/Riyadh").new_page()  # member, phone
    C = browser.new_context(viewport=phone, locale="ar-SA", timezone_id="Asia/Riyadh").new_page()  # member, phone
    record(A, "A"); record(B, "B"); record(C, "C")
    for pg, w in ((A, "A"), (B, "B"), (C, "C")):
        watch(pg, w)

    # 1. Sign-in (hero figure) and validation
    B.goto(BASE)
    expect(B.locator("html")).to_have_attribute("dir", "rtl")
    expect(B.get_by_test_id("onboarding")).to_be_visible()             # first run: four-slide introduction
    shot(B, "00-onboarding-phone")
    for _ in range(3):
        B.get_by_role("button", name="التالي").click()
    expect(B.get_by_role("heading", name="تعهّد يحمي حق الجميع")).to_be_visible()
    shot(B, "00b-onboarding-pledge-phone")
    B.get_by_role("button", name="ابدأ الآن").click()
    welcome = B.get_by_role("img", name=re.compile("ترحّب بك|يرحّب بك"))
    expect(welcome).to_be_visible()                                    # animated sign-in illustration
    anim = lambda pg: pg.evaluate("getComputedStyle(document.querySelector('.ill-welcome .ill-badge')).animationName")
    if "ill-pop" not in anim(B): problems.append(f"welcome badges not animated: {anim(B)}")
    # greeter slider: woman, man, young man, girl — switch by hand (auto-play pauses), and a pause control exists
    for who, label in (("man", "عضو"), ("youth", "شاب"), ("girl", "بنت"), ("woman", "عضوة")):
        B.get_by_role("button", name="اعرض: " + label, exact=True).click()
        expect(B.get_by_test_id("welcome-slider")).to_have_attribute("data-who", who)
        if who == "youth": shot(B, "01b-greeter-youth-phone")
    expect(B.get_by_role("button", name=re.compile("شغّل الحركة|أوقف الحركة"))).to_be_visible()
    B.emulate_media(reduced_motion="reduce")
    if anim(B) != "none": problems.append("animation ignores reduced motion")
    B.emulate_media(reduced_motion="no-preference")
    shot(B, "01-login-phone")
    B.get_by_label("رقم الجوال").fill("12345")
    B.get_by_role("button", name="أرسل الرمز").click()
    expect(B.get_by_role("alert")).to_contain_text("رقم جوال")
    sign_in(A, "0551110001", "سارة")
    sign_in(B, "0551110002", "خالد")
    sign_in(C, "0551110003", "نورة")
    shot(A, "02-home-desktop")
    no_hscroll(B, "home-phone")

    # 2. Payout methods (IBAN checksum) and business identity logo
    for pg in (A, B, C):
        add_iban(pg)
    A.get_by_label("اسم الجهة").fill("مؤسسة الاختبار")
    A.get_by_label("ملف الشعار (PNG شفاف)").set_input_files({"name": "logo.png", "mimeType": "image/png", "buffer": PNG})
    expect(A.locator(".logo-strip:visible .logo-plate")).to_have_count(1)
    shot(A, "03-account")

    # 3. Medium circle: 3 × 5,000 = 15,000 SAR, started in the past
    create_circle(A, "جمعية الحي", "5000", 3, "2026-09-01", "متوسطة")
    expect(A.get_by_test_id("preview-pot")).to_have_text("15,000 ريال")
    shot(A, "04-create-medium")
    A.get_by_role("button", name="أنشئ الجمعية").click()
    expect(A.get_by_role("heading", name="جمعية الحي")).to_be_visible()
    invite_and_join(A, [(B, "خالد"), (C, "نورة")], "جمعية الحي")
    winner = run_draw(A, B, "جمعية الحي")
    # B stayed on the circle page after approving: the wheel appears there by itself, with the same result
    expect(B.get_by_test_id("draw-stage")).to_be_visible(timeout=12000)
    expect(B.get_by_test_id("draw-stage")).to_contain_text("إعادة مشاهدة القرعة")
    if watch_draw(B) != winner: problems.append("members watching saw a different winner")
    # the result card in the chat reopens the wheel for anyone
    open_circle(C, "جمعية الحي", "المحادثة")
    C.get_by_role("button", name="شاهد العجلة وصورة النتيجة").first.click()
    if watch_draw(C) != winner: problems.append("chat result card shows a different winner")
    shot(A, "05-circle-overview")

    # 4. Three-party settlement driven through the UI until the circle completes
    people = {"A": A, "B": B, "C": C}
    rejected = disputed = False
    for _ in range(40):
        progressed = False
        for who, pg in people.items():
            open_circle(pg, "جمعية الحي", "المدفوعات")
            if pg.get_by_text("اكتملت الجمعية").count():
                continue
            if pg.get_by_role("button", name="اعتمد الإيصال").count():
                if not rejected:
                    pg.get_by_label("سبب الرفض").first.fill("الإيصال غير واضح")
                    pg.get_by_role("button", name="ارفض").first.click()
                    expect(pg.get_by_text("رُفض الإيصال")).to_be_visible()
                    rejected = True
                else:
                    pg.get_by_role("button", name="اعتمد الإيصال").first.click()
                    expect(pg.get_by_text("اعتُمد الإيصال")).to_be_visible()
                progressed = True
            elif pg.get_by_role("button", name="وصلني المبلغ").count():
                first_item = pg.get_by_role("button", name="وصلني المبلغ").first.locator("xpath=ancestor::li[1]").inner_text()
                if not disputed and who != "A" and "من سارة" not in first_item:
                    pg.get_by_label("ما المشكلة؟").first.fill("لم يصل المبلغ بعد")
                    pg.get_by_role("button", name="لم يصلني").first.click()
                    expect(pg.get_by_text("سُجّل اعتراضك")).to_be_visible()
                    disputed = True
                else:
                    pg.get_by_role("button", name="وصلني المبلغ").first.click()
                    expect(pg.get_by_text("تم التأكيد")).to_be_visible()
                    expect(pg.get_by_test_id("celebration")).to_contain_text("اكتملت الدفعة")
                    pg.get_by_test_id("celebration").get_by_role("button", name="إغلاق").click()
                progressed = True
            elif pg.get_by_role("button", name="احسم").count():
                pg.get_by_label("القرار").first.select_option("RECEIPT_VALID")
                pg.get_by_label("سبب القرار").first.fill("الإيصال يطابق المبلغ")
                pg.get_by_role("button", name="احسم").first.click()
                expect(pg.get_by_text("حُسم الاعتراض")).to_be_visible()
                progressed = True
            elif pg.get_by_role("button", name="سجّل تحويلك").count():
                pg.get_by_role("button", name="سجّل تحويلك").first.click()
                pg.get_by_role("button", name="اعرض بيانات التحويل").click()
                expect(pg.get_by_test_id("pay-to")).to_contain_text(IBAN)
                if who == "B":
                    shot(pg, "06-pay-to-phone")
                pg.get_by_label("وسيلة التحويل").select_option("IBAN_SA")
                pg.get_by_label("إيصال التحويل (PDF أو صورة)").set_input_files({"name": "r.png", "mimeType": "image/png", "buffer": receipt_png()})
                pg.get_by_role("button", name="أرسل الإيصال للاعتماد").click()
                expect(pg.get_by_text("أُرسل الإيصال")).to_be_visible()
                progressed = True
        if A.get_by_text("اكتملت الجمعية").count() or not progressed:
            break
    open_circle(A, "جمعية الحي", "المدفوعات")
    expect(A.get_by_text("اكتملت الجمعية")).to_be_visible()
    assert rejected and disputed, (rejected, disputed)
    shot(A, "07-payments-complete")

    # 5. Chat: members, the circle record, the assistant
    open_circle(B, "جمعية الحي", "المحادثة")
    B.get_by_label(re.compile("اكتب رسالة")).fill("شكراً للجميع على الالتزام")
    B.get_by_role("button", name="أرسل").click()
    expect(B.locator(".msg.USER.mine").last).to_contain_text("شكراً للجميع")
    B.locator(".chip", has_text="تقرير").click()
    expect(B.locator(".msg.ASSISTANT").last).to_contain_text("تقرير جمعية الحي")
    expect(B.locator(".msg.SYSTEM", has_text="رفض المنظم")).to_have_count(1)
    expect(B.locator(".msg.SYSTEM", has_text="حُسم الاعتراض")).to_have_count(1)
    shot(B, "08-chat-phone")
    no_hscroll(B, "chat-phone")

    # 5b. Payout order by priority (AI suggestion) → objection → agreed order → every member approves
    create_circle(A, "جمعية الأولوية", "1000", 3, "2027-01-01", "صغيرة")
    A.get_by_role("button", name="أنشئ الجمعية").click()
    expect(A.get_by_role("heading", name="جمعية الأولوية")).to_be_visible()
    invite_and_join(A, [(B, "خالد"), (C, "نورة")], "جمعية الأولوية")
    for pg, pref, when, reason in ((B, "أحتاجه مبكراً", "2027-01-20", "WEDDING"), (C, "أفضّل التأخير", None, "NONE")):
        open_circle(pg, "جمعية الأولوية")
        pg.get_by_test_id("payout-order").get_by_role("radio", name="بالأولوية").click()
        pg.get_by_role("radio", name=pref).click()
        expect(pg.get_by_test_id("turn-picker").get_by_role("radio")).to_have_count(3)
        expect(pg.get_by_test_id("no-fees")).to_contain_text("لا رسوم")
        if when:
            pg.get_by_label("أحتاج المبلغ قبل (اختياري)").fill(when)
        pg.get_by_label("السبب (اختياري)").select_option(reason)
        if reason != "NONE":
            pg.get_by_label("أظهر السبب لبقية الأعضاء").check()
        pg.get_by_role("button", name="احفظ أولويتي").click()
        expect(pg.get_by_text("حُفظت أولويتك")).to_be_visible()
    shot(B, "21-priority-phone")
    no_hscroll(B, "priority-phone")
    open_circle(A, "جمعية الأولوية")
    A.get_by_test_id("payout-order").get_by_role("radio", name="بالأولوية").click()
    expect(A.get_by_test_id("priority-requests")).to_contain_text("زواج")
    A.get_by_role("button", name="اقتراح المساعد الذكي").click()
    sug = A.get_by_test_id("suggestion")
    expect(sug.locator("li").first).to_contain_text("خالد")
    expect(sug.locator(".order-list li").last).to_contain_text("نورة")
    expect(sug).to_contain_text("لا يفاضل بين الأسباب")
    shot(A, "22-ai-suggestion")
    A.get_by_role("button", name="اقترح هذا الترتيب على الأعضاء").click()
    expect(A.get_by_test_id("open-proposal")).to_contain_text("وافق 1 من 3")
    open_circle(B, "جمعية الأولوية")
    B.get_by_role("button", name="أوافق على هذا الترتيب").click()
    expect(B.get_by_text("وافقت. يُعتمد الترتيب")).to_be_visible()
    open_circle(C, "جمعية الأولوية")
    expect(C.get_by_test_id("open-proposal")).to_contain_text("وافق 2 من 3")
    shot(C, "23-vote-phone")
    C.get_by_role("button", name="أعترض").click()
    C.get_by_label("سبب الاعتراض (يراه الجميع)").fill("تغيّر ظرفي وأحتاج الدور الثاني")
    C.get_by_role("button", name="أرسل الاعتراض").click()
    expect(C.get_by_text("اعتُرض على الاقتراح السابق")).to_be_visible()
    A.reload()
    A.get_by_test_id("payout-order").get_by_role("radio", name="بالاتفاق").click()
    A.get_by_role("button", name="قدّم خالد").click()
    A.get_by_role("button", name="أخّر سارة").click()
    expect(A.get_by_test_id("build-order").locator("li").nth(1)).to_contain_text("نورة")
    A.get_by_label("ملاحظة للأعضاء (اختياري)").fill("كما اتفقنا في المحادثة")
    A.get_by_role("button", name="اقترح الترتيب على الأعضاء").click()
    for pg in (B, C):
        pg.reload()
        pg.get_by_role("button", name="أوافق على هذا الترتيب").click()
    expect(C.get_by_test_id("celebration")).to_contain_text("اعتُمد الترتيب بموافقة الجميع")
    expect(C.get_by_test_id("celebration").locator(".reveal-list li").first).to_contain_text("خالد")
    shot(C, "26-celebration-phone")
    C.get_by_test_id("celebration").get_by_role("button", name="إغلاق").click()
    expect(C.get_by_test_id("order-adopted")).to_be_visible()
    open_circle(A, "جمعية الأولوية")
    expect(A.get_by_test_id("order-adopted")).to_contain_text("بالاتفاق")
    expect(A.get_by_test_id("my-turn")).to_contain_text("3")

    # 5c. Smart transfer: reference + steps, then the automatic match flags a short amount for the recipient
    open_circle(A, "جمعية الأولوية", "المدفوعات")
    A.get_by_role("button", name="سجّل تحويلك").first.click()
    A.get_by_role("button", name="اعرض بيانات التحويل").click()
    expect(A.get_by_test_id("transfer-ref")).to_have_text(re.compile(r"^JM-[A-Z2-9]{4}-[A-Z2-9]{4}$"))
    A.get_by_text("خطوات التحويل").first.click()
    expect(A.get_by_test_id("pay-to")).to_contain_text("تحويل فوري")
    A.get_by_label("وسيلة التحويل").select_option("IBAN_SA")
    A.get_by_label("المبلغ الذي حوّلته").fill("900")
    A.get_by_label("رقم العملية (اختياري)").fill("SARIE-5521")
    A.get_by_label("إيصال التحويل (PDF أو صورة)").set_input_files({"name": "r.png", "mimeType": "image/png", "buffer": receipt_png()})
    shot(A, "24-transfer-card")
    A.get_by_role("button", name="أرسل الإيصال للاعتماد").click()
    expect(A.get_by_text("أُرسل الإيصال")).to_be_visible()
    open_circle(B, "جمعية الأولوية", "المدفوعات")
    expect(B.get_by_test_id("match")).to_contain_text("1 ملاحظة للمراجعة")
    expect(B.get_by_test_id("match")).to_contain_text("المبلغ يطابق القسط")
    shot(B, "25-match-phone")
    no_hscroll(B, "match-phone")

    # 6. Large circle: notes payable to the organizer, platform approval, then the draw unlocks
    create_circle(A, "الجمعية الكبيرة", "20000", 3, "2027-02-01", "كبيرة")
    expect(A.get_by_test_id("tier-rule")).to_contain_text("سند لأمر")
    A.get_by_role("button", name="أنشئ الجمعية").click()
    invite_and_join(A, [(B, "خالد"), (C, "نورة")], "الجمعية الكبيرة")
    for pg, ref in ((B, "NFTH-2001"), (C, "NFTH-2002")):
        open_circle(pg, "الجمعية الكبيرة")
        pg.get_by_label("ملف السند (PDF أو صورة)").set_input_files({"name": "note.pdf", "mimeType": "application/pdf", "buffer": PDF})
        pg.get_by_label("رقم السند المرجعي").fill(ref)
        pg.get_by_role("button", name="ارفع السند").click()
        expect(pg.get_by_text("رُفع السند")).to_be_visible()
    open_circle(A, "الجمعية الكبيرة")
    expect(A.get_by_role("button", name="جهّز القرعة الرسمية")).to_have_count(0)
    A.get_by_role("button", name="اطلب اعتماد إدارة المنصة").click()
    expect(A.get_by_test_id("large-notes")).to_contain_text("قيد مراجعة إدارة المنصة")
    shot(A, "09-large-pending")

    R = browser.new_context(viewport=desk, locale="ar-SA", timezone_id="Asia/Riyadh").new_page()
    record(R, "R")
    watch(R, "Reviewer")
    sign_in(R, "0500000900", "مراجعة المنصة")
    nav(R, "الإدارة")
    expect(R.get_by_test_id("review-item")).to_contain_text("الجمعية الكبيرة")
    expect(R.get_by_test_id("review-item").locator("li")).to_have_count(2)
    shot(R, "10-admin-review")
    R.get_by_role("button", name="اعتمد الجمعية").click()
    expect(R.get_by_text("لا توجد جمعيات بانتظار المراجعة")).to_be_visible()
    R.reload()
    expect(R.get_by_role("navigation", name="جمعيتي").get_by_role("link", name="الإدارة")).to_be_visible()
    A.reload()
    expect(A.get_by_test_id("large-notes")).to_contain_text("معتمدة")
    expect(A.get_by_role("button", name="جهّز القرعة الرسمية")).to_be_visible()

    # 7. Skins, English/LTR, notifications, mobile sheet
    A.get_by_role("button", name=re.compile("^المظهر")).click()
    A.get_by_role("menuitemradio", name="داكن").click()
    expect(A.locator("html")).to_have_attribute("data-skin", "dark")
    open_circle(A, "جمعية الحي")
    shot(A, "11-overview-dark")
    A.get_by_role("button", name=re.compile("^المظهر")).click()
    A.get_by_role("menuitemradio", name="ساطع").click()
    expect(A.locator("html")).to_have_attribute("data-skin", "bright")
    shot(A, "12-overview-bright")
    A.get_by_role("button", name="English").click()
    expect(A.locator("html")).to_have_attribute("dir", "ltr")
    A.get_by_role("navigation", name="Jamiyati").get_by_role("link", name="Home").click()
    expect(A.get_by_role("heading", name="Hello, سارة")).to_be_visible()
    shot(A, "13-home-english-bright")
    A.get_by_role("button", name="العربية").click()
    B.goto(BASE + "/#/")
    expect(B.get_by_test_id("unread")).to_be_visible()
    B.get_by_role("button", name=re.compile("^الإشعارات")).click()
    shot(B, "14-notifications-phone")
    B.keyboard.press("Escape")
    bottom = B.locator("nav.bottom-nav")
    expect(bottom).to_be_visible()
    expect(A.locator("nav.bottom-nav")).to_be_hidden()          # desktop uses the sidebar
    expect(A.locator("aside.sidebar")).to_be_visible()
    h = bottom.get_by_role("link", name="أهدافي").bounding_box()["height"]
    if h < 44: problems.append(f"bottom-nav touch target {h}px < 44")
    bottom.get_by_role("link", name="أهدافي").click()
    B.get_by_role("tab", name="قدرتك على الادخار").click()
    expect(B.get_by_role("heading", name="كم تستطيع أن تدخر بجمعية؟")).to_be_visible()
    expect(bottom.get_by_role("link", name="أهدافي")).to_have_attribute("aria-current", "page")
    shot(B, "15-bottom-nav-phone")
    no_hscroll(B, "advisor-phone")
    nav(B, "حسابي")
    expect(B.get_by_test_id("install-panel")).to_be_visible()

    # 7b. One layout per breakpoint (375 / 768 / 1024 / 1440 + phone landscape), no horizontal scroll
    for w, hgt, name in ((375, 812, "16-home-375"), (768, 1024, "17-home-768-tablet"), (1024, 768, "18-home-1024"), (1440, 900, "19-home-1440"), (844, 390, "20-home-phone-landscape")):
        B.set_viewport_size({"width": w, "height": hgt})
        B.goto(BASE + "/#/")
        expect(B.get_by_role("heading", name="أهلاً خالد")).to_be_visible()
        side = B.locator("aside.sidebar").is_visible()
        if side != (w >= 1024): problems.append(f"sidebar visible={side} at {w}px")
        no_hscroll(B, name)
        B.screenshot(path=f"{SHOTS}/{name}.png")
    B.set_viewport_size(phone)

    # 7c. v0.11: goals + smart planner → prefilled wizard; Friday circle with pledge; WhatsApp invite;
    #     organizer edits the money terms → members re-confirm or leave; organizer removes a member with a reason
    nav(A, "أهدافي")
    A.get_by_role("tab", name="المخطط الذكي").click()
    A.get_by_label("المبلغ الذي تحتاجه (ريال)").fill("24000")
    A.get_by_label("كم تستطيع شهرياً؟ (اختياري)").fill("3000")
    A.get_by_role("button", name="اقترح جمعيات").click()
    expect(A.get_by_test_id("plan").first).to_contain_text("ريال")
    shot(A, "30-planner")
    A.get_by_role("link", name="أنشئ هذه الجمعية").first.click()
    expect(A.get_by_text("عبّأنا الحقول من خطة المخطط الذكي")).to_be_visible()
    expect(A.get_by_test_id("preview-pot")).to_contain_text("24,000")
    nav(A, "أهدافي")
    A.get_by_role("button", name="جمعية الحج والعمرة").click()
    A.get_by_label("المبلغ المطلوب (ريال)").fill("20000")
    A.get_by_role("button", name="احفظ الهدف").click()
    expect(A.get_by_test_id("goal")).to_contain_text("20,000")
    shot(A, "31-goals")
    nav(A, "الرئيسية")
    expect(A.get_by_test_id("hero")).to_be_visible()
    A.get_by_test_id("start-types").get_by_role("link", name="جمعية الجمعة").click()
    expect(A.get_by_text("جمعية الجمعة: القسط أسبوعي")).to_be_visible()
    A.get_by_label("اسم الجمعية").fill("جمعية جمعة الحي")
    A.get_by_label("عدد الأعضاء").fill("4")
    A.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    A.get_by_role("button", name="التالي").click()
    expect(A.get_by_test_id("pledge-total")).to_contain_text("600")      # 3 weekly installments × 200
    sign_pledge(A, "سارة")
    shot(A, "32-pledge")
    A.get_by_role("button", name="أنشئ الجمعية").click()
    expect(A.get_by_role("heading", name="جمعية جمعة الحي")).to_be_visible()
    # direct invitation: everyone she already shares a circle with, plus a number that has no account yet
    di = A.get_by_test_id("direct-invite")
    di.get_by_role("button", name=re.compile("اختر الكل")).click()
    di.get_by_label("أو اكتب أرقام الجوال").fill("0555000999")
    di.get_by_role("button", name=re.compile("أرسل الدعوة إلى")).click()
    expect(A.get_by_test_id("direct-result")).to_contain_text("خالد")
    expect(A.get_by_test_id("direct-result").get_by_role("link", name="أرسل عبر واتساب")).to_have_attribute("href", re.compile(r"^https://wa\.me/966555000999\?text="))
    shot(A, "32b-direct-invite")
    nav(B, "الرئيسية"); B.reload()
    expect(B.get_by_test_id("my-invitations")).to_contain_text("جمعية جمعة الحي")
    shot(B, "32c-invitation-home-phone")
    B.get_by_test_id("my-invitations").get_by_role("link", name="راجع وانضم").click()
    expect(B.get_by_test_id("invite-card")).to_contain_text("جمعية جمعة الحي")
    B.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    sign_pledge(B, "خالد")
    B.get_by_role("button", name="انضم إلى الجمعية").click()
    expect(B.get_by_role("heading", name="جمعية جمعة الحي")).to_be_visible()
    B.get_by_test_id("celebration").get_by_role("button", name="إغلاق").click()
    invite_and_join(A, [(C, "نورة")], "جمعية جمعة الحي")
    expect(A.get_by_role("link", name="أرسل عبر واتساب").first).to_have_attribute("href", re.compile(r"^https://wa\.me/\?text=.*%D8"))
    shot(B, "33-join-phone")
    open_circle(A, "جمعية جمعة الحي")
    A.get_by_test_id("edit-circle").locator("summary").click()
    A.get_by_test_id("edit-circle").get_by_label("مساهمة كل عضو").fill("300")
    expect(A.get_by_test_id("edit-preview")).to_contain_text("سيُطلب من 2 أعضاء")
    sign_pledge(A, "سارة", A.get_by_test_id("edit-preview"))
    A.get_by_role("button", name="احفظ التعديلات").click()
    expect(A.get_by_text("حُفظت التعديلات.")).to_be_visible()
    open_circle(B, "جمعية جمعة الحي")
    expect(B.get_by_test_id("reconfirm")).to_be_visible()
    shot(B, "34-reconfirm-phone")
    no_hscroll(B, "reconfirm-phone")
    sign_pledge(B, "خالد", B.get_by_test_id("reconfirm"))
    B.get_by_role("button", name="أوافق وأوقّع").click()
    expect(B.get_by_test_id("reconfirm")).to_have_count(0)
    open_circle(C, "جمعية جمعة الحي")
    C.get_by_test_id("reconfirm").get_by_role("button", name="انسحب من الجمعية").click()
    C.get_by_role("button", name="نعم، انسحب").click()
    expect(C.get_by_role("heading", name="جمعياتي")).to_be_visible()
    A.reload()
    expect(A.get_by_text("نورة")).to_have_count(0)
    A.get_by_role("button", name="أزل خالد").click()
    A.get_by_label("سبب الإزالة (يراه الجميع)").fill("اتفقنا على جمعية عائلية")
    A.get_by_role("button", name="أزل العضو").click()
    expect(A.locator("ol.list li")).to_have_count(1)
    shot(A, "35-managed")

    # 8. Session survives reload; sign-out clears it
    nav(A, "الرئيسية")
    A.reload()
    expect(A.get_by_role("heading", name="أهلاً سارة")).to_be_visible()
    A.get_by_role("button", name="حسابي").click()
    A.get_by_role("menuitem", name="خروج").click()
    expect(A.get_by_role("button", name="أرسل الرمز")).to_be_visible()
    browser.close()

if problems:
    print("\n".join(problems))
    sys.exit(1)
print("UI journey passed: greeter slider (woman, man, young man, girl), direct invitations (people from other circles + unregistered number via WhatsApp, Home «دعوات لك» → join), onboarding (4 slides), circle-type wizard with the signed payment pledge, invite card + pledge before joining, WhatsApp invite, smart planner → prefilled wizard, goals, Friday circle, edit money terms → re-confirm / leave / remove with reason, turn picker with no fees, draw wheel (invite all, countdown, live for the organizer, auto-shown to waiting members, result card in chat), animated sign-in illustration (stops under reduced motion), celebrations with name-by-name reveal after the draw / adoption / payment, payout order by priority (AI suggestion) → objection → agreed order approved by all, smart transfer card + automatic match, payout methods, identity logo, medium circle (reject, dispute, resolve, confirm, complete), chat + assistant, large circle (notes → platform approval), 4 skins, RTL/LTR, notifications, adaptive sidebar/bottom nav, install panel, breakpoints 375/768/1024/1440 + landscape with no horizontal scroll")
