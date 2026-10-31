/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Application Coordinator & Bootstrapper
 * Coordinates input, focus, router, background worker, and debug overlay HUD.
 */

window.App = (function () {
  'use strict';

  let debugOverlayEl = null;
  let isDebugActive = false;
  let debugUpdateInterval = null;

  function init() {
    console.log('[MatPad TV] Starting application bootstrap...');

    // 1. Initialize Core Engines
    window.Input.init();
    window.Focus.init();
    window.Notify.init();
    window.BgController.init();
    window.VirtualKeyboard.init();
    window.Router.init();

    // 2. Register Screens
    window.Router.register('boot', window.BootScreen);
    window.Router.register('profile_select', window.ProfileSelectScreen);
    window.Router.register('profile_edit', window.ProfileEditScreen);
    window.Router.register('main', window.MainScreen);
    window.Router.register('category', window.CategoryScreen);
    window.Router.register('run', window.RunScreen);
    // 3. Setup Debug Overlay Listener
    setupDebugOverlay();

    // 4. Start at Boot Screen
    window.Router.navigate('boot', {}, false);
  }

  function setupDebugOverlay() {
    debugOverlayEl = document.getElementById('debug-overlay');

    window.Input.addListener((action) => {
      if (action === window.Input.ACTIONS.DEBUG) {
        toggleDebugOverlay();
      }
    });
  }

  function toggleDebugOverlay() {
    if (!debugOverlayEl) return;
    isDebugActive = !isDebugActive;

    if (isDebugActive) {
      debugOverlayEl.classList.add('active');
      updateDebugStats();
      debugUpdateInterval = setInterval(updateDebugStats, 400);
      if (window.Notify) {
        window.Notify.show({ type: 'info', title: 'Debug HUD', message: 'Overlay active (Press D to toggle)', duration: 2000 });
      }
    } else {
      debugOverlayEl.classList.remove('active');
      if (debugUpdateInterval) {
        clearInterval(debugUpdateInterval);
        debugUpdateInterval = null;
      }
    }
  }

  function updateDebugStats() {
    if (!debugOverlayEl || !isDebugActive) return;

    const fps = window.Perf ? window.Perf.getFps() : 60;
    const quality = window.Perf ? window.Perf.getQuality() : 'high';
    const currentScreen = window.Router ? window.Router.getCurrentScreen() : 'unknown';
    const focusedEl = window.Focus ? window.Focus.getCurrent() : null;
    const focusedTag = focusedEl ? `${focusedEl.tagName.toLowerCase()}.${focusedEl.className.split(' ').slice(0, 2).join('.')}` : 'none';

    debugOverlayEl.innerHTML = `
      <div><strong>[MATPAD TV DEBUG]</strong></div>
      <div>FPS: <span style="color: ${fps < 40 ? '#ef4444' : '#10b981'}; font-weight: bold;">${fps}</span> (Target 60)</div>
      <div>Quality: <strong>${quality.toUpperCase()}</strong></div>
      <div>Screen: <strong>${currentScreen}</strong></div>
      <div>Focused: <span style="font-size: 10px;">${focusedTag}</span></div>
      <div>TV Bridge: <strong>${window.Bridge.isAvailable() ? 'Android Native' : 'Browser Mock'}</strong></div>
      <div>Gamepad: <strong>${isGamepadActive() ? 'Connected' : 'None'}</strong></div>
    `;
  }

  function isGamepadActive() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(gamepads).some(g => g && g.connected);
  }

  // Auto-boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init,
    toggleDebugOverlay
  };
})();
