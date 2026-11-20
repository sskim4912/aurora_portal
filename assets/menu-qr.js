// QR controls are siblings of links so expanding never navigates the menu.
(() => {
  const buttons = [...document.querySelectorAll('.menu-qr')];
  let active = null;
  let pinned = false;
  const close = () => {
    active?.setAttribute('aria-expanded', 'false');
    active = null;
    pinned = false;
  };
  const open = button => {
    if (active !== button) close();
    active = button;
    button.setAttribute('aria-expanded', 'true');
  };
  for (const button of buttons) {
    button.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' && !pinned) open(button);
    });
    button.addEventListener('pointerleave', () => {
      if (active === button && !pinned) close();
    });
    button.addEventListener('click', () => {
      if (active === button && pinned) close();
      else { open(button); pinned = true; }
    });
  }
  document.addEventListener('click', event => {
    if (active && !active.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 600px)').matches) close();
  });
})();
