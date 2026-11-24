"""Check the OWNER install entry and native prompt lifecycle without installing an OS app."""
import json
from playwright.sync_api import expect

def check_owner_install(browser,base):
    page=browser.new_page(viewport={'width':320,'height':740},service_workers='block')
    page.route('https://**/*',lambda r:r.abort())
    page.add_init_script("""(() => {
      window.ownerRegistrations=[];
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{
        register:async(script,opts)=>{window.ownerRegistrations.push([new URL(script,location.href).pathname,new URL(opts.scope,location.href).pathname]);return {scope:new URL(opts.scope,location.href).href}},addEventListener(){}
      }});
    })()""")
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'shinji/owner/')
    expect(page.locator('#owner-install-button')).to_be_visible()
    expect(page.locator('#login-panel')).to_be_visible()
    expect(page.locator('#owner-console')).to_be_hidden()
    assert page.evaluate('ownerRegistrations.some(x=>x[0]==="/shinji/owner/sw.js" && x[1]==="/shinji/owner/")')
    assert not page.evaluate('ownerRegistrations.some(x=>x[1]==="/shinji/")')
    manifest=page.request.get(base+'shinji/owner/manifest.webmanifest').json()
    assert manifest['id']==manifest['start_url']==manifest['scope']=='./'
    assert manifest['display']=='standalone' and '管理' in manifest['short_name']
    assert any(i['sizes']=='192x192' for i in manifest['icons'])
    assert any(i['sizes']=='512x512' for i in manifest['icons'])
    for i in manifest['icons']:
        from urllib.parse import urljoin
        assert page.request.get(urljoin(base+'shinji/owner/',i['src'])).ok
    # No native prompt in an embedded browser: show usable manual instructions.
    page.locator('#owner-install-button').click()
    expect(page.locator('#owner-install-guide')).to_be_visible()
    assert page.locator('#owner-install-guide').evaluate('el=>el.open')
    # Browser supplies a real install prompt; simulate accept/dismiss on explicit click.
    page.evaluate("""() => {
      window.ownerPromptCount=0;
      const e=new Event('beforeinstallprompt',{cancelable:true});
      e.prompt=async()=>{window.ownerPromptCount++};
      e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e);
    }""")
    page.locator('#owner-install-button').click()
    expect(page.locator('#owner-install-button')).to_be_enabled()
    assert page.evaluate('ownerPromptCount')==1
    expect(page.locator('#owner-install-status')).to_be_hidden()
    page.evaluate("""() => {
      const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{};
      e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e);
    }""")
    page.locator('#owner-install-button').click()
    expect(page.locator('#owner-install-status')).to_contain_text('追加済み')
    expect(page.locator('#owner-install-button')).to_be_hidden()
    page.goto(base+'shinji/owner.html')
    expect(page.locator('#owner-app-link')).to_be_visible()
    assert page.locator('#owner-app-link').get_attribute('href').endswith('/shinji/owner/?v=owner-home-1')
    assert not errors,errors
    page.close()
    print('PASS owner install entry, native prompt simulation, browser fallback and separate owner scope')
