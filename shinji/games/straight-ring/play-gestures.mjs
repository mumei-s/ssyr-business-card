// A fight surface is pointer driven. Do not hand its taps to browser zoom.
export function createPlayGestureGuard(root, viewport, surfaces) {
  const normal = viewport?.getAttribute('content') || 'width=device-width, initial-scale=1, viewport-fit=cover';
  const locked = normal.split(',').map(part => part.trim())
    .filter(part => !/^(?:minimum-scale|maximum-scale|user-scalable)\s*=/i.test(part))
    .concat('maximum-scale=1', 'user-scalable=no').join(', ');
  let active = false;
  const swallow = event => {
    if (active && event.cancelable) event.preventDefault();
  };
  // Keep touch cancellation on the game surface, never on menus, setup inputs,
  // or pause. Pointer events still reach the multi-touch game handlers.
  for (const surface of surfaces) {
    for (const type of ['touchstart','touchmove','touchend','dblclick','gesturestart','gesturechange']) {
      surface.addEventListener(type, swallow, {capture:true, passive:false});
    }
  }
  return function setPlayGestureGuard(next) {
    next = !!next;
    if (active === next) return;
    active = next;
    root.classList.toggle('game-touch-lock', active);
    viewport?.setAttribute('content', active ? locked : normal);
  };
}
