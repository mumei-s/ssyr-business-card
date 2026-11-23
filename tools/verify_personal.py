"""Check that the personal edition keeps its own identity, contact and QR destinations."""

from html import unescape
from io import BytesIO
import re
from urllib.parse import unquote, urljoin, urlsplit

from PIL import Image
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


def check_routes(page, base, public_url):
    codes = {}
    destinations = {
        'index.html': {'/shinji/works.html'},
        'works.html': {'/shinji/', '/shinji/index.html'},
    }
    for name, next_paths in destinations.items():
        page.goto(base + 'shinji/' + name)
        assert 'SHINJI' in page.title().upper()
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
