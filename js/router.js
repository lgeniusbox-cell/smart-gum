/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Screen Router & Navigation Stack
 * Handles screen transitions, history stack, back navigation, and exit dialog.
 */

window.Router = (function () {
  'use strict';

  const screens = {};
  const historyStack = [];
  let currentScreenId = null;
  let isTransitioning = false;
  let exitModalEl = null;
  let currentParams = {};
  
  function register(id, screenHandler) {
    screens[id] = screenHandler;
  }

  function init() {
    window.Input.addListener((action) => {
      if (action === window.Input.ACTIONS.BACK) {
        handleBack();
      }
    });

    createExitModal();
  }

  function createExitModal() {
    exitModalEl = document.createElement('div');
    exitModalEl.id = 'exit-confirm-modal';
    exitModalEl.className = 'modal-backdrop';
    exitModalEl.innerHTML = `
      <div class="modal-dialog" data-focus-group="exit-modal">
        <div class="modal-title">${window.t('confirm_exit_title')}</div>
        <div class="modal-subtitle">${window.t('confirm_exit_desc')}</div>
        <div style="display: flex; justify-content: center; gap: 1.5vw; margin-top: 3vh;">
          <button type="button" class="btn-secondary focusable" id="exit-btn-cancel">${window.t('no_stay')}</button>
          <button type="button" class="btn-primary btn-danger focusable" id="exit-btn-confirm">${window.t('yes_exit')}</button>
        </div>
      </div>
    `;
    document.getElementById('app').appendChild(exitModalEl);

    document.getElementById('exit-btn-cancel').addEventListener('click', () => {
      closeExitModal();
    });

    document.getElementById('exit-btn-confirm').addEventListener('click', () => {
      closeExitModal();
      if (window.Bridge) {
        window.Bridge.onExitRequested();
      }
    });
  }

  function showExitModal() {
    if (!exitModalEl) return;
    exitModalEl.classList.add('active');
    if (window.Focus) {
      window.Focus.trapFocus(exitModalEl);
    }
  }

  function closeExitModal() {
    if (!exitModalEl) return;
    exitModalEl.classList.remove('active');
    if (window.Focus) {
      window.Focus.releaseFocusTrap();
    }
  }

  function isExitModalOpen() {
    return exitModalEl && exitModalEl.classList.contains('active');
  }

  async function navigate(targetScreenId, params = {}, addToHistory = true) {
    if (targetScreenId === currentScreenId || isTransitioning) return;
    const targetHandler = screens[targetScreenId];
    if (!targetHandler) {
      console.error(`[Router] Unknown screen: ${targetScreenId}`);
      return;
    }

    isTransitioning = true;
    if (window.Focus) window.Focus.hideFocusRing();

    const container = document.getElementById('screen-container');

    // Save previous screen focus before leaving
    if (currentScreenId && addToHistory) {
      historyStack.push({
        screenId: currentScreenId,
        params: currentParams,
        focusedElement: window.Focus ? window.Focus.getCurrent() : null
      });
    }

    // Call onLeave on outgoing screen
    if (currentScreenId && screens[currentScreenId] && screens[currentScreenId].onLeave) {
      try {
        screens[currentScreenId].onLeave();
      } catch (e) {
        console.warn('[Router] onLeave error:', e);
      }
    }

    // Unmount / exit ALL old screens with fade-out
    const existingScreens = container ? Array.from(container.querySelectorAll('.screen')) : [];
    if (existingScreens.length > 0) {
      existingScreens.forEach(el => {
        el.classList.add('exiting');
        el.classList.remove('active');
      });
      await new Promise(r => setTimeout(r, 140));
      existingScreens.forEach(el => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    }

    // Guarantee container is pristine before mounting
    if (container) {
      container.innerHTML = '';
    }

    // Mount target screen
    currentScreenId = targetScreenId;
    currentParams = params;
    if (window.BgController) {
      window.BgController.setScreen(targetScreenId);
    }

    const newScreenEl = document.createElement('div');
    newScreenEl.id = `screen-${targetScreenId}`;
    newScreenEl.className = `screen screen-${targetScreenId}`;
    if (container) {
      container.appendChild(newScreenEl);
    }

    // Trigger entrance transition
    void newScreenEl.offsetWidth;
    newScreenEl.classList.add('active');

    // Reset transition lock so screen can trigger further navigations if needed
    isTransitioning = false;

    // Call target screen mount
    if (targetHandler.onMount) {
      try {
        await targetHandler.onMount(newScreenEl, params);
      } catch (err) {
        console.error(`[Router] Error mounting screen ${targetScreenId}:`, err);
      }
    }

    // Give TV & PC DOM time to composite before showing focus ring
    setTimeout(() => {
      if (window.Focus) {
        if (targetHandler.getDefaultFocus) {
          const defaultEl = targetHandler.getDefaultFocus(newScreenEl);
          if (defaultEl) {
            window.Focus.setFocus(defaultEl);
          } else {
            window.Focus.focusFirstAvailable(newScreenEl);
          }
        } else {
          window.Focus.focusFirstAvailable(newScreenEl);
        }
        window.Focus.showFocusRing();
      }
    }, 100);
  }

  function handleBack() {
    // 0. If Spotify Overlay is open, close it
    if (window.SpotifyOverlay && window.SpotifyOverlay.isOpen && window.SpotifyOverlay.isOpen()) {
      window.SpotifyOverlay.close();
      return;
    }

    // 1. If Virtual Keyboard is open, close it
    if (window.VirtualKeyboard && window.VirtualKeyboard.isOpen()) {
      window.VirtualKeyboard.close(false);
      return;
    }

    // 2. If Exit Modal is open, close it
    if (isExitModalOpen()) {
      closeExitModal();
      return;
    }

    // 3. Check if current screen handles back internally (e.g. PIN modal)
    if (currentScreenId && screens[currentScreenId] && screens[currentScreenId].onBack) {
      const handled = screens[currentScreenId].onBack();
      if (handled) return;
    }

    // 4. If on Main Dashboard, show Exit App confirmation dialog
    if (currentScreenId === 'main') {
      showExitModal();
      return;
    }

    // 5. If on Profile Select and no history, show Exit dialog
    if (currentScreenId === 'profile_select' && historyStack.length === 0) {
      showExitModal();
      return;
    }

    // 6. Pop from history stack
    if (historyStack.length > 0) {
      const prev = historyStack.pop();
      navigate(prev.screenId, prev.params, false);
    } else {
      showExitModal();
    }
  }

  function getCurrentScreen() {
    return currentScreenId;
  }

  return {
    init,
    register,
    navigate,
    handleBack,
    getCurrentScreen
  };
})();
