"""Turns the Vite demo build (apps/web/dist-demo/index.html) into an artifact page body + list of files to publish."""
import json, pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent / "apps/web/dist-demo"
html = (root / "index.html").read_text()
js = re.search(r'<script type="module" crossorigin src="\./(assets/[^"]+)"', html).group(1)
css = re.search(r'<link rel="stylesheet" crossorigin href="\./(assets/[^"]+)"', html).group(1)
page = f"""<title>تجربة جمعيتي</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="نسخة تجريبية تفاعلية من تطبيق جمعيتي لتنظيم جمعيات الادخار، ببيانات وهمية في المتصفح.">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{css}">
<script>document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl';</script>
<div id="root"></div>
<script type="module" src="{js}"></script>
"""
(root / "artifact.html").write_text(page)
files = {str(p.relative_to(root)): str(p) for p in sorted(root.rglob("*")) if p.is_file() and p.name not in ("index.html", "artifact.html", "sw.js", "manifest.webmanifest")}
json.dump(files, open(root / "artifact-files.json", "w"), ensure_ascii=False, indent=1)
print(len(files), "files;", sum(pathlib.Path(v).stat().st_size for v in files.values()) // 1024, "KB")
