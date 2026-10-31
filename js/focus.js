/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MatPad TV - Spatial Navigation & Gliding Focus Ring Engine
 */

window.Focus = (function () {
  'use strict';

  const RING_OUTSET = 5;
  const CAROUSEL_SELECTOR = '.catalog-carousel-track, .profile-cards-track';
  const ID_ATTRS = [
    'data-item-id', 'data-profile-id', 'data-edit-profile-id', 'data-avatar-url',
    'data-pin-key', 'data-pin-action', 'data-vk-key', 'data-vk-action'
  ];

  let currentElement = null;
  let currentDesc = null;
  let focusRingEl = null;
  let activeTrapContainer = null;
  let previousFocusStack = []; // { el, desc }
  let ringSnap = true;
  let ringHidden = false;
  let settleTimer = null;
  let recoverQueued = false;
  let isSuspended = false;
  const containerMemory = new Map();

  function isBlocked() {
    if (isSuspended) return true;
    if (window.SpotifyOverlay && typeof window.SpotifyOverlay.isOpen === 'function' && window.SpotifyOverlay.isOpen()) {
      return true;
    }
    return false;
  }

  function suspend() {
    isSuspended = true;
    hideFocusRing();
    if (currentElement) {
      currentElement.classList.remove('focused', 'pressed');
    }
  }

  function resume() {
    isSuspended = false;
    showFocusRing();
    if (currentElement && currentElement.isConnected) {
      currentElement.classList.add('focused');
      updateFocusRing(currentElement);
    }
  }

  function init() {
    focusRingEl = document.getElementById('focus-ring');
    window.Input.addListener(handleAction);

    window.addEventListener('resize', () => {
      if (currentElement) updateFocusRing(currentElement);
    });

    // Re-sync the ring whenever the focused element OR any ancestor finishes
    // animating (screen slide, modal scale, keyboard slide, carousel, focus scale).
    const resync = (e) => {
      if (!currentElement || isBlocked()) return;
      if (e.type === 'transitionend' && e.propertyName !== 'transform') return;
      const t = e.target;
      if (t === currentElement || (t.contains && t.contains(currentElement))) {
        updateFocusRing(currentElement);
      }
    };
    document.addEventListener('transitionend', resync, true);
    document.addEventListener('animationend', resync, true);

    // Real mouse movement only (not content sliding under a still cursor)
    document.addEventListener('mousemove', (e) => {
      if (isBlocked()) return;
      if (!e.movementX && !e.movementY) return;
      const el = e.target.closest ? e.target.closest('.focusable') : null;
      if (el && el !== currentElement && document.body.contains(el)) {
        if (activeTrapContainer && !activeTrapContainer.contains(el)) return;
        setFocus(el);
      }
    });

    document.addEventListener('click', (e) => {
      if (isBlocked()) return;
      const el = e.target.closest ? e.target.closest('.focusable') : null;
      if (el && document.body.contains(el)) {
        if (activeTrapContainer && !activeTrapContainer.contains(el)) return;
        setFocus(el);
      }
    });

    // If the focused element is destroyed by a re-render, recover automatically
    const app = document.getElementById('app') || document.body;
    new MutationObserver(() => {
      if (isBlocked()) return;
      if (recoverQueued) return;
      recoverQueued = true;
      requestAnimationFrame(() => {
        recoverQueued = false;
        recoverFocusIfLost();
      });
    }).observe(app, { childList: true, subtree: true });
  }

  /* ----------------------------------------------------------------------
     Focus recovery (element replaced by innerHTML re-render)
     ---------------------------------------------------------------------- */
  function describe(el) {
    if (!el) return null;
    if (el.id) return { id: el.id };
    for (const a of ID_ATTRS) {
      if (el.hasAttribute(a)) return { attr: a, value: el.getAttribute(a) };
    }
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.classList.contains('focusable'));
      return { cls: el.className.split(' ')[0], index: siblings.indexOf(el) };
    }
    return null;
  }

  function findByDescriptor(desc, root) {
    if (!desc || !root) return null;
    const all = Array.from(root.querySelectorAll('.focusable'));
    if (desc.id) return all.find(e => e.id === desc.id) || null;
    if (desc.attr) return all.find(e => e.getAttribute(desc.attr) === desc.value) || null;
    if (desc.cls) {
      const same = all.filter(e => e.classList.contains(desc.cls));
      return same[Math.min(Math.max(desc.index, 0), same.length - 1)] || null;
    }
    return null;
  }

  function getRoot() {
    if (activeTrapContainer) return activeTrapContainer;
    const activeScreen = document.querySelector('#screen-container .screen.active');
    return activeScreen || document.getElementById('screen-container');
  }

  function recoverFocusIfLost() {
    if (isBlocked() || !currentElement || currentElement.isConnected || ringHidden) return;
    const root = getRoot();
    const again = findByDescriptor(currentDesc, root);
    if (again && getFocusableElements(root).includes(again)) {
      setFocus(again);
    } else {
      currentElement = null;
      const list = getFocusableElements(root);
      if (list.length) setFocus(list[0]);
      else if (focusRingEl) focusRingEl.classList.remove('active');
    }
  }

  /* ----------------------------------------------------------------------
     Input
     ---------------------------------------------------------------------- */
  function handleAction(action) {
    if (isBlocked()) return;

    if (!currentElement || !currentElement.isConnected) {
      recoverFocusIfLost();
      if (!currentElement) { focusFirstAvailable(getRoot()); return; }
    }

    if (action === window.Input.ACTIONS.OK) {
      if (currentElement) triggerPress(currentElement);
      return;
    }

    const A = window.Input.ACTIONS;
    if ([A.UP, A.DOWN, A.LEFT, A.RIGHT].includes(action)) navigate(action);
  }

  function getFocusableElements(container) {
    const root = container || activeTrapContainer || document.querySelector('#screen-container .screen.active') || document.getElementById('screen-container');
    if (!root) return [];

    const candidates = Array.from(root.querySelectorAll('.focusable:not([disabled]):not([aria-hidden="true"])'));
    return candidates.filter((el) => {
      // Exclude elements from inactive or exiting screens
      if (el.closest('.screen:not(.active)') || el.closest('.screen.exiting')) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  /* ----------------------------------------------------------------------
     Geometry helpers
     ---------------------------------------------------------------------- */
  function getTransformValues(el) {
    const t = window.getComputedStyle(el).transform;
    if (!t || t === 'none') return { scale: 1, tx: 0, ty: 0 };
    const m = t.match(/matrix(3d)?\(([^)]+)\)/);
    if (!m) return { scale: 1, tx: 0, ty: 0 };
    const v = m[2].split(',').map(parseFloat);
    const out = m[1] ? { scale: v[0], tx: v[12], ty: v[13] } : { scale: v[0], tx: v[4], ty: v[5] };
    if (!out.scale) out.scale = 1;
    return out;
  }

  function getFocusScale() {
    const app = document.getElementById('app') || document.documentElement;
    return parseFloat(window.getComputedStyle(app).getPropertyValue('--focus-scale')) || 1.05;
  }

  // The scale the element will REALLY have once everything has settled.
  function resolveFinalScale(el, curScale) {
    const running = el.getAnimations ? el.getAnimations().length > 0 : true;
    if (!running) return curScale;               // idle: what we measure is final
    if (el.classList.contains('no-scale')) return 1;
    return getFocusScale();                       // transitioning: assume target
  }

  /* ----------------------------------------------------------------------
     Spatial navigation
     ---------------------------------------------------------------------- */
  function navigate(direction) {
    if (isBlocked()) return;
    const candidates = getFocusableElements();
    if (!candidates.length) return;

    if (!currentElement || !currentElement.isConnected) {
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
    if (isBlocked() || !el || !el.isConnected) return;

    if (currentElement) {
      currentElement.classList.remove('focused');
      const container = currentElement.closest('[data-focus-group]');
      if (container && container.dataset.focusGroup) {
        containerMemory.set(container.dataset.focusGroup, currentElement);
      }
    }

    currentElement = el;
    currentDesc = describe(el);
    currentElement.classList.add('focused');

    scrollIntoViewIfNeeded(el);
    updateFocusRing(el);

    // Safety net: after all CSS transitions (modal, keyboard, screen) are done,
    // measure once more so the ring can never stay misplaced.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (currentElement && currentElement.isConnected) updateFocusRing(currentElement);
    }, 340);

    el.dispatchEvent(new CustomEvent('tv:focus', { bubbles: true }));
  }

  function updateFocusRing(el) {
    if (isBlocked() || !focusRingEl || !el || !el.isConnected) return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const curScale = getTransformValues(el).scale;
    const finalScale = resolveFinalScale(el, curScale);

    const baseW = rect.width / curScale;
    const baseH = rect.height / curScale;

    // Pending carousel movement
    let dx = 0;
    const track = el.closest(CAROUSEL_SELECTOR);
    if (track && typeof track._targetX === 'number') {
      dx = track._targetX - getTransformValues(track).tx;
    }

    const w = baseW * finalScale + RING_OUTSET * 2;
    const h = baseH * finalScale + RING_OUTSET * 2;
    const x = rect.left + rect.width / 2 + dx - w / 2;
    const y = rect.top + rect.height / 2 - h / 2;

    const br = window.getComputedStyle(el).borderTopLeftRadius || '14px';
    const radius = br.includes('%') ? br : `calc(${br} * ${finalScale} + ${RING_OUTSET}px)`;

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

    const left0 = eCenter - eW / 2 - vRect.left - curTx;
    const right0 = left0 + eW;
    const base = tRect.left - vRect.left - curTx;

    const margin = vRect.width * 0.05;
    const start = typeof track._targetX === 'number' ? track._targetX : curTx;

    let newX = start;
    if (left0 + start < margin) {
      newX = margin - left0;
    } else if (right0 + start > vRect.width - margin) {
      newX = vRect.width - margin - right0;
    }

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
    if (currentElement && currentElement.isConnected) {
      previousFocusStack.push({ el: currentElement, desc: currentDesc });
    }
    activeTrapContainer = containerEl;
    ringSnap = false;
    focusFirstAvailable(containerEl);
  }

  function releaseFocusTrap() {
    activeTrapContainer = null;
    const prev = previousFocusStack.pop();
    const root = document.getElementById('screen-container');

    if (prev && prev.el.isConnected && getFocusableElements(root).includes(prev.el)) {
      setFocus(prev.el);
      return;
    }
    // Previous element was destroyed/re-rendered: find its twin, else first available
    const twin = prev ? findByDescriptor(prev.desc, root) : null;
    if (twin && getFocusableElements(root).includes(twin)) {
      setFocus(twin);
    } else {
      currentElement = null;
      focusFirstAvailable(root);
    }
  }

  function hideFocusRing() {
    ringHidden = true;
    if (focusRingEl) {
      focusRingEl.classList.remove('active');
      focusRingEl.classList.add('hidden');
    }
    ringSnap = true;
  }

  function showFocusRing() {
    ringHidden = false;
    if (focusRingEl) {
      focusRingEl.classList.remove('hidden');
      if (currentElement && currentElement.isConnected) updateFocusRing(currentElement);
    }
  }

  function getCurrent() { return currentElement; }

  return {
    init, setFocus, getCurrent, focusFirstAvailable,
    trapFocus, releaseFocusTrap, updateFocusRing,
    hideFocusRing, showFocusRing,
    suspend, resume, isSuspended: isBlocked
  };
})();
