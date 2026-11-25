"""Exercise independent notification choices without a real subscription or recipient."""
import base64
import hashlib
import json
from urllib.parse import urlsplit
from uuid import uuid4
from playwright.sync_api import expect
from verify_notices import API, HEADERS, INVITE


# A fresh browser that records system permission requests, user activation and
# native subscriptions across navigation. Only the test origin is reachable.
PLATFORM = """
(() => {
  const behavior = __BEHAVIOR__;
  const log = (key, value) => {
    const rows=JSON.parse(localStorage.getItem('qa-'+key)||'[]');
    rows.push(value); localStorage.setItem('qa-'+key,JSON.stringify(rows));
  };
  if (behavior === 'timeout') {
    const timer=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>timer(fn,ms>=3000 && ms<=30000 ? 160 : ms,...args);
  }
  Object.defineProperty(window,'Notification',{value:{
    get permission(){ return localStorage.getItem('qa-os') || 'default'; },
    async requestPermission(){
      log('requests',{active:navigator.userActivation.isActive});
      if(behavior === 'timeout') return new Promise(()=>{});
      const decision=behavior==='dismiss'?'default':behavior==='denied'?'denied':'granted';
      localStorage.setItem('qa-os',decision); return decision;
    }
  }});
  const scope=new URL('./',location.href).href;
  const subscription={endpoint:'https://fcm.googleapis.com/isolated-notification-test',
    get options(){return {applicationServerKey:new Uint8Array([4,...Array(64).fill(behavior==='mismatch'?1:0)]).buffer}},
    toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'fixture-key',auth:'fixture-auth'}}},
    async unsubscribe(){log('unsubscribe',1);localStorage.removeItem('qa-native');return true}
  };
  const reg={scope,active:{state:'activated'},getNotifications:async()=>[],pushManager:{
    async getSubscription(){return behavior==='mismatch'||localStorage.getItem('qa-native')?subscription:null},
    async subscribe(){
      log('subscribe',1);
      if(behavior==='push-error')throw new Error('Synthetic unavailable push service');
      localStorage.setItem('qa-native','yes');return subscription;
    }
  }};
  Object.defineProperty(navigator,'serviceWorker',{value:behavior==='unsupported'?undefined:{register:async()=>reg,
    getRegistration:async()=>reg,ready:Promise.resolve(reg),addEventListener(){}}});
  window.PushManager=function(){};
})();
"""


