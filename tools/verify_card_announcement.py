"""Public teasers, registered chat reading and independent notification opt-in."""
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
  const recordBadge = n => { document.documentElement.dataset.qaBadge = String(n ?? 'dot'); };
  Object.defineProperty(navigator,'setAppBadge',{value:async n=>recordBadge(n)});
  Object.defineProperty(navigator,'clearAppBadge',{value:async()=>recordBadge(0)});
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
    suggested = {'title':'今週の公開テスト', 'body':'新しい試合の見どころを準備しました。'}
    revision = first['id']
    item = first.copy()
    key = base64.urlsafe_b64encode(b'\x04'+bytes(64)).decode().rstrip('=')
    bindings = {}
    actions = []
    written_revisions = {}
    drop_next = False
    private_unread = 0
    active_devices = {}
    full_available = False
    private_id = str(uuid4())
    private_message_id = str(uuid4())
    private_body = '個別の会話でだけ読める本文'

    def teaser(value):
        if not value:
            return None
        lines = [line.strip() for line in value['body'].splitlines() if line.strip()]
        if lines and lines[0] == value['title']:
            lines.pop(0)
        first_line = lines[0] if lines else ''
        length = min(5, max(0, len(first_line) - (len(lines) == 1)))
        return {**value, 'body':first_line[:length]+'……'}

    def route(r):
        nonlocal item, revision, drop_next, private_unread
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
            done({'announcement': teaser(item)})
        elif action == 'visitor-start':
            assert fields['name'] == 'テストのひかり'
            device = fields['device']
            assert len(bytes.fromhex(device)) == 32
            active_devices[device] = private_id
            done({'contact':{'id':private_id,'enabled':False}})
        elif action == 'chat-announcement':
            assert set(fields) == {'action','device'}
            if fields['device'] not in active_devices:
                done({'error':'受け取り登録が必要です。'},401)
            elif not full_available:
                done({'error':'全文を取得できませんでした。'},503)
            else:
                done({'announcement':item})
        elif action == 'game-access':
            done({'allowed':False})
        elif action == 'chat-unread':
            thread_ids = [active_devices.get(device) for device in fields['devices']]
            done({'counts':[private_unread if tid else 0 for tid in thread_ids], 'threadIds':thread_ids})
        elif action == 'status':
            if fields['device'] not in active_devices:
                done({'error':'招待の受け取りが必要です。'},401)
                return
            done({'contact':{'id':private_id,'enabled':False},'messages':[{
                'id':private_message_id,'direction':'outbound','body':private_body,
                'created_at':'2026-01-01T00:00:00Z',
                'read_at':None if private_unread else '2026-01-02T00:00:00Z'}]})
        elif action == 'read':
            assert fields['device'] in active_devices and fields['id'] == private_message_id
            private_unread = 0
            done({'ok':True})
        elif action.startswith('card-announcement-'):
            device = fields['device']
            assert len(bytes.fromhex(device)) == 32
            assert device not in active_devices
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
            done({'enabled':bool(binding),'pushBinding':binding})
        elif action == 'owner-list':
            done({'contacts':[], 'ownerPushEnabled': False})
        elif action == 'owner-announcement':
            done({'announcement':item,'revision':revision,'suggestedDraft':suggested if revision == first['id'] else None})
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
    preview = page.locator('#announcement-preview')
    name = page.locator('#card-receive-name')
    start = page.locator('#card-receive-start')
    state = page.locator('#announcement-state')
    read_key = 'ssyr-card-announcement-chat-read-v1'
    def expect_badge(n):
        expect(page.locator('html')).to_have_attribute('data-qa-badge', str(n))
    expect(entry).to_be_in_viewport()
    expect(state).to_have_text('新着メッセージあり')
    expect(entry).to_contain_text(first['title'])
    expect(preview).to_have_text('横画面で遊……')
    expect(entry).to_contain_text('続きを読む')
    expect(page.get_by_text(first['body'], exact=True)).to_have_count(0)
    expect(page.locator('#card-chat-start')).to_be_visible()
    expect_badge(1)
    page.evaluate("(id) => localStorage.setItem('ssyr-card-announcement-read-v1',id)", first['id'])
    page.reload()
    expect(state).to_have_text('新着メッセージあり')
    page.locator('#announcement-default').uncheck()
    entry.click()
    expect(name).to_be_focused()
    name.fill('　 ')
    start.click()
    expect(name).to_be_focused()
    expect_badge(1)
    assert not page.evaluate("key => localStorage.getItem(key)", read_key)
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

    # A notification preview follows the same name gate without claiming an
    # invitation. A lost full-body response must leave the announcement unread.
    page.goto(home+'#announcement')
    expect(name).to_be_focused()
    expect_badge(1)
    assert not active_devices
    name.fill('テストのひかり')
    page.locator('#card-private-default').uncheck()
    start.click()
    retry = page.locator('#chat-announcement-retry')
    expect(retry).to_be_visible()
    expect_badge(1)
    assert not page.evaluate("key => localStorage.getItem(key)", read_key)
    assert len(active_devices) == 1 and actions.count('visitor-start') == 1
    full_available = True
    retry.click()
    full = page.locator('#chat-announcement-body')
    expect(full).to_have_text(first['body'])
    expect(full).to_be_visible()
    expect_badge(0)
    assert page.evaluate("key => localStorage.getItem(key)", read_key) == first['id']
    page.goto(home)
    expect(state).to_contain_text('SHINJI')

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
    expect(owner.locator('#owner-announcement-current')).to_contain_text(first['body'])
    expect(title).to_have_value(suggested['title'])
    expect(text).to_have_value(suggested['body'])
    expect(publish).to_be_enabled()
    assert 'owner-publish-announcement' not in actions and item == first
    expect(page.get_by_text(suggested['body'], exact=True)).to_have_count(0)
    publish.click()
    expect(owner.locator('#owner-announcement-current')).to_contain_text(suggested['body'])
    page.reload()
    expect(entry).to_contain_text(suggested['title'])
    expect(preview).to_have_text(teaser(suggested)['body'])
    expect(page.get_by_text(suggested['body'],exact=True)).to_have_count(0)
    entry.click()
    expect(full).to_have_text(suggested['body'])
    expect(full).to_be_visible()
    page.goto(home)
    text.fill('   ')
    expect(publish).to_be_disabled()
    text.fill('家')
    expect(owner.locator('#owner-announcement-preview-body')).to_have_text('……')
    glyph = '👩‍👩‍👧‍👧'
    text.fill(suggested['title']+'\n'+glyph*6+'\n末尾')
    expect(owner.locator('#owner-announcement-preview-body')).to_have_text(glyph*5+'……')
    new_title = 'リングの<a>お知らせ'
    title.fill(new_title)
    text.fill('第2試合も遊べます。')
    expect(owner.locator('#owner-announcement-preview')).to_contain_text('第2試合も……')
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

    private_unread = 1
    page.reload()
    expect(state).to_have_text('新着メッセージあり')
    expect(entry).to_contain_text(new_title)
    expect_badge(2)
    assert entry.locator('a').count() == 0
    # A private read from another open card must preserve the public unread.
    expect(page.get_by_text(private_body)).to_have_count(0)
    chat = guest.new_page()
    chat.goto(home+'notices.html')
    expect(chat.locator('html')).to_have_attribute('data-qa-badge', '2')
    expect(chat.get_by_text(private_body)).to_be_visible()
    chat.get_by_role('button',name='既読にする').click()
    expect(chat.locator('html')).to_have_attribute('data-qa-badge', '1')
    chat.close()
    page.bring_to_front()
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect_badge(1)
    expect(state).to_have_text('新着メッセージあり')
    private_unread = 1
    page.evaluate("window.dispatchEvent(new Event('ssyr-chat-unread-changed'))")
    expect_badge(2)
    page.goto(home+'#announcement')
    expect(full).to_have_text(item['body'])
    expect(full).to_be_visible()
    expect_badge(1)
    page.goto(home)
    expect(page.locator('#card-chat-unread')).to_be_visible()
    expect(name).to_be_hidden()
    entry.click()
    expect(full).to_be_visible()
    assert actions.count('visitor-start') == 1
    page.goto(home)

    final_title = '第3試合のお知らせ'
    previous_id = item['id']
    title.fill(final_title)
    text.fill('今週の対戦です。')
    publish.click()
    expect(owner.locator('#owner-announcement-current')).to_contain_text(final_title)
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(state).to_have_text('新着メッセージあり')
    expect_badge(2)
    page.goto(home+'notices.html#thread='+private_id+'&announcement='+previous_id)
    back_to_card = page.locator('#chat-announcement a[href$="#announcement"]')
    expect(back_to_card).to_be_visible()
    expect(full).to_be_hidden()
    expect_badge(2)
    assert page.evaluate("key => localStorage.getItem(key)",read_key) == previous_id
    withdraw = owner.locator('#owner-announcement-withdraw')
    owner.once('dialog',lambda d:d.dismiss())
    withdraw.click()
    assert item is not None
    owner.once('dialog',lambda d:d.accept())
    withdraw.click()
    expect(owner.locator('#owner-announcement-current')).not_to_contain_text(final_title)
    page.goto(home+'#announcement')
    expect(entry).to_be_hidden()
    expect(page.locator('#announcement-empty')).to_be_visible()
    expect(prefs).to_be_visible()
    expect_badge(1)
    assert actions.count('read') == 1
    # A cached but revoked chat must return to the name gate, never issuing a
    # new acceptance or showing a full announcement merely by following a push.
    item = first.copy()
    active_devices.clear()
    page.goto(home+'#announcement')
    page.reload()
    expect(name).to_be_focused()
    expect(page.get_by_text(first['body'],exact=True)).to_have_count(0)
    assert actions.count('visitor-start') == 1
    assert not any(a in actions for a in ('claim','chat-send','owner-send','stop','disconnect'))
    guest.close()
    admin.close()
    print('PASS shared QR teaser, required chat registration, full text, badges, push, owner edits and withdrawal')
