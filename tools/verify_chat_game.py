"""Exercise a single game's owner grant, two isolated recipients, and its standalone launcher."""
import base64
import json
from urllib.parse import urlsplit
from uuid import uuid4

from playwright.sync_api import expect

from verify_notices import API, HEADERS, SESSION, VISITOR


def check_chat_game(browser, base):
    chat = base + 'shinji/notices.html'
    game = base + 'shinji/games/straight-ring/'
    contacts = [dict(VISITOR, id=str(uuid4()), display_name='同じ呼び名', unread=0) for _ in range(3)]
    contacts[-1]['linked_at'] = None
    devices = {'a'*64: contacts[0], 'b'*64: contacts[1]}
    grant = {'contactId': None, 'revision': str(uuid4())}
    calls = []
    contexts = []
    test_message = 'この会話に届いた案内です。'

    def isolated(device=None, owner=False):
        context = browser.new_context(viewport={'width':360, 'height':760}, service_workers='block')
        contexts.append(context)
        context.route('**/*', lambda r: r.continue_() if urlsplit(r.request.url).netloc == urlsplit(base).netloc else r.abort())
        context.route(API, api)
        if device:
            context.add_init_script("localStorage.setItem('ssyr-card-device-v1', " + json.dumps(device) + ")")
        if owner:
            context.add_init_script("sessionStorage.setItem('ssyr-owner-session-v1', " + json.dumps(SESSION) + ")")
        return context.new_page()

    def api(route):
        def reply(data, status=200):
            route.fulfill(json=data, headers=HEADERS, status=status)
        req = route.request
        if req.method == 'OPTIONS':
            route.fulfill(status=204, headers=HEADERS)
            return
        if req.method == 'GET':
            reply({'ok':True, 'vapidPublicKey':base64.urlsafe_b64encode(bytes([4])+bytes(64)).decode().rstrip('=')})
            return
        data = req.post_data_json
        action, device = data['action'], data.get('device')
        calls.append((action,device))
        receiver = devices.get(device)
        allowed = bool(receiver and receiver['id'] == grant['contactId'] and not receiver['revoked_at'])
        if action.startswith('owner-'):
            assert req.headers.get('authorization') == 'Bearer '+SESSION
        if action == 'owner-list':
            reply({'contacts':contacts,'ownerPushEnabled':False})
        elif action == 'owner-game-access':
            reply(grant)
        elif action == 'owner-set-game-access':
            assert data['expectedRevision'] == grant['revision']
            assert data['contactId'] in (None, contacts[0]['id'],contacts[1]['id'])
            grant.update(contactId=data['contactId'], revision=str(uuid4()))
            reply(grant)
        elif action == 'card-announcement':
            reply({'announcement':None})
        elif action == 'chat-unread':
            ids = [devices[t]['id'] if t in devices and not devices[t]['revoked_at'] else None for t in data['devices']]
            reply({'counts':[0]*len(ids),'threadIds':ids})
        elif action == 'status' and receiver and not receiver['revoked_at']:
            reply({'contact':{'id':receiver['id'], 'displayName':receiver['display_name'], 'enabled':False}, 'messages':[]})
        elif action == 'game-access':
            reply({'allowed':True,'message':test_message} if allowed else {'allowed':False})
        elif action == 'game-open' and allowed:
            reply({'key':fixture['key']})
        elif action in ('status','game-open'):
            reply({'error':'利用できません。'},403 if action == 'game-open' else 401)
        else:
            raise AssertionError('Unexpected request: '+action)

    try:
        anonymous = isolated()
        anonymous.goto(base+'shinji/')
        fixture = anonymous.evaluate("""async () => {
          const secret = crypto.getRandomValues(new Uint8Array(32));
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const key = await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['encrypt']);
          const html = new TextEncoder().encode('<!doctype html><p id="arena">保護されたテスト画面</p>');
          const data = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,html));
          return {key:btoa(String.fromCharCode(...secret)),pack:btoa(String.fromCharCode(...iv,...data))};
        }""")
        anonymous.goto(game)
        expect(anonymous.locator('#game-status')).to_contain_text('許可')
        expect(anonymous.locator('iframe')).to_have_count(0)
        assert not any(a in ('game-open','game-access') for a,_ in calls)

        first, second = devices.keys()
        reader, other = isolated(first), isolated(second)
        admin = isolated(owner=True)
        admin.goto(base+'shinji/owner/')
        admin.locator('#owner-game-panel summary').click()
        choice = admin.locator('#owner-game-contact')
        expect(choice.locator('option')).to_have_count(3)
        assert not choice.locator('option[value="'+contacts[2]['id']+'"]').count()
        assert len(set(choice.locator('option').all_text_contents())) == 3
        assert grant['contactId'] is None
        admin.on('dialog',lambda dialog: dialog.accept())

        def assign(contact):
            choice.select_option(contact['id'])
            admin.locator('#owner-game-allow').click()
            expect(admin.locator('#owner-game-current')).to_contain_text(contact['id'][-8:])

        assign(contacts[0])
        other.goto(chat)
        other.wait_for_load_state('networkidle')
        link = other.locator('#chat-game-url')
        expect(link).to_be_hidden()
        assert link.get_attribute('href') is None
        assert ('game-access',second) in calls and ('game-open',second) not in calls
        reader.goto(chat+'#invite='+'d'*64)
        reader.wait_for_load_state('networkidle')
        expect(reader.locator('#chat-game-url')).to_be_hidden()
        assert ('game-access',first) not in calls
        reader.locator('#dismiss-invite').click()
        link = reader.locator('#chat-game-url')
        expect(link).to_have_attribute('href',game)
        expect(link).to_have_text(game)
        expect(reader.locator('#chat-game-message')).to_have_text(test_message)
        for path, fields in [('release.json',{'json':{'version':1,'ready':False}}),('index.html',{'status':404})]:
            reader.route(game+path, lambda route: route.fulfill(**fields))
            reader.reload(wait_until='networkidle')
            expect(link).to_be_hidden()
            assert link.get_attribute('href') is None
            reader.unroute(game+path)
        reader.reload()
        expect(link).to_have_attribute('href',game)
        assert reader.request.get(game+'release.json').json()['ready'] is True
        reader.context.route(game+'game.pack', lambda r: r.fulfill(body=base64.b64decode(fixture['pack']),content_type='application/octet-stream'))
        reader.goto(game)
        expect(reader.frame_locator('#game-frame').locator('#arena')).to_have_text('保護されたテスト画面')
        assert reader.locator('#game-frame').get_attribute('sandbox').split() == ['allow-scripts']
        assert reader.url==game and ('game-open',first) in calls
        assign(contacts[1])
        reader.evaluate("dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
        expect(reader.locator('#game-frame')).to_have_count(0)
        reader.reload(wait_until='networkidle')
        expect(reader.locator('#game-frame')).to_be_hidden()
        other.reload()
        expect(other.locator('#chat-game-url')).to_have_attribute('href',game)
        admin.locator('#owner-game-remove').click()
        expect(admin.locator('#owner-game-current')).to_contain_text('ありません')
        other.reload(wait_until='networkidle')
        expect(other.locator('#chat-game-url')).to_be_hidden()
        contacts[0]['revoked_at'] = contacts[0]['linked_at']
        reader.goto(chat)
        expect(reader.locator('#claim-form')).to_be_visible()
        expect(reader.locator('#chat-game-url')).to_be_hidden()
    finally:
        for context in contexts:
            context.close()
    print('PASS owner assignment, two chat credentials, protected launcher, release gate, transfer and revocation')
