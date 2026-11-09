"""
Real-browser journey: two members on two phones run a full circle through the web app.
Run via scripts/test-ui.sh (starts Postgres-backed API serving apps/web/dist on :3100).
"""
import os, re, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3100")
SHOTS = os.environ.get("SHOTS_DIR", "screenshots")
os.makedirs(SHOTS, exist_ok=True)
problems: list[str] = []


def watch(page, who):
    page.on("pageerror", lambda e: problems.append(f"{who} pageerror: {e}"))
    # Web fonts are optional (system fallback); the build sandbox cannot reach Google Fonts.
    is_font = lambda url: "fonts.googleapis.com" in url or "fonts.gstatic.com" in url
    page.on("console", lambda m: m.type == "error" and not is_font(m.location.get("url", "")) and problems.append(f"{who} console: {m.text} @ {m.location.get('url')}"))
    page.on("requestfailed", lambda r: not is_font(r.url) and problems.append(f"{who} request failed: {r.url}"))


def shot(page, name):
    page.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)


def sign_in(page, phone, name):
    page.get_by_label("رقم الجوال").fill(phone)
    page.get_by_role("button", name="أرسل الرمز").click()
    dev = page.get_by_test_id("dev-code").inner_text()
    code = re.search(r"\d{6}", dev).group(0)
    page.get_by_label("رمز التحقق").fill(code)
    page.get_by_label("اسمك كما يراه أعضاء الجمعية").fill(name)
    page.get_by_role("button", name="دخول").click()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    phone_size = {"width": 390, "height": 844}
    A = browser.new_context(viewport=phone_size, locale="ar-SA").new_page()
    B = browser.new_context(viewport=phone_size, locale="ar-SA").new_page()
    watch(A, "A"); watch(B, "B")

    # 1. Sign-in screen and validation
    A.goto(BASE)
    expect(A.locator("html")).to_have_attribute("dir", "rtl")
    shot(A, "01-login")
    A.get_by_label("رقم الجوال").fill("12345")
    A.get_by_role("button", name="أرسل الرمز").click()
    expect(A.get_by_role("alert")).to_contain_text("رقم جوال سعودياً")
    sign_in(A, "0551110001", "سارة")
    expect(A.get_by_role("heading", name="أهلاً سارة")).to_be_visible()
    expect(A.get_by_text("ليست لديك جمعيات بعد")).to_be_visible()
    shot(A, "02-home-empty")

    # 2. Create a 2-member circle that started in the past (so turns are due)
    A.get_by_role("link", name="جمعية جديدة").first.click()
    A.get_by_label("اسم الجمعية").fill("جمعية العائلة")
    A.get_by_label("مساهمة كل عضو (ريال)").fill("500")
    A.get_by_label("عدد الأعضاء").fill("2")
    A.get_by_label("تاريخ أول دورة").fill("2026-09-01")
    expect(A.get_by_test_id("preview-pot")).to_have_text("1,000 ريال")  # computed by the server
    create = A.get_by_role("button", name="أنشئ الجمعية")
    expect(create).to_be_disabled()  # agreement not accepted yet
    A.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    shot(A, "03-create-preview")
    create.click()
    expect(A.get_by_role("heading", name="جمعية العائلة")).to_be_visible()
    expect(A.get_by_text("يستقبل أعضاء")).to_be_visible()

    # 3. Invite link
    A.get_by_role("button", name="ادعُ أعضاء").click()
    link = A.get_by_test_id("invite-link").inner_text().strip()
    assert "/#/join/" in link, link
    shot(A, "04-invite")

    # 4. Member B opens the link, signs in, is taken back to the join screen, accepts, joins
    B.goto(link.replace("http://localhost:3100", BASE))
    sign_in(B, "0551110002", "خالد")
    expect(B.get_by_role("heading", name="انضم بدعوة")).to_be_visible()
    expect(B.get_by_label("رمز الدعوة")).to_have_value(link.split("/join/")[1])
    B.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
    B.get_by_role("button", name="انضم إلى الجمعية").click()
    expect(B.get_by_text("اكتمل العدد")).to_be_visible()

    # 5. Draw: trial, prepare (A), approve (B), execute (A), verified
    A.reload()
    expect(A.get_by_text("اكتمل العدد")).to_be_visible()
    A.get_by_role("button", name="جرّب قرعة تجريبية").click()
    expect(A.get_by_text("نتيجة تجريبية غير ملزمة")).to_be_visible()
    A.get_by_role("button", name="جهّز القرعة الرسمية").click()
    commitment = A.get_by_test_id("commitment").inner_text().strip()
    assert re.fullmatch(r"[0-9a-f]{64}", commitment), commitment
    expect(A.get_by_text("بانتظار موافقة عضو آخر")).to_be_visible()
    B.reload()
    expect(B.get_by_test_id("commitment")).to_have_text(commitment)  # same fingerprint for every member
    B.get_by_role("button", name="أوافق على إجراء القرعة").click()
    expect(B.get_by_text("وافقت. بانتظار تنفيذ المدير.")).to_be_visible()
    A.reload()
    A.get_by_role("button", name="نفّذ القرعة").click()
    expect(A.get_by_test_id("verification")).to_contain_text("تحققنا")
    expect(A.get_by_test_id("my-turn")).to_be_visible()
    shot(A, "05-circle-after-draw")

    # 6. Settlement: each pays the other's turn, each confirms what they received
    for payer in (A, B):
        payer.reload()
        payer.get_by_role("button", name="حوّلت المبلغ").first.click()
        expect(payer.get_by_text("سجّلنا تحويلك")).to_be_visible()
    shot(B, "06-awaiting-confirmation")
    B.goto(BASE + "/#/")
    expect(B.get_by_text("بانتظار تأكيدك")).to_be_visible()
    shot(B, "07-home-to-confirm")
    B.get_by_role("button", name="وصلني المبلغ").click()
    expect(B.get_by_text("تم التأكيد.")).to_be_visible()
    A.goto(BASE + "/#/")
    A.get_by_role("button", name="وصلني المبلغ").click()
    expect(A.get_by_text("تم التأكيد.")).to_be_visible()
    A.goto(BASE + "/#/circles")
    A.get_by_role("link", name=re.compile("جمعية العائلة")).click()
    expect(A.get_by_text("اكتملت الجمعية")).to_be_visible()
    shot(A, "08-circle-completed")

    # 7. Advisor (no AI keys configured here → deterministic template explanation)
    A.get_by_role("link", name="المستشار").click()
    A.get_by_label("الدخل الشهري (ريال)").fill("15000")
    A.get_by_label("المصاريف الشهرية (ريال)").fill("9000")
    A.get_by_label("المبلغ الذي تريد جمعه (ريال)").fill("9000")
    A.get_by_label("خلال كم شهراً؟ (اختياري)").fill("12")
    A.get_by_role("button", name="احسب").click()
    expect(A.get_by_test_id("advice")).to_contain_text("750 ريال")
    expect(A.get_by_text("شرح ثابت من المنصة")).to_be_visible()
    shot(A, "09-advisor")

    # 8. English / LTR and dark mode
    A.get_by_role("button", name="English").click()
    expect(A.locator("html")).to_have_attribute("dir", "ltr")
    A.get_by_role("link", name="Home").click()
    expect(A.get_by_role("heading", name="Hello, سارة")).to_be_visible()
    shot(A, "10-home-english")
    A.get_by_role("button", name="العربية").click()
    A.get_by_role("button", name=re.compile("المظهر")).click()  # system → dark
    expect(A.locator("html")).to_have_attribute("data-theme", "dark")
    A.goto(BASE + "/#/circles")
    A.get_by_role("link", name=re.compile("جمعية العائلة")).click()
    expect(A.get_by_test_id("verification")).to_be_visible()
    shot(A, "11-circle-dark")

    # 9. Session survives reload via refresh token; sign-out clears it
    A.reload()
    expect(A.get_by_role("heading", name="جمعية العائلة")).to_be_visible()
    A.get_by_role("button", name="خروج").click()
    expect(A.get_by_role("button", name="أرسل الرمز")).to_be_visible()

    # 10. Desktop width keeps the single column readable
    D = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
    D.goto(BASE)
    shot(D, "12-login-desktop")
    browser.close()

if problems:
    print("\n".join(problems))
    sys.exit(1)
print("UI journey passed: 2 users, create → invite → join → draw → settle → complete, advisor, EN/LTR, dark mode, session refresh")
