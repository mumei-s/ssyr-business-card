"""Check that the personal edition keeps its own identity and contact details."""

from html import unescape
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urljoin, urlsplit

from playwright.sync_api import expect

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
        assert not re.search(fr'{surname}|かわい|カワイ|しんじ|シンジ|\bkawai\b|tel\s*:|{domestic}|{international}', text, re.I), file
        assert not re.search(r'assets/(?:lettering/(?:name|phone)|qr-(?:contact|introduction)|og-card)\.svg', text), file

    contact = (personal / 'contact.vcf').read_text().splitlines()
    assert 'FN:SHINJI' in contact and 'N:SHINJI;;;;' in contact, 'Save SHINJI as a family name'
    assert any(line.upper().startswith('EMAIL') and line.split(':', 1)[-1] == EMAIL for line in contact)
    assert not any(re.match(r'(TEL|URL|X-PHONETIC-[^:;]+)(:|;)', line, re.I) for line in contact)


def check_viewport(page):
    width, content = page.locator('html').evaluate(
        '(el) => [el.clientWidth, el.scrollWidth]'
    )
    assert content <= width + 1, f'{page.url} overflows horizontally: {content}px in {width}px'


def check_role(face):
    role = face.get_by_text('代表', exact=True)
    expect(role).to_be_visible()
    size, weight = role.evaluate(
        '(el) => [parseFloat(getComputedStyle(el).fontSize), Number(getComputedStyle(el).fontWeight)]'
    )
    assert size >= 20 and weight >= 600, '代表 should be legible at the smallest tested width'


