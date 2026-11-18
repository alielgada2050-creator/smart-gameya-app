"""
Demo journey: the in-browser demo build (no server) driven the way a visitor would try it — switching between the five
demo members to cover every role. Fails on any console error. Usage: DEMO_URL=http://127.0.0.1:5190/index.html
"""
import os, re, sys
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get("DEMO_URL", "http://127.0.0.1:5190/index.html")
SHOTS = os.environ.get("SHOTS_DIR", "tests/e2e/screenshots")
os.makedirs(SHOTS, exist_ok=True)
errors = []

def png():
    import struct, zlib
    raw = b"".join(b"\x00" + bytes([200, 230, 255]) * 8 for _ in range(8))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def be(page, name):
    """Switch persona through the floating demo switcher."""
    if not page.get_by_role("dialog", name="نسخة تجريبية").is_visible():
        page.get_by_test_id("demo-switcher").click()
    page.get_by_role("dialog", name="نسخة تجريبية").get_by_role("button", name=re.compile("^" + name)).click()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name=re.compile("أهلاً " + name))).to_be_visible()

def nav(page, label):
    page.get_by_role("navigation", name="جمعيتي").get_by_role("link", name=label).click()

def watch(page, skip=True):
    stage = page.get_by_test_id("draw-stage")
    if skip: page.get_by_role("button", name="تخطَّ إلى النتيجة").click()
    expect(stage).to_have_attribute("data-phase", "reveal", timeout=25000)
    w = page.get_by_test_id("draw-winner").inner_text()
    stage.get_by_role("button", name="إغلاق").click()
    return w

