"""Exercise the two digital-card pages and verify the actual shipping media."""

from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
import subprocess
from threading import Thread
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright
import zxingcpp


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_URL = "https://mumei-s.github.io/ssyr-business-card/"
QR_DESTINATIONS = {"qr-contact.svg": "contact.vcf", "qr-introduction.svg": "works.html"}
ART = {f"portfolio-{kind}-hd.webp" for kind in ("fantasy", "graphic", "app", "film")}
PREVIOUS_REEL_BYTES = 1_384_814


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


@contextmanager
def serve():
    handler = partial(QuietHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/"
        finally:
            server.shutdown()
            thread.join()


def check_face(face, destination):
    expect(face).to_be_visible()
    link = face.locator(f'a[href$="{destination}"]').filter(has=face.page.locator("img")).first
    qr_image = link.locator("img")
    qr = zxingcpp.read_barcode(Image.open(BytesIO(qr_image.screenshot())))
    assert qr and qr.text == PUBLIC_URL + destination, f"Bad rendered QR on {destination} face"
    # A reversed ancestor mirrors all of its children, including readable text.
    mirrored = face.evaluate("""element => {
        for (let node = element; node; node = node.parentElement) {
          const transform = getComputedStyle(node).transform;
          if (transform !== 'none' && new DOMMatrixReadOnly(transform).m11 < 0) return true;
        }
        return false;
    }""")
    assert not mirrored, "The visible side of the card is mirrored"


def check_wordmark(face):
    mark = face.get_by_role("img", name="S's-YR", exact=True)
    expect(mark).to_be_visible()
    grayscale = Image.open(BytesIO(mark.screenshot())).convert("L")
    pixels = sorted(grayscale.tobytes())
    # The central 90% includes ink and the actual background behind the SVG.
    dark = pixels[len(pixels) // 20] / 255
    light = pixels[-len(pixels) // 20] / 255

    def luminance(level):
        return level / 12.92 if level <= 0.04045 else ((level + 0.055) / 1.055) ** 2.4

    contrast = (luminance(light) + 0.05) / (luminance(dark) + 0.05)
    assert contrast >= 4.5, f"The wordmark blends into its background ({contrast:.1f}:1)"


def check_card(page):
    front, back = page.locator("#frontFace"), page.locator("#backFace")
    check_face(front, "contact.vcf")
    check_wordmark(front)
    expect(back).to_be_hidden()
    lettering = front.locator('img[src*="lettering/"]')
    assert lettering.count() > 0, "Original card lettering is missing"
    assert lettering.evaluate_all("imgs => imgs.every(img => img.complete && img.naturalWidth > 0)")
    page.locator("#backBtn").click()
    expect(front).to_be_hidden()
    check_face(back, "works.html")
    check_wordmark(back)
    page.locator("#frontBtn").click()
    expect(front).to_be_visible()
    expect(back).to_be_hidden()


def check_page(page):
    assert page.get_by_role("button", name=re.compile("名刺を共有")).count() == 0
    assert page.get_by_role("link", name=re.compile("名刺を共有|QRコードを表示|QR画像を保存")).count() == 0
    gallery = page.locator(".media-grid")
    thumbnails = gallery.locator("img")
    assert thumbnails.count() and thumbnails.evaluate_all("imgs => imgs.every(i => i.loading === 'lazy')"), (
        "Gallery thumbnails should load as the reader approaches them"
    )
    full = gallery.locator("[data-full]").evaluate_all("tiles => tiles.map(t => t.dataset.full)")
    assert ART.issubset({Path(urlsplit(path).path).name for path in full}), "Missing gallery originals"
    movie = page.locator("video")
    expect(movie).to_have_count(1)
    expect(movie).to_have_attribute("preload", "none")
    assert movie.get_attribute("autoplay") is None
    assert movie.get_attribute("controls") is not None
    poster = movie.get_attribute("poster")
    with Image.open(ROOT / urlsplit(poster).path) as im:
        im.verify()
    src = movie.get_attribute("src") or movie.locator("source").get_attribute("src")
    return ROOT / urlsplit(src).path


def check_video(video):
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_chapters", "-of", "json", str(video)
    ]))
    streams = info["streams"]
    videos = [s for s in streams if s["codec_type"] == "video"]
    assert len(videos) == 1 and videos[0]["codec_name"] == "h264", "Expected a mobile-compatible H.264 reel"
    assert not any(s["codec_type"] == "audio" for s in streams), "Showreel must be silent"
    assert video.stat().st_size < PREVIOUS_REEL_BYTES, "Showreel exceeds the previous download size"
    chapters = info["chapters"]
    titles = " ".join(c["tags"]["title"] for c in chapters)
    for category in ("溶接", "建築|施工", "業務|現場応援", "清掃", "AI|イラスト", "広告|グラフィック", "アプリ|ツール", "動画|映像"):
        assert re.search(category, titles), f"Showreel chapter missing: {category}"
    assert all(float(c["end_time"]) > float(c["start_time"]) for c in chapters)
    print(f"Validated {video.stat().st_size:,}-byte reel: {titles}")


def main():
    qr_files = {p.name for p in (ROOT / "assets").rglob("qr-*") if p.is_file()}
    assert qr_files == set(QR_DESTINATIONS), f"Unexpected public QR assets: {qr_files}"
    vcard = (ROOT / "contact.vcf").read_text(encoding="utf-8")
    for field in ("BEGIN:VCARD", "FN:川合 伸次", "TEL;TYPE=CELL:080-9119-0044", "EMAIL:ss526s-syr@yahoo.co.jp", "END:VCARD"):
        assert field in vcard.splitlines(), f"Missing contact field {field}"
    for name in ART:
        with Image.open(ROOT / "assets" / name) as artwork:
            assert min(artwork.size) >= 700, f"Low-resolution gallery original: {name}"
            artwork.verify()

    with serve() as base, sync_playwright() as playwright:
        chrome = shutil.which("google-chrome") or shutil.which("chromium")
        browser = playwright.chromium.launch(executable_path=chrome)
        page = browser.new_page(viewport={"width": 360, "height": 800}, device_scale_factor=3)
        page.route("https://**/*", lambda route: route.abort())
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(base)
        check_card(page)
        movie = check_page(page)
        page.goto(base + "works.html")
        assert movie == check_page(page), "The two pages serve different showreels"
        assert not page_errors, page_errors
        browser.close()
    check_video(movie)
    print("Validated card switching, two readable QR codes, gallery originals and tap-to-load video")


if __name__ == "__main__":
    main()