def check_card_controls(page):
    front, back = page.locator('#front'), page.locator('#back')
    expect(front).to_be_visible()
    expect(back).to_be_hidden()
    expect(page.locator('#front-button')).to_have_attribute('aria-pressed', 'true')
    light = page.locator('#light-button')
    initial = light.get_attribute('aria-pressed')
    assert initial in {'true', 'false'}, 'The light button must expose its state'
    light.click()
    expect(light).to_have_attribute('aria-pressed', 'false' if initial == 'true' else 'true')
    light.click()
    expect(light).to_have_attribute('aria-pressed', initial)

    page.emulate_media(reduced_motion='reduce')
    original = page.viewport_size
    for width in (320, 360, 390, 480, 768, 1024, 1280):
        page.set_viewport_size({'width': width, 'height': original['height']})
        check_viewport(page)
        expect(front.locator('a[href^="mailto:"]')).to_be_visible()
        lettering = front.locator('.wordmark img')
        expect(lettering).to_be_visible()
        lettering.evaluate('img => img.decode()')
        assert lettering.get_attribute('alt') == "S's-YR"
        brand, name = lettering.bounding_box(), front.locator('.front-person b').bounding_box()
        assert brand['width'] >= front.bounding_box()['width'] * .59
        assert brand['width'] > name['width'] * 1.8
        assert brand['height'] > name['height']
        assert front.evaluate('(el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1')
        expect(front.locator('.front-emblem img')).to_be_visible()
        front.locator('.front-emblem img').evaluate('img => img.decode()')
        check_role(front)
        expect(front.locator('[data-add-contact]')).to_have_count(0)
        expect(page.locator('[data-add-contact]')).to_have_count(1)
        expect(page.locator('#contact [data-add-contact]')).to_be_visible()
        front_box = front.bounding_box()
        assert abs(front_box['width'] / front_box['height'] - 91/55) < .035, front_box

        page.locator('#back-button').click()
        expect(front).to_be_hidden()
        expect(back).to_be_visible()
        expect(page.locator('#back-button')).to_have_attribute('aria-pressed', 'true')
        check_viewport(page)
        expect(back.locator('a[href$="works.html"]')).to_be_visible()
        check_role(back)
        back_box = back.bounding_box()
        assert abs(back_box['width'] - front_box['width']) < 1
        assert abs(back_box['height'] - front_box['height']) < 1
        assert back.evaluate('(el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1')
        images = back.locator('.foil-logo img')
        expect(images).to_have_count(3)
        images.evaluate_all('imgs => Promise.all(imgs.map(i => i.decode()))')
        assert images.evaluate_all('imgs => imgs.every(i => i.complete && i.naturalWidth >= 256)')
        assert back.locator('.logo-color').evaluate("el => getComputedStyle(el).animationName") == 'none'
        assert back.locator('.logo-color').evaluate("el => getComputedStyle(el).opacity") == '1'
        light.click()
        assert back.locator('.logo-fixed').evaluate("el => getComputedStyle(el).opacity") == '1'
        assert back.locator('.logo-cycle').evaluate("el => getComputedStyle(el).opacity") == '0'
        light.click()
        page.locator('#front-button').click()
        expect(front).to_be_visible()
        expect(back).to_be_hidden()
    page.set_viewport_size(original)
    page.emulate_media(reduced_motion='no-preference')
    page.locator('#back-button').click()
    # Seek the real infinite CSS animation to verify both supplied logo phases.
    states = page.evaluate("""() => {
        const color = document.querySelector('.logo-color');
        const silver = document.querySelector('.logo-silver');
        const ca = color.getAnimations()[0], sa = silver.getAnimations()[0];
        if (!ca || !sa) return null;
        if (ca.effect.getTiming().iterations !== Infinity || sa.effect.getTiming().iterations !== Infinity) return null;
        ca.pause(); sa.pause();
        return [0, 3500, 6000, 12000].map(t => {
            ca.currentTime = t; sa.currentTime = t;
            return [Number(getComputedStyle(color).opacity), Number(getComputedStyle(silver).opacity)];
        });
    }""")
    assert states and states[0] == [1, 0] and states[2] == [0, 1] and states[3] == [1, 0], states
    assert all(0 < value < 1 for value in states[1]), states
    # CSS transition must interpolate in BOTH directions without disabling the loop.
    for locked in (True, False):
        light.click()
        expect(light).to_have_attribute('aria-pressed', str(locked).lower())
        result = page.evaluate("""() => {
            const fixed = document.querySelector('.logo-fixed');
            const cycle = document.querySelector('.logo-cycle');
            const a = fixed.getAnimations().find(a => a.transitionProperty === 'opacity');
            const b = cycle.getAnimations().find(a => a.transitionProperty === 'opacity');
            if (!a || !b) return null;
            const duration = a.effect.getTiming().duration;
            a.pause(); b.pause();
            const values = [0,duration/2,duration].map(t => {
                a.currentTime = t; b.currentTime = t;
                return [Number(getComputedStyle(fixed).opacity),Number(getComputedStyle(cycle).opacity)];
            });
            a.finish(); b.finish();
            return {duration, values, loop: getComputedStyle(document.querySelector('.logo-color')).animationName};
        }""")
        assert result and result['duration'] >= 1500 and result['loop'] == 'foil-color', result
        start, middle, end = result['values']
        assert all(0.1 < v < 0.9 for v in middle), result
        assert start == ([0,1] if locked else [1,0]) and end == ([1,0] if locked else [0,1]), result
    assert back.evaluate("el => getComputedStyle(el,'::after').animationName") == 'surface-light'
    page.locator('#front-button').click()
    assert front.locator('.brand-foil').evaluate("el => getComputedStyle(el,'::after').animationName") == 'surface-light'
    assert front.locator('.front-emblem img').evaluate("el => getComputedStyle(el).animationName") == 'emblem-breathe'
    assert page.locator('.jobs img').first.evaluate("el => getComputedStyle(el).animationName") == 'photo-light'
    print('PASS SHINJI brand hierarchy, both landscape faces, continuous foil cycle, gradual light switch, ambient motion and reduced motion')


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
    destinations = {
        'index.html': {'/shinji/works.html'},
        'works.html': {'/shinji/', '/shinji/index.html'},
    }
    for name, next_paths in destinations.items():
        page.goto(base + 'shinji/' + name)
        assert 'SHINJI' in page.title().upper()
        check_viewport(page)
        if name == 'index.html':
            check_card_controls(page)
        else:
            check_gallery_controls(page)
        links = page.locator('a[href]').evaluate_all('(links) => links.map(a => a.href)')
        site_links = [url.replace(public_url, base, 1) if url.startswith(public_url) else url for url in links]
        paths = {urlsplit(url).path for url in site_links if url.startswith(base)}
        assert any(link.startswith('mailto:' + EMAIL) for link in links)
        assert all(path.startswith('/shinji/') for path in paths), f'{name} links outside the personal edition: {paths}'
        assert paths & next_paths, f'{name} has no link to its companion page'
        for manifest in page.locator('link[rel="manifest"]').evaluate_all('(links) => links.map(l => l.href)'):
            assert manifest.startswith(base + 'shinji/'), f'{name} uses the business card manifest'
