"""WCAG contrast check for every text/background token pair in each skin of apps/web/src/styles.css."""
import re, sys, pathlib
css = pathlib.Path(__file__).resolve().parent.parent.joinpath("apps/web/src/styles.css").read_text()
def block(start):
    i = css.index(start); j = css.index("}", i); return dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", css[i:j]))
light = block(":root {")
skins = {"light": light, "dark": {**light, **block(":root[data-skin='dark'] {")}, "bright": {**light, **block(":root[data-skin='bright'] {")}}
def lum(h):
    c = [int(h[k:k+2], 16) / 255 for k in (1, 3, 5)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + .05) / (lb + .05)
pairs = [("ink", "bg", 4.5), ("ink", "surface", 4.5), ("muted", "surface", 4.5), ("muted", "bg", 4.5), ("accent-ink", "accent", 4.5),
         ("accent-strong", "accent-tint", 4.5), ("ok", "ok-tint", 4.5), ("danger", "danger-tint", 4.5), ("info", "info-tint", 4.5),
         ("control-line", "surface", 3.0), ("focus", "surface", 3.0), ("focus", "bg", 3.0), ("accent-strong", "surface", 3.0),
         ("turn-ink", "turn-tint", 4.5), ("hero-ink", "hero-a", 4.5), ("hero-ink", "hero-b", 4.5), ("turn-on", "turn", 4.5)]
# --accent (teal) is the primary fill behind --accent-ink; --turn (saffron) marks your turn and carries ink text.
# --accent was gold before 0.11 and is used only as a fill behind --accent-ink text or with a darker --accent-strong edge, never alone.
bad = 0
for name, t in skins.items():
    for fg, bg, need in pairs:
        r = ratio(t[fg], t[bg]); ok = r >= need; bad += not ok
        print(f"{name:6} {fg:>13} on {bg:<12} {r:5.2f} {'ok' if ok else f'FAIL (<{need})'}")
sys.exit(1 if bad else 0)
