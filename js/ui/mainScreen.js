/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Main Dashboard Screen View
 * Top bar with live clock, profile switcher, and 4 distinctive activity portals.
 */

window.MainScreen = (function () {
  'use strict';

  let clockInterval = null;

  async function onMount(container) {
    const profile = window.Profiles.getActiveProfile() || (window.Profiles.getAll()[0] || null);
    if (profile) {
      window.Theme.applyProfileTheme(profile);
    }

    container.innerHTML = `
      <!-- Top Navigation Bar -->
      <div class="top-bar">
        <div class="top-bar-left">
          <div class="brand-logo-wrap">
            <img src="assets/logo.png" alt="MatPad" class="brand-logo" onerror="this.style.display='none'; document.getElementById('dash-logo-fallback').style.display='block';" />
            <div id="dash-logo-fallback" class="brand-logo-fallback" style="display: none;">MATPAD</div>
          </div>
        </div>

        <div class="top-bar-right">
          <div id="clock-widget" class="clock-display">12:00</div>

          <!-- Focusable Spotify Music Button -->
          <button type="button" class="icon-btn focusable dash-spotify-btn" id="dash-spotify-btn" tabindex="0" title="Spotify" aria-label="Spotify">
            ${window.Utils.getIcon('spotify')}
          </button>
          
          <!-- Focusable Profile Pill to Switch Profiles -->
          <button type="button" class="profile-chip-btn focusable" id="dash-profile-btn" tabindex="0" title="Switch Profile">
            <img src="${profile ? profile.avatar : ''}" alt="${profile ? window.Utils.escapeHTML(profile.name) : 'User'}" class="profile-chip-avatar" onerror="this.src='${window.Utils.generateFallbackAvatarSvg(profile ? profile.name : 'M', false, 0)}'" />
            <span class="profile-chip-name">${profile ? window.Utils.escapeHTML(profile.name) : 'Player'}</span>
          </button>

          <!-- Focusable Settings Button -->
          <button type="button" class="icon-btn focusable" id="dash-settings-btn" tabindex="0" title="${window.t('hint_settings')}">
            ${window.Utils.getIcon('settings')}
          </button>
        </div>
      </div>

      <!-- 4 Distinctive Activity Cards Grid -->
      <div class="main-dashboard-grid" data-focus-group="dashboard-cards">
        <!-- 1. Games (Featured Hero Card - Row Span 2) -->
        <div class="dash-card dash-card-featured focusable anim-stagger-1" id="dash-card-games" tabindex="0">
          <img src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80" alt="Games" class="dash-card-bg-art" onerror="this.style.display='none';" />
          <div class="dash-card-overlay"></div>
          <div class="dash-card-content">
            <div class="dash-card-icon">${window.Utils.getIcon('games')}</div>
            <div class="dash-card-title">${window.t('games')}</div>
            <div class="dash-card-subtitle">${window.t('games_subtitle')}</div>
          </div>
        </div>

        <!-- 2. Virtual Run (Active) -->
        <div class="dash-card focusable anim-stagger-2" id="dash-card-run" tabindex="0">
          <img src="https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=700&q=80" alt="Virtual Run" class="dash-card-bg-art" onerror="this.style.display='none';" />
          <div class="dash-card-overlay"></div>
          <div class="dash-card-content">
            <div class="dash-card-icon" style="color: #00e5ff;">${window.Utils.getIcon('run')}</div>
            <div class="dash-card-title">${window.t('virtual_run')}</div>
            <div class="dash-card-subtitle">${window.t('virtual_run_subtitle')}</div>
          </div>
        </div>

        <!-- 3. Relax (Coming Soon) -->
        <div class="dash-card dash-card-locked focusable anim-stagger-3" id="dash-card-relax" tabindex="0">
          <span class="badge badge-soon dash-card-lock-badge">${window.t('coming_soon')}</span>
          <img src="https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=700&q=80" alt="Relax" class="dash-card-bg-art" onerror="this.style.display='none';" />
          <div class="dash-card-overlay"></div>
          <div class="dash-card-content">
            <div class="dash-card-icon" style="color: #a3e635;">${window.Utils.getIcon('relax')}</div>
            <div class="dash-card-title">${window.t('relax')}</div>
            <div class="dash-card-subtitle">${window.t('relax_subtitle')}</div>
          </div>
        </div>

        <!-- 4. Cardio Session (Coming Soon) -->
        <div class="dash-card dash-card-locked focusable anim-stagger-4" id="dash-card-cardio" style="grid-column: span 2;" tabindex="0">
          <span class="badge badge-soon dash-card-lock-badge">${window.t('coming_soon')}</span>
          <img src="https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=900&q=80" alt="Cardio" class="dash-card-bg-art" onerror="this.style.display='none';" />
          <div class="dash-card-overlay"></div>
          <div class="dash-card-content">
            <div class="dash-card-icon" style="color: #ff3366;">${window.Utils.getIcon('cardio')}</div>
            <div class="dash-card-title">${window.t('cardio')}</div>
            <div class="dash-card-subtitle">${window.t('cardio_subtitle')}</div>
          </div>
        </div>
      </div>
    `;

    setupDashboardEvents(container);
    startClock();
  }

  function setupDashboardEvents(container) {
    // Spotify Button -> Open Spotify Overlay
    const spotifyBtn = container.querySelector('#dash-spotify-btn');
    if (spotifyBtn) {
      spotifyBtn.addEventListener('click', () => {
        if (window.SpotifyOverlay && typeof window.SpotifyOverlay.open === 'function') {
          window.SpotifyOverlay.open();
        } else {
          console.warn('[Main] SpotifyOverlay not available');
        }
      });
    }

    // Switch Profile button
    const profileBtn = container.querySelector('#dash-profile-btn');
    if (profileBtn) {
      profileBtn.addEventListener('click', () => {
        window.Router.navigate('profile_select');
      });
    }

    // Settings Button -> Coming Soon Toast
    const settingsBtn = container.querySelector('#dash-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        showComingSoonToast(window.t('hint_settings'));
      });
    }

    // Games Card -> Navigate to Games Category
    const gamesCard = container.querySelector('#dash-card-games');
    if (gamesCard) {
      gamesCard.addEventListener('click', () => {
        window.Router.navigate('category', { category: 'games' });
      });
    }

    // Virtual Run Card -> Navigate to Virtual Run Category
    const runCard = container.querySelector('#dash-card-run');
    if (runCard) {
      runCard.addEventListener('click', () => {
        window.Router.navigate('category', { category: 'virtual_run' });
      });
    }

    // Relax Card -> Coming Soon
    const relaxCard = container.querySelector('#dash-card-relax');
    if (relaxCard) {
      relaxCard.addEventListener('click', () => {
        showComingSoonToast(window.t('relax'));
      });
    }

    // Cardio Card -> Coming Soon
    const cardioCard = container.querySelector('#dash-card-cardio');
    if (cardioCard) {
      cardioCard.addEventListener('click', () => {
        showComingSoonToast(window.t('cardio'));
      });
    }
  }

  function showComingSoonToast(featureTitle) {
    if (window.Notify) {
      window.Notify.show({
        type: 'soon',
        title: featureTitle,
        message: window.t('coming_soon_desc'),
        duration: 3500
      });
    }
  }

  function startClock() {
    updateClock();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(updateClock, 30000); // Check every 30s
  }

  function updateClock() {
    const el = document.getElementById('clock-widget');
    if (!el) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.textContent = timeStr;
  }

  function onLeave() {
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  }

  function getDefaultFocus(container) {
    return container.querySelector('#dash-card-games');
  }

  return {
    onMount,
    onLeave,
    getDefaultFocus
  };
})();
