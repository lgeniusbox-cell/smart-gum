/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Create / Edit Profile Screen View
 * Form inputs for Name, Age, Weight, Sex, Type, Avatar Grid, and Adult PIN setup.
 */

window.ProfileEditScreen = (function () {
  'use strict';

  let currentContainer = null;
  let editingProfile = null;
  let isNew = true;
  let avatarLibrary = null;

  // Form State
  let formState = {
    name: 'Player 1',
    age: 10,
    weight: 35,
    sex: 'male',
    type: 'child',
    avatar: '',
    pin: '',
    confirmPin: ''
  };

  let deleteModalEl = null;

  async function onMount(container, params = {}) {
    currentContainer = container;
    isNew = !params.profileId;

    if (!isNew) {
      editingProfile = window.Profiles.getById(params.profileId);
      if (editingProfile) {
        formState = {
          name: editingProfile.name,
          age: editingProfile.age,
          weight: editingProfile.weight,
          sex: editingProfile.sex,
          type: editingProfile.type,
          avatar: editingProfile.avatar,
          pin: '',
          confirmPin: ''
        };
      }
    } else {
      editingProfile = null;
      formState = {
        name: 'Player 1',
        age: 10,
        weight: 35,
        sex: 'male',
        type: 'child',
        avatar: '',
        pin: '',
        confirmPin: ''
      };
    }

    avatarLibrary = await window.Profiles.loadAvatars();

    // Ensure initial avatar is selected
    if (!formState.avatar) {
      const list = formState.type === 'child' ? avatarLibrary.child : avatarLibrary.adult;
      formState.avatar = (list && list[0]) || window.Utils.generateFallbackAvatarSvg(formState.name, formState.type === 'child', 0);
    }

    render(container);
    createDeleteModal();
  }

  function render(container) {
    const isChild = formState.type === 'child';
    const avatars = isChild ? (avatarLibrary.child || []) : (avatarLibrary.adult || []);

    let avatarGridHtml = '';
    avatars.slice(0, 12).forEach((avUrl, idx) => {
      const isSelected = formState.avatar === avUrl;
      avatarGridHtml += `
        <div class="avatar-grid-item focusable ${isSelected ? 'selected' : ''}" data-avatar-url="${avUrl}" tabindex="0">
          <img src="${avUrl}" alt="Avatar ${idx}" onerror="this.src='${window.Utils.generateFallbackAvatarSvg('P', isChild, idx)}'" />
        </div>
      `;
    });

    const isAdult = formState.type === 'adult';

    container.innerHTML = `
      <div class="profile-select-header" style="margin-bottom: 2vh;">
        <h1 class="profile-select-title">${isNew ? window.t('create_profile') : window.t('edit_profile')}</h1>
      </div>

      <div class="profile-form-container">
        <!-- Left Column: Avatar & Type Preview -->
        <div class="form-left-col" data-focus-group="avatar-selection">
          <div class="form-current-avatar-wrap">
            <img src="${formState.avatar}" alt="Selected Avatar" class="form-current-avatar" id="edit-avatar-preview" onerror="this.src='${window.Utils.generateFallbackAvatarSvg(formState.name, isChild, 0)}'" />
          </div>

          <div class="avatar-grid-label">${window.t('choose_avatar')}</div>
          <div class="avatar-grid" id="avatar-picker-grid">
            ${avatarGridHtml}
          </div>
        </div>

        <!-- Right Column: Interactive Fields -->
        <div class="form-right-col" data-focus-group="form-fields">
          <div class="form-fields-grid">
            <!-- Name Field -->
            <div class="form-field-group full-width">
              <label class="form-label">${window.t('name')}</label>
              <button type="button" class="form-input-btn focusable" id="field-name-btn" tabindex="0">
                <span id="field-name-text">${window.Utils.escapeHTML(formState.name)}</span>
                ${window.Utils.getIcon('edit')}
              </button>
            </div>

            <!-- Age Field -->
            <div class="form-field-group">
              <label class="form-label">${window.t('age')}</label>
              <button type="button" class="form-input-btn focusable" id="field-age-btn" tabindex="0">
                <span id="field-age-text">${formState.age}</span>
                ${window.Utils.getIcon('edit')}
              </button>
            </div>

            <!-- Weight Field -->
            <div class="form-field-group">
              <label class="form-label">${window.t('weight')}</label>
              <button type="button" class="form-input-btn focusable" id="field-weight-btn" tabindex="0">
                <span id="field-weight-text">${formState.weight} kg</span>
                ${window.Utils.getIcon('edit')}
              </button>
            </div>

            <!-- Sex Selector -->
            <div class="form-field-group">
              <label class="form-label">${window.t('sex')}</label>
              <div class="form-toggle-row">
                <button type="button" class="toggle-pill-btn focusable ${formState.sex === 'male' ? 'active' : ''}" id="sex-male-btn" tabindex="0">
                  ${window.t('male')}
                </button>
                <button type="button" class="toggle-pill-btn focusable ${formState.sex === 'female' ? 'active' : ''}" id="sex-female-btn" tabindex="0">
                  ${window.t('female')}
                </button>
              </div>
            </div>

            <!-- Type Selector (Child / Adult) -->
            <div class="form-field-group">
              <label class="form-label">${window.t('profile_type')}</label>
              <div class="form-toggle-row">
                <button type="button" class="toggle-pill-btn focusable ${isChild ? 'active' : ''}" id="type-child-btn" tabindex="0">
                  ${window.t('type_child')}
                </button>
                <button type="button" class="toggle-pill-btn focusable ${!isChild ? 'active' : ''}" id="type-adult-btn" tabindex="0">
                  ${window.t('type_adult')}
                </button>
              </div>
            </div>

            <!-- PIN Field (Only displayed if Adult) -->
            ${isAdult ? `
              <div class="form-field-group full-width" style="margin-top: 0.5vh;">
                <label class="form-label">${window.t('set_pin_adult')}</label>
                <div style="display: flex; gap: 1.5vw;">
                  <button type="button" class="form-input-btn focusable" id="field-pin-btn" style="flex: 1;" tabindex="0">
                    <span>${formState.pin ? '••••' : window.t('pin_placeholder')}</span>
                    ${window.Utils.getIcon('lock')}
                  </button>
                  <button type="button" class="form-input-btn focusable" id="field-confirm-pin-btn" style="flex: 1;" tabindex="0">
                    <span>${formState.confirmPin ? '••••' : window.t('confirm_pin')}</span>
                    ${window.Utils.getIcon('lock')}
                  </button>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Bottom Action Buttons -->
          <div class="form-actions-row">
            <div>
              ${!isNew ? `
                <button type="button" class="btn-secondary btn-danger focusable" id="btn-delete-profile" tabindex="0">
                  ${window.Utils.getIcon('trash')} ${window.t('delete')}
                </button>
              ` : ''}
            </div>
            <div style="display: flex; gap: 1.2vw;">
              <button type="button" class="btn-secondary focusable" id="btn-cancel-edit" tabindex="0">
                ${window.t('cancel')}
              </button>
              <button type="button" class="btn-primary focusable" id="btn-save-profile" tabindex="0">
                ${window.Utils.getIcon('check')} ${window.t('save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    setupFormEvents(container);
  }

  function setupFormEvents(container) {
    // Avatar selection in grid
    container.querySelectorAll('.avatar-grid-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.getAttribute('data-avatar-url');
        formState.avatar = url;
        const preview = document.getElementById('edit-avatar-preview');
        if (preview) preview.src = url;

        container.querySelectorAll('.avatar-grid-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });

    // Name field click -> opens Virtual Keyboard
    const nameBtn = container.querySelector('#field-name-btn');
    if (nameBtn) {
      nameBtn.addEventListener('click', () => {
        window.VirtualKeyboard.open({
          type: 'text',
          initialValue: formState.name,
          maxLength: window.CONFIG.VALIDATION.NAME_MAX_LENGTH || 24,
          onComplete: (val) => {
            if (val != null && val.trim()) {
              formState.name = val.trim();
              const textEl = document.getElementById('field-name-text');
              if (textEl) textEl.textContent = formState.name;
            }
          }
        });
      });
    }

    // Age field click -> opens Virtual Numeric Keypad
    const ageBtn = container.querySelector('#field-age-btn');
    if (ageBtn) {
      ageBtn.addEventListener('click', () => {
        window.VirtualKeyboard.open({
          type: 'number',
          initialValue: formState.age,
          maxLength: 3,
          onComplete: (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= window.CONFIG.VALIDATION.AGE_MIN && num <= window.CONFIG.VALIDATION.AGE_MAX) {
              formState.age = num;
              // Suggest Child type if age < 13
              if (num < window.CONFIG.VALIDATION.CHILD_AGE_THRESHOLD && formState.type !== 'child') {
                formState.type = 'child';
                refreshTypeChange();
                return;
              }
              const textEl = document.getElementById('field-age-text');
              if (textEl) textEl.textContent = formState.age;
            } else if (val != null) {
              showError(`Age must be between ${window.CONFIG.VALIDATION.AGE_MIN} and ${window.CONFIG.VALIDATION.AGE_MAX}`);
            }
          }
        });
      });
    }

    // Weight field click -> opens Virtual Numeric Keypad
    const weightBtn = container.querySelector('#field-weight-btn');
    if (weightBtn) {
      weightBtn.addEventListener('click', () => {
        window.VirtualKeyboard.open({
          type: 'number',
          initialValue: formState.weight,
          maxLength: 3,
          onComplete: (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= window.CONFIG.VALIDATION.WEIGHT_MIN && num <= window.CONFIG.VALIDATION.WEIGHT_MAX) {
              formState.weight = num;
              const textEl = document.getElementById('field-weight-text');
              if (textEl) textEl.textContent = `${formState.weight} kg`;
            } else if (val != null) {
              showError(`Weight must be between ${window.CONFIG.VALIDATION.WEIGHT_MIN} and ${window.CONFIG.VALIDATION.WEIGHT_MAX} kg`);
            }
          }
        });
      });
    }

    // Sex toggles
    const maleBtn = container.querySelector('#sex-male-btn');
    const femaleBtn = container.querySelector('#sex-female-btn');
    if (maleBtn && femaleBtn) {
      maleBtn.addEventListener('click', () => {
        formState.sex = 'male';
        maleBtn.classList.add('active');
        femaleBtn.classList.remove('active');
      });
      femaleBtn.addEventListener('click', () => {
        formState.sex = 'female';
        femaleBtn.classList.add('active');
        maleBtn.classList.remove('active');
      });
    }

    // Type toggles
    const childBtn = container.querySelector('#type-child-btn');
    const adultBtn = container.querySelector('#type-adult-btn');
    if (childBtn && adultBtn) {
      childBtn.addEventListener('click', () => {
        if (formState.type !== 'child') {
          formState.type = 'child';
          refreshTypeChange();
        }
      });
      adultBtn.addEventListener('click', () => {
        if (formState.type !== 'adult') {
          formState.type = 'adult';
          refreshTypeChange();
        }
      });
    }

    // PIN buttons (Adult)
    const pinBtn = container.querySelector('#field-pin-btn');
    const confirmPinBtn = container.querySelector('#field-confirm-pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        window.VirtualKeyboard.open({
          type: 'number',
          initialValue: formState.pin,
          maxLength: 4,
          onComplete: (val) => {
            if (val != null) {
              formState.pin = val;
              render(currentContainer);
            }
          }
        });
      });
    }
    if (confirmPinBtn) {
      confirmPinBtn.addEventListener('click', () => {
        window.VirtualKeyboard.open({
          type: 'number',
          initialValue: formState.confirmPin,
          maxLength: 4,
          onComplete: (val) => {
            if (val != null) {
              formState.confirmPin = val;
              render(currentContainer);
            }
          }
        });
      });
    }

    // Cancel Button
    const cancelBtn = container.querySelector('#btn-cancel-edit');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        window.Router.handleBack();
      });
    }

    // Save Button
    const saveBtn = container.querySelector('#btn-save-profile');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleSave);
    }

    // Delete Button
    const deleteBtn = container.querySelector('#btn-delete-profile');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        openDeleteModal();
      });
    }
  }

  function refreshTypeChange() {
    const list = formState.type === 'child' ? avatarLibrary.child : avatarLibrary.adult;
    formState.avatar = (list && list[0]) || window.Utils.generateFallbackAvatarSvg(formState.name, formState.type === 'child', 0);
    render(currentContainer);
  }

  async function handleSave() {
    // 1. Validate Name
    if (!formState.name || formState.name.trim().length === 0) {
      showError('Please enter a profile name.');
      return;
    }

    // 2. Validate PIN (if adult provided PIN)
    let pinHash = editingProfile ? editingProfile.pinHash : '';
    if (formState.type === 'adult') {
      if (formState.pin || formState.confirmPin) {
        if (formState.pin.length !== 4) {
          showError('PIN must be exactly 4 digits.');
          return;
        }
        if (formState.pin !== formState.confirmPin) {
          showError('PINs do not match. Please re-enter.');
          return;
        }
        pinHash = await window.Profiles.hashPin(formState.pin);
      }
    } else {
      pinHash = ''; // Child profiles have no PIN
    }

    // Save profile
    const saved = await window.Profiles.saveProfile({
      id: editingProfile ? editingProfile.id : null,
      name: formState.name,
      age: formState.age,
      weight: formState.weight,
      sex: formState.sex,
      type: formState.type,
      avatar: formState.avatar,
      pinHash: pinHash,
      createdAt: editingProfile ? editingProfile.createdAt : Date.now()
    });

    if (window.Notify) {
      window.Notify.show({
        type: 'success',
        title: 'Profile Saved',
        message: `${saved.name} is ready to play!`,
        duration: 3000
      });
    }

    // Set active profile and enter Main Dashboard
    window.Profiles.setActiveProfile(saved);
    if (window.Bridge) {
      window.Bridge.onProfileSelected(saved);
    }
    window.Router.navigate('main');
  }

  function showError(msg) {
    if (window.Notify) {
      window.Notify.show({
        type: 'error',
        title: 'Validation',
        message: msg,
        duration: 3500
      });
    }
  }

  /* ------------------------------------------------------------------------
     Delete Confirmation Modal
     ------------------------------------------------------------------------ */
  function createDeleteModal() {
    deleteModalEl = document.createElement('div');
    deleteModalEl.id = 'delete-profile-modal';
    deleteModalEl.className = 'modal-backdrop';
    deleteModalEl.innerHTML = `
      <div class="modal-dialog" data-focus-group="delete-modal">
        <div class="modal-title">${window.t('confirm_delete_title')}</div>
        <div class="modal-subtitle">${window.t('confirm_delete_desc')}</div>
        <div style="display: flex; justify-content: center; gap: 1.5vw; margin-top: 3vh;">
          <button type="button" class="btn-secondary focusable" id="delete-btn-cancel">${window.t('cancel')}</button>
          <button type="button" class="btn-primary btn-danger focusable" id="delete-btn-confirm">${window.t('delete')}</button>
        </div>
      </div>
    `;

    document.getElementById('app').appendChild(deleteModalEl);

    document.getElementById('delete-btn-cancel').addEventListener('click', closeDeleteModal);
    document.getElementById('delete-btn-confirm').addEventListener('click', async () => {
      closeDeleteModal();
      if (editingProfile) {
        await window.Profiles.deleteProfile(editingProfile.id);
        if (window.Notify) {
          window.Notify.show({
            type: 'info',
            title: 'Profile Deleted',
            message: `${editingProfile.name} removed.`,
            duration: 3000
          });
        }
        window.Router.navigate('profile_select');
      }
    });
  }

  function openDeleteModal() {
    if (!deleteModalEl) return;
    deleteModalEl.classList.add('active');
    if (window.Focus) {
      window.Focus.trapFocus(deleteModalEl);
    }
  }

  function closeDeleteModal() {
    if (!deleteModalEl) return;
    deleteModalEl.classList.remove('active');
    if (window.Focus) {
      window.Focus.releaseFocusTrap();
    }
  }

  function onBack() {
    if (deleteModalEl && deleteModalEl.classList.contains('active')) {
      closeDeleteModal();
      return true;
    }
    return false;
  }

  function onLeave() {
    if (deleteModalEl && deleteModalEl.parentNode) {
      deleteModalEl.parentNode.removeChild(deleteModalEl);
      deleteModalEl = null;
    }
  }

  function getDefaultFocus(container) {
    return container.querySelector('#field-name-btn');
  }

  return {
    onMount,
    onBack,
    onLeave,
    getDefaultFocus
  };
})();
