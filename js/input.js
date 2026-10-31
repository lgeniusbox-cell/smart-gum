/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Central Input & Gamepad Engine
 * Unifies Keyboard, Android TV Remote Keycodes, and Gamepad API into semantic actions.
 */

window.Input = (function () {
  'use strict';

  const ACTIONS = {
    UP: 'UP',
    DOWN: 'DOWN',
    LEFT: 'LEFT',
    RIGHT: 'RIGHT',
    OK: 'OK',
    BACK: 'BACK',
    MENU: 'MENU',
    DEBUG: 'DEBUG'
  };

  const listeners = [];
  let isPaused = false;

  // Gamepad state tracking
  let gamepadPollingActive = false;
  let lastGamepadButtonState = {};
  let lastDirectionAction = null;
  let lastDirectionTime = 0;
  let initialRepeatDone = false;

  const DEADZONE = 0.45;
  const INITIAL_REPEAT_DELAY = window.CONFIG.NAV_REPEAT_DELAY || 240;
  const SUBSEQUENT_REPEAT_DELAY = window.CONFIG.NAV_REPEAT_RATE || 130;

  function addListener(fn) {
    if (typeof fn === 'function' && !listeners.includes(fn)) {
      listeners.push(fn);
    }
  }

  function removeListener(fn) {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  }

  function emitAction(action, source = 'keyboard') {
    if (isPaused) return;
    for (let i = 0; i < listeners.length; i++) {
      try {
        listeners[i](action, source);
      } catch (err) {
        console.error('[Input] Error in action listener:', err);
      }
    }
  }

  /**
   * Keyboard & Android TV Remote handler
   */
  function handleKeyDown(e) {
    const key = e.key;
    const code = e.keyCode;

    // While the user is typing in an editable text field (keyboard requested),
    // don't hijack typing keys (letters, Space, Backspace, Left/Right caret...).
    // Only Enter, Up/Down, Escape and the TV Back key are still routed.
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' ||
      (t.tagName === 'INPUT' && !t.readOnly && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(t.type)));
    if (typing) {
      const passThrough = key === 'Enter' || key === 'Escape' || key === 'ArrowUp' || key === 'ArrowDown' ||
        code === 4 || code === 13 || code === 23 || code === 66 || code === 19 || code === 20 || code === 27;
      if (!passThrough) return;
    }

    let action = null;

    // Up
    if (key === 'ArrowUp' || code === 19 || code === 38) {
      action = ACTIONS.UP;
    }
    // Down
    else if (key === 'ArrowDown' || code === 20 || code === 40) {
      action = ACTIONS.DOWN;
    }
    // Left
    else if (key === 'ArrowLeft' || code === 21 || code === 37) {
      action = ACTIONS.LEFT;
    }
    // Right
    else if (key === 'ArrowRight' || code === 22 || code === 39) {
      action = ACTIONS.RIGHT;
    }
    // Confirm / OK (Enter or Space when not typing)
    else if (key === 'Enter' || key === ' ' || code === 23 || code === 66 || code === 13 || code === 32) {
      // If virtual keyboard is open and space was pressed, let keyboard handler consume it
      if (key === ' ' && window.VirtualKeyboard && window.VirtualKeyboard.isOpen()) {
        return;
      }
      action = ACTIONS.OK;
    }
    // Tab / Shift+Tab for PC browser accessibility
    else if (key === 'Tab' || code === 9) {
      action = e.shiftKey ? ACTIONS.LEFT : ACTIONS.RIGHT;
    }
    // Back / Return
    else if (key === 'Escape' || (key === 'Backspace' && (!window.VirtualKeyboard || !window.VirtualKeyboard.isOpen())) || code === 4 || code === 27 || code === 97) {
      action = ACTIONS.BACK;
    }
    // Menu / Settings
    else if (key === 'ContextMenu' || code === 82) {
      action = ACTIONS.MENU;
    }
    // Debug toggle (key 'd' or 'D')
    else if ((key === 'd' || key === 'D') && (!window.VirtualKeyboard || !window.VirtualKeyboard.isOpen())) {
      action = ACTIONS.DEBUG;
    }

    if (action) {
      e.preventDefault();
      emitAction(action, 'remote');
    }
  }

  /**
   * Gamepad Polling Loop (requestAnimationFrame)
   */
  function pollGamepad() {
    if (!gamepadPollingActive) return;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;

    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        break;
      }
    }

    if (gp) {
      processGamepadInput(gp);
    }

    requestAnimationFrame(pollGamepad);
  }

  function processGamepadInput(gp) {
    const now = performance.now();

    // 1. Digital Buttons: A (OK) and B (BACK) with Edge Detection (no repeat jank)
    const btnA = gp.buttons[0] && gp.buttons[0].pressed; // A / Cross
    const btnB = gp.buttons[1] && gp.buttons[1].pressed; // B / Circle
    const btnMenu = gp.buttons[9] && gp.buttons[9].pressed; // Start / Menu

    if (btnA && !lastGamepadButtonState.btnA) {
      emitAction(ACTIONS.OK, 'gamepad');
    }
    lastGamepadButtonState.btnA = btnA;

    if (btnB && !lastGamepadButtonState.btnB) {
      emitAction(ACTIONS.BACK, 'gamepad');
    }
    lastGamepadButtonState.btnB = btnB;

    if (btnMenu && !lastGamepadButtonState.btnMenu) {
      emitAction(ACTIONS.MENU, 'gamepad');
    }
    lastGamepadButtonState.btnMenu = btnMenu;

    // 2. Directional inputs: D-Pad Buttons + Left Stick
    const dpadUp = gp.buttons[12] && gp.buttons[12].pressed;
    const dpadDown = gp.buttons[13] && gp.buttons[13].pressed;
    const dpadLeft = gp.buttons[14] && gp.buttons[14].pressed;
    const dpadRight = gp.buttons[15] && gp.buttons[15].pressed;

    const axisX = gp.axes && gp.axes.length > 0 ? gp.axes[0] : 0;
    const axisY = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;

    let dir = null;
    if (dpadUp || axisY < -DEADZONE) dir = ACTIONS.UP;
    else if (dpadDown || axisY > DEADZONE) dir = ACTIONS.DOWN;
    else if (dpadLeft || axisX < -DEADZONE) dir = ACTIONS.LEFT;
    else if (dpadRight || axisX > DEADZONE) dir = ACTIONS.RIGHT;

    if (dir) {
      if (lastDirectionAction !== dir) {
        // Initial press
        emitAction(dir, 'gamepad');
        lastDirectionAction = dir;
        lastDirectionTime = now;
        initialRepeatDone = false;
      } else {
        // Held repeat logic
        const threshold = initialRepeatDone ? SUBSEQUENT_REPEAT_DELAY : INITIAL_REPEAT_DELAY;
        if (now - lastDirectionTime >= threshold) {
          emitAction(dir, 'gamepad');
          lastDirectionTime = now;
          initialRepeatDone = true;
        }
      }
    } else {
      // Released
      lastDirectionAction = null;
      initialRepeatDone = false;
    }
  }

  function init() {
    window.addEventListener('keydown', handleKeyDown, { passive: false });

    window.addEventListener('gamepadconnected', (e) => {
      console.log(`[Input] Gamepad connected: ${e.gamepad.id}`);
      if (!gamepadPollingActive) {
        gamepadPollingActive = true;
        requestAnimationFrame(pollGamepad);
      }
      if (window.Notify) {
        window.Notify.show({
          type: 'info',
          title: window.t('gamepad_connected'),
          message: e.gamepad.id.substring(0, 30),
          duration: 3000
        });
      }
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log(`[Input] Gamepad disconnected: ${e.gamepad.id}`);
      if (window.Notify) {
        window.Notify.show({
          type: 'warning',
          title: window.t('gamepad_disconnected'),
          message: e.gamepad.id.substring(0, 30),
          duration: 3000
        });
      }
    });

    // Start polling loop right away in case gamepad is already attached
    gamepadPollingActive = true;
    requestAnimationFrame(pollGamepad);
  }

  function pause() {
    isPaused = true;
  }

  function resume() {
    isPaused = false;
  }

  return {
    init,
    ACTIONS,
    addListener,
    removeListener,
    pause,
    resume
  };
})();
