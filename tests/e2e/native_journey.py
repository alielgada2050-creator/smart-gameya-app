"""
Native-app journey: the UI runs as the Android app would (Capacitor platform 'android', files served from the device
origin) on a phone and on a tablet, and every API call goes cross-origin to the server. Also checks that an origin the
server does not list is refused (CORS), and that the browser-only pieces (service worker, Google button) stay off.
"""
import os, re, sys
from playwright.sync_api import sync_playwright, expect

APP = "http://localhost:5180"
API = "http://localhost:3100"
SHOTS = os.environ.get("SHOTS_DIR", "tests/e2e/screenshots")
os.makedirs(SHOTS, exist_ok=True)
AS_ANDROID = "window.CapacitorCustomPlatform = { name: 'android', plugins: {} };"
problems = []

def run(p, device, name, phone, who):
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome") if os.path.exists("/usr/bin/google-chrome") else p.chromium.launch()
    ctx = b.new_context(**device, locale="ar-SA", timezone_id="Asia/Riyadh")
    ctx.add_init_script(AS_ANDROID)
    page = ctx.new_page()
    errors, api_hosts = [], set()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: "/api/v1/" in r.url and api_hosts.add(r.url.split("/api/v1/")[0]))
    page.goto(APP + "/")
    expect(page.locator("html")).to_have_attribute("data-native", "android")
    expect(page.get_by_test_id("onboarding")).to_be_visible()             # first-run introduction, then sign-in
    page.get_by_role("button", name="تخطَّ").click()
    expect(page.get_by_text("المتابعة بحساب Google")).to_have_count(0)   # Google is browser-only
    page.get_by_label("رقم الجوال").fill(phone)
    with page.expect_response(lambda r: r.url.endswith("/auth/otp/request")) as resp:
        page.get_by_role("button", name="أرسل الرمز").click()
    code = resp.value.json()["devCode"]
    page.get_by_label("رمز التحقق").fill(code)
    page.get_by_label("اسمك كما يراه أعضاء الجمعية").fill(who)
    page.get_by_role("button", name="دخول").click()
    expect(page.get_by_role("heading", name=f"أهلاً {who}")).to_be_visible()
    nav = page.get_by_role("navigation", name="جمعيتي")
    nav.get_by_role("link", name="حسابي").click()
    expect(page.get_by_role("heading", name="حسابي")).to_be_visible()
    page.reload()                                      # session survives an app restart (refresh token rotation)
    expect(page.get_by_role("heading", name="حسابي")).to_be_visible()
    sw = page.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0")
    if sw: problems.append(f"{name}: service worker registered inside the app")
    wide = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if wide > 1: problems.append(f"{name}: horizontal scroll {wide}px")
    page.screenshot(path=f"{SHOTS}/{name}.png")
    nav.get_by_role("link", name="الرئيسية").click()
    page.screenshot(path=f"{SHOTS}/{name}-home.png")
    if api_hosts != {API}: problems.append(f"{name}: API calls went to {api_hosts}, expected only {API}")
    real = [e for e in errors if "unimplemented" not in e.lower() and "not implemented on web" not in e.lower()]
    if real: problems.append(f"{name}: console errors {real[:3]}")
    b.close()

with sync_playwright() as p:
    run(p, p.devices["Pixel 7"], "30-android-phone", "0500000701", "ريم")
    run(p, p.devices["iPad (gen 7) landscape"], "31-android-tablet", "0500000702", "فهد")
    # An origin the server does not list must be refused by CORS.
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome") if os.path.exists("/usr/bin/google-chrome") else p.chromium.launch()
    pg = b.new_page()
    pg.goto("http://127.0.0.1:5180/")                # same files, but an origin the server does not list
    blocked = pg.evaluate("""() => fetch('http://localhost:3100/api/v1/config/public', {headers: {'content-type': 'application/json'}})
        .then(() => 'allowed').catch(() => 'blocked')""")
    b.close()
    if blocked != "blocked": problems.append("CORS allowed an unlisted origin")

if problems:
    print("FAIL:\n- " + "\n- ".join(problems)); sys.exit(1)
print("Native journey passed: Android phone (Pixel 7) and tablet (iPad-size landscape) as the app, cross-origin API only, CORS refuses unlisted origins, no service worker, Google hidden, session survives restart, no horizontal scroll")
