"""Live endpoint config and fail-closed authorization checks. No recipient data or messages."""
import json, urllib.request, urllib.error, base64
URL='https://slamzhgsawfnmwlejgqp.supabase.co/functions/v1/ssyr-card'
def request(payload=None, origin='https://mumei-s.github.io'):
    headers={'Origin':origin,'Accept':'application/json'}
    data=None if payload is None else json.dumps(payload).encode()
    if data is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(URL,data=data,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=25) as r:return r.status,json.load(r),r.headers
    except urllib.error.HTTPError as e:
        return e.code,json.load(e),e.headers
code,body,h=request()
assert code==200 and body.get('ok') is True,(code,body.get('error'))
key=body['vapidPublicKey'];decoded=base64.urlsafe_b64decode(key+'='*((4-len(key)%4)%4))
assert len(decoded)==65 and decoded[0]==4
assert set(body)=={'ok','version','vapidPublicKey'}
assert h.get('Access-Control-Allow-Origin')=='https://mumei-s.github.io'
assert request({'action':'owner-list'})[0]==401
assert request({'action':'status','device':'invalid'})[0]==401
assert request({'action':'owner-send','contactId':'invalid'})[0]==401
assert request(origin='https://foreign.invalid')[0]==403
print('PASS live VAPID public configuration, CORS and unauthenticated rejection; no push sent')
