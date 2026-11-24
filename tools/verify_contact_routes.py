"""Browser-side regression test; never launches a native app or writes contacts.
Run: python tools/verify_contact_routes.py --root /path/to/checkout --engine chromium
Firefox and WebKit are optional installed Playwright engines, NOT physical phone tests.
"""
import argparse
import contextlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
from threading import Thread
from urllib.parse import unquote, urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

ANDROID = 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
PLATFORMS = {
    'Android Chrome': (ANDROID, 'intent'),
    'Android Edge': (ANDROID + ' EdgA/131.0.0.0', 'intent'),
    'Android Firefox': ('Mozilla/5.0 (Android 15; Mobile; rv:138.0) Gecko/138.0 Firefox/138.0', 'html'),
    'iPhone Safari': (IOS, 'vcard'),
    'iPhone Chrome': (IOS.replace('Version/18.0', 'CriOS/131.0.0.0'), 'vcard'),
    'iPhone Edge': (IOS.replace('Version/18.0', 'EdgiOS/131.0.0.0'), 'vcard'),
    'iPhone Firefox': (IOS.replace('Version/18.0', 'FxiOS/138.0'), 'vcard'),
    'JS disabled': (ANDROID, 'html'),
}

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass

@contextlib.contextmanager
def serve(root):
    s = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(root)))
    th = Thread(target=s.serve_forever, daemon=True); th.start()
    try: yield f'http://127.0.0.1:{s.server_port}/'
    finally: s.shutdown(); s.server_close(); th.join()

def card_fields(root, edition):
    raw = (root / edition / 'contact.vcf').read_bytes()
    rows = raw.decode('utf-8').splitlines()
    assert rows[0] == 'BEGIN:VCARD' and rows[-1] == 'END:VCARD'
    assert 'VERSION:3.0' in rows
    f = {line.split(':', 1)[0].split(';', 1)[0]: line.split(':', 1)[1] for line in rows if ':' in line}
    assert f['ORG'] == "S's-YR" and f['TITLE'] == '代表'
    if edition: assert f['FN'] == 'SHINJI' and f['N'] == 'SHINJI;;;;' and 'TEL' not in f and 'URL' not in f and not any('PHONETIC' in k for k in f)
    else: assert f['FN'] == '川合 伸次' and f.get('TEL') and f.get('URL')
    return raw, f

def check_intent(href, fields, fallback):
    assert href.startswith('intent:#Intent;') and href.endswith(';end')
    d = {k: unquote(v) for k,v in (x.split('=', 1) for x in href.split(';')[1:-1] if '=' in x)}
    assert d['action'] == 'android.intent.action.INSERT'
    assert d['type'] == 'vnd.android.cursor.dir/contact'
    assert d['S.name'] == fields['FN'] and d['S.email'] == fields['EMAIL']
    assert d['S.company'] == fields['ORG'] and d['S.job_title'] == fields['TITLE']
    assert d['S.browser_fallback_url'] == fallback
    if 'TEL' in fields: assert re.sub(r'\D', '', d['S.phone']) == re.sub(r'\D', '', fields['TEL'])
    else: assert 'S.phone' not in d


