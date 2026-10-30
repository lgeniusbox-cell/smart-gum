/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - On-Screen Virtual Keyboard & Numeric Keypad
 * Fast TV D-Pad & Gamepad friendly input entry dialog with live preview.
 */

window.VirtualKeyboard = (function () {
  'use strict';

  let overlayEl = null;
  let activeCallback = null;
  let currentVal = '';
  let currentType = 'text'; // 'text' | 'number'
  let maxLength = 24;

  function init() {
    overlayEl = document.getElementById('virtual-keyboard-overlay');
  }

  function open(options = {}) {
    if (!overlayEl) init();
    if (!overlayEl) return;

    currentType = options.type || 'text';
    currentVal = options.initialValue != null ? String(options.initialValue) : '';
    maxLength = options.maxLength || (currentType === 'number' ? 4 : 24);
    activeCallback = options.onComplete || null;

    render();
    overlayEl.classList.add('active');

    if (window.Focus) {
      window.Focus.trapFocus(overlayEl);
    }
  }

  function close(accepted = false) {
    if (!overlayEl) return;
    overlayEl.classList.remove('active');

    if (window.Focus) {
      window.Focus.releaseFocusTrap();
    }

    if (activeCallback) {
      activeCallback(accepted ? currentVal : null);
      activeCallback = null;
    }
  }

  function render() {
    const isNum = currentType === 'number';

    let keysHtml = '';
    if (isNum) {
      keysHtml = `
        <div class="numpad-grid">
          <button type="button" class="numpad-key focusable" data-vk-key="1">1</button>
          <button type="button" class="numpad-key focusable" data-vk-key="2">2</button>
          <button type="button" class="numpad-key focusable" data-vk-key="3">3</button>
          <button type="button" class="numpad-key focusable" data-vk-key="4">4</button>
          <button type="button" class="numpad-key focusable" data-vk-key="5">5</button>
          <button type="button" class="numpad-key focusable" data-vk-key="6">6</button>
          <button type="button" class="numpad-key focusable" data-vk-key="7">7</button>
          <button type="button" class="numpad-key focusable" data-vk-key="8">8</button>
          <button type="button" class="numpad-key focusable" data-vk-key="9">9</button>
          <button type="button" class="numpad-key focusable" data-vk-action="clear">C</button>
          <button type="button" class="numpad-key focusable" data-vk-key="0">0</button>
          <button type="button" class="numpad-key focusable" data-vk-action="backspace">${window.Utils.getIcon('backspace')}</button>
        </div>
        <div class="vk-row" style="margin-top: 2vh; gap: 1.5vw;">
          <button type="button" class="btn-secondary focusable vk-key-wide" data-vk-action="cancel">${window.t('cancel')}</button>
          <button type="button" class="btn-primary focusable vk-key-done" data-vk-action="done">OK</button>
        </div>
      `;
    } else {
      // QWERTY Layout
      const row1 = ['1','2','3','4','5','6','7','8','9','0'];
      const row2 = ['Q','W','E','R','T','Y','U','I','O','P'];
      const row3 = ['A','S','D','F','G','H','J','K','L'];
      const row4 = ['Z','X','C','V','B','N','M'];

      const makeRow = (arr) => arr.map(k => `<button type="button" class="vk-key focusable" data-vk-key="${k}">${k}</button>`).join('');

      keysHtml = `
        <div class="vk-row">${makeRow(row1)}</div>
        <div class="vk-row">${makeRow(row2)}</div>
        <div class="vk-row">${makeRow(row3)}</div>
        <div class="vk-row">
          ${makeRow(row4)}
          <button type="button" class="vk-key vk-key-wide focusable" data-vk-action="backspace">${window.Utils.getIcon('backspace')}</button>
        </div>
        <div class="vk-row" style="margin-top: 1.5vh;">
          <button type="button" class="vk-key vk-key-wide focusable" data-vk-action="clear">Clear</button>
          <button type="button" class="vk-key vk-key-space focusable" data-vk-key=" ">Space</button>
          <button type="button" class="btn-secondary vk-key-wide focusable" data-vk-action="cancel">${window.t('cancel')}</button>
          <button type="button" class="vk-key vk-key-done focusable" data-vk-action="done">Done</button>
        </div>
      `;
    }

    overlayEl.innerHTML = `
      <div class="vk-box" data-focus-group="virtual-keyboard">
        <div class="vk-input-preview">
          <span id="vk-text-display">${window.Utils.escapeHTML(currentVal)}</span>
          <span class="vk-caret"></span>
        </div>
        ${keysHtml}
      </div>
    `;

    // Event delegation on keyboard box
    const box = overlayEl.querySelector('.vk-box');
    box.addEventListener('click', handleKeyClick);
  }

  function handleKeyClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    const char = btn.getAttribute('data-vk-key');
    const action = btn.getAttribute('data-vk-action');

    if (char != null) {
      if (currentVal.length < maxLength) {
        currentVal += char;
        updatePreview();
      }
    } else if (action === 'backspace') {
      currentVal = currentVal.slice(0, -1);
      updatePreview();
    } else if (action === 'clear') {
      currentVal = '';
      updatePreview();
    } else if (action === 'done') {
      close(true);
    } else if (action === 'cancel') {
      close(false);
    }
  }

  function updatePreview() {
    const textEl = document.getElementById('vk-text-display');
    if (textEl) {
      textEl.textContent = currentVal;
    }
  }

  function isOpen() {
    return overlayEl && overlayEl.classList.contains('active');
  }

  return {
    init,
    open,
    close,
    isOpen
  };
})();
