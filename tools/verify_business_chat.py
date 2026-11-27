"""Exercise a complete business-card conversation without a real account, message or push."""
import base64
import hashlib
import json
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from playwright.sync_api import expect

from verify_notification_defaults import PLATFORM
from verify_notices import API, DATE, HEADERS, SESSION, VISITOR
from verify_personal import check_viewport


def check_business_push(page, base, path, contact_id, owner=False):
    """Dispatch pushes to the released worker script; never subscribe a real device."""
    worker = page.request.get(base + path + 'sw.js').text()
    result = page.evaluate("""async ({source,scope,id,owner}) => {
        const listeners = {}, notices = [], opened = [], badges = [];
        const self = {
            registration: {scope, showNotification: async (title, options) => notices.push({title, ...options})},
            navigator: {setAppBadge: async () => badges.push(1)},
            clients: {matchAll: async () => [], openWindow: async url => opened.push(String(url))},
            addEventListener: (event, handler) => listeners[event] = handler
        };
        new Function('self', source)(self);
        let work;
        const waitUntil = p => {work = p};
        const event = owner ? {kind:'owner-message',contactId:id} : {kind:'message',threadId:id};
        if (!owner) {
            listeners.push({data:{json:()=>({...event,edition:'shinji'})},waitUntil});
            await work;
        }
        listeners.push({data:{json:()=>({...event,edition:'business',id})},waitUntil});
        await work;
        listeners.notificationclick({notification:{...notices[0],close(){}},waitUntil});
        await work;
        return {notices,opened,badges};
    }""", {'source': worker, 'scope': base + path, 'id': contact_id, 'owner': owner})
    assert len(result['notices']) == 1 and result['badges'] == [1]
    notice = result['notices'][0]
    assert "S's-YR" in notice['title']
    assert '事業用名刺' in notice['body'] if owner else '新着' in notice['body']
    target = base + path + ('#contact=' + contact_id if owner else '')
    assert result['opened'] == [target]


