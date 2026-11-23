const front = document.getElementById('front');
const back = document.getElementById('back');
const frontButton = document.getElementById('front-button');
const backButton = document.getElementById('back-button');
const card = document.getElementById('card');

const lightButton = document.getElementById('light-button');
lightButton.addEventListener('click', () => {
  lightButton.setAttribute('aria-pressed', String(card.classList.toggle('lit')));
});

function setSide(showBack) {
  lightButton.disabled = showBack;
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

for (const [buttonId, dialogId] of [['open-qr', 'contact-dialog'], ['open-work-qr', 'work-dialog']]) {
  const dialog = document.getElementById(dialogId);
  document.getElementById(buttonId).addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
