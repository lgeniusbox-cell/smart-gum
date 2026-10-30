/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Global Notification / Toast System
 * Non-intrusive, deduplicated, hardware-accelerated toast queue with Java bridge mirror.
 */

window.Notify = (function () {
  'use strict';

  let container = null;
  const activeToasts = [];
  const MAX_VISIBLE = 3;
  let lastMessageKey = '';
  let lastMessageTime = 0;

  function init() {
    container = document.getElementById('toast-container');
  }

  function show(options = {}) {
    if (!container) init();
    if (!container) return;

    const {
      type = 'info', // 'info' | 'success' | 'warning' | 'error' | 'soon'
      title = '',
      message = '',
      duration = 3500
    } = options;

    // Deduplicate rapid identical messages (within 2 seconds)
    const key = `${type}:${title}:${message}`;
    const now = performance.now();
    if (key === lastMessageKey && now - lastMessageTime < 2000) {
      return;
    }
    lastMessageKey = key;
    lastMessageTime = now;

    // Mirror to Java bridge if available
    if (window.Bridge) {
      window.Bridge.onNotification({ type, title, message, timestamp: Date.now() });
    }

    // Dismiss oldest if queue is full
    if (activeToasts.length >= MAX_VISIBLE) {
      const oldest = activeToasts.shift();
      dismiss(oldest);
    }

    // Create toast DOM node
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') iconSvg = window.Utils.getIcon('check');
    else if (type === 'error') iconSvg = window.Utils.getIcon('trash');
    else if (type === 'soon') iconSvg = window.Utils.getIcon('lock');
    else if (type === 'warning') iconSvg = window.Utils.getIcon('settings');
    else iconSvg = window.Utils.getIcon('gamepad');

    toastEl.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${window.Utils.escapeHTML(title)}</div>` : ''}
        ${message ? `<div class="toast-message">${window.Utils.escapeHTML(message)}</div>` : ''}
      </div>
    `;

    container.appendChild(toastEl);
    activeToasts.push(toastEl);

    // Hardware accelerated entrance (force reflow once)
    void toastEl.offsetWidth;
    toastEl.classList.add('show');

    // Auto dismiss timer
    const timer = setTimeout(() => {
      dismiss(toastEl);
    }, duration);

    toastEl._dismissTimer = timer;
  }

  function dismiss(toastEl) {
    if (!toastEl || !toastEl.parentNode) return;
    if (toastEl._dismissTimer) clearTimeout(toastEl._dismissTimer);

    toastEl.classList.remove('show');
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
      const idx = activeToasts.indexOf(toastEl);
      if (idx !== -1) activeToasts.splice(idx, 1);
    }, 280);
  }

  return {
    init,
    show
  };
})();
