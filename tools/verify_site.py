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
from urllib.parse import parse_qs, unquote, urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright
from verify_personal import EMAIL, check_identity, check_routes, check_viewport


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_URL = "https://mumei-s.github.io/ssyr-business-card/"
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


def check_face(face):
    expect(face).to_be_visible()
    # Sample the unprinted top margin on each stock and the page just outside the card.
    box = face.bounding_box()
    view = Image.open(BytesIO(face.page.screenshot(scale="css"))).convert("RGB")
    y = round(box["y"] + box["height"] * 0.03)
    surround = view.getpixel((round(box["x"]) - 5, y))
    silver = view.getpixel((round(box["x"] + box["width"] * 0.15), y))
    band = view.getpixel((round(box["x"] + box["width"] * 0.88), y))
    assert max(surround) < 90 and min(silver) > 150, "The silver card should stand out against the dark page"
    assert min(band) > 145 and max(band) - min(band) < 12, "The wordmark backing should be neutral silver"
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
    front_button = page.get_by_role("button", name="表", exact=True)
    back_button = page.get_by_role("button", name="裏", exact=True)
    expect(front_button).to_have_attribute("aria-pressed", "true")
    expect(back_button).to_have_attribute("aria-pressed", "false")
    for face in (front, back):
        expect(face.locator('a[href*="works.html"], a[href="#services"], a[href="#works"]')).to_have_count(0)
        assert not re.search(r"事業内容\s*を\s*見る", face.text_content())
    check_face(front)
    check_wordmark(front)
    expect(back).to_be_hidden()
    lettering = front.locator('img[src*="lettering/"]')
    assert lettering.count() > 0, "Original card lettering is missing"
    assert lettering.evaluate_all("imgs => imgs.every(img => img.complete && img.naturalWidth > 0)")
    back_button.click()
    expect(front).to_be_hidden()
    check_face(back)
    expect(back_button).to_have_attribute("aria-pressed", "true")
    check_wordmark(back)
    front_button.click()
    expect(front).to_be_visible()
    expect(back).to_be_hidden()
    for item in (page.locator("#services h2"), page.locator("#works .media-grid img").first, page.locator("video")):
        item.scroll_into_view_if_needed()
        expect(item).to_be_in_viewport()


def check_page(page):
    body = page.locator("body")
    assert not re.search(r"91\s*[:：]\s*55\s*RATIO", body.inner_text(), re.I)
    assert not re.search(r"Unsplash|Pexels", body.inner_text(), re.I)
    assert body.locator('a[href*="unsplash.com"], a[href*="pexels.com"]').count() == 0
    assert page.get_by_role("button", name=re.compile("名刺を共有")).count() == 0
    assert page.get_by_role("link", name=re.compile("名刺を共有")).count() == 0
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


def check_android_intent(href, name, phone, fallback):
    assert href.startswith('intent:#Intent;') and href.endswith(';end'), href
    fields = dict(part.split('=', 1) for part in href.split(';')[1:-1] if '=' in part)
    fields = {key: unquote(value) for key, value in fields.items()}
    assert fields['action'] == 'android.intent.action.INSERT'
    assert fields['type'] in {'vnd.android.cursor.dir/contact', 'vnd.android.cursor.dir/raw_contact'}
    assert fields['S.name'] == name and fields['S.email'] == EMAIL
    if phone:
        assert re.sub(r'\D', '', fields['S.phone']) == re.sub(r'\D', '', phone)
    else:
        assert 'S.phone' not in fields
    assert fields['S.company'] == "S's-YR" and fields['S.job_title'] == '代表'
    assert fields['S.browser_fallback_url'] == fallback


def check_contact_routes(browser, base):
    platforms = {
        'iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        'Android': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
        'Android Firefox': 'Mozilla/5.0 (Android 15; Mobile; rv:138.0) Gecko/138.0 Firefox/138.0',
        'no-js': '',
    }
    for platform, user_agent in platforms.items():
        context = browser.new_context(user_agent=user_agent, java_script_enabled=platform != 'no-js',
                                      viewport={'width': 320, 'height': 780})
        context.route('https://**/*', lambda route: route.abort())
        page = context.new_page()
        for edition, name, phone in (('', '川合 伸次', '080-9119-0044'), ('shinji/', 'SHINJI', None)):
            contact_url = base + edition + 'contact.html'
            vcard_url = base + edition + 'contact.vcf'
            vcard = page.request.get(vcard_url)
            assert vcard.ok and vcard.body() == (ROOT / edition / 'contact.vcf').read_bytes()

            for route in ('index.html', 'works.html'):
                page.goto(base + edition + route)
                actions = page.locator('a[data-add-contact]').all()
                assert actions, f'No contact action on {page.url}'
                for action in actions:
                    expect(action).to_be_visible()
                    assert action.get_attribute('download') is None
                    href = action.evaluate('a => a.href')
                    if platform == 'Android':
                        check_android_intent(href, name, phone, contact_url)
                    elif platform == 'iOS':
                        assert href == vcard_url
                    else:
                        assert href == contact_url

                # Verify ordinary navigation on click. A synthetic HTML response observes the
                # iPhone handoff URL without asking desktop Chromium to download the file.
                if platform == 'iOS':
                    page.route(vcard_url, lambda r: r.fulfill(content_type='text/html', body='vCard handoff'))
                    actions[0].click()
                    expect(page).to_have_url(vcard_url)
                    page.unroute(vcard_url)
                elif platform == 'Android':
                    # Desktop Chromium has no external contact handler. Suppress only the
                    # external navigation, then exercise the same recovery link a recipient sees.
                    page.evaluate("document.addEventListener('click', e => e.preventDefault(), {once: true})")
                    actions[0].click()
                    recovery = page.get_by_role('link', name='電話帳が開かないときの登録方法')
                    expect(recovery).to_be_visible()
                    recovery.click()
                    expect(page).to_have_url(contact_url)
                else:
                    actions[0].click()
                    expect(page).to_have_url(contact_url)

            response = page.goto(contact_url)
            assert response.ok
            check_viewport(page)
            google = page.locator('a[href^="https://contacts.google.com/"]')
            expect(google).to_be_visible()
            url = urlsplit(google.get_attribute('href'))
            assert url.path.endswith('/new')
            fields = parse_qs(url.query)
            assert fields['givenname'] == [name.split()[-1]]
            assert fields['email'] == [EMAIL] and fields.get('phone') == ([phone] if phone else None)
            assert fields.get('familyname') == (['川合'] if phone else None)
            if platform.startswith('Android'):
                expect(page.locator('a[href$=".vcf"]:visible')).to_have_count(0)
            elif platform == 'no-js':
                expect(page.locator('a[href$=".vcf"]')).to_be_visible()
        context.close()


def check_no_qr():
    files = [p for folder in ('assets', 'shinji') for p in (ROOT / folder).rglob('*') if p.is_file()]
    assert not any('qr' in p.name.lower() for p in files), 'A public QR asset is still present'
    for path in [*ROOT.glob('*.html'), *(ROOT / 'shinji').glob('*.html')]:
        assert not re.search(r'QRコード|連絡先QR|QRを|(?:contact|introduction)-qr|qr-(?:contact|introduction)',
                             path.read_text(), re.I), f'QR control remains in {path.name}'


def main():
    check_identity(ROOT)
    check_no_qr()
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
        check_routes(page, base, PUBLIC_URL)
        assert not page_errors, page_errors
        check_contact_routes(browser, base)
        browser.close()
    check_video(movie)
    print("Validated card switching, device-specific registration, gallery originals and tap-to-load video")


if __name__ == "__main__":
    main()
