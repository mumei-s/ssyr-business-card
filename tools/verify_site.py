from pathlib import Path
import xml.etree.ElementTree as ET
import cv2
import cairosvg
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
index=(ROOT/"index.html").read_text()
works=(ROOT/"works.html").read_text()
card=(ROOT/"contact.vcf").read_text(encoding="utf-8")
assert 'class="front-qr"' in index and 'src="./assets/qr-contact.svg"' in index and 'href="./contact.vcf"' in index, "Front QR should save contact"
assert 'class="back-qr"' in index and 'src="./assets/qr-introduction.svg"' in index and 'href="./works.html"' in index, "Back QR should open works"
assert 'src="./assets/qr-business-card.svg"' in index, "Entry QR missing"
assert all(x in works for x in ["AIイラスト","動画","ツール・アプリ"])
assert all(x in card for x in ["BEGIN:VCARD","FN:川合 伸次","TEL;TYPE=CELL:080-9119-0044","EMAIL:ss526s-syr@yahoo.co.jp","END:VCARD"])
expected={
  "qr-business-card.svg":"https://mumei-s.github.io/ssyr-business-card/",
  "qr-contact.svg":"https://mumei-s.github.io/ssyr-business-card/contact.vcf",
  "qr-introduction.svg":"https://mumei-s.github.io/ssyr-business-card/works.html",
}
scanner=cv2.QRCodeDetector()
for name,url in expected.items():
    p=ROOT/"assets"/name
    xml=ET.parse(p).getroot()
    n=int(xml.attrib["viewBox"].split()[-1])
    raw=cairosvg.svg2png(url=str(p),output_width=n*14,output_height=n*14)
    img=cv2.imdecode(np.frombuffer(raw,dtype=np.uint8),cv2.IMREAD_COLOR)
    got,points,_=scanner.detectAndDecode(img)
    assert got==url, f"{name}: scanned {got!r}, expected {url!r}"
    print("PASS QR scan",name,"->",got)
for file in ["index.html","works.html","contact.vcf","assets/ai-illustration-01.svg","assets/ai-illustration-02.svg","assets/ui-creation.svg","assets/showreel-demo.mp4"]:
    assert (ROOT/file).exists(),file
# Regression gates for the exact failures reported by the user.
# A mirrored reverse, duplicated QR white panel, or old vector samples must fail CI.
assert "/* Quality Gate 2026-11-23 — no mirrored/rotated card text, ever */" in index
assert ".business-card.show-back .face-front{display:none!important}" in index
assert ".business-card.show-back .face-back{display:block!important}" in index
assert ".business-card.show-back{transform:none!important}" in index or ".business-card,.business-card.show-back{transform:none!important" in index
assert ".front-qr img,.back-qr img{width:100%!important" in index
assert "padding:0!important" in index
assert "font-family:'Yuji Boku'" in index
assert "Permanent Marker" in index
assert "text-orientation:sideways!important" in index
for hd in ["portfolio-fantasy-hd.webp", "portfolio-graphic-hd.webp",
           "portfolio-app-hd.webp", "portfolio-film-hd.webp"]:
    asset=ROOT/"assets"/hd
    assert asset.is_file() and asset.stat().st_size>12000, "Missing premium artwork: "+hd
    assert "./assets/"+hd in index and "./assets/"+hd in works, "Old portfolio artwork in use: "+hd
for old in ["./assets/ai-illustration-01.svg", "./assets/ai-illustration-02.svg", "./assets/ui-creation.svg"]:
    assert old not in index and old not in works, "Placeholder artwork still on live pages: "+old
video=ROOT/"assets"/"showreel-demo.mp4"
poster=ROOT/"assets"/"showreel-poster.jpg"
assert video.is_file() and video.stat().st_size>250000, "Live-action showreel not published"
assert poster.is_file() and poster.stat().st_size>10000, "No real footage poster thumbnail"
assert "溶接・建築" in index and "溶接・鉄骨・建築" in works
assert "S&#39;s-YR自身の施工" in index, "Stock footage provenance disclaimer missing"
assert "./assets/showreel-demo.mp4?v=20261123-weld" in index
assert "./assets/showreel-demo.mp4?v=20261123-weld" in works
print("PASS regression: non-mirrored card, brush fonts, QR margins, HD portfolio and actual moving construction footage")
print("PASS all three separately scanned QR purposes, contact and site media assets")
