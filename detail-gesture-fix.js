(() => {
  const dialog = document.getElementById('game-dialog');
  const content = document.getElementById('dialog-content');
  if (!dialog || !content || dialog.dataset.iosGestureFix === '1') return;
  dialog.dataset.iosGestureFix = '1';

  const GESTURE_KEY = 'games-calendar-detail-gestures-v1';
  let gesture = null;

  const gesturesEnabled = () => localStorage.getItem(GESTURE_KEY) !== '0';
  const interactiveTarget = target => Boolean(target?.closest?.('button,a,input,select,textarea,video,iframe,.screenshot-rail,.gallery-item'));

  function resetDrag() {
    gesture = null;
    dialog.classList.remove('is-gesture-dragging');
    content.style.removeProperty('transform');
    content.style.removeProperty('opacity');
  }

  function closeDialog() {
    const close = document.getElementById('dialog-close');
    if (close) close.click();
    else if (dialog.open) dialog.close();
  }

  function syncOpenState() {
    const open = dialog.open;
    document.documentElement.classList.toggle('game-detail-open', open);
    document.body.classList.toggle('game-detail-open', open);
    if (!open) resetDrag();
  }

  new MutationObserver(syncOpenState).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  dialog.addEventListener('close', syncOpenState);
  syncOpenState();

  dialog.addEventListener('touchstart', event => {
    if (!dialog.open || !gesturesEnabled() || event.touches.length !== 1 || interactiveTarget(event.target)) {
      gesture = null;
      return;
    }
    const touch = event.touches[0];
    gesture = {
      x: touch.clientX,
      y: touch.clientY,
      startedAt: performance.now(),
      startScrollTop: dialog.scrollTop,
      axis: '',
      dx: 0,
      dy: 0
    };
  }, { passive: true });

  dialog.addEventListener('touchmove', event => {
    if (!gesture || !gesturesEnabled() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    gesture.dx = dx;
    gesture.dy = dy;

    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.12 ? 'x' : 'y';
    }

    if (gesture.axis === 'x') {
      event.preventDefault();
      dialog.classList.add('is-gesture-dragging');
      const shift = Math.max(-58, Math.min(58, dx * 0.38));
      content.style.transform = `translate3d(${shift}px,0,0)`;
      content.style.opacity = String(Math.max(.78, 1 - Math.abs(shift) / 260));
      return;
    }

    if (gesture.axis === 'y' && dy > 0 && gesture.startScrollTop <= 2 && dialog.scrollTop <= 2) {
      event.preventDefault();
      dialog.classList.add('is-gesture-dragging');
      const shift = Math.min(82, dy * 0.42);
      content.style.transform = `translate3d(0,${shift}px,0)`;
      content.style.opacity = String(Math.max(.78, 1 - shift / 300));
    }
  }, { passive: false });

  dialog.addEventListener('touchend', event => {
    if (!gesture || !gesturesEnabled()) {
      resetDrag();
      return;
    }

    const touch = event.changedTouches?.[0];
    const dx = touch ? touch.clientX - gesture.x : gesture.dx;
    const dy = touch ? touch.clientY - gesture.y : gesture.dy;
    const elapsed = performance.now() - gesture.startedAt;
    const axis = gesture.axis;
    const startScrollTop = gesture.startScrollTop;
    resetDrag();

    if (elapsed > 1000) return;
    if (axis === 'y' && dy >= 72 && Math.abs(dy) > Math.abs(dx) * 1.15 && startScrollTop <= 2) {
      closeDialog();
    }
  }, { passive: true });

  dialog.addEventListener('touchcancel', resetDrag, { passive: true });

  dialog.addEventListener('touchmove', event => {
    if (!dialog.open || event.touches.length !== 1 || dialog.scrollTop > 0) return;
    if (!gesture) return;
    const dy = event.touches[0].clientY - gesture.y;
    if (dy > 4 && !interactiveTarget(event.target)) event.preventDefault();
  }, { passive: false, capture: true });
})();

// Keep the grid/compact switch visible in the main view as well as preserving
// the original app.js listeners attached to these exact buttons.
(() => {
  const viewToggle = document.querySelector('.view-toggle');
  const hero = document.querySelector('.hero-strip');
  if (!viewToggle || !hero || viewToggle.dataset.restored === '1') return;

  const settingsGroup = viewToggle.closest('.settings-group');
  viewToggle.dataset.restored = '1';
  hero.appendChild(viewToggle);
  if (settingsGroup && !settingsGroup.querySelector('.view-toggle')) settingsGroup.remove();
})();

// On the Oracle-hosted web, enrich the open detail from our server-side API.
import('./live-detail-enrichment.js').catch(error => console.warn('Live detail enrichment:', error));
