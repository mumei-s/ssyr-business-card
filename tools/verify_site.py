from pathlib import Path
import re
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
index=(ROOT/"index.html").read_text()
works=(ROOT/"works.html").read_text()
card=(ROOT/"contact.vcf").read_text()
assert 'class="front-qr"' in index and 'src="./assets/qr-contact.svg"' in index and 'href="./contact.vcf"' in index, "Front must register contact"
assert 'class="back-qr"' in index and 'src="./assets/qr-introduction.svg"' in index and 'href="./works.html"' in index, "Back must open works"
assert 'src="./assets/qr-business-card.svg"' in index, "Entry QR missing"
assert "AIイラスト" in works and "動画" in works and "ツール・アプリ" in works
for val in ["BEGIN:VCARD","FN:川合 伸次","TEL;TYPE=CELL:080-9119-0044","EMAIL:ss526s-syr@yahoo.co.jp","END:VCARD"]:
    assert val in card,val
for typ in ["qr-contact.svg","qr-introduction.svg","qr-business-card.svg"]:
    root=ET.parse(ROOT/"assets"/typ).getroot()
    assert "svg" in root.tag and len(list(root))>=2,typ
for file in ["index.html","works.html","contact.vcf","assets/ai-illustration-01.svg","assets/ai-illustration-02.svg","assets/ui-creation.svg"]:
    assert (ROOT/file).exists(),file
print("PASS: separate front contact / back works / entry URLs and complete essential site content")
