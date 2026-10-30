/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Theme Controller
 * Switches between Child, Adult, and Neutral themes.
 */

window.Theme = (function () {
  'use strict';

  let currentTheme = 'neutral';

  function setTheme(themeName) {
    if (!['neutral', 'child', 'adult'].includes(themeName)) {
      themeName = 'neutral';
    }

    currentTheme = themeName;
    const root = document.getElementById('app') || document.documentElement;
    root.setAttribute('data-theme', themeName);

    if (window.BgController) {
      window.BgController.setTheme(themeName);
    }

    // Refresh focus ring to pick up theme border-radius / glow styles
    if (window.Focus && window.Focus.getCurrent()) {
      window.Focus.updateFocusRing(window.Focus.getCurrent());
    }
  }

  function getTheme() {
    return currentTheme;
  }

  function applyProfileTheme(profile) {
    if (!profile) {
      setTheme('neutral');
      return;
    }
    const theme = profile.type === 'child' ? 'child' : 'adult';
    setTheme(theme);
  }

  return {
    setTheme,
    getTheme,
    applyProfileTheme
  };
})();
