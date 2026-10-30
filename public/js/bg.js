/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Background Controller
 * OffscreenCanvas Web Worker with Blob fallback and Main-Thread / CSS fallbacks.
 */

window.BgController = (function () {
  'use strict';

  let worker = null;
  let canvas = null;
  let isOffscreen = false;
  let mainCtx = null;
  let mainAnimId = null;
  let isPaused = false;
  let currentTheme = 'neutral';
  let currentQuality = 'high';
  let currentScreen = 'boot';

  // Inline worker code string for Blob URL fallback when running from file:// in Android WebView
  const WORKER_CODE_STRING = `
    let canvas = null, ctx = null, width = 0, height = 0, animationFrameId = null, isPaused = false;
    let quality = 'high', theme = 'neutral', screen = 'boot', particles = [], gradients = [];
    const PALETTES = {
      neutral: { bg: '#07090e', accent1: 'rgba(0, 229, 255, 0.12)', accent2: 'rgba(163, 230, 53, 0.08)', particleColor: 'rgba(0, 229, 255, 0.45)', particleGlow: 'rgba(0, 229, 255, 0.2)' },
      child: { bg: '#090e1f', accent1: 'rgba(0, 240, 255, 0.16)', accent2: 'rgba(255, 234, 0, 0.14)', particleColor: 'rgba(255, 234, 0, 0.55)', particleGlow: 'rgba(0, 240, 255, 0.3)' },
      adult: { bg: '#04060a', accent1: 'rgba(0, 210, 255, 0.14)', accent2: 'rgba(166, 255, 0, 0.09)', particleColor: 'rgba(0, 229, 255, 0.4)', particleGlow: 'rgba(166, 255, 0, 0.18)' }
    };
    function initParticles() {
      particles = []; gradients = [];
      if (quality === 'lite') return;
      const count = quality === 'high' ? 36 : 16;
      const isChild = theme === 'child';
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width, y: Math.random() * height,
          radius: isChild ? (Math.random() * 5 + 3) : (Math.random() * 3 + 1.5),
          vx: (Math.random() - 0.5) * (isChild ? 0.7 : 0.4),
          vy: (Math.random() - 0.5) * (isChild ? 0.7 : 0.4),
          layer: Math.floor(Math.random() * 3) + 1,
          alpha: Math.random() * 0.6 + 0.2,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.02 + Math.random() * 0.02
        });
      }
      gradients.push(
        { x: width * 0.25, y: height * 0.3, radius: width * 0.35, vx: 0.15, vy: 0.1, colorIndex: 1 },
        { x: width * 0.75, y: height * 0.7, radius: width * 0.4, vx: -0.12, vy: -0.08, colorIndex: 2 }
      );
    }
    function render() {
      if (isPaused || !ctx || width === 0 || height === 0) return;
      const pal = PALETTES[theme] || PALETTES.neutral;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);
      if (quality !== 'lite') {
        for (let i = 0; i < gradients.length; i++) {
          const g = gradients[i];
          g.x += g.vx; g.y += g.vy;
          if (g.x < 0 || g.x > width) g.vx *= -1;
          if (g.y < 0 || g.y > height) g.vy *= -1;
          const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
          grad.addColorStop(0, g.colorIndex === 1 ? pal.accent1 : pal.accent2);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, width, height);
        }
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.x += p.vx * p.layer; p.y += p.vy * p.layer; p.pulse += p.pulseSpeed;
          if (p.x < -20) p.x = width + 20; else if (p.x > width + 20) p.x = -20;
          if (p.y < -20) p.y = height + 20; else if (p.y > height + 20) p.y = -20;
          const dynamicAlpha = Math.max(0.1, p.alpha + Math.sin(p.pulse) * 0.2);
          ctx.save();
          ctx.globalAlpha = dynamicAlpha;
          ctx.fillStyle = pal.particleColor;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
          if (p.layer === 3 && quality === 'high') {
            ctx.fillStyle = pal.particleGlow;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
      const vig = ctx.createRadialGradient(width/2, height/2, Math.min(width, height)*0.45, width/2, height/2, Math.max(width, height)*0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
      animationFrameId = requestAnimationFrame(render);
    }
    self.onmessage = function (e) {
      const data = e.data;
      if (!data) return;
      if (data.type === 'INIT') {
        canvas = data.canvas;
        ctx = canvas.getContext('2d', { alpha: false });
        width = data.width || 1920; height = data.height || 1080;
        quality = data.quality || 'high'; theme = data.theme || 'neutral';
        initParticles(); render();
      } else if (data.type === 'RESIZE') {
        width = data.width; height = data.height;
        if (canvas) { canvas.width = width; canvas.height = height; }
        initParticles();
      } else if (data.type === 'SET_THEME') {
        theme = data.theme || 'neutral'; initParticles();
      } else if (data.type === 'SET_QUALITY') {
        quality = data.quality || 'high'; initParticles();
      } else if (data.type === 'PAUSE') {
        isPaused = true;
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
      } else if (data.type === 'RESUME') {
        if (isPaused) { isPaused = false; render(); }
      }
    };
  `;

  function createWorker() {
    // 1. Try standard worker file path
    try {
      return new Worker('./workers/bg-worker.js');
    } catch (e1) {
      console.warn('[BgController] File worker failed, trying Blob URL fallback for WebView file:// compatibility...');
      // 2. Fallback to Blob URL
      try {
        const blob = new Blob([WORKER_CODE_STRING], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        return new Worker(blobUrl);
      } catch (e2) {
        console.warn('[BgController] Web Workers completely unsupported or blocked in this environment.');
        return null;
      }
    }
  }

  function init() {
    canvas = document.getElementById('bg-canvas');
    if (!canvas) return;

    const width = window.innerWidth || 1920;
    const height = window.innerHeight || 1080;
    canvas.width = width;
    canvas.height = height;

    // Feature detect OffscreenCanvas + transferControlToOffscreen
    const supportsOffscreen = 'OffscreenCanvas' in window && typeof canvas.transferControlToOffscreen === 'function';

    if (supportsOffscreen) {
      try {
        worker = createWorker();
        if (worker) {
          const offscreen = canvas.transferControlToOffscreen();
          worker.postMessage({
            type: 'INIT',
            canvas: offscreen,
            width: width,
            height: height,
            theme: currentTheme,
            quality: currentQuality,
            screen: currentScreen
          }, [offscreen]);

          worker.onerror = function (err) {
            console.error('[BgController] Worker error:', err);
          };

          isOffscreen = true;
          console.log('[BgController] Running off-thread via OffscreenCanvas worker.');
          setupResizeListener();
          return;
        }
      } catch (e) {
        console.warn('[BgController] Offscreen transfer failed, falling back to main-thread canvas.', e);
      }
    }

    // Fallback: Lightweight main-thread canvas
    initMainThreadCanvas();
    setupResizeListener();
  }

  function initMainThreadCanvas() {
    try {
      mainCtx = canvas.getContext('2d', { alpha: false });
      renderMainThread();
      console.log('[BgController] Running on main-thread canvas fallback.');
    } catch (err) {
      console.warn('[BgController] Canvas 2d failed, using pure CSS background fallback.');
    }
  }

  function renderMainThread() {
    if (isPaused || !mainCtx) return;
    const w = canvas.width;
    const h = canvas.height;

    // Static gradient paint on main thread to keep UI fast
    mainCtx.fillStyle = currentTheme === 'child' ? '#090e1f' : (currentTheme === 'adult' ? '#04060a' : '#07090e');
    mainCtx.fillRect(0, 0, w, h);

    if (currentQuality !== 'lite') {
      const grad = mainCtx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.3, h * 0.4, w * 0.45);
      grad.addColorStop(0, currentTheme === 'child' ? 'rgba(0, 240, 255, 0.15)' : 'rgba(0, 229, 255, 0.12)');
      grad.addColorStop(1, 'transparent');
      mainCtx.fillStyle = grad;
      mainCtx.fillRect(0, 0, w, h);
    }
  }

  function setupResizeListener() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (isOffscreen && worker) {
        worker.postMessage({ type: 'RESIZE', width: w, height: h });
      } else if (canvas) {
        canvas.width = w;
        canvas.height = h;
        renderMainThread();
      }
    });
  }

  function setTheme(theme) {
    currentTheme = theme;
    if (isOffscreen && worker) {
      worker.postMessage({ type: 'SET_THEME', theme: theme });
    } else {
      renderMainThread();
    }
  }

  function setQuality(quality) {
    currentQuality = quality;
    if (isOffscreen && worker) {
      worker.postMessage({ type: 'SET_QUALITY', quality: quality });
    } else {
      renderMainThread();
    }
  }

  function setScreen(screen) {
    currentScreen = screen;
    if (isOffscreen && worker) {
      worker.postMessage({ type: 'SET_SCREEN', screen: screen });
    }
  }

  function pause() {
    isPaused = true;
    if (isOffscreen && worker) {
      worker.postMessage({ type: 'PAUSE' });
    }
  }

  function resume() {
    if (isPaused) {
      isPaused = false;
      if (isOffscreen && worker) {
        worker.postMessage({ type: 'RESUME' });
      } else {
        renderMainThread();
      }
    }
  }

  return {
    init,
    setTheme,
    setQuality,
    setScreen,
    pause,
    resume
  };
})();