def check_business_chat(browser, base):
    # An old, personal contact with the same name must stay distinguishable.
    personal = dict(VISITOR, id=str(uuid4()), display_name='山田', unread=0)
    legacy_device = 'a' * 64
    customers = {}
    messages = {personal['id']: []}
    subscriptions = {}
    calls = []
    errors = []
    contexts = []
    vapid = base64.urlsafe_b64encode(bytes([4]) + bytes(64)).decode().rstrip('=')

    def api(route):
        request = route.request

        def send(data, status=200):
            route.fulfill(json=data, status=status, headers=HEADERS)

        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers=HEADERS)
            return
        if request.method == 'GET':
            send({'ok': True, 'version': 1, 'vapidPublicKey': vapid})
            return
        data = request.post_data_json
        action = data['action']
        calls.append(action)
        device = data.get('device')
        assert device != legacy_device and legacy_device not in data.get('devices', [])
        if action.startswith('owner-'):
            assert request.headers.get('authorization') == 'Bearer ' + SESSION
            contact_id = data.get('contactId')
            if action == 'owner-list':
                send({'contacts': [personal, *customers.values()], 'ownerPushEnabled': False})
            elif action == 'owner-game-access':
                send({'contactId': personal['id'], 'revision': str(uuid4())})
            elif action == 'owner-history':
                send({'messages': messages[contact_id]})
            elif action == 'owner-read':
                for msg in messages[contact_id]:
                    if msg['id'] in data['ids']:
                        msg['read_at'] = DATE
                send({'ok': True})
            elif action == 'owner-ack-acceptance':
                row = next(c for c in customers.values() if c['id'] == contact_id)
                row['acceptance_seen_at'] = data['acceptanceAt']
                send({'ok': True})
            elif action == 'owner-send':
                assert UUID(data['requestId']).version == 4
                msg = new_message(data['body'], 'outbound')
                messages[contact_id].insert(0, msg)
                send({'message': msg})
            else:
                raise AssertionError('Unexpected owner action: ' + action)
            return

        assert data.get('edition') == 'business', action
        if action == 'business-config':
            send({'ok': True, 'edition': 'business', 'version': 1, 'vapidPublicKey': vapid})
            return
        if action == 'chat-unread':
            rows = [customers.get(key) for key in data['devices']]
            ids = [row['id'] if row else None for row in rows]
            counts = [sum(m['direction'] == 'outbound' and not m['read_at'] for m in messages.get(id_, [])) for id_ in ids]
            send({'counts': counts, 'threadIds': ids})
            return
        if action == 'visitor-start':
            assert data['name'] == '山田' and len(bytes.fromhex(device)) == 32
            customer = customers.setdefault(device, dict(VISITOR, id=str(uuid4()), display_name='山田',
                card_edition='business', acceptance_at=DATE, acceptance_seen_at=None, unread=0))
            messages.setdefault(customer['id'], [])
        customer = customers.get(device)
        if not customer:
            send({'error': '未登録'}, 401)
            return

        def summary():
            return {'id': customer['id'], 'edition': 'business', 'displayName': customer['display_name'],
                    'enabled': device in subscriptions, 'pushBinding': subscriptions.get(device)}

        thread = messages[customer['id']]
        if action == 'visitor-start':
            send({'contact': summary()})
        elif action == 'status':
            send({'contact': summary(), 'messages': thread})
        elif action == 'chat-send':
            assert UUID(data['requestId']).version == 4
            msg = new_message(data['body'], 'inbound')
            thread.insert(0, msg)
            send({'message': msg})
        elif action == 'chat-delete':
            thread[:] = [msg for msg in thread if msg['id'] != data['id'] or msg['direction'] != 'inbound']
            send({'ok': True})
        elif action == 'read':
            next(msg for msg in thread if msg['id'] == data['id'])['read_at'] = DATE
            send({'ok': True})
        elif action == 'subscribe':
            sub = data['subscription']
            fields = [sub['endpoint'], sub['keys']['p256dh'], sub['keys']['auth']]
            subscriptions[device] = hashlib.sha256(json.dumps(fields, separators=(',', ':')).encode()).hexdigest()
            send({'contact': summary()})
        elif action == 'stop':
            subscriptions.pop(device, None)
            send({'ok': True})
        else:
            raise AssertionError('Unexpected business action: ' + action)

    def new_message(body, direction):
        return {'id': str(uuid4()), 'direction': direction, 'body': body, 'title': 'チャット',
                'created_at': DATE, 'read_at': None, 'push_status': 'disabled'}

    def new_page(behavior=None):
        context = browser.new_context(viewport={'width': 320, 'height': 740}, service_workers='block')
        contexts.append(context)
        context.route('**/*', lambda route: route.continue_() if urlsplit(route.request.url).netloc == urlsplit(base).netloc else route.abort())
        context.route(API, api)
        if behavior:
            context.add_init_script(PLATFORM.replace('__BEHAVIOR__', json.dumps(behavior)))
            context.add_init_script("localStorage.setItem('ssyr-card-device-v1', " + json.dumps(legacy_device) + ")")
        else:
            context.add_init_script("sessionStorage.setItem('ssyr-owner-session-v1', " + json.dumps(SESSION) + ")")
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        return page

    def join(page):
        page.goto(base)
        expect(page.locator('#business-chat-unread')).to_be_hidden()
        page.locator('#business-chat-link').click()
        expect(page.locator('#visitor-name')).to_have_attribute('required', '')
        expect(page.locator('#initial-push')).to_be_checked()
        page.locator('#visitor-name').fill('山田')
        page.locator('#join-chat').click()
        expect(page.locator('#conversation')).to_be_visible()
        check_viewport(page)
        return page.evaluate("localStorage.getItem('ssyr-business-device-v1')")

    try:
        reader = new_page('denied')
        first_device = join(reader)
        reader.locator('#chat-body').fill('チラシの配布を相談したいです')
        reader.locator('#chat-send').click()
        expect(reader.locator('#message-list')).to_contain_text('チラシの配布を相談したいです')
        assert not subscriptions
        reader.goto(base)

        other = new_page('grant')
        other_device = join(other)
        expect(other.locator('#notification-state')).to_contain_text('ON')
        assert set(subscriptions) == {other_device} and other_device != first_device
        expect(other.locator('#message-list')).not_to_contain_text('チラシの配布')
        assert not other.get_by_text('STRAIGHT RING').count()
        other.locator('#stop-notifications').click()
        expect(other.locator('#notification-state')).to_contain_text('OFF')

        owner = new_page()
        first_id = customers[first_device]['id']
        owner.goto(base + 'shinji/owner/#contact=' + first_id)
        expect(owner.locator('#selected-edition')).to_contain_text('事業用')
        expect(owner.locator('#selected-name')).to_have_text('山田')
        expect(owner.locator('#history')).to_contain_text('チラシの配布')
        select = owner.locator('#edition-filter')
        select.select_option('business')
        expect(owner.locator('#contacts .contact-row')).to_have_count(2)
        expect(owner.locator('#new-chat')).to_be_hidden()
        expect(owner.locator('#reissue')).to_be_hidden()
        expect(owner.locator('#invite-handoff')).to_be_hidden()
        expect(owner.locator('#owner-game-panel')).to_be_hidden()
        for row in owner.locator('#contacts .contact-row').all():
            expect(row).to_contain_text('事業用')
        check_viewport(owner)
        owner.locator('#message-body').fill('配布地域をお知らせください。')
        owner.locator('#send-form button').click()
        expect(owner.locator('#history')).to_contain_text('配布地域をお知らせください。')
        select.select_option('shinji')
        expect(owner.locator('#contacts .contact-row')).to_have_count(1)
        expect(owner.locator('#contacts .contact-row')).to_contain_text('個人用')
        owner.locator('#owner-game-panel summary').click()
        expect(owner.locator('#owner-game-contact')).to_be_enabled()
        eligible = owner.locator('#owner-game-contact option').evaluate_all('rows => rows.map(r => r.value).filter(Boolean)')
        assert eligible == [personal['id']]

        reader.reload()
        expect(reader.locator('#business-chat-count')).to_contain_text('1')
        reader.locator('#business-chat-unread a').click()
        reply = reader.locator('#message-list').get_by_text('配布地域をお知らせください。', exact=True)
        expect(reply).to_be_visible()
        expect(reader.locator('#message-list')).to_contain_text("S's-YR")
        assert not reader.locator('#message-list').get_by_text('SHINJI', exact=True).count()
        reply.locator('..').scroll_into_view_if_needed()
        expect(reader.get_by_role('button', name='既読にする')).to_have_count(0)
        assert 'read' in calls
        mine = reader.locator('#message-list article').filter(has_text='チラシの配布')
        reader.once('dialog', lambda dialog: dialog.accept())
        mine.get_by_role('button', name='削除').click()
        expect(mine).to_have_count(0)
        expect(reply).to_be_visible()
        reader.goto(base)
        expect(reader.locator('#business-chat-unread')).to_be_hidden()
        other.reload()
        expect(other.locator('#conversation')).to_be_visible()
        expect(other.locator('#message-list')).not_to_contain_text('配布地域')
        assert other.evaluate("localStorage.getItem('ssyr-card-device-v1')") == legacy_device
        check_business_push(other, base, 'business-chat/', first_id)
        check_business_push(owner, base, 'shinji/owner/', first_id, owner=True)
        assert not subscriptions
        assert calls.count('visitor-start') == 2 and calls.count('owner-send') == 1
        assert not errors, errors
    finally:
        for context in contexts:
            context.close()
    print('PASS business visitors, same-name isolation, owner filter and reply, private game separation, notification refusal and unread on card')
