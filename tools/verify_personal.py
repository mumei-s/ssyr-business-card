"""Check that the personal edition keeps its own identity, contact and QR destinations."""

from html import unescape
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urljoin, urlsplit

from PIL import Image
from playwright.sync_api import expect
import zxingcpp

EMAIL = 'ss526s-syr@yahoo.co.jp'


def check_identity(root):
    personal = root / 'shinji'
    business = (root / 'contact.vcf').read_text()
    surname = re.search(r'^N:([^;]+)', business, re.M)[1]
    number = re.search(r'^TEL[^:]*:([^\n]+)', business, re.M)[1]
    digits = re.sub(r'\D', '', number)
    domestic = r'[\s().-]*'.join(digits)
    international = r'\+81[\s().-]*' + r'[\s().-]*'.join(digits[1:])
    for file in personal.rglob('*'):
        if file.suffix not in {'.html', '.css', '.js', '.svg', '.vcf', '.webmanifest'}:
            continue
        text = unquote(unescape(file.read_text()))
        assert not re.search(fr'{surname}|かわい|カワイ|\bkawai\b|tel\s*:|{domestic}|{international}', text, re.I), file
        assert not re.search(r'assets/(?:lettering/(?:name|phone)|qr-(?:contact|introduction)|og-card)\.svg', text), file

    contact = (personal / 'contact.vcf').read_text().splitlines()
    assert 'FN:SHINJI' in contact and 'N:;SHINJI;;;' in contact, 'Save SHINJI as a given name'
    assert any(line.upper().startswith('EMAIL') and line.split(':', 1)[-1] == EMAIL for line in contact)
    assert not any(re.match(r'(TEL|URL)(:|;)', line, re.I) for line in contact)


def check_viewport(page):
    width, content = page.locator('html').evaluate(
        '(el) => [el.clientWidth, el.scrollWidth]'
    )
    assert content <= width + 1, f'{page.url} overflows horizontally: {content}px in {width}px'


def check_printed_qr(face, asset, expected):
    qr = face.locator(f'img[src$="{asset}"]')
    expect(qr).to_be_visible()
    href = qr.evaluate('img => img.closest("a")?.href')
    assert href == urljoin(face.page.url, expected.rsplit('/', 1)[1]), f'{asset} links to the wrong destination'
    # Decode the visible card itself, preserving its actual size, clipping and overlays.
    rect = qr.bounding_box()
    bounds = face.bounding_box()
    assert (rect['x'] >= bounds['x'] - 1 and rect['y'] >= bounds['y'] - 1
            and rect['x'] + rect['width'] <= bounds['x'] + bounds['width'] + 1
            and rect['y'] + rect['height'] <= bounds['y'] + bounds['height'] + 1), f'{asset} is cropped'
    code = zxingcpp.read_barcode(Image.open(BytesIO(face.screenshot())))
    assert code and code.text == expected, f'{asset} is not readable on the displayed card'


def check_card_controls(page, public_url):
    front, back = page.locator('#front'), page.locator('#back')
    expect(front).to_be_visible()
    expect(back).to_be_hidden()
    light = page.locator('#light-button')
    initial = light.get_attribute('aria-pressed')
    assert initial in {'true', 'false'}, 'The light button must expose its state'
    light.click()
    expect(light).to_have_attribute('aria-pressed', 'false' if initial == 'true' else 'true')
    light.click()
    expect(light).to_have_attribute('aria-pressed', initial)

    page.emulate_media(reduced_motion='reduce')
    original = page.viewport_size
    for width in (320, 360):
        page.set_viewport_size({'width': width, 'height': original['height']})
        check_viewport(page)
        check_printed_qr(front, 'introduction-qr.svg', urljoin(public_url, 'shinji/works.html'))
        page.locator('#back-button').click()
        expect(front).to_be_hidden()
        expect(page.locator('#back-button')).to_have_attribute('aria-pressed', 'true')
        expect(back.locator('a[href^="mailto:"]')).to_be_visible()
        check_viewport(page)
        check_printed_qr(back, 'contact-qr.svg', urljoin(public_url, 'shinji/contact.vcf'))
        back.locator('#open-qr').click()
        dialog = page.locator('#contact-dialog')
        expect(dialog).to_be_visible()
        expect(dialog.locator('img')).to_be_visible()
        check_viewport(page)
        dialog.get_by_role('button', name=re.compile('閉じる')).click()
        expect(dialog).to_be_hidden()
        page.locator('#front-button').click()
        expect(front).to_be_visible()
        expect(back).to_be_hidden()
    page.set_viewport_size(original)
    page.emulate_media(reduced_motion='no-preference')


