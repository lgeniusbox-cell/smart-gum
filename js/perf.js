/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Performance Governor & Hardware Quality Manager
 * Monitors FPS and dynamically throttles effects for low-end Android TV hardware.
 */

window.Perf = (function () {
  'use strict';

  let currentQuality = window.CONFIG.PERF_GOVERNOR.DEFAULT_QUALITY || 'high';
  let frameCount = 0;
  let lastTime = performance.now();
  let currentFps = 60;
  let fpsHistory = [];
  let isGovernorActive = true;
  let governorSamples = 0;
  const maxSamples = window.CONFIG.PERF_GOVERNOR.SAMPLE_FRAMES || 120;
  const lowThreshold = window.CONFIG.PERF_GOVERNOR.LOW_FPS_THRESHOLD || 38;

  function update() {
    const now = performance.now();
    const delta = now - lastTime;
    frameCount++;

    if (delta >= 500) {
      currentFps = Math.round((frameCount * 1000) / delta);
      frameCount = 0;
      lastTime = now;

      if (isGovernorActive) {
        fpsHistory.push(currentFps);
        governorSamples++;

        if (governorSamples >= maxSamples / 2) {
          const avg = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
          console.log(`[Perf Governor] Evaluated initial average FPS: ${avg.toFixed(1)}`);
          if (avg < lowThreshold) {
            console.warn('[Perf Governor] Low performance detected! Auto-switching to Lite Mode.');
            setQuality('lite');
            if (window.Notify) {
              window.Notify.show({
                type: 'info',
                title: 'Performance Optimized',
                message: 'Lite visual mode enabled for smoother TV playback.',
                duration: 4000
              });
            }
          }
          isGovernorActive = false; // Governor initial phase completed
        }
      }
    }

    requestAnimationFrame(update);
  }

  function setQuality(mode) {
    if (!['high', 'medium', 'lite'].includes(mode)) return;
    currentQuality = mode;
    console.log(`[Perf] Quality mode set to: ${mode}`);

    const root = document.documentElement;
    if (mode === 'lite') {
      root.classList.add('lite-mode');
    } else {
      root.classList.remove('lite-mode');
    }

    if (window.BgController) {
      window.BgController.setQuality(mode);
    }
  }

  function getQuality() {
    return currentQuality;
  }

  function getFps() {
    return currentFps;
  }

  function start() {
    lastTime = performance.now();
    requestAnimationFrame(update);
  }

  return {
    start,
    setQuality,
    getQuality,
    getFps
  };
})();
