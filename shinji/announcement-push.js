(() => {
  'use strict';
  const N = window.SSYRNotice;
  const settings = document.getElementById('announcement-preferences');
  const choices = ['announcement-default', 'card-announcement-default'].map(id => document.getElementById(id));
  const enable = document.getElementById('announcement-enable');
  const stop = document.getElementById('announcement-stop');
  const status = document.getElementById('announcement-push-status');
  const deviceKey = 'ssyr-card-announcement-device-v1';
  const choiceKey = 'ssyr-card-announcement-choice-v1';
  const changeKey = 'ssyr-card-announcement-push-change';
  const statusKey = 'ssyr-card-announcement-status-change-v1';
  const pendingKey = 'ssyr-card-announcement-granted-v1';
  const scope = new URL('./', location.href).href;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const supported = N.pushSupported;
  let serverState = null, matched = false, version = 0;
  let localChoice = '', localEpoch = '', issue = '', dismissed = false;
  let permissionTask, permissionEpoch, bindingTask, stopping;

  function stored(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }
  function epoch() { return stored(changeKey) || localEpoch || 'initial'; }
  function device() {
    const value = stored(deviceKey);
    return N.validToken(value) ? value : '';
  }
  function reserveDevice() {
    if (device()) return device();
    const value = N.random();
    save(deviceKey, value);
    if (device() !== value) throw Error('通知設定を保存できません。ブラウザーの保存設定をご確認ください。');
    return value;
  }
  function choice() { return stored(choiceKey) || localChoice; }
  function wanted() {
    if (choice()) return choice() === 'on';
    // Older releases retained the anonymous key after an explicit stop.
    return device() ? serverState?.enabled === true : supported;
  }
  function enabled() {
    return !!serverState?.enabled && matched && supported && Notification.permission === 'granted';
  }
  function render() {
    if (!settings) return;
    const blocked = supported && Notification.permission === 'denied';
    let text = '通知OFF';
    if (!supported) text = ios ? 'ホーム画面に追加した名刺で設定できます。' : '端末通知に対応していないブラウザーです。';
    else if (stopping || (choice() === 'off' && serverState?.enabled)) text = '停止の反映待ち';
    else if (device() && serverState === null && !choice()) text = '受け取り設定を確認しています…';
    else if (enabled()) text = '端末通知ON';
    else if (wanted()) {
      if (blocked) text = '端末でブロック中。通知はブラウザーの設定で許可できます。';
      else if (Notification.permission !== 'granted') text = dismissed
        ? '許可待ち。通知設定から再度許可できます。' : '許可待ち。続けると端末で通知の許可を確認します。';
      else text = bindingTask ? '端末に登録しています…' : '端末への登録待ち';
    }
    for (const input of choices) {
      input.checked = wanted();
      input.disabled = !supported;
      document.getElementById(input.id + '-status').textContent = issue || text;
    }
    status.textContent = issue || text;
    enable.hidden = enabled() && wanted();
    enable.disabled = !!permissionTask || !!bindingTask || !!stopping || !supported || blocked;
    stop.hidden = !device() || (serverState?.enabled === false && !stopping);
    stop.disabled = !!stopping;
  }
  function locked(fn) {
    return navigator.locks?.request ? navigator.locks.request(deviceKey, fn) : fn();
  }
  function pending() {
    try { return sessionStorage.getItem(pendingKey); } catch { return null; }
  }
  function recordPending(value) {
    try {
      if (value) sessionStorage.setItem(pendingKey, value);
      else sessionStorage.removeItem(pendingKey);
    } catch {}
  }
  function permitted(at) {
    return supported && Notification.permission === 'granted' && choice() !== 'off' && epoch() === at;
  }
  async function sync() {
    if ((!settings && choice() !== 'off') || bindingTask || stopping) return;
    const check = ++version, token = device();
    if (!token) { serverState = null; matched = false; render(); return; }
    try {
      const remote = await N.call('card-announcement-status', {device:token});
      if (check !== version) return;
      if (choice() === 'off' && remote.enabled) {
        serverState = remote; issue = '';
        void stopAt(epoch()); return;
      }
      let match = false;
      if (remote.enabled && supported && Notification.permission === 'granted') {
        const reg = await N.wait(navigator.serviceWorker.getRegistration(scope));
        const sub = reg?.scope === scope ? await N.wait(reg.pushManager.getSubscription()) : null;
        const current = await N.pushBinding(sub);
        match = !!current && current === remote.pushBinding;
        if (current && !match && choice() !== 'off' && N.validToken(remote.pushBinding)) {
          const {key} = await N.preparePush();
          if (check !== version || choice() === 'off') return;
          if (N.compatiblePush(sub, key)) {
            const restored = await N.call('card-announcement-subscribe', {
              device:token, expectedPushBinding:remote.pushBinding, subscription:sub.toJSON()
            });
            match = restored.enabled === true && restored.pushBinding === current;
          }
        }
      }
      if (check !== version) return;
      serverState = remote; matched = match; issue = ''; render();
    } catch {
      if (check !== version) return;
      matched = false; issue = choice() === 'off' ? '停止の反映待ち。通信が戻ると確認します。' : '端末の通知設定を確認できませんでした。'; render();
    }
  }
  function bind(at) {
    if (bindingTask?.epoch === at) return bindingTask.promise;
    const task = {epoch:at};
    bindingTask = task; ++version;
    issue = '';
    let note = '';
    task.promise = (async () => {
      if (!permitted(at)) return;
      const {subscription, binding} = await N.pushSubscription();
      await locked(async () => {
        if (!permitted(at)) return;
        const token = reserveDevice();
        const saved = await N.call('card-announcement-subscribe', {device:token, subscription:subscription.toJSON()});
        if (!saved.enabled || saved.pushBinding !== binding) throw Error('端末への通知登録を確認できませんでした。');
        if (permitted(at)) { serverState = saved; matched = true; }
        else if (choice() === 'off') await N.call('card-announcement-stop', {device:token});
        save(statusKey, String(Date.now()));
      });
      if (pending() === at) recordPending(null);
    })().catch(error => { note = error.message || '通知設定を保存できませんでした。'; })
      .finally(() => { if (bindingTask === task) { bindingTask = null; if (epoch() === at) issue = note; render(); } });
    render();
    return task.promise;
  }
  function navigationWait(task) {
    // A receiving page resumes the granted operation from this same browser tab.
    return N.wait(task, 2000).catch(() => {});
  }
  function fromGesture(retry = false) {
    if (!wanted()) return stopping ? navigationWait(stopping) : Promise.resolve();
    if (!supported || Notification.permission === 'denied' || (enabled() && !stopping)) return Promise.resolve();
    const at = epoch();
    if (permissionTask && permissionEpoch === at) return permissionTask;
    if (bindingTask?.epoch === at) return navigationWait(bindingTask.promise);
    // Invoke the OS prompt within the click/submit, before any asynchronous work.
    const answer = N.requestPushPermission(retry);
    permissionEpoch = at;
    permissionTask = answer.then(async permission => {
      dismissed = permission === 'default';
      if (permission !== 'granted' || epoch() !== at || !wanted()) return;
      localChoice = 'on'; save(choiceKey, 'on');
      recordPending(at);
      await navigationWait(bind(at));
    }).catch(() => {}).finally(() => { if (permissionEpoch === at) permissionTask = null; render(); });
    return permissionTask;
  }
  function resumeGranted() {
    const at = pending();
    if (!at) return;
    if (permitted(at)) void bind(at);
    else recordPending(null);
  }
  function stopAt(at) {
    if (stopping) return stopping.then(() => {
      if (epoch() === at && choice() === 'off' && serverState?.enabled !== false) return stopAt(at);
    });
    const work = locked(async () => {
      if (epoch() !== at || choice() !== 'off') return;
      await N.call('card-announcement-stop', {device:device()});
      if (epoch() === at) { serverState = {enabled:false}; matched = false; }
      save(statusKey, String(Date.now()));
    });
    stopping = work.catch(() => {
      if (epoch() === at) issue = '停止の反映待ち。通信が戻ると再試行します。';
    }).finally(() => { stopping = null; render(); });
    render();
    return stopping;
  }
  function setChoice(on) {
    localEpoch = N.requestId();
    localChoice = on ? 'on' : 'off';
    save(choiceKey, localChoice); save(changeKey, localEpoch);
    recordPending(null); ++version; issue = '';
    if (!on && device()) void stopAt(epoch());
    render();
  }
  if (settings) {
    window.SSYRAnnouncementPush = {fromGesture};
    for (const input of choices) input.addEventListener('change', () => setChoice(input.checked));
    enable.addEventListener('click', () => { setChoice(true); void fromGesture(true); });
    stop.addEventListener('click', () => setChoice(false));
    settings.addEventListener('toggle', () => { if (settings.open) void sync(); });
    window.addEventListener('storage', e => {
      if (!e.key || [choiceKey, changeKey, deviceKey, statusKey].includes(e.key)) { render(); void sync(); }
    });
    settings.hidden = false;
    render();
  }
  function refresh() { resumeGranted(); void sync(); }
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('pageshow', e => { if (e.persisted) refresh(); });
  refresh();
})();
