/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Profile Select Screen View
 * Displays user profile cards with PIN authentication and navigation to Main or Profile Edit.
 */

window.ProfileSelectScreen = (function () {
  'use strict';

  let currentContainer = null;
  let pinModalEl = null;
  let pendingProfile = null;
  let pinSuccessAction = null; // 'select' | 'edit'
  let enteredPin = '';
  let failedAttempts = 0;
  let lockoutTimer = null;
  let isProceeding = false;

  async function onMount(container) {
    isProceeding = false;
    currentContainer = container;

    // Reset to neutral theme for profile select
    if (window.Theme) {
      window.Theme.setTheme('neutral');
    }

    const profiles = window.Profiles.getAll();

    let cardsHtml = '';
    profiles.forEach((p, idx) => {
      const isChild = p.type === 'child';
      const hasPin = Boolean(p.pinHash);

      cardsHtml += `
        <div class="profile-card-wrapper" style="display: flex; flex-direction: column; gap: 1.5vh; align-items: center;">
          <div class="profile-card focusable anim-stagger-${(idx % 4) + 1}" data-profile-id="${p.id}" tabindex="0">
            <div class="profile-card-glow"></div>
            <div class="profile-avatar-wrap">
              <img src="${p.avatar}" alt="${window.Utils.escapeHTML(p.name)}" class="profile-card-avatar" data-profile-name="${window.Utils.escapeHTML(p.name)}" data-is-child="${isChild}" data-idx="${idx}" />
              ${hasPin ? `<div class="profile-lock-icon">${window.Utils.getIcon('lock')}</div>` : ''}
            </div>
            <div class="profile-card-info">
              <div class="profile-card-name">${window.Utils.escapeHTML(p.name)}</div>
              <span class="badge ${isChild ? 'badge-child' : 'badge-adult'}">
                ${isChild ? window.t('type_child') : window.t('type_adult')}
              </span>
            </div>
          </div>
          <button type="button" class="profile-edit-btn focusable" data-edit-profile-id="${p.id}" tabindex="0">
            ${window.Utils.getIcon('edit')} ${window.t('edit_profile')}
          </button>
        </div>
      `;
    });

    // "Add New Profile" Card at the end
    cardsHtml += `
      <div class="profile-card-wrapper" style="display: flex; flex-direction: column; gap: 1.5vh; align-items: center;">
        <div class="profile-card profile-card-add focusable" id="btn-add-profile" tabindex="0">
          <div class="profile-add-icon-circle">
            ${window.Utils.getIcon('plus')}
          </div>
          <div class="profile-card-info">
            <div class="profile-card-name">${window.t('add_profile')}</div>
          </div>
        </div>
        <div style="height: 3.2vh;"></div> <!-- spacer to align with edit buttons -->
      </div>
    `;

    container.innerHTML = `
      <div class="profile-select-header">
        <h1 class="profile-select-title">${window.t('who_is_playing')}</h1>
        <p class="profile-select-subtitle">${window.t('select_profile_hint')}</p>
      </div>
      <div class="catalog-carousel-viewport">
        <div class="profile-cards-track" data-focus-group="profiles">
          ${cardsHtml}
        </div>
      </div>
    `;

    setupEvents(container);
    createPinModal();
  }

  function setupEvents(container) {
    // Attach error fallbacks for avatars
    container.querySelectorAll('.profile-card-avatar').forEach(img => {
      img.onerror = function () {
        const name = img.getAttribute('data-profile-name') || 'Player';
        const isChild = img.getAttribute('data-is-child') === 'true';
        const idx = parseInt(img.getAttribute('data-idx') || '0', 10);
        img.onerror = null;
        if (window.Utils && window.Utils.generateFallbackAvatarSvg) {
          img.src = window.Utils.generateFallbackAvatarSvg(name, isChild, idx);
        }
      };
    });

    // Click on Profile Card -> Select profile
    container.querySelectorAll('.profile-card[data-profile-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-profile-id');
        const profile = window.Profiles.getById(id);
        if (profile) {
          handleProfileChosen(profile, 'select');
        }
      });
    });

    // Click on Edit Profile Button
    container.querySelectorAll('.profile-edit-btn[data-edit-profile-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-edit-profile-id');
        const profile = window.Profiles.getById(id);
        if (profile) {
          handleProfileChosen(profile, 'edit');
        }
      });
    });

    // Click on Add Profile Card
    const addCard = container.querySelector('#btn-add-profile');
    if (addCard) {
      addCard.addEventListener('click', () => {
        window.Router.navigate('profile_edit', { isNew: true });
      });
    }
  }

  function handleProfileChosen(profile, action) {
    pendingProfile = profile;
    pinSuccessAction = action;

    if (profile.pinHash) {
      // Profile has PIN: open PIN keypad modal
      openPinModal();
    } else {
      // No PIN protection: proceed directly
      proceedWithProfile(profile, action);
    }
  }

  function proceedWithProfile(profile, action) {
    if (isProceeding) return;
    isProceeding = true;
    setTimeout(() => { isProceeding = false; }, 800);

    if (action === 'select') {
      window.Profiles.setActiveProfile(profile);
      if (window.Bridge) {
        window.Bridge.onProfileSelected(profile);
      }
      window.Router.navigate('main');
    } else if (action === 'edit') {
      window.Router.navigate('profile_edit', { profileId: profile.id });
    }
  }

  /* ------------------------------------------------------------------------
     PIN Keypad Modal Logic
     ------------------------------------------------------------------------ */
  function createPinModal() {
    pinModalEl = document.createElement('div');
    pinModalEl.id = 'pin-keypad-modal';
    pinModalEl.className = 'modal-backdrop';
    pinModalEl.innerHTML = `
      <div class="modal-dialog" id="pin-dialog-box" data-focus-group="pin-keypad">
        <div class="modal-title">${window.t('enter_pin_title')}</div>
        <div class="modal-subtitle" id="pin-modal-desc">${window.t('enter_pin_desc')}</div>
        
        <div class="pin-dots-wrap">
          <div class="pin-dot" id="pindot-0"></div>
          <div class="pin-dot" id="pindot-1"></div>
          <div class="pin-dot" id="pindot-2"></div>
          <div class="pin-dot" id="pindot-3"></div>
        </div>

        <div class="numpad-grid">
          <button type="button" class="numpad-key focusable" data-pin-key="1">1</button>
          <button type="button" class="numpad-key focusable" data-pin-key="2">2</button>
          <button type="button" class="numpad-key focusable" data-pin-key="3">3</button>
          <button type="button" class="numpad-key focusable" data-pin-key="4">4</button>
          <button type="button" class="numpad-key focusable" data-pin-key="5">5</button>
          <button type="button" class="numpad-key focusable" data-pin-key="6">6</button>
          <button type="button" class="numpad-key focusable" data-pin-key="7">7</button>
          <button type="button" class="numpad-key focusable" data-pin-key="8">8</button>
          <button type="button" class="numpad-key focusable" data-pin-key="9">9</button>
          <button type="button" class="numpad-key focusable" data-pin-action="clear">C</button>
          <button type="button" class="numpad-key focusable" data-pin-key="0">0</button>
          <button type="button" class="numpad-key focusable" data-pin-action="backspace">${window.Utils.getIcon('backspace')}</button>
        </div>

        <div style="margin-top: 2vh;">
          <button type="button" class="btn-secondary focusable" id="pin-btn-cancel">${window.t('cancel')}</button>
        </div>
      </div>
    `;

    document.getElementById('app').appendChild(pinModalEl);

    // Event delegation on numpad keys
    pinModalEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const num = btn.getAttribute('data-pin-key');
      const action = btn.getAttribute('data-pin-action');

      if (num != null) {
        if (enteredPin.length < 4) {
          enteredPin += num;
          updatePinDots();
          if (enteredPin.length === 4) {
            await checkEnteredPin();
          }
        }
      } else if (action === 'backspace') {
        enteredPin = enteredPin.slice(0, -1);
        updatePinDots();
      } else if (action === 'clear') {
        enteredPin = '';
        updatePinDots();
      } else if (btn.id === 'pin-btn-cancel') {
        closePinModal();
      }
    });
  }

  function openPinModal() {
    if (!pinModalEl) return;
    enteredPin = '';
    updatePinDots();
    pinModalEl.classList.add('active');

    if (window.Focus) {
      window.Focus.trapFocus(pinModalEl);
    }
  }

  function closePinModal() {
    if (!pinModalEl) return;
    pinModalEl.classList.remove('active');
    enteredPin = '';
    pendingProfile = null;
    pinSuccessAction = null;

    if (window.Focus) {
      window.Focus.releaseFocusTrap();
    }
  }

  function updatePinDots() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`pindot-${i}`);
      if (dot) {
        if (i < enteredPin.length) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      }
    }
  }

  async function checkEnteredPin() {
    if (!pendingProfile) return;

    if (failedAttempts >= (window.CONFIG.PIN.MAX_ATTEMPTS || 4)) {
      showPinError(window.t('pin_locked_out'));
      return;
    }

    const isValid = await window.Profiles.verifyPin(pendingProfile, enteredPin);
    if (isValid) {
      failedAttempts = 0;
      const prof = pendingProfile;
      const act = pinSuccessAction;
      closePinModal();
      proceedWithProfile(prof, act);
    } else {
      failedAttempts++;
      showPinError(window.t('pin_error_incorrect'));

      // Shake animation on PIN dialog
      const dialog = document.getElementById('pin-dialog-box');
      if (dialog) {
        dialog.classList.remove('anim-shake');
        void dialog.offsetWidth;
        dialog.classList.add('anim-shake');
      }

      enteredPin = '';
      setTimeout(() => {
        updatePinDots();
      }, 350);

      if (failedAttempts >= 4) {
        startLockout();
      }
    }
  }

  function showPinError(msg) {
    const desc = document.getElementById('pin-modal-desc');
    if (desc) {
      desc.textContent = msg;
      desc.style.color = 'var(--color-danger)';
    }
    if (window.Notify) {
      window.Notify.show({
        type: 'error',
        title: 'PIN Error',
        message: msg,
        duration: 3000
      });
    }
  }

  function startLockout() {
    const desc = document.getElementById('pin-modal-desc');
    if (desc) {
      desc.textContent = window.t('pin_locked_out');
    }
    setTimeout(() => {
      failedAttempts = 0;
      if (desc) {
        desc.textContent = window.t('enter_pin_desc');
        desc.style.color = 'var(--color-text-muted)';
      }
    }, window.CONFIG.PIN.LOCKOUT_DURATION_MS || 30000);
  }

  function onBack() {
    // If PIN modal is open, close it
    if (pinModalEl && pinModalEl.classList.contains('active')) {
      closePinModal();
      return true;
    }
    return false;
  }

  function getDefaultFocus(container) {
    // Focus the first profile card or add card
    return container.querySelector('.profile-card') || container.querySelector('#btn-add-profile');
  }

  function onLeave() {
    if (pinModalEl && pinModalEl.parentNode) {
      pinModalEl.parentNode.removeChild(pinModalEl);
      pinModalEl = null;
    }
  }

  return {
    onMount,
    onBack,
    onLeave,
    getDefaultFocus
  };
})();
