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
    light = page.locator('#light-button')
    expect(front).to_be_visible()
    expect(back).to_be_hidden()
    expect(light).to_be_hidden()
    expect(page.locator('#front-button')).to_have_attribute('aria-pressed', 'true')

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
        assert brand['width'] >= front.bounding_box()['width'] * .70
        assert brand['width'] > name['width'] * 1.8
        assert brand['height'] > name['height']
        assert front.evaluate('(el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1')
        expect(front.locator('img')).to_have_count(1)
        expect(front.locator('.front-engraving')).to_have_count(1)
        expect(front.locator('.front-guilloche')).to_have_count(1)
        expect(front.locator('.foil-corners')).to_have_count(1)
        check_role(front)
        expect(front.locator('[data-add-contact]')).to_have_count(0)
        expect(page.locator('[data-add-contact]')).to_have_count(1)
        expect(page.locator('#contact [data-add-contact]')).to_be_visible()
        expect(light).to_be_hidden()
        front_box = front.bounding_box()
        assert abs(front_box['width'] / front_box['height'] - 91/55) < .035, front_box

        page.locator('#back-button').click()
        expect(front).to_be_hidden()
        expect(back).to_be_visible()
        expect(page.locator('#back-button')).to_have_attribute('aria-pressed', 'true')
        expect(light).to_be_visible()
        expect(light).to_be_disabled()
        expect(light).to_have_attribute('aria-pressed', 'false')
        check_viewport(page)
        expect(back.locator('a, button, .person, .back-brand')).to_have_count(0)
        expect(back.locator('.back-engraving')).to_have_count(1)
        assert 'SHINJI' not in back.inner_text() and '代表' not in back.inner_text()
        assert back.locator('.service-brief li').all_inner_texts() == ['工事・施工', '現場支援', 'ポスティング', '洗車', 'AI・デジタル制作']
        back_box = back.bounding_box()
        assert abs(back_box['width'] - front_box['width']) < 1
        assert abs(back_box['height'] - front_box['height']) < 1
        assert back.evaluate('(el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1'), width
        assert back.locator('.service-brief').evaluate("""el => {
            const r = el.getBoundingClientRect(), b = el.closest('.face').getBoundingClientRect();
            return r.top >= b.top && r.bottom <= b.bottom && r.right <= b.right;
        }"""), width
        images = back.locator('.foil-logo img')
        expect(images).to_have_count(3)
        images.evaluate_all('imgs => Promise.all(imgs.map(i => i.decode()))')
        assert images.evaluate_all('imgs => imgs.every(i => i.complete && i.naturalWidth >= 256)')
        assert back.locator('.logo-silver').evaluate("el => getComputedStyle(el).animationName") == 'none'
        expect(back.locator('.logo-fixed')).to_have_css('opacity', '1')
        expect(back.locator('.logo-effects')).to_have_css('opacity', '0')
        page.locator('#front-button').click()
        expect(front).to_be_visible()
        expect(back).to_be_hidden()
        expect(light).to_be_hidden()

    page.set_viewport_size(original)
    page.emulate_media(reduced_motion='no-preference')
    page.locator('#back-button').click()
    expect(light).to_be_enabled()
    expect(light).to_have_attribute('aria-pressed', 'true')
    fixed = back.locator('.logo-fixed')
    expect(fixed).to_have_css('opacity', '0', timeout=5000)
    states = page.evaluate("""() => {
        const silver = document.querySelector('.logo-silver'), color = document.querySelector('.logo-color');
        const anim = silver.getAnimations()[0];
        if (!anim || anim.effect.getTiming().iterations !== Infinity) return null;
        const d = anim.effect.getTiming().duration;
        anim.pause();
        const values = [0,d*.29,d*.5,d*.71,d].map(t => {
            anim.currentTime=t;
            return [Number(getComputedStyle(color).opacity), Number(getComputedStyle(silver).opacity)];
        });
        anim.play();
        return {duration:d,values};
    }""")
    assert states and states['duration'] == 14000, states
    values = states['values']
    assert values[0] == [1,0] and values[2] == [1,1] and values[-1] == [1,0], values
    assert 0 < values[1][1] < 1 and 0 < values[3][1] < 1, values
    assert all(v[0] == 1 for v in values)

    # Both directions must interpolate instead of swapping an image abruptly.
    for enabled in (False, True):
        light.click()
        expect(light).to_have_attribute('aria-pressed', str(enabled).lower())
        transition = page.evaluate("""() => {
            const fixed = document.querySelector('.logo-fixed');
            getComputedStyle(fixed).opacity;
            const a = fixed.getAnimations().find(a => a.transitionProperty === 'opacity');
            if (!a) return null;
            const duration = a.effect.getTiming().duration;
            a.pause();
            const values = [0,duration/2,duration].map(t => {
                a.currentTime = t;
                return Number(getComputedStyle(fixed).opacity);
            });
            a.finish();
            return {duration, values};
        }""")
        assert transition and transition['duration'] >= 1500, transition
        start, mid, end = transition['values']
        assert .1 < mid < .9, transition
        assert abs(start-(1 if enabled else 0)) < .05 and abs(end-(0 if enabled else 1)) < .05, transition
        expect(fixed).to_have_css('opacity', '0' if enabled else '1', timeout=5000)
        expect(back.locator('.logo-effects')).to_have_css('opacity', '1' if enabled else '0', timeout=5000)
        assert back.locator('.logo-silver').evaluate("el => getComputedStyle(el).animationPlayState") == ('running' if enabled else 'paused')
    page.locator('#front-button').click()
    expect(light).to_be_hidden()
    assert front.locator('.brand-foil').evaluate("el => getComputedStyle(el,'::after').animationName") == 'surface-light'
    # Back-side control stops the front face's motion too, including after reload.
    page.locator('#back-button').click()
    light.click()
    expect(light).to_have_attribute('aria-pressed', 'false')
    page.locator('#front-button').click()
    expect(light).to_be_hidden()
    for selector, pseudo in (('#front', '::after'), ('.brand-foil', '::after'), ('.front-engraving', '::before')):
        assert page.locator(selector).evaluate('(el,p) => getComputedStyle(el,p).animationPlayState', pseudo) == 'paused'
    page.reload()
    assert page.locator('#card').evaluate("el => el.classList.contains('logo-off')")
    page.locator('#back-button').click()
    expect(light).to_have_attribute('aria-pressed', 'false')
    light.click()
    page.locator('#front-button').click()
    assert front.locator('.brand-foil').evaluate("el => getComputedStyle(el,'::after').animationPlayState") == 'running'
    expect(page.locator('#install-guide')).to_be_visible()
    expect(page.locator('.notice-state')).to_contain_text('まだ通知は届きません')
    assert '管理者専用送信画面' in page.locator('.notice-info').inner_text()
    manifest_url = page.locator('link[rel="manifest"]').evaluate('el => el.href')
    manifest = page.request.get(manifest_url).json()
    assert manifest['scope'] == './' and manifest['start_url'] == './' and manifest['display'] == 'standalone'
    assert all(page.request.get(urljoin(manifest_url, icon['src'])).ok for icon in manifest['icons'])
    assert page.request.get(urljoin(manifest_url, 'sw.js')).ok
    assert front.evaluate("el => getComputedStyle(el,'::after').animationName") == 'surface-light'
    assert page.locator('.jobs img').first.evaluate("el => getComputedStyle(el).animationName") == 'photo-light'
    print('PASS SHINJI: brand-first front, no front emblem, business-only back, gradual logo ON/OFF, responsive layout and reduced motion')


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
