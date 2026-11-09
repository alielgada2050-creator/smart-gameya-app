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
    page.get_by_label("رقم الجوال").fill(phone)
    page.get_by_role("button", name="أرسل الرمز").click()
    code = re.search(r"\d{6}", page.get_by_test_id("dev-code").inner_text()).group(0)
    page.get_by_label("رمز التحقق").fill(code)
    page.get_by_label("اسمك كما يراه أعضاء الجمعية").fill(name)
    page.get_by_role("button", name="دخول").click()
    expect(page.get_by_role("heading", name=f"أهلاً {name}")).to_be_visible()


def nav(page, label):
    """Desktop: second-row tab. Phone: open the menu sheet first."""
    if page.viewport_size["width"] <= 640:
        page.get_by_role("button", name="القائمة").click()
        page.get_by_role("navigation", name="القائمة").get_by_role("link", name=label).click()
    else:
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


def open_circle(page, name, tab=None):
    nav(page, "جمعياتي")
    page.get_by_role("link", name=re.compile(name)).first.click()
    expect(page.get_by_role("heading", name=name)).to_be_visible()
    if tab:
        page.get_by_role("tab", name=tab).click()
        if tab == "المدفوعات":
            expect(page.get_by_role("heading", name="مطلوب منك")).to_be_visible()
        page.wait_for_load_state("networkidle")


def create_circle(page, name, contribution, members, start, expect_tier):
    nav(page, "جمعياتي")
    page.get_by_role("link", name="جمعية جديدة").click()
    page.get_by_label("اسم الجمعية").fill(name)
    page.get_by_label(re.compile("مساهمة كل عضو")).fill(contribution)
    page.get_by_label("عدد الأعضاء").fill(str(members))
    page.get_by_label("تاريخ أول دورة").fill(start)
    expect(page.locator(".tier").first).to_have_text(expect_tier)
    page.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    return page


def invite_and_join(org, joiners, circle_name):
    org.get_by_role("button", name="ادعُ أعضاء").click()
    link = org.get_by_test_id("invite-link").inner_text().strip()
    for p in joiners:
        p.goto(link)
        p.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
        p.get_by_role("button", name="انضم إلى الجمعية").click()
        expect(p.get_by_role("heading", name=circle_name)).to_be_visible()


def run_draw(org, approver, circle_name):
    open_circle(org, circle_name)
    org.get_by_role("button", name="جهّز القرعة الرسمية").click()
    expect(org.get_by_test_id("commitment")).to_be_visible()
    open_circle(approver, circle_name)
    approver.get_by_role("button", name="أوافق على إجراء القرعة").click()
    expect(approver.get_by_text("وافقت. بانتظار تنفيذ المنظم.")).to_be_visible()
    org.reload()
    org.get_by_role("button", name="نفّذ القرعة").click()
    expect(org.get_by_test_id("verification")).to_contain_text("تحققنا")


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    phone = {"width": 390, "height": 844}
    desk = {"width": 1280, "height": 900}
    A = browser.new_context(viewport=desk, locale="ar-SA").new_page()   # organizer, desktop
    B = browser.new_context(viewport=phone, locale="ar-SA").new_page()  # member, phone
    C = browser.new_context(viewport=phone, locale="ar-SA").new_page()  # member, phone
    for pg, w in ((A, "A"), (B, "B"), (C, "C")):
        watch(pg, w)

    # 1. Sign-in (hero figure) and validation
    B.goto(BASE)
    expect(B.locator("html")).to_have_attribute("dir", "rtl")
    expect(B.locator(".figure-box [data-hairline]")).to_have_count(1)
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
    expect(A.locator(".logo-strip .logo-plate")).to_have_count(1)
    shot(A, "03-account")

    # 3. Medium circle: 3 × 5,000 = 15,000 SAR, started in the past
    create_circle(A, "جمعية الحي", "5000", 3, "2026-09-01", "متوسطة")
    expect(A.get_by_test_id("preview-pot")).to_have_text("15,000 ريال")
    shot(A, "04-create-medium")
    A.get_by_role("button", name="أنشئ الجمعية").click()
    expect(A.get_by_role("heading", name="جمعية الحي")).to_be_visible()
    invite_and_join(A, [B, C], "جمعية الحي")
    run_draw(A, B, "جمعية الحي")
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
                pg.get_by_label("إيصال التحويل (PDF أو صورة)").set_input_files({"name": "r.png", "mimeType": "image/png", "buffer": PNG})
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

    # 6. Large circle: notes payable to the organizer, platform approval, then the draw unlocks
    create_circle(A, "الجمعية الكبيرة", "20000", 3, "2027-02-01", "كبيرة")
    expect(A.get_by_test_id("tier-rule")).to_contain_text("سند لأمر")
    A.get_by_role("button", name="أنشئ الجمعية").click()
    invite_and_join(A, [B, C], "الجمعية الكبيرة")
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

    R = browser.new_context(viewport=desk, locale="ar-SA").new_page()
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
    B.get_by_role("button", name="القائمة").click()
    expect(B.get_by_role("navigation", name="القائمة")).to_be_visible()
    shot(B, "15-menu-sheet-phone")
    B.get_by_role("navigation", name="القائمة").get_by_role("link", name="المستشار").click()
    expect(B.get_by_role("heading", name="كم تستطيع أن تدخر بجمعية؟")).to_be_visible()
    no_hscroll(B, "advisor-phone")

    # 8. Session survives reload; sign-out clears it
    A.reload()
    expect(A.get_by_role("heading", name="أهلاً سارة")).to_be_visible()
    A.get_by_role("button", name="حسابي").click()
    A.get_by_role("menuitem", name="خروج").click()
    expect(A.get_by_role("button", name="أرسل الرمز")).to_be_visible()
    browser.close()

if problems:
    print("\n".join(problems))
    sys.exit(1)
print("UI journey passed: payout methods, identity logo, medium circle (reject, dispute, resolve, confirm, complete), chat + assistant, large circle (notes → platform approval), 4 skins, RTL/LTR, notifications, mobile sheet, no horizontal scroll at 390px")
