/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MatPad TV - Spatial Navigation & Gliding Focus Ring Engine
 */

window.Focus = (function () {
  'use strict';

  const RING_OUTSET = 5; // px gap between the card and the ring
  const CAROUSEL_SELECTOR = '.catalog-carousel-track, .profile-cards-track';

  let currentElement = null;
  let focusRingEl = null;
  let activeTrapContainer = null;
  let previousFocusStack = [];
  let ringSnap = true; // first placement: jump, don't glide
  const containerMemory = new Map();

  function init() {
    focusRingEl = document.getElementById('focus-ring');
    window.Input.addListener(handleAction);

    window.addEventListener('resize', () => {
      if (currentElement) updateFocusRing(currentElement);
    });

    // Re-sync the ring whenever a layout transition ends (screen slide-in, carousel, etc.)
    document.addEventListener('transitionend', (e) => {
      if (!currentElement || e.propertyName !== 'transform') return;
      const t = e.target;
      if (t.classList && (t.classList.contains('screen') || t.matches(CAROUSEL_SELECTOR))) {
        updateFocusRing(currentElement);
      }
    }, true);

    // Only react to REAL mouse movement. Plain "mouseover" also fires when the
    // carousel slides under a stationary cursor and steals the focus.
    document.addEventListener('mousemove', (e) => {
      if (!e.movementX && !e.movementY) return;
      const el = e.target.closest ? e.target.closest('.focusable') : null;
      if (el && el !== currentElement && document.body.contains(el)) {
        if (activeTrapContainer && !activeTrapContainer.contains(el)) return;
        setFocus(el);
      }
    });

    document.addEventListener('click', (e) => {
      const el = e.target.closest ? e.target.closest('.focusable') : null;
      if (el && document.body.contains(el)) setFocus(el);
    });
  }

  function handleAction(action) {
    if ((!currentElement || !document.body.contains(currentElement)) && !activeTrapContainer) {
      focusFirstAvailable();
      return;
    }

    if (action === window.Input.ACTIONS.OK) {
      if (currentElement) triggerPress(currentElement);
      return;
    }

    const A = window.Input.ACTIONS;
    if ([A.UP, A.DOWN, A.LEFT, A.RIGHT].includes(action)) navigate(action);
  }

  function getFocusableElements(container) {
    const root = container || activeTrapContainer || document.getElementById('screen-container');
    if (!root) return [];

    const candidates = Array.from(root.querySelectorAll('.focusable:not([disabled]):not([aria-hidden="true"])'));
    return candidates.filter((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  /* ----------------------------------------------------------------------
     Geometry helpers
     ---------------------------------------------------------------------- */

  // Reads the CURRENT (mid-transition) translate / scale of an element
  function getTransformValues(el) {
    const t = window.getComputedStyle(el).transform;
    if (!t || t === 'none') return { scale: 1, tx: 0, ty: 0 };
    const m = t.match(/matrix(3d)?\(([^)]+)\)/);
    if (!m) return { scale: 1, tx: 0, ty: 0 };
    const v = m[2].split(',').map(parseFloat);
    const out = m[1]
      ? { scale: v[0], tx: v[12], ty: v[13] }
      : { scale: v[0], tx: v[4], ty: v[5] };
    if (!out.scale) out.scale = 1;
    return out;
  }

  function getFocusScale() {
    const app = document.getElementById('app') || document.documentElement;
    return parseFloat(window.getComputedStyle(app).getPropertyValue('--focus-scale')) || 1.05;
  }

  /* ----------------------------------------------------------------------
     Spatial navigation
     ---------------------------------------------------------------------- */
  function navigate(direction) {
    const candidates = getFocusableElements();
    if (!candidates.length) return;

    if (!currentElement || !document.body.contains(currentElement)) {
      setFocus(candidates[0]);
      return;
    }

    const curRect = currentElement.getBoundingClientRect();
    const curCenter = { x: curRect.left + curRect.width / 2, y: curRect.top + curRect.height / 2 };

    let bestCandidate = null;
    let bestScore = Infinity;
    const A = window.Input.ACTIONS;

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el === currentElement) continue;

      const rect = el.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const dx = center.x - curCenter.x;
      const dy = center.y - curCenter.y;

      let inCone = false, primaryDist = 0, orthDist = 0, overlap = 0;

      switch (direction) {
        case A.UP:
          inCone = dy < -4; primaryDist = -dy; orthDist = Math.abs(dx);
          overlap = Math.max(0, Math.min(curRect.right, rect.right) - Math.max(curRect.left, rect.left));
          break;
        case A.DOWN:
          inCone = dy > 4; primaryDist = dy; orthDist = Math.abs(dx);
          overlap = Math.max(0, Math.min(curRect.right, rect.right) - Math.max(curRect.left, rect.left));
          break;
        case A.LEFT:
          inCone = dx < -4; primaryDist = -dx; orthDist = Math.abs(dy);
          overlap = Math.max(0, Math.min(curRect.bottom, rect.bottom) - Math.max(curRect.top, rect.top));
          break;
        case A.RIGHT:
          inCone = dx > 4; primaryDist = dx; orthDist = Math.abs(dy);
          overlap = Math.max(0, Math.min(curRect.bottom, rect.bottom) - Math.max(curRect.top, rect.top));
          break;
      }

      if (inCone) {
        const score = primaryDist + orthDist * 2.2 - overlap * 1.4;
        if (score < bestScore) { bestScore = score; bestCandidate = el; }
      }
    }

    if (bestCandidate) setFocus(bestCandidate);
  }

  function setFocus(el) {
    if (!el || !document.body.contains(el)) return;

    if (currentElement) {
      currentElement.classList.remove('focused');
      const container = currentElement.closest('[data-focus-group]');
      if (container && container.dataset.focusGroup) {
        containerMemory.set(container.dataset.focusGroup, currentElement);
      }
    }

    currentElement = el;
    currentElement.classList.add('focused');

    // ORDER MATTERS: scroll first (sets the carousel's final position),
    // then place the ring using the FINAL geometry.
    scrollIntoViewIfNeeded(el);
    updateFocusRing(el);

    el.dispatchEvent(new CustomEvent('tv:focus', { bubbles: true }));
  }

  /**
   * Places the ring on the element's FINAL geometry (after its scale-up and
   * after any pending carousel translation), so it never lags or lands wrong.
   */
  function updateFocusRing(el) {
    if (!focusRingEl || !el || !document.body.contains(el)) return;

    const rect = el.getBoundingClientRect();
    const { scale: curScale } = getTransformValues(el);
    const fs = getFocusScale();

    // Un-scaled size (scale is applied around the centre, so the centre is stable)
    const baseW = rect.width / curScale;
    const baseH = rect.height / curScale;

    // Pending carousel movement: target minus where it is right now
    let dx = 0;
    const track = el.closest(CAROUSEL_SELECTOR);
    if (track && typeof track._targetX === 'number') {
      dx = track._targetX - getTransformValues(track).tx;
    }

    const w = baseW * fs + RING_OUTSET * 2;
    const h = baseH * fs + RING_OUTSET * 2;
    const x = rect.left + rect.width / 2 + dx - w / 2;
    const y = rect.top + rect.height / 2 - h / 2;

    const br = window.getComputedStyle(el).borderTopLeftRadius || '14px';
    const radius = br.includes('%') ? br : `calc(${br} * ${fs} + ${RING_OUTSET}px)`;

    const apply = () => {
      focusRingEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      focusRingEl.style.width = `${Math.round(w)}px`;
      focusRingEl.style.height = `${Math.round(h)}px`;
      focusRingEl.style.borderRadius = radius;
    };

    if (ringSnap) {
      focusRingEl.style.transition = 'none';
      apply();
      void focusRingEl.offsetWidth;
      focusRingEl.style.transition = '';
      ringSnap = false;
    } else {
      apply();
    }
    focusRingEl.classList.add('active');
  }

  function triggerPress(el) {
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 120);
    el.click();
    el.dispatchEvent(new CustomEvent('tv:select', { bubbles: true }));
  }

  /**
   * Minimal carousel scrolling: only moves when the card is (nearly) outside
   * the viewport, always keeps a safe margin, and never scrolls past the ends.
   * Uses the track's real current/target position, never a half-finished one.
   */
  function scrollIntoViewIfNeeded(el) {
    const track = el.closest(CAROUSEL_SELECTOR);
    if (!track) return;
    const viewport = track.parentElement;
    if (!viewport) return;

    const vRect = viewport.getBoundingClientRect();
    const tRect = track.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    const curTx = getTransformValues(track).tx;
    const elScale = getTransformValues(el).scale;
    const eW = eRect.width / elScale;
    const eCenter = eRect.left + eRect.width / 2;

    // Element edges in viewport coordinates when the track has translateX = 0
    const left0 = eCenter - eW / 2 - vRect.left - curTx;
    const right0 = left0 + eW;
    const base = tRect.left - vRect.left - curTx; // track's own offset inside viewport

    const margin = vRect.width * 0.05;
    const start = typeof track._targetX === 'number' ? track._targetX : curTx;

    let newX = start;
    if (left0 + start < margin) {
      newX = margin - left0;
    } else if (right0 + start > vRect.width - margin) {
      newX = vRect.width - margin - right0;
    }

    // Clamp to content bounds
    const minX = Math.min(0, vRect.width - (base + track.scrollWidth) - base);
    newX = Math.max(minX, Math.min(0, newX));

    track._targetX = newX;
    track.style.transform = `translate3d(${newX}px, 0, 0)`;
  }

  function focusFirstAvailable(container) {
    const candidates = getFocusableElements(container);
    if (candidates.length > 0) setFocus(candidates[0]);
  }

  function trapFocus(containerEl) {
    if (currentElement) previousFocusStack.push(currentElement);
    activeTrapContainer = containerEl;
    focusFirstAvailable(containerEl);
  }

  function releaseFocusTrap() {
    activeTrapContainer = null;
    const prev = previousFocusStack.pop();
    if (prev && document.body.contains(prev)) setFocus(prev);
    else focusFirstAvailable();
  }

  function hideFocusRing() {
    if (focusRingEl) {
      focusRingEl.classList.remove('active');
      focusRingEl.classList.add('hidden');
    }
    ringSnap = true; // next placement jumps instead of flying across the screen
  }

  function showFocusRing() {
    if (focusRingEl) {
      focusRingEl.classList.remove('hidden');
      if (currentElement) updateFocusRing(currentElement);
    }
  }

  function getCurrent() { return currentElement; }

  return {
    init, setFocus, getCurrent, focusFirstAvailable,
    trapFocus, releaseFocusTrap, updateFocusRing,
    hideFocusRing, showFocusRing
  };
})();