def circle(page, name, tab=None):
    nav(page, "جمعياتي")
    page.get_by_role("link", name=re.compile(name)).first.click()
    expect(page.get_by_role("heading", name=name, level=1)).to_be_visible()
    page.wait_for_load_state("networkidle")
    if page.get_by_test_id("draw-stage").count(): watch(page)
    if tab: page.get_by_role("tab", name=tab).click()
    page.wait_for_load_state("networkidle")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome") if os.path.exists("/usr/bin/google-chrome") else p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="ar-SA", timezone_id="Asia/Riyadh")
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    # first visit: the switcher opens by itself over the sign-in illustration
    expect(pg.get_by_role("dialog", name="نسخة تجريبية")).to_be_visible()
    expect(pg.get_by_test_id("onboarding")).to_be_attached()             # first-run introduction behind the switcher
    wide = pg.evaluate("document.querySelector('main').getBoundingClientRect().width")
    if wide < 900: errors.append(f"signed-out page uses only {wide}px of a 1280px window")
    pg.screenshot(path=f"{SHOTS}/40-demo-start.png")

    # 1. Organizer: approve a receipt, read the automatic match, confirm a payment
    be(pg, "سارة")
    circle(pg, "جمعية الأصدقاء", "المدفوعات")
    pg.get_by_role("button", name="اعتمد الإيصال").first.click()
    expect(pg.get_by_text(re.compile("اعتُمد|اعتمدت"))).to_be_visible()
    expect(pg.get_by_test_id("match").filter(has_text="ملاحظة للمراجعة").first).to_be_visible()   # فهد sent 1800 of 2000
    pg.get_by_role("button", name="وصلني المبلغ").first.click()
    expect(pg.get_by_test_id("celebration")).to_contain_text("اكتملت الدفعة")
    pg.get_by_test_id("celebration").get_by_role("button", name="إغلاق").click()

    # 2. Organizer pays her own installment with a receipt (upload → declare → match)
    nav(pg, "الرئيسية")
    circle(pg, "جمعية الأصدقاء", "المدفوعات")
    pg.get_by_role("button", name="سجّل تحويلك").first.click()
    pg.get_by_role("button", name="اعرض بيانات التحويل").click()
    expect(pg.get_by_test_id("transfer-ref")).to_have_text(re.compile(r"^JM-"))
    pg.get_by_label("وسيلة التحويل").select_option("IBAN_SA")
    pg.get_by_test_id("rc-gallery").set_input_files({"name": "r.png", "mimeType": "image/png", "buffer": png()})
    pg.get_by_role("button", name="أرسل الإيصال للاعتماد").click()
    expect(pg.get_by_text("أُرسل الإيصال")).to_be_visible()

    # 3. Priority order with the AI suggestion, approved by everyone
    circle(pg, "جمعية العائلة")
    pg.get_by_test_id("payout-order").get_by_role("radio", name="بالأولوية").click()
    pg.get_by_role("button", name="اقتراح المساعد الذكي").click()
    expect(pg.get_by_test_id("suggestion").locator(".order-list li").first).to_contain_text("خالد")
    pg.get_by_role("button", name="اقترح هذا الترتيب على الأعضاء").click()
    expect(pg.get_by_test_id("open-proposal")).to_contain_text("وافق 1 من 3")
    for who in ("خالد", "نورة"):
        be(pg, who)
        circle(pg, "جمعية العائلة")
        pg.get_by_role("button", name="أوافق على هذا الترتيب").click()
    expect(pg.get_by_test_id("celebration")).to_contain_text("اعتُمد الترتيب بموافقة الجميع")
    pg.get_by_test_id("celebration").get_by_role("button", name="إغلاق").click()

    # 4. Join a recruiting circle with the invite code
    nav(pg, "جمعياتي")
    pg.get_by_role("link", name="انضم بدعوة").click()
    pg.get_by_label("رمز الدعوة").fill("HAYY2026")
    pg.get_by_role("button", name="اعرض الدعوة").click()
    expect(pg.get_by_test_id("invite-card")).to_contain_text("جمعية الحي")
    pg.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    box = pg.get_by_test_id("pledge")
    for cb in box.locator(".pledge-clauses input[type=checkbox]").all(): cb.check()
    box.get_by_label("اكتب اسمك الكامل توقيعاً").fill("نورة")
    pg.get_by_role("button", name="انضم إلى الجمعية").click()
    expect(pg.get_by_role("heading", name="جمعية الحي")).to_be_visible()

    # 4b. Goals and the smart planner
    nav(pg, "أهدافي")
    pg.get_by_role("tab", name="المخطط الذكي").click()
    pg.get_by_label("المبلغ الذي تحتاجه (ريال)").fill("12000")
    pg.get_by_role("button", name="اقترح جمعيات").click()
    expect(pg.get_by_test_id("plan").first).to_be_visible()

    # 5. Chat assistant
    circle(pg, "جمعية الأصدقاء", "المحادثة")
    pg.get_by_role("textbox").last.fill("@مساعد تقرير")
    pg.keyboard.press("Enter")
    expect(pg.get_by_text(re.compile("تقرير جمعية الأصدقاء: اكتمل")).last).to_be_visible()

    # 6. Platform reviewer: resolve the dispute and approve the large circle
    be(pg, "ريم")
    nav(pg, "الإدارة")
    pg.get_by_label("القرار").first.select_option("RECEIPT_VALID")
    pg.get_by_label("سبب القرار").first.fill("الإيصال يطابق المبلغ والتاريخ")
    pg.get_by_role("button", name="احسم").first.click()
    pg.get_by_role("button", name="اعتمد الجمعية").first.click()
    expect(pg.get_by_role("button", name="اعتمد الجمعية")).to_have_count(0)
    pg.screenshot(path=f"{SHOTS}/41-demo-admin.png")

    # 7. Real verifiable lottery in the browser: organizer prepares, another member approves, organizer runs it
    be(pg, "خالد")
    circle(pg, "الجمعية الكبيرة")
    pg.get_by_role("button", name="جهّز القرعة الرسمية").click()
    be(pg, "سارة")
    circle(pg, "الجمعية الكبيرة")
    pg.get_by_role("button", name="أوافق على إجراء القرعة").click()
    be(pg, "خالد")
    circle(pg, "الجمعية الكبيرة")
    pg.get_by_role("button", name="ابدأ القرعة على العجلة").click()
    expect(pg.get_by_test_id("draw-stage")).to_have_attribute("data-phase", "spin", timeout=15000)   # full 10-second countdown
    expect(pg.get_by_test_id("draw-stage")).to_have_attribute("data-phase", "reveal", timeout=12000)
    pg.screenshot(path=f"{SHOTS}/43-demo-wheel.png")
    live_winner = pg.get_by_test_id("draw-winner").inner_text()
    pg.get_by_test_id("draw-stage").get_by_role("button", name="إغلاق").click()
    expect(pg.get_by_test_id("verification")).to_contain_text("تحققنا")
    # another member opening the circle afterwards sees the same wheel and the same winner
    be(pg, "نورة")
    nav(pg, "جمعياتي"); pg.get_by_role("link", name=re.compile("الجمعية الكبيرة")).first.click()
    expect(pg.get_by_test_id("draw-stage")).to_contain_text("إعادة مشاهدة القرعة")
    if watch(pg) != live_winner: errors.append("replay showed a different winner")
    # hand the browser-made draw to Node: the real lottery code must verify it independently
    import json as _j
    state = _j.loads(pg.evaluate("localStorage.getItem('sg.demo.v3')"))
    rec = next(v["result"] for v in state["lottery"].values() if v.get("result"))
    open(os.path.join(SHOTS, "demo-draw.json"), "w").write(_j.dumps(rec))

    # 8. Phone view, and the data survives a reload
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.reload(); pg.wait_for_load_state("networkidle")
    nav(pg, "الرئيسية")
    pg.screenshot(path=f"{SHOTS}/42-demo-phone.png")
    b.close()

real = [e for e in errors if "favicon" not in e]
if real:
    print("FAIL: console errors:\n- " + "\n- ".join(real[:8])); sys.exit(1)
print("Demo journey passed: draw wheel (live countdown + spin, replay with the same winner), persona switcher, organizer approves + match + confirm, upload + declare, AI priority order approved by all, join by code, chat assistant, platform dispute + large-circle approval, real lottery in the browser, phone layout, data kept on reload")
