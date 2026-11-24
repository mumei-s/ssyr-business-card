(() => {
  // The official MUUMEI release gate is the sole source of truth.
  // Always keep the public entrance and the isolated sample usable.
  const official = document.getElementById('muumei-official');
  if (!official || !window.fetch) return;
  const base = 'https://mumei-s.github.io/muumei-public/';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  fetch(base + 'muumei-config.json', {
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
  }).then(response => {
    if (!response.ok) return null;
    return response.json();
  }).then(config => {
    if (!config || config.ready !== true ||
        String(config.appUrl).replace(/\/+$/, '') !== base.replace(/\/+$/, '')) return;
    // The official invite entry applies MUUMEI's actual registration and approval rules.
    // Do not open a direct signup, auto-enroll or accept a redirect from remote data.
    official.href = base + 'entry/private/';
    official.querySelector('span').textContent = '招待・会員登録へ';
  }).catch(() => {}).finally(() => clearTimeout(timeout));
})();