def check_gallery_controls(page):
    player = page.locator('video')
    expect(player).to_have_count(1)
    src = player.get_attribute('src') or player.locator('source').get_attribute('src')
    assert urlsplit(urljoin(page.url, src)).path == '/shinji/field-film.mp4'
    film = Path(__file__).resolve().parents[1] / 'shinji' / 'field-film.mp4'
    chapters = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_chapters', '-of', 'json', str(film)
    ]))['chapters']
    titles = [c.get('tags', {}).get('title', '') for c in chapters if float(c['end_time']) > float(c['start_time'])]
    assert all(any(name in title for title in titles) for name in ('ポスティング', '洗車')), 'Field film chapters are missing'

    for filename in ('work-posting.webp', 'work-carwash.webp'):
        tile = page.locator(f'button[data-full$="{filename}"]')
        expect(tile).to_have_count(1)
        full = tile.get_attribute('data-full')
        tile.click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()
        displayed = dialog.locator('img')
        displayed.evaluate('img => img.decode()')
        assert displayed.evaluate('img => img.currentSrc') == urljoin(page.url, full)
        check_viewport(page)
        dialog.get_by_role('button', name=re.compile('閉じる')).click()
        expect(dialog).to_be_hidden()


def check_routes(page, base, public_url):
    codes = {}
    destinations = {
        'index.html': {'/shinji/works.html'},
        'works.html': {'/shinji/', '/shinji/index.html'},
    }
    for name, next_paths in destinations.items():
        page.goto(base + 'shinji/' + name)
        assert 'SHINJI' in page.title().upper()
        check_viewport(page)
        if name == 'index.html':
            check_card_controls(page, public_url)
        else:
            check_gallery_controls(page)
        links = page.locator('a[href]').evaluate_all('(links) => links.map(a => a.href)')
        site_links = [url.replace(public_url, base, 1) if url.startswith(public_url) else url for url in links]
        paths = {urlsplit(url).path for url in site_links if url.startswith(base)}
        assert '/shinji/contact.vcf' in paths and any(link.startswith('mailto:' + EMAIL) for link in links)
        assert all(path.startswith('/shinji/') for path in paths), f'{name} links outside the personal edition: {paths}'
        assert paths & next_paths, f'{name} has no link to its companion page'
        for manifest in page.locator('link[rel="manifest"]').evaluate_all('(links) => links.map(l => l.href)'):
            assert manifest.startswith(base + 'shinji/'), f'{name} uses the business card manifest'
        codes.update(page.locator('img[src]').evaluate_all("""els => els
            .filter(i => /qr/i.test(i.alt + ' ' + i.getAttribute('src')))
            .map(i => [i.src, i.closest('a')?.href])"""))

    expected = {urljoin(public_url, 'shinji/' + p) for p in ('contact.vcf', 'works.html')}
    decoded = set()
    for image_url, link in codes.items():
        assert image_url.startswith(base + 'shinji/'), 'A personal card QR must use a dedicated asset'
        # Use a fixed proof size so QR content is checked independently of a viewport or closed dialog.
        page.set_content('<img alt="QR" width="384">')
        page.locator('img').evaluate('(img, url) => { img.src = url; return img.decode(); }', image_url)
        data = page.locator('img').screenshot()
        barcode = zxingcpp.read_barcode(Image.open(BytesIO(data)))
        assert link and link.startswith(base), f'QR image must also be a personal contact or gallery link: {image_url}'
        destination = urljoin(public_url, link.removeprefix(base))
        assert barcode and barcode.text == destination and destination in expected, f'Wrong QR destination for {image_url}'
        decoded.add(destination)
    assert decoded == expected, 'Missing personal gallery or contact QR'