def check_notification_defaults(browser, base):
    home = base+'shinji/'
    for public, private, behavior, entry in [
        (True, True, 'grant', 'teaser'), (True, True, 'grant', 'name'), (True, False, 'grant', 'name'),
        (False, True, 'grant', 'name'), (False, False, 'grant', 'name'),
        (True, True, 'denied', 'name'), (True, True, 'dismiss', 'teaser'),
        (True, True, 'timeout', 'name'), (True, True, 'push-error', 'name'),
        (True, True, 'mismatch', 'name'), (False, False, 'unsupported', 'name'),
        (False, True, 'grant', 'invite'), (True, True, 'grant', 'legacy-off'),
    ]:
        ctx = browser.new_context(viewport={'width':360,'height':760},service_workers='block')
        ctx.add_init_script(PLATFORM.replace('__BEHAVIOR__',json.dumps(behavior)))
        records, chat_bindings, public_bindings = [], {}, {}
        thread_id, notice_id = str(uuid4()), str(uuid4())
        headline, full_text = '試合のご案内', '次の試合は来月開催します。'
        if entry=='legacy-off':
            ctx.add_init_script("localStorage.setItem('ssyr-card-announcement-device-v1','b'.repeat(64));localStorage.setItem('ssyr-card-device-v1','c'.repeat(64))")
            chat_bindings['c'*64]=None
            public_bindings['b'*64]=None

        def summary(token):
            return {'id':thread_id,'enabled':bool(chat_bindings[token]),'pushBinding':chat_bindings[token], 'muumeiNews':False}

        def api(route):
            def respond(data, status=200):
                route.fulfill(status=status,json=data,headers=HEADERS)
            if route.request.method=='OPTIONS':
                route.fulfill(status=204,headers=HEADERS)
                return
            if route.request.method=='GET':
                key=base64.urlsafe_b64encode(b'\x04'+bytes(64)).decode().rstrip('=')
                respond({'ok':True,'version':1,'vapidPublicKey':key})
                return
            params=route.request.post_data_json
            action=params['action']
            token=params.get('device')
            records.append(action)
            if action=='card-announcement':
                respond({'announcement':{'id':notice_id,'title':headline,'body':'次の試合は……'}})
            elif action=='chat-unread':
                ids=[thread_id if key in chat_bindings else None for key in params['devices']]
                respond({'counts':[0]*len(ids),'threadIds':ids})
            elif action in ('visitor-start','claim'):
                if action=='visitor-start': assert params['name']=='通知の読者テスト'
                else: assert params['invite']==INVITE
                chat_bindings.setdefault(token,None)
                respond({'contact':summary(token)})
            elif action in ('chat-announcement','status'):
                if token not in chat_bindings:
                    respond({'error':'未登録'},401)
                elif action=='status':respond({'contact':summary(token),'messages':[]})
                else:respond({'announcement':{'id':notice_id,'title':headline,'body':full_text}})
            elif action in ('subscribe','card-announcement-subscribe'):
                sub=params['subscription']
                parts=[sub['endpoint'],sub['keys']['p256dh'],sub['keys']['auth']]
                fingerprint=hashlib.sha256(json.dumps(parts,separators=(',',':')).encode()).hexdigest()
                if action=='subscribe':
                    assert token in chat_bindings and token not in public_bindings
                    chat_bindings[token]=fingerprint
                    respond({'contact':summary(token)})
                else:
                    assert token not in chat_bindings
                    public_bindings[token]=fingerprint
                    respond({'enabled':True,'pushBinding':fingerprint})
            elif action=='stop':
                assert token in chat_bindings
                chat_bindings[token]=None;respond({'ok':True})
            elif action in ('card-announcement-status','card-announcement-stop'):
                if action.endswith('-stop'):public_bindings[token]=None
                binding=public_bindings.get(token)
                respond({'enabled':bool(binding),'pushBinding':binding})
            else:raise AssertionError('Unexpected request: '+action)

        ctx.route('**/*',lambda r:r.continue_() if r.request.method=='GET' and urlsplit(r.request.url).netloc==urlsplit(base).netloc else r.abort())
        ctx.route(API,api)
        page=ctx.new_page()
        def events(key):
            return page.evaluate("key=>JSON.parse(localStorage.getItem('qa-'+key)||'[]')",key)
        def writes(action):return records.count(action)
        try:
            if entry=='invite':
                invite=home+'notices.html#invite='+INVITE
                page.goto(invite)
                expect(page.locator('#claim-private-default')).to_be_checked()
                assert not events('requests') and not records.count('claim')
                page.locator('#claim-button').click()
                expect(page.locator('#notice-state')).to_contain_text('ON')
                assert writes('claim')==1 and writes('subscribe')==1 and not public_bindings
                page.locator('#stop').click()
                expect(page.locator('#notice-state')).to_contain_text('OFF')
                page.goto(invite)
                page.locator('#claim-button').click()
                expect(page.locator('#claim-panel')).to_be_hidden()
                assert writes('subscribe')==1 and not any(chat_bindings.values())
                continue

            page.goto(home+'#announcement' if entry=='name' else home)
            top=page.locator('#announcement-default')
            public_choice=page.locator('#card-announcement-default')
            reply_choice=page.locator('#card-private-default')
            read=page.locator('#announcement-open')
            name=page.locator('#card-receive-name')
            if entry=='legacy-off':
                expect(top).not_to_be_checked()
                expect(page.locator('#announcement-default-status')).to_contain_text('OFF')
                read.click()
                expect(page.locator('#chat-announcement-body')).to_have_text(full_text)
                assert not events('requests') and not writes('subscribe') and not writes('card-announcement-subscribe')
                continue
            if behavior=='unsupported':
                expect(page.locator('#announcement-default-status')).to_contain_text('対応')
                expect(reply_choice).to_be_disabled()
            else:
                expect(top).to_be_checked()
                expect(public_choice).to_be_checked()
                expect(reply_choice).to_be_checked()
                expect(page.locator('#announcement-default-status')).to_contain_text('許可待ち')
            assert not events('requests') and not events('subscribe')
            assert not chat_bindings and not public_bindings
            if not public and behavior!='unsupported':top.uncheck()
            expect(public_choice).to_have_js_property('checked',public)
            if not private and behavior!='unsupported':reply_choice.uncheck()
            if entry=='teaser':
                read.click()
                expect(name).to_be_focused()
                if behavior=='grant':
                    expect(page.locator('#announcement-default-status')).to_contain_text('ON')
                assert len(events('requests'))==1 and not chat_bindings
                assert writes('card-announcement-subscribe')==int(behavior=='grant')
            else:
                if public and private:
                    expect(name).to_be_focused()
                page.locator('#card-receive-start').click()
                assert not events('requests') and not writes('visitor-start')
            name.fill('通知の読者テスト')
            page.locator('#card-receive-start').click()
            expect(page.locator('#chat-announcement-body')).to_have_text(full_text,timeout=12000)
            good=behavior=='grant'
            assert writes('visitor-start')==1 and len(chat_bindings)==1
            assert writes('subscribe')==int(private and good), (entry,behavior,records)
            assert writes('card-announcement-subscribe')==int(public and good), (entry,behavior,records)
            prompts=events('requests')
            assert len(prompts)==int(public or private) and all(p['active'] for p in prompts),(behavior,prompts)
            if good:assert len(events('subscribe'))==int(public or private)
            if public and private and good:
                assert set(public_bindings.values())==set(chat_bindings.values())
            assert not events('unsubscribe')
            if entry=='teaser' and good:
                page.locator('#stop').click()
                expect(page.locator('#notice-state')).to_contain_text('OFF')
                assert any(public_bindings.values())
                page.goto(home)
                page.locator('#announcement-preferences > summary').click()
                page.locator('#announcement-stop').click()
                expect(top).not_to_be_checked()
                read.click()
                expect(page.locator('#chat-announcement-body')).to_have_text(full_text)
                assert not any(public_bindings.values()) and not any(chat_bindings.values())
                assert writes('visitor-start')==1 and writes('subscribe')==1 and writes('card-announcement-subscribe')==1
                assert not events('unsubscribe')
        finally:
            ctx.close()
    print('PASS independent default notification choices, gesture-only permission, refusal/error recovery, replay and prior OFF')
