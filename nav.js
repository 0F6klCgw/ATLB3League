/* Shared nav behavior for every page — full link row at the top,
   hamburger once you scroll. Narrow screens stay collapsed at any
   scroll position. One set of links in the DOM; CSS in theme.css just
   re-presents them as a dropdown panel once collapsed. */
(function initNav(){
  const nav      = document.querySelector('nav');
  const burger   = document.getElementById('burger');
  const narrow   = window.matchMedia('(max-width: 760px)');
  const COLLAPSE_AT = 90;   // px scrolled before the menu folds up

  function setOpen(open){
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  function syncNav(){
    const collapsed = narrow.matches || window.scrollY > COLLAPSE_AT;
    nav.classList.toggle('collapsed', collapsed);
    if (!collapsed) setOpen(false);   // never leave a hidden panel "open"
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { syncNav(); ticking = false; });
  }, { passive: true });

  window.addEventListener('resize', syncNav);
  if (narrow.addEventListener) narrow.addEventListener('change', syncNav);
  else if (narrow.addListener)  narrow.addListener(syncNav);   // older Safari

  burger.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(!nav.classList.contains('open'));
  });

  // Close on link tap, outside click, or Escape.
  document.querySelectorAll('#nav-links a').forEach(a =>
    a.addEventListener('click', () => setOpen(false)));

  document.addEventListener('click', e => {
    if (nav.classList.contains('open') && !nav.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('open')){
      setOpen(false);
      burger.focus();
    }
  });

  syncNav();
})();
