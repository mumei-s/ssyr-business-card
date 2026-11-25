(() => {
  'use strict';
  const N = window.SSYRNotice;
  const settings = document.getElementById('announcement-preferences');
  const enable = document.getElementById('announcement-enable');
  const stop = document.getElementById('announcement-stop');
  const status = document.getElementById('announcement-push-status');
  const deviceKey = 'ssyr-card-announcement-device-v1';
  const changeKey = 'ssyr-card-announcement-push-change';
  const scope = new URL('./', location.href).href;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const supported = window.isSecureContext && 'Notification' in window && 'PushManager' in window &&
    !!navigator.serviceWorker && (!ios || navigator.standalone || matchMedia('(display-mode: standalone)').matches);
  let busy = false;
  let serverState = null;
  let matched = false;
  let version = 0;

  function device() {
    try {
      const saved = localStorage.getItem(deviceKey);
      return N.validToken(saved) ? saved : '';
    } catch { return ''; }
  }
  function reserveDevice() {
    const saved = device();
    if (saved) return saved;
    const token = N.random();
    localStorage.setItem(deviceKey, token);
    if (device() !== token) throw Error('通知設定を保存できません。ブラウザーの保存設定をご確認ください。');
    return token;
  }
  function render(note = '') {
    const blocked = supported && Notification.permission === 'denied';
    const on = !!serverState?.enabled && matched && supported && Notification.permission === 'granted';
    stop.hidden = !serverState?.enabled && (serverState !== null || !device());
    enable.hidden = on;
    enable.disabled = busy || !supported || blocked;
    stop.disabled = busy;
    enable.textContent = serverState?.enabled ? '名刺の新着通知を再設定' : '名刺の新着通知を受け取る';
    let text = '名刺の新着通知はOFFです。';
    if (on) text = '名刺の新着通知はONです。';
    else if (!supported) text = ios ? '通知はホーム画面に追加した名刺から設定できます。' : '通知に対応したブラウザーで名刺を開いてください。';
    else if (blocked) text = '通知がブロックされています。ブラウザーのサイト設定で通知を許可してください。';
    else if (serverState?.enabled) text = 'この端末の通知登録を確認してください。';
    else if (device() && serverState === null) text = '通知設定を確認しています。';
    status.textContent = note || text;
  }
  async function bindingOf(subscription) {
    if (!subscription) return '';
    const {endpoint, keys} = subscription.toJSON();
    if (!endpoint || !keys?.p256dh || !keys?.auth) return '';
    const input = new TextEncoder().encode(JSON.stringify([endpoint, keys.p256dh, keys.auth]));
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  function compatible(subscription, key) {
    const existing = subscription?.options?.applicationServerKey;
    if (!existing) return true;
    const bytes = new Uint8Array(existing);
    return bytes.length === key.length && bytes.every((value, i) => value === key[i]);
  }
  async function publicKey() {
    const config = await N.config();
    const key = config.ok && typeof config.vapidPublicKey === 'string' ? N.decode(config.vapidPublicKey) : null;
    if (key?.length !== 65 || key[0] !== 4) throw Error('名刺の通知設定を確認できませんでした。');
    return key;
  }
  async function sync() {
    if (busy) return;
    const check = ++version, token = device();
    if (!token) { serverState = null; matched = false; render(); return; }
    try {
      const remote = await N.call('card-announcement-status', {device:token});
      if (check !== version) return;
      let match = false;
      if (remote.enabled && supported && Notification.permission === 'granted') {
        const reg = await N.wait(navigator.serviceWorker.getRegistration(scope));
        const sub = reg?.scope === scope ? await N.wait(reg.pushManager.getSubscription()) : null;
        const current = await bindingOf(sub);
        match = !!current && current === remote.pushBinding;
        if (current && !match && N.validToken(remote.pushBinding)) {
          const key = await publicKey();
          if (check !== version) return;
          if (compatible(sub, key)) {
            const restored = await N.call('card-announcement-subscribe', {
              device:token, expectedPushBinding:remote.pushBinding, subscription:sub.toJSON()
            });
            match = restored.enabled === true && restored.pushBinding === current;
          }
        }
      }
      if (check !== version) return;
      serverState = remote; matched = match; render();
    } catch {
      if (check !== version) return;
      matched = false;
      render('名刺の新着通知の設定を確認できませんでした。');
    }
  }
  async function register(token) {
    const [key, reg] = await Promise.all([publicKey(),
      N.wait(navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'}), 10000)]);
    if (reg.scope !== scope) throw Error('名刺から通知を設定してください。');
    for (let i = 0; i < 24 && !reg.active; ++i) await new Promise(resolve => setTimeout(resolve, 250));
    if (!reg.active) throw Error('通知の準備中です。もう一度お試しください。');
    let sub = await N.wait(reg.pushManager.getSubscription());
    // Other private chats share this browser's subscription. Never unsubscribe it here.
    if (!compatible(sub, key)) throw Error('この端末の通知登録が一致しません。名刺の通知設定をご確認ください。');
    if (!sub) sub = await N.wait(reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key}), 12000);
    const binding = await bindingOf(sub);
    if (!binding) throw Error('この端末の通知登録を確認できませんでした。');
    const saved = await N.call('card-announcement-subscribe', {device:token, subscription:sub.toJSON()});
    if (!saved.enabled || saved.pushBinding !== binding) throw Error('通知登録の結果を確認できませんでした。');
    serverState = saved; matched = true;
  }
  async function change(turnOn) {
    if (busy) return;
    busy = true; ++version; render('通知設定を保存しています…');
    let error = '';
    try {
      if (turnOn) {
        const permission = Notification.permission === 'granted' ? 'granted' :
          await N.wait(Notification.requestPermission(),20000);
        if (permission !== 'granted') throw Error('端末で通知が許可されていません。');
      }
      async function apply() {
        if (turnOn) { await register(reserveDevice()); return; }
        const token = device();
        if (token) await N.call('card-announcement-stop', {device:token});
        serverState = {enabled:false}; matched = false;
      }
      if (navigator.locks?.request) await navigator.locks.request(deviceKey, apply);
      else await apply();
      try { localStorage.setItem(changeKey, String(Date.now())); } catch {}
    } catch (err) { error = err.message || '通知設定を保存できませんでした。'; }
    finally { busy = false; render(error); }
  }
  enable.addEventListener('click', () => { void change(true); });
  stop.addEventListener('click', () => { void change(false); });
  settings.addEventListener('toggle', () => { if (settings.open) void sync(); });
  window.addEventListener('storage', e => { if (!e.key || e.key === changeKey || e.key === deviceKey) void sync(); });
  window.addEventListener('focus', sync);
  window.addEventListener('pageshow', e => { if (e.persisted) void sync(); });
  window.addEventListener('online', sync);
  settings.hidden = false;
  render();
  void sync();
})();
