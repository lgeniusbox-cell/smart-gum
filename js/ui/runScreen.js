/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MatPad TV - Virtual Run (Treadmill) Screen with YouTube Integration
 * - Embedded hidden YouTube iframe driven by cross-origin injected script
 * - Video playback rate dynamically controlled by player's cadence
 * - ImageBitmap transfer over postMessage drawn to hardware-accelerated canvas
 * - Cadence speed model: EMA smoothing, idle pause, dead-zone filtering
 * - Debug HUD (Cadence, Rate, FPS) + Desktop Dev Mode Step Simulator
 */

window.RunScreen = (function () {
  'use strict';

  // Configurable Speed Model & Runtime Constants
  const DEFAULTS = {
    BASE_CADENCE_SPM: 120, // Steps per minute that equals normal speed (1.0x playbackRate)
    MIN_RATE: 0.25,        // Clamped minimum playback rate while moving
    MAX_RATE: 3.0,         // Clamped maximum playback rate at high cadence
    EMA_ALPHA: 0.25,       // Smoothing factor for exponential moving average
    RATE_DEAD_ZONE: 0.03,  // Minimum delta required to send new rate (avoids jitter)
    IDLE_MS: 2000,         // Inactivity threshold (ms): runner stopped -> send rate 0 (pause)
    MIN_STEP_GAP: 150,     // Debounce filter for mat bounce (ms)
    STEP_WINDOW_SIZE: 6,   // Rolling step window size used to compute cadence
    MAX_SPEED: 25,         // Sanity cap for speed in km/h
    HYDRATE_MS: 10000,     // Duration for hydration/breathing overlay (ms)
    ENABLE_FRAME_BUFFER: false, // Optional ring buffer for frames
    MAX_BUFFER_FRAMES: 60, // Maximum frames retained when ring buffer is active
    REF_SPEED: 8           // Reference km/h
  };

  const CFG = Object.assign({}, DEFAULTS, (window.CONFIG && window.CONFIG.RUN) || {});

  // Metabolic Equivalent of Task (MET) interpolation table [km/h, MET]
  const MET_TABLE = [
    [0, 1.5], [3, 2.5], [4.5, 3.5], [6, 5], [8, 8.3], [9.7, 9.8],
    [11, 11], [12.8, 12.8], [14.5, 14.8], [16, 16], [19, 19]
  ];

  const CANVAS_W = 1280;
  const CANVAS_H = 720;

  // Session state container
  let S = null;
  let R = {}; // Cached DOM element references
  let canvas = null;
  let ctx = null;
  let layerEl = null;
  let devPanelEl = null;
  let devToggleBtn = null;
  let rafId = null;
  let tickId = null;
  let confirmModal = null;
  let summaryModal = null;
  let keyHandler = null;
  let nativeHandler = null;
  let messageHandler = null;

  // Frame ring buffer (exposed when ENABLE_FRAME_BUFFER is true)
  const ringBuffer = [];

  const t = (k, v) => window.t(k, v);
  const clockText = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function getStepLength(p) {
    if (!p) return 0.72;
    const age = p.age || 30;
    if (age < 18) return Math.min(0.75, 0.2 + 0.035 * age);
    return p.sex === 'female' ? 0.68 : 0.76;
  }

  function met(v) {
    const T = MET_TABLE;
    if (v <= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) {
      if (v <= T[i][0]) {
        const a = T[i - 1];
        const b = T[i];
        return a[1] + ((b[1] - a[1]) * (v - a[0])) / (b[0] - a[0]);
      }
    }
    return T[T.length - 1][1];
  }

  function ageFactor(age) {
    if (age < 13) return 1.1;
    if (age > 60) return 0.95;
    return 1;
  }

  /* --------------------------------------------------------------------------
     YOUTUBE URL / ID PARSER
     Extracts 11-char video ID from youtu.be, watch?v=, shorts, embed, or bare ID
     -------------------------------------------------------------------------- */
  function extractVideoId(input) {
    if (!input) return '';
    const clean = String(input).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
    const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([a-zA-Z0-9_-]{11})/i);
    if (match && match[1]) return match[1];
    try {
      const url = new URL(clean);
      if (url.searchParams.has('v')) return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    } catch (e) {}
    return clean;
  }

  /* --------------------------------------------------------------------------
     FRAME BUFFER (Optional Ring Buffer)
     -------------------------------------------------------------------------- */
  function pushToFrameBuffer(bmp, mediaTime) {
    if (!CFG.ENABLE_FRAME_BUFFER) return;
    ringBuffer.push({ bmp, mediaTime });
    while (ringBuffer.length > CFG.MAX_BUFFER_FRAMES) {
      const evicted = ringBuffer.shift();
      if (evicted && evicted.bmp && typeof evicted.bmp.close === 'function') {
        try { evicted.bmp.close(); } catch (e) {}
      }
    }
  }

  function clearFrameBuffer() {
    ringBuffer.forEach(item => {
      if (item && item.bmp && typeof item.bmp.close === 'function') {
        try { item.bmp.close(); } catch (e) {}
      }
    });
    ringBuffer.length = 0;
  }

  /* --------------------------------------------------------------------------
     THROTTLED POSTMESSAGE TO YOUTUBE IFRAME
     Throttled to maximum ~5 messages per second (~200ms interval)
     -------------------------------------------------------------------------- */
  function sendRateToIframe(rate, force = false) {
    if (!S || !S.ytIframe || !S.ytIframe.contentWindow) return;

    const now = performance.now();
    const MIN_INTERVAL_MS = 200; // 5 calls/sec maximum

    const postNow = (targetRate) => {
      S.lastSentRate = targetRate;
      S.lastPostTime = performance.now();
      try {
        S.ytIframe.contentWindow.postMessage({ type: 'yt-config', rate: targetRate }, '*');
      } catch (err) {
        console.warn('[YT Run] postMessage to iframe failed:', err);
      }
    };

    if (force) {
      if (S.throttleTimer) {
        clearTimeout(S.throttleTimer);
        S.throttleTimer = null;
      }
      S.pendingRate = null;
      postNow(rate);
      return;
    }

    // Dead-zone filter: avoid jitter if rate difference is smaller than 0.03
    if (S.lastSentRate !== null && rate !== 0 && S.lastSentRate !== 0) {
      if (Math.abs(rate - S.lastSentRate) < CFG.RATE_DEAD_ZONE) {
        return;
      }
    }

    const elapsed = now - S.lastPostTime;
    if (elapsed >= MIN_INTERVAL_MS) {
      if (S.throttleTimer) {
        clearTimeout(S.throttleTimer);
        S.throttleTimer = null;
      }
      S.pendingRate = null;
      postNow(rate);
    } else {
      S.pendingRate = rate;
      if (!S.throttleTimer) {
        S.throttleTimer = setTimeout(() => {
          S.throttleTimer = null;
          if (S && S.pendingRate !== null) {
            const r = S.pendingRate;
            S.pendingRate = null;
            postNow(r);
          }
        }, MIN_INTERVAL_MS - elapsed);
      }
    }
  }

  /* --------------------------------------------------------------------------
     SPEED MODEL & STEP PROCESSOR
     Called for each step taken on the mat or simulated via dev tools
     -------------------------------------------------------------------------- */
  function onStep(optionalParam) {
    if (!S || S.finished) return;

    const nowPerf = performance.now();
    const nowReal = Date.now();

    // 1) Mat bounce filter: ignore events with gap < MIN_STEP_GAP (150ms)
    if (S.lastStepPerfAt && (nowPerf - S.lastStepPerfAt) < CFG.MIN_STEP_GAP) {
      return;
    }

    // 2) Idle state recovery: if paused/idle, resume smoothly
    const wasIdle = S.isIdle || (S.lastStepPerfAt > 0 && (nowPerf - S.lastStepPerfAt) > CFG.IDLE_MS);
    if (wasIdle) {
      S.isIdle = false;
      S.stepTimes = []; // Clear old window timestamps after stopping
      // Resume smoothly from rate ~1.0 or last active rate
      if (S.smoothedRate < CFG.MIN_RATE) {
        S.smoothedRate = 1.0;
      }
    }

    S.lastStepPerfAt = nowPerf;
    S.lastStepAt = nowReal;
    S.steps++;
    S.distance += S.stepLen;

    // 3) Rolling window of last ~6 step timestamps (using performance.now())
    S.stepTimes.push(nowPerf);
    if (S.stepTimes.length > CFG.STEP_WINDOW_SIZE) {
      S.stepTimes.shift();
    }

    // 4) Compute cadence (Steps Per Minute)
    if (S.stepTimes.length >= 2) {
      const spanMs = S.stepTimes[S.stepTimes.length - 1] - S.stepTimes[0];
      const intervals = S.stepTimes.length - 1;
      if (spanMs > 0 && intervals > 0) {
        const avgIntervalSec = (spanMs / intervals) / 1000;
        S.cadence = 60 / avgIntervalSec;
      }
    } else {
      // First step after resuming
      S.cadence = CFG.BASE_CADENCE_SPM;
    }

    // 5) Rate calculation: cadence / BASE_CADENCE_SPM
    const rawRate = S.cadence / CFG.BASE_CADENCE_SPM;
    const clampedRate = Math.min(CFG.MAX_RATE, Math.max(CFG.MIN_RATE, rawRate));

    // Exponential Moving Average (EMA) smoothing (alpha = 0.25)
    S.smoothedRate = (CFG.EMA_ALPHA * clampedRate) + ((1 - CFG.EMA_ALPHA) * S.smoothedRate);
    S.rate = S.smoothedRate;

    // 6) Align speed (km/h) for HUD stats: speed = (cadence * stepLen * 60) / 1000
    S.speedTarget = Math.min(CFG.MAX_SPEED, S.cadence * S.stepLen * 0.06);

    // 7) Dispatch updated playback rate to iframe
    sendRateToIframe(S.rate);

    renderStats();
  }

  /* --------------------------------------------------------------------------
     YOUTUBE IFRAME LIFECYCLE & VIDEO LOADING
     -------------------------------------------------------------------------- */
  function createHiddenIframe() {
    if (S.ytIframe) return;

    const iframe = document.createElement('iframe');
    iframe.id = 'yt-video-embed';
    // Rendered but invisible: opacity: 0, small size, pointer-events: none. NOT display: none
    iframe.style.position = 'fixed';
    iframe.style.top = '0px';
    iframe.style.left = '0px';
    iframe.style.width = '1920px';
    iframe.style.height = '1080px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-999';
    iframe.style.border = 'none';
    iframe.setAttribute('allow', 'autoplay; encrypted-media');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('aria-hidden', 'true');

    document.body.appendChild(iframe);
    S.ytIframe = iframe;
  }

  function startFallbackTimer() {
    if (S.loadTimeoutId) clearTimeout(S.loadTimeoutId);
    S.loadTimeoutId = setTimeout(() => {
      if (!S || S.firstFrameReceived) return;
      activateFallback('Video unavailable or embedding disabled');
    }, 5000);
  }

  function activateFallback(reason) {
    if (!S) return;
    S.fallbackActive = true;
    S.statusMsg = reason || 'Video unavailable or embedding disabled';
    updateStatus();
    if (window.Notify) {
      window.Notify.show({
        type: 'warning',
        title: 'Virtual Run Fallback',
        message: S.statusMsg,
        duration: 5000
      });
    }
  }

  function loadVideo(urlOrId) {
    const videoId = extractVideoId(urlOrId) || 'aZqQmzHLliQ';
    if (!S) return;

    S.currentVideoId = videoId;
    S.firstFrameReceived = false;
    S.fallbackActive = false;
    S.frameCount = 0;
    S.frameTimes = [];
    S.fps = 0;

    createHiddenIframe();
    startFallbackTimer();

    const origin = encodeURIComponent(window.location.origin);
    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${origin}`;
    S.ytIframe.src = embedUrl;

    if (R.dbgStatus) {
      R.dbgStatus.className = 'run-debug-status-tag run-status-loading';
      R.dbgStatus.textContent = 'CONNECTING';
    }
    updateStatus();
  }

  /* --------------------------------------------------------------------------
     CROSS-ORIGIN POSTMESSAGE PROTOCOL (Iframe <-> Page)
     Validates e.origin is https://www.youtube.com or https://www.youtube-nocookie.com
     -------------------------------------------------------------------------- */
  function onWindowMessage(e) {
    const isYtOrigin = e.origin === 'https://www.youtube.com' || e.origin === 'https://www.youtube-nocookie.com';
    const isDevOrigin = (isDevModeActive() && e.origin === window.location.origin);

    if (!isYtOrigin && !isDevOrigin) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (!S) return;

    switch (data.type) {
      case 'yt-ready': {
        S.ytReady = true;
        // On 'yt-ready', immediately send {type:'yt-config', rate:<current rate>, fps:15, width:480}
        const initialRate = S.isIdle ? 0 : (S.rate || 1.0);
        try {
          if (S.ytIframe && S.ytIframe.contentWindow) {
            S.ytIframe.contentWindow.postMessage({
              type: 'yt-config',
              rate: initialRate,
              fps: 15,
              width: 1080
            }, '*');
            S.lastSentRate = initialRate;
            S.lastPostTime = performance.now();
          }
        } catch (err) {}
        break;
      }

      case 'yt-frame': {
        if (S.loadTimeoutId) {
          clearTimeout(S.loadTimeoutId);
          S.loadTimeoutId = null;
        }
        S.firstFrameReceived = true;
        S.fallbackActive = false;

        // Rolling frames-per-second tracker
        const now = performance.now();
        S.frameTimes.push(now);
        while (S.frameTimes.length && S.frameTimes[0] < now - 1000) {
          S.frameTimes.shift();
        }
        S.fps = S.frameTimes.length;

        const bmp = data.bmp;
        if (bmp) {
          if (CFG.ENABLE_FRAME_BUFFER) {
            pushToFrameBuffer(bmp, data.t || 0);
          } else {
            // Memory hygiene: close the previous bitmap to prevent GPU RAM leaks
            if (S.currentBitmap && S.currentBitmap !== bmp) {
              try { S.currentBitmap.close(); } catch (err) {}
            }
          }
          S.currentBitmap = bmp;
          S.frameCount++;
          S.lastFrameAt = now;
        }
        break;
      }

      case 'yt-error': {
        console.warn('[YT Run] YouTube iframe error:', data.msg);
        if (!S.firstFrameReceived) {
          activateFallback(data.msg || 'Embedding disabled or video error');
        }
        break;
      }
    }
  }

  /* --------------------------------------------------------------------------
     FRAME RENDERING ON CANVAS
     -------------------------------------------------------------------------- */
  function drawCoverBitmap(bmp) {
    if (!bmp) return;
    const bw = bmp.width;
    const bh = bmp.height;
    if (!bw || !bh) return;
    const s = Math.max(CANVAS_W / bw, CANVAS_H / bh);
    const w = bw * s;
    const h = bh * s;
    ctx.drawImage(bmp, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
  }

  function drawLoadingPlaceholder() {
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#00e5ff';
    ctx.font = '800 28px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Loading video...', CANVAS_W / 2, CANVAS_H / 2 - 10);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '600 16px Outfit, sans-serif';
    ctx.fillText('Syncing runner footage with MatPad steps', CANVAS_W / 2, CANVAS_H / 2 + 28);
  }

  function drawDemo(dt) {
    S.demoOffset = (S.demoOffset + dt * (40 + S.rate * 700)) % 120;
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#0b1d3a');
    g.addColorStop(0.45, '#1c3f6e');
    g.addColorStop(0.46, '#10151f');
    g.addColorStop(1, '#05070c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = 'rgba(0, 229, 255, 0.55)';
    for (let i = 0; i < 8; i++) {
      const p = ((i * 120 + S.demoOffset) % 960) / 960;
      const y = CANVAS_H * 0.46 + p * p * CANVAS_H * 0.54;
      const w = 6 + p * p * 60;
      const h = 4 + p * p * 70;
      ctx.fillRect(CANVAS_W / 2 - w / 2, y, w, h);
    }

    if (S.fallbackActive) {
      ctx.fillStyle = 'rgba(255, 23, 68, 0.85)';
      ctx.font = '700 18px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`FALLBACK BACKGROUND: ${S.statusMsg}`, CANVAS_W / 2, 45);
    }
  }

  /* --------------------------------------------------------------------------
     MAIN ANIMATION & HUD LOOP (requestAnimationFrame)
     -------------------------------------------------------------------------- */
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!S) return;

    const dt = Math.min(0.1, Math.max(0, (ts - S.lastT) / 1000));
    S.lastT = ts;
    const nowPerf = performance.now();

    // 1) Idle detection: if no step arrives for IDLE_MS (2000ms), player stopped -> send rate 0
    const timeSinceStep = nowPerf - S.lastStepPerfAt;
    if (S.lastStepPerfAt > 0 && timeSinceStep > CFG.IDLE_MS) {
      if (!S.isIdle) {
        S.isIdle = true;
        S.cadence = 0;
        S.speedTarget = 0;
        sendRateToIframe(0, true); // Send rate 0 (pause video) immediately
      }
    }

    // 2) Smooth runner speed interpolation for statistics
    const targetSpeed = S.isIdle ? 0 : S.speedTarget;
    S.speed += (targetSpeed - S.speed) * Math.min(1, dt * 3.2);
    if (targetSpeed === 0 && S.speed < 0.25) S.speed = 0;

    // Check personal record
    if (S.speed > S.maxSpeed) {
      S.maxSpeed = S.speed;
      if (S.lastBest > 0 && !S.recordShown && S.maxSpeed > S.lastBest + 0.05) {
        S.recordShown = true;
        if (window.Notify) {
          window.Notify.show({
            type: 'success',
            title: t('run_new_record'),
            message: S.maxSpeed.toFixed(1) + ' km/h',
            duration: 3500
          });
        }
      }
    }

    // Accumulate workout session time and calories
    if (!S.finished) {
      S.videoTime += dt * (S.isIdle ? 0 : S.rate);
      if (S.speed >= 1.5) {
        S.kcal += met(S.speed) * 3.5 * S.weight / 200 * (dt / 60) * S.ageFactor;
      }
      if (S.videoTime >= S.total) finishRun();
    }

    // 3) Draw canvas background
    if (S.currentBitmap && !S.fallbackActive) {
      drawCoverBitmap(S.currentBitmap);
    } else if (S.fallbackActive) {
      drawDemo(dt);
    } else {
      drawLoadingPlaceholder();
    }
  }

  /* --------------------------------------------------------------------------
     STATS & DEBUG HUD RENDERING
     -------------------------------------------------------------------------- */
  function renderStats() {
    if (!S || !R.speed) return;
    R.speed.textContent = S.speed.toFixed(1);
    R.speedSub.textContent = `${t('run_max')} ${S.maxSpeed.toFixed(1)} · ${t('run_last_best')} ${S.lastBest ? S.lastBest.toFixed(1) : '--'}`;
    R.cadence.textContent = Math.round(S.cadence);
    R.steps.textContent = S.steps;
    R.distance.textContent = (S.distance / 1000).toFixed(2);
    R.kcal.textContent = Math.round(S.kcal);
    R.time.textContent = fmt((Date.now() - S.startAt) / 1000);
    R.progress.style.transform = `scaleX(${Math.min(1, S.videoTime / S.total)})`;
  }

  function renderDebugHud() {
    if (!S || !R.dbgCadence) return;
    R.dbgCadence.textContent = Math.round(S.cadence);
    R.dbgRate.textContent = (S.isIdle ? 0 : S.rate).toFixed(2);
    R.dbgFps.textContent = S.fps.toFixed(1);

    if (R.dbgStatus) {
      if (S.fallbackActive) {
        R.dbgStatus.className = 'run-debug-status-tag run-status-fallback';
        R.dbgStatus.textContent = 'FALLBACK';
      } else if (!S.firstFrameReceived) {
        R.dbgStatus.className = 'run-debug-status-tag run-status-loading';
        R.dbgStatus.textContent = 'BUFFERING';
      } else if (S.isIdle) {
        R.dbgStatus.className = 'run-debug-status-tag run-status-idle';
        R.dbgStatus.textContent = 'IDLE (PAUSED)';
      } else {
        R.dbgStatus.className = 'run-debug-status-tag run-status-streaming';
        R.dbgStatus.textContent = 'STREAMING';
      }
    }
  }

  function updateStatus() {
    if (!R.status || !S) return;
    const waiting = !S.firstFrameReceived && !S.fallbackActive;
    const msg = S.statusMsg || (waiting ? t('run_buffering') : '');
    if (msg !== S.statusShown) {
      S.statusShown = msg;
      R.status.textContent = msg;
      R.status.style.opacity = msg ? '1' : '0';
    }
  }

  function tick() {
    if (!S) return;
    renderStats();
    renderDebugHud();

    const c = clockText(new Date());
    if (R.clock && R.clock.textContent !== c) R.clock.textContent = c;

    if (S.firstFrameReceived && S.statusMsg && !S.errorShown) {
      S.statusMsg = '';
    }
    updateStatus();

    S.tickCount++;
    if (S.tickCount % 2 === 0 && window.Bridge && window.Bridge.isAvailable()) {
      window.Bridge.onRunBuffer({
        size: S.frameCount,
        max: CFG.MAX_BUFFER_FRAMES,
        rate: +(S.isIdle ? 0 : S.rate).toFixed(2),
        fps: S.fps,
        speed: +S.speed.toFixed(1)
      });
    }
  }

  /* --------------------------------------------------------------------------
     DEV MODE: STEP SIMULATOR & MOCK VIDEO STREAM (when ?dev=1 or desktop)
     -------------------------------------------------------------------------- */
  function isDevModeActive() {
    return (typeof window.Android === 'undefined') ||
      new URLSearchParams(window.location.search).has('dev') ||
      window.location.search.includes('dev=1');
  }

  let simIntervalId = null;
  let mockStreamIntervalId = null;
  let mockOffscreenCanvas = null;
  let mockOffscreenCtx = null;
  let mockStreamAngle = 0;

  function stopStepSimulation() {
    if (simIntervalId) {
      clearInterval(simIntervalId);
      simIntervalId = null;
    }
    if (R.devBtnWalk) R.devBtnWalk.classList.remove('active');
    if (R.devBtnJog) R.devBtnJog.classList.remove('active');
    if (R.devBtnSprint) R.devBtnSprint.classList.remove('active');
  }

  function startStepSimulation(spm, activeBtn) {
    stopStepSimulation();
    if (activeBtn) activeBtn.classList.add('active');
    const intervalMs = Math.round(60000 / spm);
    onStep(); // immediate step
    simIntervalId = setInterval(() => {
      onStep();
    }, intervalMs);
  }

  // Desktop standalone test feed (generates and transfers ImageBitmaps via postMessage)
  function toggleMockVideoStream() {
    if (mockStreamIntervalId) {
      clearInterval(mockStreamIntervalId);
      mockStreamIntervalId = null;
      if (R.devBtnMockFeed) {
        R.devBtnMockFeed.classList.remove('active');
        R.devBtnMockFeed.textContent = 'Mock Stream: OFF';
      }
      return;
    }

    if (!mockOffscreenCanvas) {
      mockOffscreenCanvas = document.createElement('canvas');
      mockOffscreenCanvas.width = 480;
      mockOffscreenCanvas.height = 270;
      mockOffscreenCtx = mockOffscreenCanvas.getContext('2d');
    }

    if (R.devBtnMockFeed) {
      R.devBtnMockFeed.classList.add('active');
      R.devBtnMockFeed.textContent = 'Mock Stream: ON';
    }

    mockStreamIntervalId = setInterval(async () => {
      if (!S || S.finished) return;
      const rate = S.isIdle ? 0 : S.rate;
      mockStreamAngle += 0.05 * (rate || 0.1);

      // Render colorful simulated trail footage on offscreen canvas
      const w = 480;
      const h = 270;
      const g = mockOffscreenCtx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#00172d');
      g.addColorStop(0.5, '#0b3c5d');
      g.addColorStop(1, '#1d2731');
      mockOffscreenCtx.fillStyle = g;
      mockOffscreenCtx.fillRect(0, 0, w, h);

      // Procedural road perspective lines
      mockOffscreenCtx.strokeStyle = '#00e5ff';
      mockOffscreenCtx.lineWidth = 3;
      mockOffscreenCtx.beginPath();
      mockOffscreenCtx.moveTo(w / 2, h * 0.45);
      mockOffscreenCtx.lineTo(w * 0.1, h);
      mockOffscreenCtx.moveTo(w / 2, h * 0.45);
      mockOffscreenCtx.lineTo(w * 0.9, h);
      mockOffscreenCtx.stroke();

      // Moving road dashes
      const dashY = ((mockStreamAngle * 120) % (h * 0.55)) + (h * 0.45);
      mockOffscreenCtx.fillStyle = '#ffffff';
      mockOffscreenCtx.fillRect(w / 2 - 4, dashY, 8, 22);

      // Watermark
      mockOffscreenCtx.fillStyle = '#00e5ff';
      mockOffscreenCtx.font = '700 14px monospace';
      mockOffscreenCtx.fillText(`[MOCK YT STREAM] SPEED: ${rate.toFixed(2)}x`, 16, 28);

      try {
        const bmp = await createImageBitmap(mockOffscreenCanvas);
        // Post frame to messageHandler matching the exact injected script contract
        window.postMessage({
          type: 'yt-frame',
          bmp,
          t: performance.now() / 1000,
          w,
          h
        }, window.location.origin, [bmp]);
      } catch (err) {}
    }, 1000 / 15);
  }

  function setupDevPanel(container) {
    if (!isDevModeActive()) return;

    devToggleBtn = document.createElement('button');
    devToggleBtn.type = 'button';
    devToggleBtn.className = 'run-dev-toggle-btn focusable';
    devToggleBtn.textContent = 'DEV TOOLS';
    container.appendChild(devToggleBtn);

    devPanelEl = document.createElement('div');
    devPanelEl.className = 'run-dev-panel';
    devPanelEl.innerHTML = `
      <div class="run-dev-row">
        <span class="run-dev-badge">DEV MODE</span>
        <button type="button" class="run-dev-btn focusable" id="dev-btn-step">+1 Step (S)</button>
        <button type="button" class="run-dev-btn focusable" id="dev-btn-walk">Walk 85 SPM (W)</button>
        <button type="button" class="run-dev-btn focusable" id="dev-btn-jog">Jog 135 SPM (J)</button>
        <button type="button" class="run-dev-btn focusable" id="dev-btn-sprint">Sprint 180 SPM (R)</button>
        <button type="button" class="run-dev-btn run-dev-btn-danger focusable" id="dev-btn-stop">Stop (X)</button>
      </div>
      <div class="run-dev-row">
        <div class="run-dev-input-group">
          <input type="text" class="run-dev-input focusable" id="dev-yt-input" placeholder="YouTube URL or Video ID" />
          <button type="button" class="run-dev-btn focusable" id="dev-btn-load-yt">Load Video</button>
        </div>
        <button type="button" class="run-dev-btn focusable" id="dev-btn-mock-feed">Mock Stream: OFF</button>
        <button type="button" class="run-dev-btn focusable" id="dev-btn-cap-frame">Save Frame PNG</button>
      </div>
    `;
    container.appendChild(devPanelEl);

    R.devBtnWalk = devPanelEl.querySelector('#dev-btn-walk');
    R.devBtnJog = devPanelEl.querySelector('#dev-btn-jog');
    R.devBtnSprint = devPanelEl.querySelector('#dev-btn-sprint');
    R.devBtnStop = devPanelEl.querySelector('#dev-btn-stop');
    R.devBtnStep = devPanelEl.querySelector('#dev-btn-step');
    R.devBtnMockFeed = devPanelEl.querySelector('#dev-btn-mock-feed');
    const inputYt = devPanelEl.querySelector('#dev-yt-input');
    const loadYtBtn = devPanelEl.querySelector('#dev-btn-load-yt');
    const capFrameBtn = devPanelEl.querySelector('#dev-btn-cap-frame');

    if (inputYt && S.item) {
      inputYt.value = S.item.url || S.item.videoId || 'aZqQmzHLliQ';
    }

    devToggleBtn.addEventListener('click', () => {
      devPanelEl.style.display = devPanelEl.style.display === 'none' ? 'flex' : 'none';
    });

    R.devBtnStep.addEventListener('click', () => onStep());
    R.devBtnWalk.addEventListener('click', () => startStepSimulation(85, R.devBtnWalk));
    R.devBtnJog.addEventListener('click', () => startStepSimulation(135, R.devBtnJog));
    R.devBtnSprint.addEventListener('click', () => startStepSimulation(180, R.devBtnSprint));
    R.devBtnStop.addEventListener('click', () => {
      stopStepSimulation();
      if (S) {
        S.isIdle = true;
        S.cadence = 0;
        S.speedTarget = 0;
        sendRateToIframe(0, true);
        renderStats();
        renderDebugHud();
      }
    });

    loadYtBtn.addEventListener('click', () => {
      const val = inputYt.value.trim();
      if (val) loadVideo(val);
    });

    R.devBtnMockFeed.addEventListener('click', toggleMockVideoStream);
    capFrameBtn.addEventListener('click', () => window.downloadCurrentFrame('run-frame-capture.png'));
  }

  /* --------------------------------------------------------------------------
     MODALS & DIALOGS
     -------------------------------------------------------------------------- */
  function makeModal(id, inner) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'modal-backdrop';
    el.innerHTML = `<div class="modal-dialog" data-focus-group="${id}">${inner}</div>`;
    document.getElementById('app').appendChild(el);
    return el;
  }

  function openModal(el) {
    el.classList.add('active');
    if (window.Focus) window.Focus.trapFocus(el);
  }

  function closeModal(el) {
    el.classList.remove('active');
    if (window.Focus) window.Focus.releaseFocusTrap();
  }

  function exitRun() {
    S.allowExit = true;
    window.Router.handleBack();
  }

  function buildSummary() {
    const sec = (Date.now() - S.startAt) / 1000;
    R.sumBody.innerHTML = `
      <div class="run-sum-grid">
        <div><span>${t('run_time')}</span><b>${fmt(sec)}</b></div>
        <div><span>${t('run_distance')}</span><b>${(S.distance / 1000).toFixed(2)} km</b></div>
        <div><span>${t('run_steps')}</span><b>${S.steps}</b></div>
        <div><span>${t('run_calories')}</span><b>${Math.round(S.kcal)} kcal</b></div>
        <div><span>${t('run_max')}</span><b>${S.maxSpeed.toFixed(1)} km/h</b></div>
      </div>`;
  }

  function finishRun() {
    if (!S || S.finished) return;
    S.finished = true;
    stopStepSimulation();
    if (mockStreamIntervalId) {
      clearInterval(mockStreamIntervalId);
      mockStreamIntervalId = null;
    }
    sendRateToIframe(0, true);
    finalize();
    buildSummary();
    openModal(summaryModal);
  }

  function finalize() {
    if (!S || S.saved) return;
    S.saved = true;
    const summary = {
      profileId: S.profileId,
      title: S.item.title,
      maxSpeed: +S.maxSpeed.toFixed(2),
      distance: Math.round(S.distance),
      steps: S.steps,
      kcal: Math.round(S.kcal),
      durationMs: Date.now() - S.startAt,
      endedAt: Date.now()
    };
    if (S.steps > 0) window.Storage.set(`run_last_${S.profileId}`, summary);
    if (window.Bridge && window.Bridge.onRunStopped) {
      window.Bridge.onRunStopped(summary);
    }
  }

  function onHydrate() {
    if (!R.hydrate || !S) return;
    R.hydrate.classList.add('show');
    clearTimeout(S.hydrateTimer);
    S.hydrateTimer = setTimeout(() => R.hydrate && R.hydrate.classList.remove('show'), CFG.HYDRATE_MS);
  }

  /* --------------------------------------------------------------------------
     SCREEN LIFECYCLE (onMount, onBack, onLeave)
     -------------------------------------------------------------------------- */
  async function onMount(container, params = {}) {
    const item = params.item || { title: 'Virtual Run', duration: 1800, url: 'https://youtu.be/aZqQmzHLliQ' };
    const profile = (window.Profiles && window.Profiles.getActiveProfile()) ||
      (window.Profiles && window.Profiles.getAll()[0]) || null;
    if (profile && window.Theme) window.Theme.applyProfileTheme(profile);

    const profileId = profile ? profile.id : 'guest';
    const last = await window.Storage.get(`run_last_${profileId}`);
    const total = (item.trim && item.trim.end > item.trim.start)
      ? item.trim.end - item.trim.start
      : (item.duration || 1800);
    const nowReal = Date.now();
    const nowPerf = performance.now();

    S = {
      item,
      profileId,
      total,
      weight: (profile && profile.weight) || 60,
      ageFactor: ageFactor((profile && profile.age) || 30),
      stepLen: getStepLength(profile),
      startAt: nowReal,
      steps: 0,
      distance: 0,
      kcal: 0,
      speed: 0,
      speedTarget: 0,
      maxSpeed: 0,
      cadence: 0,
      lastBest: last && last.maxSpeed ? last.maxSpeed : 0,
      recordShown: false,
      lastStepAt: 0,
      lastStepPerfAt: 0,
      stepTimes: [],
      isIdle: false,
      rate: 1.0,
      smoothedRate: 1.0,
      lastSentRate: null,
      lastPostTime: 0,
      pendingRate: null,
      throttleTimer: null,
      videoTime: 0,
      currentBitmap: null,
      frameCount: 0,
      frameTimes: [],
      fps: 0,
      ytIframe: null,
      ytReady: false,
      currentVideoId: '',
      firstFrameReceived: false,
      fallbackActive: false,
      loadTimeoutId: null,
      demoOffset: 0,
      statusMsg: '',
      statusShown: null,
      errorShown: false,
      lastT: nowPerf,
      tickCount: 0,
      finished: false,
      saved: false,
      allowExit: false,
      hydrateTimer: null
    };

    container.innerHTML = `
      <div class="run-top">
        <div class="run-title-block">
          <button type="button" class="back-btn focusable" id="run-end-btn" tabindex="0">
            ${window.Utils.getIcon('arrowLeft')}<span>${t('run_end')}</span>
          </button>
          <div>
            <div class="run-title">${window.Utils.escapeHTML(item.title || '')}</div>
            ${item.place ? `<span class="badge badge-child">${window.Utils.escapeHTML(item.place)}</span>` : ''}
          </div>
        </div>

        <!-- Debug HUD: Cadence, Rate, Frames/sec -->
        <div class="run-debug-hud" id="run-debug-hud">
          <div class="run-debug-pill">
            <span class="run-debug-lbl">CADENCE:</span>
            <span class="run-debug-val" id="rs-dbg-cadence">0</span>
            <span class="run-debug-lbl">SPM</span>
          </div>
          <div class="run-debug-divider"></div>
          <div class="run-debug-pill run-debug-pill-highlight">
            <span class="run-debug-lbl">RATE:</span>
            <span class="run-debug-val" id="rs-dbg-rate">1.00</span>
            <span class="run-debug-lbl">x</span>
          </div>
          <div class="run-debug-divider"></div>
          <div class="run-debug-pill">
            <span class="run-debug-lbl">STREAM:</span>
            <span class="run-debug-val" id="rs-dbg-fps">0.0</span>
            <span class="run-debug-lbl">FPS</span>
          </div>
          <div class="run-debug-divider"></div>
          <span class="run-debug-status-tag run-status-loading" id="rs-dbg-status">STANDBY</span>
        </div>

        <div class="run-clock" id="run-clock">${clockText(new Date())}</div>
      </div>

      <div class="run-status" id="run-status"></div>

      <div class="run-hydrate" id="run-hydrate">
        <div class="run-breath"></div>
        <div>
          <div class="run-hydrate-title">${t('run_hydrate_title')}</div>
          <div class="run-hydrate-desc">${t('run_hydrate_desc')}</div>
        </div>
      </div>

      <div class="run-board">
        <div class="run-stats">
          <div class="run-tile run-tile-hero">
            <div class="run-tile-label">${t('run_speed')}</div>
            <div class="run-tile-value"><span id="rs-speed">0.0</span><span class="run-tile-unit">km/h</span></div>
            <div class="run-tile-sub" id="rs-speed-sub"></div>
          </div>
          <div class="run-tile">
            <div class="run-tile-label">${t('run_cadence')}</div>
            <div class="run-tile-value"><span id="rs-cadence">0</span><span class="run-tile-unit">spm</span></div>
          </div>
          <div class="run-tile">
            <div class="run-tile-label">${t('run_steps')}</div>
            <div class="run-tile-value" id="rs-steps">0</div>
          </div>
          <div class="run-tile">
            <div class="run-tile-label">${t('run_distance')}</div>
            <div class="run-tile-value"><span id="rs-distance">0.00</span><span class="run-tile-unit">km</span></div>
          </div>
          <div class="run-tile">
            <div class="run-tile-label">${t('run_calories')}</div>
            <div class="run-tile-value"><span id="rs-kcal">0</span><span class="run-tile-unit">kcal</span></div>
          </div>
          <div class="run-tile">
            <div class="run-tile-label">${t('run_time')}</div>
            <div class="run-tile-value" id="rs-time">00:00</div>
            <div class="run-tile-sub">${t('run_total')} ${fmt(total)} · ${t('run_started')} ${clockText(new Date(nowReal))}</div>
          </div>
        </div>
        <div class="run-progress"><div class="run-progress-fill" id="rs-progress"></div></div>
      </div>
    `;

    R = {
      speed: container.querySelector('#rs-speed'),
      speedSub: container.querySelector('#rs-speed-sub'),
      cadence: container.querySelector('#rs-cadence'),
      steps: container.querySelector('#rs-steps'),
      distance: container.querySelector('#rs-distance'),
      kcal: container.querySelector('#rs-kcal'),
      time: container.querySelector('#rs-time'),
      progress: container.querySelector('#rs-progress'),
      clock: container.querySelector('#run-clock'),
      hydrate: container.querySelector('#run-hydrate'),
      status: container.querySelector('#run-status'),
      dbgCadence: container.querySelector('#rs-dbg-cadence'),
      dbgRate: container.querySelector('#rs-dbg-rate'),
      dbgFps: container.querySelector('#rs-dbg-fps'),
      dbgStatus: container.querySelector('#rs-dbg-status')
    };

    container.querySelector('#run-end-btn').addEventListener('click', () => openModal(confirmModal));

    // Hardware accelerated video canvas layer
    layerEl = document.createElement('div');
    layerEl.id = 'run-video-layer';
    canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    layerEl.appendChild(canvas);
    document.getElementById('app').appendChild(layerEl);
    document.getElementById('app').classList.add('run-mode');

ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Setup dev panel if running on desktop or with ?dev=1
    setupDevPanel(container);

    confirmModal = makeModal('run-confirm-modal', `
      <div class="modal-title">${t('run_end_title')}</div>
      <div class="modal-subtitle">${t('run_end_desc')}</div>
      <div style="display:flex;justify-content:center;gap:1.5vw;margin-top:3vh;">
        <button type="button" class="btn-secondary focusable" id="run-keep-btn">${t('run_continue')}</button>
        <button type="button" class="btn-primary btn-danger focusable" id="run-quit-btn">${t('run_end')}</button>
      </div>`);
    confirmModal.querySelector('#run-keep-btn').addEventListener('click', () => closeModal(confirmModal));
    confirmModal.querySelector('#run-quit-btn').addEventListener('click', () => { closeModal(confirmModal); exitRun(); });

    summaryModal = makeModal('run-summary-modal', `
      <div class="modal-title">${t('run_summary_title')}</div>
      <div id="run-sum-body"></div>
      <div style="display:flex;justify-content:center;margin-top:3vh;">
        <button type="button" class="btn-primary focusable" id="run-sum-btn">${t('run_back')}</button>
      </div>`);
    R.sumBody = summaryModal.querySelector('#run-sum-body');
    summaryModal.querySelector('#run-sum-btn').addEventListener('click', () => { closeModal(summaryModal); exitRun(); });

    // Listen for postMessage from the YouTube iframe
    messageHandler = onWindowMessage;
    window.addEventListener('message', messageHandler);

    // Listen for Android native bridge events
    nativeHandler = (e) => {
      const d = e.detail || {};
      const p = d.payload || {};
      if (!S) return;
      switch (d.type) {
        case 'hydrate': case 'run_hydrate': case 'breath':
          onHydrate(); break;
        case 'run_step':
          onStep(p.ts); break;
        case 'run_loading':
          S.errorShown = false;
          S.statusMsg = t('run_buffering') + (p.percent ? ' ' + Math.round(p.percent) + '%' : '');
          updateStatus(); break;
        case 'run_error':
          S.errorShown = true;
          S.statusMsg = p.message || 'Error';
          updateStatus(); break;
        case 'run_ended':
          finishRun(); break;
      }
    };
    window.addEventListener('matpad:nativeEvent', nativeHandler);

    // Keyboard shortcuts for rapid testing and TV navigation
    keyHandler = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 's') {
        onStep();
      } else if (k === 'w') {
        startStepSimulation(85, R.devBtnWalk);
      } else if (k === 'j') {
        startStepSimulation(135, R.devBtnJog);
      } else if (k === 'r') {
        startStepSimulation(180, R.devBtnSprint);
      } else if (k === 'x' || k === ' ') {
        stopStepSimulation();
        if (S) {
          S.isIdle = true;
          S.cadence = 0;
          S.speedTarget = 0;
          sendRateToIframe(0, true);
        }
      } else if (k === 'd') {
        if (devPanelEl) {
          devPanelEl.style.display = devPanelEl.style.display === 'none' ? 'flex' : 'none';
        }
      }
    };
    window.addEventListener('keydown', keyHandler);

    // Load video designated by current trail item
    const videoTarget = item.url || item.videoId || 'aZqQmzHLliQ';
    loadVideo(videoTarget);

    renderStats();
    renderDebugHud();
    tickId = setInterval(tick, 250);
    S.lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function onBack() {
    if (!S || S.allowExit) return false;
    if (summaryModal && summaryModal.classList.contains('active')) {
      closeModal(summaryModal);
      exitRun();
      return true;
    }
    if (confirmModal && confirmModal.classList.contains('active')) {
      closeModal(confirmModal);
      return true;
    }
    openModal(confirmModal);
    return true;
  }

  function onLeave() {
    finalize();
    stopStepSimulation();

    if (mockStreamIntervalId) {
      clearInterval(mockStreamIntervalId);
      mockStreamIntervalId = null;
    }

    if (rafId) cancelAnimationFrame(rafId);
    if (tickId) clearInterval(tickId);
    rafId = tickId = null;

    if (S) {
      clearTimeout(S.hydrateTimer);
      clearTimeout(S.loadTimeoutId);
      clearTimeout(S.throttleTimer);

      if (S.currentBitmap && typeof S.currentBitmap.close === 'function') {
        try { S.currentBitmap.close(); } catch (e) {}
        S.currentBitmap = null;
      }

      // Teardown YouTube iframe
      if (S.ytIframe) {
        try {
          S.ytIframe.src = 'about:blank';
          if (S.ytIframe.parentNode) {
            S.ytIframe.parentNode.removeChild(S.ytIframe);
          }
        } catch (e) {}
        S.ytIframe = null;
      }
    }

    clearFrameBuffer();

    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    if (nativeHandler) window.removeEventListener('matpad:nativeEvent', nativeHandler);
    if (messageHandler) window.removeEventListener('message', messageHandler);

    [layerEl, devPanelEl, devToggleBtn, confirmModal, summaryModal].forEach(el => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    const app = document.getElementById('app');
    if (app) app.classList.remove('run-mode');

    layerEl = devPanelEl = devToggleBtn = confirmModal = summaryModal = canvas = ctx = null;
    R = {};
    S = null;
  }

  function getDefaultFocus(container) {
    return container.querySelector('#run-end-btn');
  }

  /* --------------------------------------------------------------------------
     GLOBAL CONTRACTS & HOOKS
     Preserve and wrap window.onStep for Android evaluateJavascript calls
     -------------------------------------------------------------------------- */
  const existingOnStep = window.onStep;
  window.onStep = function (optionalArg) {
    if (typeof existingOnStep === 'function') {
      try { existingOnStep(optionalArg); } catch (e) {}
    }
    onStep(optionalArg);
  };

  // Expose Frame Buffer inspection and PNG capture
  window.getBufferedFrames = function () {
    return ringBuffer;
  };

  window.downloadCurrentFrame = function (filename = 'matpad-run-frame.png') {
    if (!canvas) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (a.parentNode) a.parentNode.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      }, 'image/png');
    } catch (e) {
      console.warn('[YT Run] downloadCurrentFrame failed:', e);
    }
  };

  // Maintain backward compatibility for Java bridge
  window.MatPadRun = {
    onStep: window.onStep,
    onHydrate,
    loadVideo,
    getBufferSize: () => (S && S.frameCount) || 0
  };

  return { onMount, onBack, onLeave, getDefaultFocus, loadVideo };
})();
