/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Spatial Navigation & Gliding Focus Ring Engine
 * Geometric direction-cone algorithm, modal focus traps, and transform-based scrolling.
 */

window.Focus = (function () {
  'use strict';

  let currentElement = null;
  let focusRingEl = null;
  let activeTrapContainer = null;
  let previousFocusStack = [];
  const containerMemory = new Map();

  function init() {
    focusRingEl = document.getElementById('focus-ring');
    window.Input.addListener(handleAction);

    // Reposition focus ring on resize
    window.addEventListener('resize', () => {
      if (currentElement) updateFocusRing(currentElement);
    });
  }

  function handleAction(action) {
    if (!currentElement && !activeTrapContainer) {
      focusFirstAvailable();
      return;
    }

    if (action === window.Input.ACTIONS.OK) {
      if (currentElement) {
        triggerPress(currentElement);
      }
      return;
    }

    if ([window.Input.ACTIONS.UP, window.Input.ACTIONS.DOWN, window.Input.ACTIONS.LEFT, window.Input.ACTIONS.RIGHT].includes(action)) {
      navigate(action);
    }
  }

  function getFocusableElements(container) {
    const root = container || activeTrapContainer || document.getElementById('screen-container');
    if (!root) return [];

    const candidates = Array.from(root.querySelectorAll('.focusable:not([disabled]):not([aria-hidden="true"])'));
    return candidates.filter((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  /**
   * Spatial navigation algorithm using geometric direction-cone & overlap scoring
   */
  function navigate(direction) {
    const candidates = getFocusableElements();
    if (!candidates.length) return;

    if (!currentElement || !document.body.contains(currentElement)) {
      setFocus(candidates[0]);
      return;
    }

    const curRect = currentElement.getBoundingClientRect();
    const curCenter = {
      x: curRect.left + curRect.width / 2,
      y: curRect.top + curRect.height / 2
    };

    let bestCandidate = null;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el === currentElement) continue;

      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      let dx = center.x - curCenter.x;
      let dy = center.y - curCenter.y;

      let inCone = false;
      let primaryDist = 0;
      let orthDist = 0;
      let overlap = 0;

      switch (direction) {
        case window.Input.ACTIONS.UP:
          inCone = dy < -4; // strictly above
          primaryDist = -dy;
          orthDist = Math.abs(dx);
          overlap = Math.max(0, Math.min(curRect.right, rect.right) - Math.max(curRect.left, rect.left));
          break;

        case window.Input.ACTIONS.DOWN:
          inCone = dy > 4; // strictly below
          primaryDist = dy;
          orthDist = Math.abs(dx);
          overlap = Math.max(0, Math.min(curRect.right, rect.right) - Math.max(curRect.left, rect.left));
          break;

        case window.Input.ACTIONS.LEFT:
          inCone = dx < -4; // strictly to the left
          primaryDist = -dx;
          orthDist = Math.abs(dy);
          overlap = Math.max(0, Math.min(curRect.bottom, rect.bottom) - Math.max(curRect.top, rect.top));
          break;

        case window.Input.ACTIONS.RIGHT:
          inCone = dx > 4; // strictly to the right
          primaryDist = dx;
          orthDist = Math.abs(dy);
          overlap = Math.max(0, Math.min(curRect.bottom, rect.bottom) - Math.max(curRect.top, rect.top));
          break;
      }

      if (inCone) {
        // Weighted geometric score: prioritize aligned elements, penalize perpendicular distance
        const score = primaryDist + orthDist * 2.2 - (overlap * 1.4);
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = el;
        }
      }
    }

    if (bestCandidate) {
      setFocus(bestCandidate);
    }
  }

  function setFocus(el) {
    if (!el || !document.body.contains(el)) return;

    if (currentElement) {
      currentElement.classList.remove('focused');
      // Remember container focus
      const container = currentElement.closest('[data-focus-group]');
      if (container && container.dataset.focusGroup) {
        containerMemory.set(container.dataset.focusGroup, currentElement);
      }
    }

    currentElement = el;
    currentElement.classList.add('focused');

    updateFocusRing(el);
    scrollIntoViewIfNeeded(el);

    // Dispatch focus event
    el.dispatchEvent(new CustomEvent('tv:focus', { bubbles: true }));
  }

  function updateFocusRing(el) {
    if (!focusRingEl || !el) return;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const borderRadius = style.borderRadius || '14px';

    // Hardware accelerated glide via transform translate3d
    focusRingEl.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    focusRingEl.style.width = `${rect.width}px`;
    focusRingEl.style.height = `${rect.height}px`;
    focusRingEl.style.borderRadius = borderRadius;
    focusRingEl.classList.add('active');
  }

  function triggerPress(el) {
    el.classList.add('pressed');
    setTimeout(() => {
      el.classList.remove('pressed');
    }, 120);

    // Invoke click handler or custom TV action
    el.click();
    el.dispatchEvent(new CustomEvent('tv:select', { bubbles: true }));
  }

  /**
   * Smooth transform-based carousel scrolling (avoids browser scroll jank on TV)
   */
  function scrollIntoViewIfNeeded(el) {
    const track = el.closest('.catalog-carousel-track, .profile-cards-track');
    if (!track) return;

    const trackParent = track.parentElement;
    if (!trackParent) return;

    const parentRect = trackParent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Check if element is out of viewport or close to edges
    const currentTransform = track.style.transform || 'translate3d(0px, 0px, 0px)';
    const match = currentTransform.match(/translate3d\(([-0-9.]+)px/);
    let currentX = match ? parseFloat(match[1]) : 0;

    const elLeftRel = elRect.left - parentRect.left;
    const targetOffset = parentRect.width * 0.15; // margin from left edge

    let newX = currentX - (elLeftRel - targetOffset);
    if (newX > 0) newX = 0; // Don't scroll past start

    track.style.transform = `translate3d(${newX}px, 0, 0)`;

    // Readjust focus ring after carousel translation completes
    setTimeout(() => {
      if (currentElement === el) updateFocusRing(el);
    }, 280);
  }

  function focusFirstAvailable(container) {
    const candidates = getFocusableElements(container);
    if (candidates.length > 0) {
      setFocus(candidates[0]);
    }
  }

  function trapFocus(containerEl) {
    if (currentElement) {
      previousFocusStack.push(currentElement);
    }
    activeTrapContainer = containerEl;
    focusFirstAvailable(containerEl);
  }

  function releaseFocusTrap() {
    activeTrapContainer = null;
    const prev = previousFocusStack.pop();
    if (prev && document.body.contains(prev)) {
      setFocus(prev);
    } else {
      focusFirstAvailable();
    }
  }

  function hideFocusRing() {
    if (focusRingEl) {
      focusRingEl.classList.remove('active');
      focusRingEl.classList.add('hidden');
    }
  }

  function showFocusRing() {
    if (focusRingEl) {
      focusRingEl.classList.remove('hidden');
      if (currentElement) updateFocusRing(currentElement);
    }
  }

  function getCurrent() {
    return currentElement;
  }

  return {
    init,
    setFocus,
    getCurrent,
    focusFirstAvailable,
    trapFocus,
    releaseFocusTrap,
    updateFocusRing,
    hideFocusRing,
    showFocusRing
  };
})();
