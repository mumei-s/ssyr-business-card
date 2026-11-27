(() => {
  'use strict';
  const N = window.SSYRNotice;
  const panel = document.getElementById('status-panel');
  const status = document.getElementById('game-status');
  const retry = document.getElementById('game-retry');
  const settingsKeys = new Set(['hikari-boxing.character.v1', 'hikari-boxing.profile.v1']);
  const noAccess = 'このゲームは、SHINJIが許可した個別チャットの端末で開けます。';
  let sourceDevice = '', frame = null, version = 0, loading = false;

  function display(text, canRetry = false) {
    panel.hidden = false;
    status.textContent = text;
    retry.hidden = !canRetry;
  }
  function closeGame() {
    frame?.remove();
    frame = null;
    sourceDevice = '';
  }
  function savedDevices() {
    if (!N) return [];
    return [...new Set([N.getDevice(), ...N.getThreads().map(chat => chat.device)].filter(N.validToken))];
  }
  async function canPlay(device) {
    try { return (await N.call('game-access', {device})).allowed === true; }
    catch (error) { if (error.status === 401 || error.status === 403) return false; throw error; }
  }
  async function unpack(device) {
    const grant = await N.call('game-open', {device});
    if (typeof grant.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(grant.key)) throw Error('無効な利用設定です。');
    const bytes = Uint8Array.from(atob(grant.key), value => value.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    bytes.fill(0);
    const response = await fetch('./game.pack', {cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('ゲームを取得できませんでした。');
    const binary = new Uint8Array(await response.arrayBuffer());
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:binary.subarray(0,12)}, key, binary.subarray(12));
    return new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
  }
  async function refresh() {
    if (document.hidden || loading) return;
    const stamp = version;
    loading = true;
    try {
      const devices = savedDevices();
      if (frame && sourceDevice && devices.includes(sourceDevice)) {
        if (await canPlay(sourceDevice)) {
          if (stamp !== version || document.hidden) return;
          frame.hidden = false;
          panel.hidden = true;
          startFrame();
          return;
        }
        if (stamp !== version) return;
        closeGame();
      }
      closeGame();
      if (!devices.length) { display(noAccess,true); return; }
      display('利用設定を確認しています…');
      for (const device of devices) {
        const allowed = await canPlay(device);
        if (stamp !== version || document.hidden) return;
        if (!allowed) continue;
        const html = await unpack(device);
        if (stamp !== version || document.hidden || !savedDevices().includes(device)) return;
        frame = document.createElement('iframe');
        frame.id = 'game-frame';
        frame.title = 'HIKARI STRAIGHT';
        frame.setAttribute('sandbox','allow-scripts');
        frame.setAttribute('referrerpolicy','no-referrer');
        frame.srcdoc = html;
        sourceDevice = device;
        document.body.append(frame);
        panel.hidden = true;
        return;
      }
      display(noAccess,true);
    } catch (error) {
      if (stamp !== version) return;
      closeGame();
      display([401,403].includes(error.status) ? noAccess : 'ゲームの利用設定を確認できませんでした。通信状況をご確認ください。',true);
    } finally {
      if (stamp === version) loading = false;
    }
  }
  function conceal(reset) {
    ++version;
    loading = false;
    if (reset) closeGame();
    else if (frame) frame.hidden = true;
    display('利用設定を確認しています…');
  }
  function startFrame() {
    const settings = {};
    try { for (const key of settingsKeys) settings[key] = localStorage.getItem(key); } catch {}
    frame.contentWindow.postMessage({type:'ring-start',settings}, '*');
  }
  window.addEventListener('message', async event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || frame.hidden) return;
    const msg = event.data;
    if (msg?.type === 'ring-ready') {
      startFrame();
    } else if (msg?.type === 'ring-save' && settingsKeys.has(msg.key)) {
      try {
        if (msg.value === null) localStorage.removeItem(msg.key);
        else if (typeof msg.value === 'string' && msg.value.length <= 800000) localStorage.setItem(msg.key, msg.value);
        else throw Error('Invalid setting');
      } catch { event.source.postMessage({type:'ring-storage-error'}, '*'); }
    } else if (msg?.type === 'ring-open-chatgpt' && navigator.userActivation?.isActive) {
      window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
    } else if (msg?.type === 'ring-copy') {
      let ok = false;
      if (navigator.userActivation?.isActive && typeof msg.text==='string' && msg.text.length<=5000) {
        try { await navigator.clipboard.writeText(msg.text); ok = true; } catch {}
      }
      event.source.postMessage({type:'ring-copy-result',ok}, '*');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) conceal(false); else void refresh();
  });
  window.addEventListener('pagehide', () => conceal(true));
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
  window.addEventListener('storage', event => {
    if (!event.key || event.key==='ssyr-card-device-v1' || event.key.startsWith('ssyr-card-thread-v1:')) {
      if (sourceDevice && !savedDevices().includes(sourceDevice)) conceal(true);
      void refresh();
    }
  });
  retry.addEventListener('click', refresh);
  setInterval(() => { if (frame && !document.hidden) void refresh(); }, 30000);
  void refresh();
})();
