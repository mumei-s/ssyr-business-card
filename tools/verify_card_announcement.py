"""Shared notices and opt-in are independent of all private chat identities."""
import base64
import hashlib
import json
from uuid import UUID, uuid4
from urllib.parse import urlsplit
from playwright.sync_api import expect
from verify_notices import API, HEADERS, SESSION

MOCK_PUSH = """
(() => {
  const scope = new URL('./', location.href).href;
  window.qaPush = {permission: 0, subscribed: 0, unsubscribed: 0};
  const subscription = {endpoint:'https://fcm.googleapis.com/synthetic-only',
    toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'fixture',auth:'test'}}},
    async unsubscribe(){qaPush.unsubscribed++;return true}};
  const registration = {scope,active:{state:'activated'},pushManager:{
    async getSubscription(){return subscription},
    async subscribe(){qaPush.subscribed++;return subscription}
  }};
  Object.defineProperty(navigator,'serviceWorker',{value:{
    async register(){return registration}, async getRegistration(){return registration},
    ready:Promise.resolve(registration),addEventListener(){}
  }});
  Object.defineProperty(window,'Notification',{value:{permission:'granted',
    async requestPermission(){qaPush.permission++;return 'granted'}}});
  window.PushManager = function(){};
})()
"""


def check_card_announcement(browser, base):
    first = {'id':str(uuid4()), 'title':'ゲームができたよ', 'body':'横画面で遊んでみてね。'}
    revision = first['id']
    item = first.copy()
    key = base64.urlsafe_b64encode(b'\x04'+bytes(64)).decode().rstrip('=')
    bindings = {}
    actions = []
    written_revisions = {}
    drop_next = False

    def route(r):
        nonlocal item, revision, drop_next
        if r.request.method == 'OPTIONS':
            r.fulfill(status=204, headers=HEADERS)
            return
        def done(data, status=200):
            r.fulfill(status=status, json=data, headers=HEADERS)
        if r.request.method == 'GET':
            done({'ok':True, 'version':1, 'vapidPublicKey':key})
            return
        fields = r.request.post_data_json
        action = fields['action']
        actions.append(action)
        if action.startswith('owner-'):
            assert r.request.headers['authorization'] == 'Bearer '+SESSION
        if action == 'card-announcement':
            assert set(fields) == {'action'}
            done({'announcement': item})
        elif action == 'chat-unread':
            done({'counts':[1], 'threadIds':['11111111-2222-4333-8444-555555555555']})
        elif action.startswith('card-announcement-'):
            device = fields['device']
            assert len(bytes.fromhex(device)) == 32
            assert device != 'c'*64
            binding = bindings.get(device)
            if action == 'card-announcement-subscribe':
                sub = fields['subscription']
                parts = [sub['endpoint'],sub['keys']['p256dh'],sub['keys']['auth']]
                binding = hashlib.sha256(json.dumps(parts,separators=(',',':')).encode()).hexdigest()
                bindings[device] = binding
            elif action == 'card-announcement-stop':
                binding = None
                bindings.pop(device, None)
            else:
                assert action == 'card-announcement-status'
            done({'enabled':bool(binding),'pushBinding':binding,'delivery':{'accepted':int(bool(item and binding)), 'failed':0,'expired':0,'pending':0}})
        elif action == 'owner-list':
            done({'contacts':[], 'ownerPushEnabled': False})
        elif action == 'owner-announcement':
            done({'announcement':item,'revision':revision})
        elif action in ('owner-publish-announcement','owner-withdraw-announcement'):
            request_id = fields['requestId']
            UUID(request_id)
            if fields['expectedRevision'] != revision:
                if written_revisions.get(request_id) != revision:
                    done({'error':'別の画面で更新されています。'},409)
                    return
            else:
                revision = str(uuid4())
                written_revisions[request_id] = revision
                item = ({'id':revision,'title':fields['title'],'body':fields['body']}
                        if action == 'owner-publish-announcement' else None)
            if drop_next:
                drop_next = False
                done({'error':'送信結果を確認できません。'}, 503)
                return
            done({'announcement':item,'revision':revision,'delivery':{'accepted':len(bindings),'failed':0,'expired':0,'pending':0}})
        else:
            raise AssertionError(f'Unexpected action: {action}')

    def isolated():
        ctx = browser.new_context(viewport={'width':360, 'height':760},service_workers='block')
        ctx.add_init_script(MOCK_PUSH)
        ctx.route('**/*',lambda r:r.continue_() if r.request.method=='GET' and
                  urlsplit(r.request.url).netloc==urlsplit(base).netloc else r.abort())
        ctx.route(API, route)
        return ctx

    guest = isolated()
    page = guest.new_page()
    home = base+'shinji/'
    page.goto(home)
    entry = page.locator('#announcement-open')
    body = page.locator('#announcement-body')
    state = page.locator('#announcement-state')
    expect(entry).to_be_in_viewport()
    expect(state).to_have_text('新着メッセージあり')
    expect(entry).to_contain_text(first['title'])
    expect(body).to_be_hidden()
    expect(page.locator('#card-chat-start')).to_be_visible()
    entry.click()
    expect(body).to_have_text(first['body'])
    expect(state).to_contain_text('SHINJI')
    page.reload()
    expect(state).to_contain_text('SHINJI')
    assert set(actions) == {'card-announcement'}
    assert not page.evaluate("localStorage.getItem('ssyr-card-device-v1')")
    assert page.evaluate("qaPush.permission + qaPush.subscribed") == 0

    prefs = page.locator('#announcement-preferences')
    prefs.locator('summary').click()
    page.locator('#announcement-enable').click()
    expect(page.locator('#announcement-stop')).to_be_visible()
    page.wait_for_function("localStorage.getItem('ssyr-card-announcement-device-v1')")
    assert len(bindings) == 1
    stop = page.locator('#announcement-stop')
    page.once('dialog',lambda d:d.accept())
    stop.click()
    expect(page.locator('#announcement-enable')).to_be_enabled()
    assert not bindings
    assert page.evaluate('qaPush.unsubscribed') == 0

    admin = isolated()
    admin.add_init_script("sessionStorage.setItem('ssyr-owner-session-v1', "+json.dumps(SESSION)+")")
    owner = admin.new_page()
    owner.goto(home+'owner/')
    expect(owner.locator('#owner-console')).to_be_visible()
    assert 'owner-announcement' not in actions
    panel = owner.locator('#owner-announcement-panel')
    panel.locator('summary').click()
    expect(owner.locator('#owner-announcement-current')).to_contain_text(first['title'])
    title, text = owner.locator('#owner-announcement-title'), owner.locator('#owner-announcement-body')
    publish = owner.locator('#owner-announcement-publish')
    new_title = 'リングの<a>お知らせ'
    title.fill(new_title)
    text.fill('第2試合も遊べます。')
    # A concurrent editor changes the record. Preserve the pending draft.
    revision = str(uuid4())
    item = {'id':revision,'title':'別の管理画面からのお知らせ','body':'テスト'}
    publish.click()
    expect(owner.locator('#owner-announcement-current')).to_contain_text(item['title'])
    expect(title).to_have_value(new_title)
    # A retry after a committed response is lost must keep the request ID.
    drop_next = True
    publish.click()
    expect(owner.locator('#owner-announcement-status')).to_contain_text('確認')
    publish.click()
    expect(owner.locator('#owner-announcement-current')).to_contain_text(new_title)
    expect(owner.locator('#owner-announcement-delivery')).to_contain_text('0件')
    assert item['title'] == new_title

    page.reload()
    expect(state).to_have_text('新着メッセージあり')
    expect(entry).to_contain_text(new_title)
    assert entry.locator('a').count() == 0
    page.evaluate("localStorage.setItem('ssyr-card-device-v1','c'.repeat(64))")
    page.goto(home+'#announcement')
    expect(body).to_have_text(item['body'])
    expect(body).to_be_visible()
    expect(page.locator('#card-chat-unread')).to_be_visible()
    expect(page.locator('#card-chat-start')).to_be_hidden()

    withdraw = owner.locator('#owner-announcement-withdraw')
    owner.once('dialog',lambda d:d.dismiss())
    withdraw.click()
    assert item is not None
    owner.once('dialog',lambda d:d.accept())
    withdraw.click()
    expect(owner.locator('#owner-announcement-current')).not_to_contain_text(new_title)
    page.reload()
    expect(entry).to_be_hidden()
    expect(page.locator('#announcement-empty')).to_be_visible()
    expect(prefs).to_be_visible()
    assert not any(a in actions for a in ('claim','visitor-start','chat-send','owner-send','read','stop','disconnect'))
    guest.close()
    admin.close()
    print('PASS shared QR notice, isolated chat, anonymous opt-in, owner conflict/retry and withdrawal')