def check_contact_routes(browser, base, root):
    root = Path(root)
    cases = 0
    for label, (ua, mode) in PLATFORMS.items():
        ctx = browser.new_context(user_agent=ua, java_script_enabled=label != 'JS disabled', viewport={'width':320,'height':780})
        ctx.route('https://**/*', lambda route: route.abort())
        page = ctx.new_page()
        if label != 'JS disabled':
            # Browser integration: deterministic clipboard success/failure without
            # reading or modifying the real host clipboard.
            page.add_init_script("""(() => {
                window.__copiedContact = [];
                window.__denyContactCopy = false;
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true, value: { writeText(value) {
                        if (window.__denyContactCopy) return Promise.reject(new Error('denied'));
                        window.__copiedContact.push(value);
                        return Promise.resolve();
                    }}
                });
                document.execCommand = () => false;
            })();""")
        errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
        for edition in ('', 'shinji/'):
            raw, fields = card_fields(root, edition)
            fallback = base + edition + 'contact.html'
            vcf = base + edition + 'contact.vcf'
            response = page.request.get(vcf)
            assert response.ok and response.body() == raw
            for route in ('index.html', 'works.html'):
                page.goto(base + edition + route, wait_until='domcontentloaded')
                links = page.locator('a[data-add-contact]')
                assert links.count() > 0
                for link in links.all():
                    expect(link).to_be_visible()
                    assert link.get_attribute('download') is None
                    href = link.evaluate('a => a.href')
                    if mode == 'intent': check_intent(href, fields, fallback)
                    else: assert href == (vcf if mode == 'vcard' else fallback)
                if mode in ('intent', 'vcard'):
                    # Stop only native/file handoff. The real click listener still runs.
                    page.evaluate("document.addEventListener('click', e => e.preventDefault(), {capture:true, once:true})")
                    links.first.click()
                    retry = page.get_by_role('link', name='電話帳が開かないときの登録方法')
                    expect(retry).to_have_count(1)
                    expect(retry.first).to_be_visible()
                    # Repeated taps must not duplicate the recovery control.
                    page.evaluate("document.addEventListener('click', e => e.preventDefault(), {capture:true, once:true})")
                    links.first.click(); expect(retry).to_have_count(1)
                    if edition and route == 'index.html':
                        assert page.locator('.contact-face .contact-retry').count() == 0
                    # Recovery survives a reload, including returning from file viewer.
                    page.reload(wait_until='domcontentloaded'); expect(retry.first).to_be_visible()
                    if links.count() > 1:
                        page.evaluate("document.addEventListener('click', e => e.preventDefault(), {capture:true, once:true})")
                        links.last.click(); expect(retry).to_have_count(2)
                        expect(retry.last).to_be_visible()
                    retry.first.click()
                else: links.first.click()
                expect(page).to_have_url(fallback)
                expect(page.locator('[data-vcard-contact]')).to_be_visible()
                assert page.locator('[data-vcard-contact]').evaluate('a => a.href') == vcf
                google = page.locator('[data-google-contact]'); expect(google).to_be_visible()
                q = parse_qs(urlsplit(google.get_attribute('href')).query)
                assert q['email'] == [fields['EMAIL']]
                if edition: assert q['familyname'] == ['SHINJI'] and 'phone' not in q and 'givenname' not in q
                else: assert q['familyname'] == ['川合'] and q['givenname'] == ['伸次'] and q.get('phone') == [fields['TEL']]
                assert page.locator('.contact-fields').count() == 1
                assert google.evaluate("(a) => !!(a.compareDocumentPosition(document.querySelector('[data-vcard-contact]')) & Node.DOCUMENT_POSITION_FOLLOWING)")
                assert google.get_attribute('target') == '_blank'
                if label == 'JS disabled':
                    assert page.locator('.contact-copy').count() == 0
                else:
                    expect(page.locator('.contact-copy')).to_have_count(4 if edition else 5)
                    for caption, key in (('屋号', 'ORG'), ('肩書', 'TITLE')):
                        button = page.get_by_role('button', name=caption + 'をコピー')
                        expect(button).to_be_visible()
                        button.click()
                        expect(page.locator('[data-copy-status]')).to_have_text(caption + '：コピーしました')
                        assert page.evaluate('window.__copiedContact.at(-1)') == fields[key]
                    page.evaluate('window.__denyContactCopy = true')
                    page.get_by_role('button', name='肩書をコピー').click()
                    expect(page.locator('[data-copy-status]')).to_have_text('肩書：長押ししてコピーしてください')
                    assert page.evaluate('window.__copiedContact.length') == 2
                expect(page.locator('.contact-back')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                cases += 1
        assert not errors, errors
        ctx.close()
        print('PASS', label, 'both editions, index + works')
    print(f'PASS {cases} page/UA cases; external app launch/save explicitly NOT tested')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1]); ap.add_argument('--engine', choices=['chromium','firefox','webkit'], default='chromium')
    args = ap.parse_args()
    with serve(args.root) as base, sync_playwright() as p:
        engine = getattr(p,args.engine)
        opts = {'executable_path': shutil.which('chromium') or shutil.which('google-chrome')} if args.engine == 'chromium' and (shutil.which('chromium') or shutil.which('google-chrome')) else {}
        browser = engine.launch(**opts)
        print('ENGINE',args.engine,browser.version)
        try: check_contact_routes(browser,base,args.root)
        finally: browser.close()
