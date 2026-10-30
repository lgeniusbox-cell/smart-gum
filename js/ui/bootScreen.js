/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Boot Screen View
 * Animated intro, engine initialization, fail-safe watchdog, and transition to Profile Select.
 */

window.BootScreen = (function () {
  'use strict';

  let statusTextEl = null;
  let hasNavigated = false;
  let watchdogTimer = null;

  function safeTransition() {
    if (hasNavigated) return;
    hasNavigated = true;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    window.Router.navigate('profile_select');
  }

  async function onMount(container) {
    hasNavigated = false;

    container.innerHTML = `
      <div class="boot-logo-wrap">
        <img src="assets/logo.png" alt="MatPad" class="boot-logo-img" onerror="this.style.display='none'; document.getElementById('boot-logo-fallback').style.display='block';" />
        <div id="boot-logo-fallback" class="boot-logo-fallback" style="display: none;">MATPAD</div>
      </div>
      <div class="boot-spinner-wrap">
        <div class="boot-bar-track">
          <div class="boot-bar-fill"></div>
        </div>
        <div id="boot-status" class="boot-status-text">${window.t('boot_initializing')}</div>
      </div>
    `;

    statusTextEl = document.getElementById('boot-status');

    // Fail-safe watchdog: guarantees the app advances to Profile Select within 1.6s even on slow/broken network/storage
    watchdogTimer = setTimeout(() => {
      console.log('[BootScreen] Watchdog timer fired. Advancing to Profile Select.');
      safeTransition();
    }, 1600);

    // Click/key listener to allow skipping boot if desired
    const clickHandler = () => safeTransition();
    container.addEventListener('click', clickHandler, { once: true });

    try {
      // 1. Initial visual breathing delay
      await delay(400);
      updateStatus(window.t('boot_syncing'));

      // 2. Load Profiles with timeout race (max 600ms)
      if (window.Profiles && window.Profiles.loadAll) {
        await Promise.race([
          window.Profiles.loadAll(),
          delay(600)
        ]);
      }

      // 3. Start avatar load in background
      if (window.Profiles && window.Profiles.loadAvatars) {
        window.Profiles.loadAvatars().catch(() => {});
      }

      // 4. Performance governor start
      if (window.Perf) {
        window.Perf.start();
      }

      updateStatus(window.t('boot_ready'));
      await delay(300);

      // 5. Notify native Android bridge
      if (window.Bridge) {
        window.Bridge.onAppReady();
      }
    } catch (err) {
      console.warn('[BootScreen] Non-critical boot error, proceeding:', err);
    } finally {
      safeTransition();
    }
  }

  function updateStatus(text) {
    if (statusTextEl) {
      statusTextEl.textContent = text;
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function onLeave() {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  return {
    onMount,
    onLeave
  };
})();
