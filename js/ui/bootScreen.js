/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Boot Screen View
 * Animated intro, engine initialization, profile loading, and transition to Profile Select.
 */

window.BootScreen = (function () {
  'use strict';

  let statusTextEl = null;

  async function onMount(container) {
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

    // Run initialization tasks sequentially with small frame delays for smooth TV rendering
    await delay(500);
    updateStatus(window.t('boot_syncing'));
    await window.Profiles.loadAll();

    await delay(400);
    window.Profiles.loadAvatars(); // fire in background

    // Performance governor start
    if (window.Perf) {
      window.Perf.start();
    }

    updateStatus(window.t('boot_ready'));
    await delay(400);

    // Notify native Android bridge
    if (window.Bridge) {
      window.Bridge.onAppReady();
    }

    // Navigate to Profile Select screen
    window.Router.navigate('profile_select');
  }

  function updateStatus(text) {
    if (statusTextEl) {
      statusTextEl.textContent = text;
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    onMount
  };
})();
