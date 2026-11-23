const front = document.getElementById('front');
const back = document.getElementById('back');
const frontButton = document.getElementById('front-button');
const backButton = document.getElementById('back-button');
const card = document.getElementById('card');

function setSide(showBack) {
  front.hidden = showBack;
  back.hidden = !showBack;
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

const qrDialog = document.getElementById('contact-dialog');
document.getElementById('open-qr').addEventListener('click', () => qrDialog.showModal());
qrDialog.addEventListener('click', event => {
  if (event.target !== qrDialog) return;
  const bounds = qrDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) qrDialog.close();
});
