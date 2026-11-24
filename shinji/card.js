const front = document.getElementById('front');
const back = document.getElementById('back');
const frontButton = document.getElementById('front-button');
const backButton = document.getElementById('back-button');
const card = document.getElementById('card');

const lightButton = document.getElementById('light-button');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const preferenceKey = 'ssyr-shinji-card-motion';
let logoEnabled = true;
try { logoEnabled = localStorage.getItem(preferenceKey) !== 'off'; } catch (_) {}
function syncLogo() {
  const active = logoEnabled && !motion.matches;
  card.classList.toggle('logo-off', !active);
  lightButton.setAttribute('aria-pressed', String(active));
  lightButton.querySelector('.light-state').textContent = active ? 'ON' : 'OFF';
  lightButton.disabled = motion.matches;
  lightButton.title = motion.matches ? '端末設定により表裏の演出を停止しています' : '表裏の光とロゴ演出をまとめて切替';
}
lightButton.addEventListener('click', () => {
  if (back.hidden || motion.matches) return;
  logoEnabled = !logoEnabled;
  try { localStorage.setItem(preferenceKey, logoEnabled ? 'on' : 'off'); } catch (_) {}
  syncLogo();
});
if (motion.addEventListener) motion.addEventListener('change', syncLogo);
else if (motion.addListener) motion.addListener(syncLogo);
syncLogo();

function setSide(showBack) {
  front.hidden = showBack;
  back.hidden = !showBack;
  lightButton.hidden = !showBack;
  frontButton.setAttribute('aria-pressed', String(!showBack));
  backButton.setAttribute('aria-pressed', String(showBack));
}

frontButton.addEventListener('click', () => setSide(false));
backButton.addEventListener('click', () => setSide(true));

let origin;
card.addEventListener('touchstart', event => {
  origin = event.touches.length === 1 ? event.touches[0] : undefined;
}, {passive: true});
card.addEventListener('touchcancel', () => { origin = undefined; }, {passive: true});
card.addEventListener('touchend', event => {
  if (!origin) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - origin.clientX;
  const dy = touch.clientY - origin.clientY;
  origin = undefined;
  if (Math.abs(dx) > 42 && Math.abs(dx) > 1.5 * Math.abs(dy)) setSide(dx < 0);
}, {passive: true});
