"""
Owner request 2026-11-18, in a real browser against the real API:
- receipts: the camera button (live camera on a computer, the phone's camera on a phone), photos, files; a large photo is
  reduced under 5 MB before upload and previewed; Arabic error messages;
- replacing a member with another after the circle started: member asks → organizer approves → link → newcomer signs and
  takes the same turn;
- editing your own name; the language button shows the language it switches to.
Setup (people, a started circle) goes through the API; everything the owner asked about goes through the screens.
"""
import json, os, re, struct, sys, urllib.request, zlib
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3100")
ipn = [40]


def call(method, path, body=None, token=None, ip=None):
    req = urllib.request.Request(BASE + "/api/v1" + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("content-type", "application/json")
    if token: req.add_header("authorization", "Bearer " + token)
    if ip: req.add_header("x-forwarded-for", ip)
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise AssertionError(f"{method} {path} → {e.code} {e.read()[:300]}")


def person(name, phone):
    ip = f"10.77.0.{ipn[0]}"; ipn[0] += 1
    code = call("POST", "/auth/otp/request", {"phone": phone}, ip=ip)["devCode"]
    r = call("POST", "/auth/otp/verify", {"phone": phone, "code": code, "fullName": name}, ip=ip)
    return {"name": name, "ip": ip, "token": r["accessToken"], "refresh": r["refreshToken"], "user": r["user"]}


def as_(p, method, path, body=None): return call(method, path, body, p["token"], p["ip"])


def started_circle(o, members):
    ag = as_(o, "GET", "/agreements/current")["id"]
    body = {"name": "جمعية الجيران", "country": "SA", "frequency": "MONTHLY", "contribution": "400", "memberCount": len(members) + 1, "startDate": "2027-04-01", "category": "FAMILY"}
    pv = as_(o, "POST", "/gamiyas/pledge-preview", body)
    g = as_(o, "POST", "/gamiyas", {**body, "agreementVersionId": ag, "pledge": {"typedName": o["name"], "textSha256": pv["textSha256"]}})
    code = as_(o, "POST", f"/gamiyas/{g['id']}/invitations", {"maxUses": len(members)})["code"]
    for m in members:
        inv = as_(m, "GET", f"/invitations/{code}")
        as_(m, "POST", f"/invitations/{code}/accept", {"agreementVersionId": ag, "pledge": {"typedName": m["name"], "textSha256": inv["pledge"]["textSha256"]}})
    as_(o, "POST", f"/gamiyas/{g['id']}/lottery/prepare")
    as_(members[0], "POST", f"/gamiyas/{g['id']}/lottery/approve")
    as_(o, "POST", f"/gamiyas/{g['id']}/lottery/execute", {"publicEntropy": "members-journey"})
    return g["id"]


def big_png(w=2600, h=1900):
    """A noisy photo-sized PNG (well over 5 MB) to prove the app shrinks it before upload."""
    rows = bytearray()
    seed = 12345
    for y in range(h):
        rows.append(0)
        for x in range(w):
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            rows += bytes(((seed >> 3) & 255, (seed >> 11) & 255, (x * 255 // w)))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(rows), 1)) + chunk(b"IEND", b"")


def open_as(browser, p, **ctx):
    c = browser.new_context(locale="ar-SA", **ctx)
    # Seed the session once; later navigations keep the rotated refresh token the app stored.
    c.add_init_script(f"""if (!localStorage.getItem('sg.refresh')) {{
      localStorage.setItem('sg.refresh', {json.dumps(p['refresh'])}); localStorage.setItem('sg.user', {json.dumps(json.dumps(p['user']))});
    }} localStorage.setItem('sg.onboarded', '1');""")
    pg = c.new_page()
    pg.on("pageerror", lambda e: (_ for _ in ()).throw(AssertionError(f"page error: {e}")))
    return pg


def shot(page, name):
    d = os.environ.get("SHOTS_DIR")
    if d: page.screenshot(path=os.path.join(d, f"{name}.png"))


def goto_circle(page, gid, tab):
    """Open a circle tab; a member who missed the draw sees the wheel once: skip to the result and close it."""
    page.goto(f"{BASE}/#/c/{gid}/{tab}")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(700)
    stage = page.get_by_test_id("draw-stage")
    if stage.count():
        skip = page.get_by_role("button", name="تخطَّ إلى النتيجة")
        if skip.count(): skip.click()
        expect(stage).to_have_attribute("data-phase", "reveal", timeout=25000)
        stage.get_by_role("button", name="إغلاق").click()
        expect(stage).to_have_count(0)


def sign_pledge(page, name):
    box = page.get_by_test_id("pledge").last
    for cb in box.locator(".pledge-clauses input[type=checkbox]").all(): cb.check()
    box.get_by_label("اكتب اسمك الكامل توقيعاً").fill(name)


def main():
    O = person("أم ناصر", "+966500000701"); A = person("عبدالرحمن", "+966500000702"); B = person("بشاير", "+966500000703"); D = person("دلال", "+966500000704")
    gid = started_circle(O, [A, B])
    a_turn = next(m["payoutPosition"] for m in as_(O, "GET", f"/gamiyas/{gid}")["members"] if m["fullName"] == A["name"])

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])

        # 1. The member asks for someone to take their place; asking twice gives the Arabic error.
        pa = open_as(browser, A, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        goto_circle(pa, gid, "overview")
        pa.get_by_role("button", name="اطلب من يحلّ محلي").click()
        pa.get_by_label("السبب (يراه المعنيون)").fill("انتقلت إلى مدينة أخرى")
        pa.get_by_role("button", name="ابدأ الاستبدال").click()
        panel = pa.get_by_test_id("seat-transfers")
        expect(panel.get_by_text("بانتظار اعتماد المنظم")).to_be_visible()
        expect(panel.get_by_text("وافق العضو")).to_be_visible()
        pa.get_by_role("button", name="اطلب من يحلّ محلي").click()
        pa.get_by_label("السبب (يراه المعنيون)").fill("مرة ثانية")
        pa.get_by_role("button", name="ابدأ الاستبدال").click()
        expect(pa.get_by_role("alert")).to_have_text("يوجد طلب استبدال مفتوح لهذا العضو.")

        # 2. The organizer approves and gets the one-time link.
        po = open_as(browser, O, viewport={"width": 1280, "height": 860})
        goto_circle(po, gid, "overview")
        op = po.get_by_test_id("seat-transfers")
        expect(op.get_by_text("استبدال عبدالرحمن")).to_be_visible()
        op.get_by_role("button", name="اعتمد").click()
        link = op.locator(".seat-link").inner_text()
        op.scroll_into_view_if_needed(); shot(po, "20-replace-link-organizer")
        assert re.search(r"/#/seat/[A-Za-z0-9_-]+$", link), link
        expect(op.get_by_role("link", name=re.compile("واتساب"))).to_have_attribute("href", re.compile(r"^https://wa\.me/\?text="))

        # 3. The newcomer opens the link, sees exactly what they take over, signs, and takes the same turn.
        pd = open_as(browser, D, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        pd.goto(BASE + "/#/seat/" + link.split("/#/seat/")[1])
        expect(pd.get_by_test_id("take-seat")).to_be_visible()
        expect(pd.get_by_text(f"ستحلّ محلّ {A['name']} — الدور رقم {a_turn}")).to_be_visible()
        expect(pd.get_by_text(re.compile("يبقى في سجله ولا يُحسب لك"))).to_be_visible()
        shot(pd, "21-take-seat-phone")
        pd.get_by_label("قرأت الاتفاقية وأوافق عليها").check()
        sign_pledge(pd, D["name"])
        pd.get_by_role("button", name="وقّع وخذ المقعد").click()
        expect(pd).to_have_url(re.compile(f"#/c/{gid}"))
        goto_circle(pd, gid, "overview")
        expect(pd.locator("ol.list").first).to_contain_text(f"{a_turn}. {D['name']} (أنت)")
        assert A["name"] not in pd.locator("ol.list").first.inner_text()

        # 4. Receipts on a phone: three ways in; the camera button opens the phone camera (capture), a big photo is reduced.
        goto_circle(pd, gid, "payments")
        pd.get_by_role("button", name="سجّل تحويلك").first.click()
        picker = pd.get_by_test_id("receipt-picker")
        for label in ("صوّر الإيصال", "من الاستوديو", "من الملفات"):
            expect(picker.get_by_role("button", name=label)).to_be_visible()
        picker.scroll_into_view_if_needed(); shot(pd, "22-receipt-picker-phone")
        assert picker.get_by_test_id("rc-camera").get_attribute("capture") == "environment"
        with pd.expect_file_chooser() as fc:
            picker.get_by_role("button", name="صوّر الإيصال").click()
        big = big_png()
        assert len(big) > 5 * 1024 * 1024, len(big)
        fc.value.set_files({"name": "IMG_2041.png", "mimeType": "image/png", "buffer": big})
        expect(picker.locator(".rc-name")).to_have_text("IMG_2041.jpg", timeout=20000)
        size = float(picker.locator(".rc-name + .muted").inner_text().split()[0])
        assert size < 5, f"reduced to {size} MB"
        expect(picker.locator("img.rc-thumb")).to_be_visible()
        shot(pd, "23-receipt-photo-reduced")
        picker.get_by_role("button", name="احذف").click()
        picker.get_by_test_id("rc-file").set_input_files({"name": "receipt.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4\n%receipt\n%%EOF"})
        expect(picker.locator(".rc-doc")).to_have_text("PDF")
        # The reduced photo really uploads and is accepted as a receipt.
        picker.get_by_role("button", name="احذف").click()
        picker.get_by_test_id("rc-gallery").set_input_files({"name": "IMG_2042.png", "mimeType": "image/png", "buffer": big})
        expect(picker.locator(".rc-name")).to_have_text("IMG_2042.jpg", timeout=20000)
        pd.get_by_label("وسيلة التحويل").select_option(index=1)
        pd.get_by_role("button", name="أرسل الإيصال للاعتماد").click()
        expect(pd.get_by_text("أُرسل الإيصال. سيصلك إشعار عند الاعتماد.")).to_be_visible(timeout=15000)

        # 5. Receipts on a computer: the camera button opens a live camera; one tap captures the photo.
        goto_circle(po, gid, "payments")
        po.get_by_role("button", name="سجّل تحويلك").first.click()
        pk = po.get_by_test_id("receipt-picker")
        pk.get_by_role("button", name="صوّر الإيصال").click()
        cam = po.get_by_test_id("live-camera")
        expect(cam).to_be_visible()
        expect(cam.get_by_role("button", name="التقط الصورة")).to_be_enabled()
        shot(po, "24-live-camera-computer")
        cam.get_by_role("button", name="التقط الصورة").click()
        expect(cam).to_be_hidden()
        expect(pk.locator(".rc-name")).to_have_text(re.compile(r"^receipt-\d+\.jpg$"))
        expect(pk.get_by_text(re.compile("أو اسحب الملف هنا"))).to_have_count(0)

        # 6. Edit your own name; the header follows. The language button names the language it switches to.
        pd.goto(f"{BASE}/#/account")
        pd.get_by_role("button", name="عدّل").click()
        pd.get_by_label("اسمك كما يراه أعضاء الجمعية").fill("دلال  الحربي")
        pd.get_by_role("button", name="احفظ الاسم").click()
        expect(pd.locator("dl.kv dd").first).to_contain_text("دلال الحربي")
        assert as_(D, "GET", "/auth/me")["fullName"] == "دلال الحربي"
        expect(po.locator(".lang-label")).to_have_text("EN")
        po.locator(".lang-btn").click()
        expect(po.locator("html")).to_have_attribute("lang", "en")
        expect(po.locator(".lang-label")).to_have_text("ع")
        po.locator(".lang-btn").click()

        browser.close()
    print("Members journey passed: member asks to be replaced → Arabic error on a duplicate → organizer approves → one-time link + WhatsApp → newcomer sees turn, payments and private-settlement note, signs, takes the same turn; receipt picker on a phone (camera opens the phone camera, 6+ MB photo reduced under 5 MB with preview, PDF, reduced photo uploaded and sent for approval), live camera capture on a computer; edit name; language button label")


if __name__ == "__main__":
    main()
