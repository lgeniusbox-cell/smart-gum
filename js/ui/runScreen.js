/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MatPad TV - Virtual Run (Treadmill) Screen
 * Step-driven stats, canvas video playback paced by running speed,
 * hydration alerts, session history.
 */

window.RunScreen = (function () {
  'use strict';

  const DEFAULTS = {
    MIN_RATE: 0.06,      // playback rate when the player stands still (very slow)
    MAX_RATE: 1.8,       // playback rate cap
    REF_SPEED: 8,        // km/h at which the video plays at normal speed (rate 1.0)
    SRC_FPS: 30,         // fps of the frames sent by Java (override with setFrameInfo)
    MAX_QUEUE: 90,       // max frames buffered in JS
    MIN_STEP_GAP: 150,   // ms, ignore faster events (mat bounce)
    IDLE_RESET: 3000,    // ms without step => considered stopped
    SPEED_WINDOW: 4,     // steps used to average the speed
    MAX_SPEED: 25,       // km/h sanity cap
    HYDRATE_MS: 10000
  };
  const CFG = Object.assign({}, DEFAULTS, (window.CONFIG && window.CONFIG.RUN) || {});

  // [km/h, MET] - interpolated
  const MET_TABLE = [[0, 1.5], [3, 2.5], [4.5, 3.5], [6, 5], [8, 8.3], [9.7, 9.8],
                     [11, 11], [12.8, 12.8], [14.5, 14.8], [16, 16], [19, 19]];

  const CANVAS_W = 1280, CANVAS_H = 720;

  let S = null;            // session state (null when screen is not mounted)
  let R = {};              // cached DOM refs
  let canvas = null, ctx = null, layerEl = null;
  let rafId = null, tickId = null;
  let confirmModal = null, summaryModal = null;
  let keyHandler = null, nativeHandler = null;

  const t = (k, v) => window.t(k, v);
  const clockText = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  /* ----------------------------------------------------------------------
     Physiology helpers
     ---------------------------------------------------------------------- */
  function getStepLength(p) {
    if (!p) return 0.7;
    const age = p.age || 30;
    if (age < 18) return Math.min(0.75, 0.2 + 0.035 * age);   // metres per step
    return p.sex === 'female' ? 0.68 : 0.76;
  }

  function met(v) {
    const T = MET_TABLE;
    if (v <= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) {
      if (v <= T[i][0]) {
        const [x0, y0] = T[i - 1], [x1, y1] = T[i];
        return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
      }
    }
    return T[T.length - 1][1];
  }

  function ageFactor(age) {
    if (age < 13) return 1.1;
    if (age > 60) return 0.95;
    return 1;
  }

  /* ----------------------------------------------------------------------
     INPUT FROM JAVA
     ---------------------------------------------------------------------- */

  // Called by Java for every step on the mat. ts = epoch ms (optional).
  function onStep(ts) {
    if (!S || S.finished) return;
    const nowReal = Date.now();
    const v = Number(ts);
    const now = (v && Math.abs(v - nowReal) < 5000) ? v : nowReal;

    const gap = now - S.lastStepAt;
    if (S.lastStepAt && gap < CFG.MIN_STEP_GAP) return;          // bounce
    if (S.lastStepAt && gap > CFG.IDLE_RESET) S.win = [];         // restarted after a stop

    S.win.push(now);
    if (S.win.length > CFG.SPEED_WINDOW) S.win.shift();
    S.lastStepAt = now;
    S.steps++;
    S.distance += S.stepLen;

    if (S.win.length >= 2) {
      const span = (S.win[S.win.length - 1] - S.win[0]) / 1000;
      S.stepInterval = span / (S.win.length - 1);
      S.cadence = 60 / S.stepInterval;
      S.speedTarget = Math.min(CFG.MAX_SPEED, (S.stepLen / S.stepInterval) * 3.6);
    }
    renderStats();
  }

  // Called by Java with one video frame:
  //  - base64 JPEG/WebP string (no prefix), or
  //  - a data:/https:/blob: URL
  // Returns false if the buffer is full (Java should wait).
  function onFrame(data) {
    if (!S || !data) return false;
    if (S.queue.length >= CFG.MAX_QUEUE) return false;
    S.queue.push(data);
    S.lastFrameAt = Date.now();
    pump();
    return true;
  }

  function setFrameInfo(info) {
    if (S && info && info.fps > 0) S.srcFps = info.fps;
  }

  function onHydrate() {
    if (!R.hydrate) return;
    R.hydrate.classList.add('show');
    clearTimeout(S && S.hydrateTimer);
    if (S) S.hydrateTimer = setTimeout(() => R.hydrate && R.hydrate.classList.remove('show'), CFG.HYDRATE_MS);
  }

  function getBufferSize() {
    return S ? S.queue.length + S.ready.length : 0;
  }

  /* ----------------------------------------------------------------------
     FRAME PIPELINE (small decode-ahead so the main thread never blocks)
     ---------------------------------------------------------------------- */
  function pump() {
    while (S.ready.length < 3 && S.queue.length) {
      const data = S.queue.shift();
      const img = new Image();
      const entry = { img, ok: false, bad: false };
      img.decoding = 'async';
      img.src = /^(data:|https?:|blob:|file:)/.test(data) ? data : 'data:image/jpeg;base64,' + data;
      img.decode().then(() => { entry.ok = true; }).catch(() => { entry.bad = true; });
      S.ready.push(entry);
    }
  }

  function drawCover(img) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;
    const s = Math.max(CANVAS_W / iw, CANVAS_H / ih);
    const w = iw * s, h = ih * s;
    ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
  }

  // Procedural road, only used in a desktop browser without Java (for testing)
  function drawDemo(dt) {
    S.demoOffset = (S.demoOffset + dt * (40 + S.rate * 700)) % 120;
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#0b1d3a'); g.addColorStop(0.45, '#1c3f6e'); g.addColorStop(0.46, '#10151f'); g.addColorStop(1, '#05070c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(0,229,255,0.5)';
    for (let i = 0; i < 8; i++) {
      const p = ((i * 120 + S.demoOffset) % 960) / 960;      // 0 = horizon, 1 = near
      const y = CANVAS_H * 0.46 + p * p * CANVAS_H * 0.54;
      const w = 6 + p * p * 60, h = 4 + p * p * 70;
      ctx.fillRect(CANVAS_W / 2 - w / 2, y, w, h);
    }
  }

  /* ----------------------------------------------------------------------
     MAIN LOOP
     ---------------------------------------------------------------------- */
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!S) return;
    const dt = Math.min(0.1, Math.max(0, (ts - S.lastT) / 1000));
    S.lastT = ts;
    const now = Date.now();

    // 1) speed: smooth, and decays on its own when steps stop arriving
    let target = S.speedTarget;
    const since = now - S.lastStepAt;
    if (!S.lastStepAt || since > CFG.IDLE_RESET) {
      target = 0;
    } else if (since > Math.max(1200, S.stepInterval * 1000 * 1.6)) {
      target = Math.min(target, (S.stepLen / (since / 1000)) * 3.6);
    }
    S.speed += (target - S.speed) * Math.min(1, dt * 3);
    if (target === 0 && S.speed < 0.3) S.speed = 0;

    if (S.speed > S.maxSpeed) {
      S.maxSpeed = S.speed;
      if (S.lastBest > 0 && !S.recordShown && S.maxSpeed > S.lastBest + 0.05) {
        S.recordShown = true;
        if (window.Notify) window.Notify.show({ type: 'success', title: t('run_new_record'), message: S.maxSpeed.toFixed(1) + ' km/h', duration: 3500 });
      }
    }

    // 2) video rate follows speed (never 0: slow motion when standing still)
    const targetRate = Math.min(CFG.MAX_RATE, CFG.MIN_RATE + (1 - CFG.MIN_RATE) * (S.speed / CFG.REF_SPEED));
    S.rate += (targetRate - S.rate) * Math.min(1, dt * 2.5);

    if (!S.finished) {
      S.videoTime += dt * S.rate;
      if (S.speed >= 1.5) {
        // kcal/min = MET * 3.5 * weight(kg) / 200
        S.kcal += met(S.speed) * 3.5 * S.weight / 200 * (dt / 60) * S.ageFactor;
      }
      if (S.videoTime >= S.total) finishRun();
    }

    // 3) draw frames at (srcFps * rate)
    pump();
    S.acc += dt * S.rate * S.srcFps;
    let frame = null;
    while (S.acc >= 1) {
      while (S.ready.length && S.ready[0].bad) S.ready.shift();
      const e = S.ready[0];
      if (!e || !e.ok) { S.acc = Math.min(S.acc, 1); break; }   // wait for decode / data
      frame = S.ready.shift().img;
      S.acc -= 1;
    }
    if (frame) {
      drawCover(frame);
      S.frameCount++;
    } else if (S.frameCount === 0 && !window.Bridge.isAvailable()) {
      drawDemo(dt);
    }

    if (R.status) {
      const waiting = S.frameCount === 0 && window.Bridge.isAvailable();
      if (waiting !== S.waiting) {
        S.waiting = waiting;
        R.status.style.opacity = waiting ? '1' : '0';
      }
    }
  }

  /* ----------------------------------------------------------------------
     UI
     ---------------------------------------------------------------------- */
  function renderStats() {
    if (!S || !R.speed) return;
    R.speed.textContent = S.speed.toFixed(1);
    R.speedSub.textContent = `${t('run_max')} ${S.maxSpeed.toFixed(1)} · ${t('run_last_best')} ${S.lastBest ? S.lastBest.toFixed(1) : '--'}`;
    R.cadence.textContent = S.speed > 0 ? Math.round(S.cadence) : 0;
    R.steps.textContent = S.steps;
    R.distance.textContent = (S.distance / 1000).toFixed(2);
    R.kcal.textContent = Math.round(S.kcal);
    R.time.textContent = fmt((Date.now() - S.startAt) / 1000);
    R.progress.style.transform = `scaleX(${Math.min(1, S.videoTime / S.total)})`;
  }

  function tick() {
    if (!S) return;
    renderStats();
    const c = clockText(new Date());
    if (R.clock && R.clock.textContent !== c) R.clock.textContent = c;

    S.tickCount++;
    if (S.tickCount % 2 === 0 && window.Bridge.isAvailable()) {
      window.Bridge.onRunBuffer({
        size: getBufferSize(), max: CFG.MAX_QUEUE,
        rate: +S.rate.toFixed(2), fps: S.srcFps, speed: +S.speed.toFixed(1)
      });
    }
  }

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
    window.Bridge.onRunStopped(summary);
  }

  /* ----------------------------------------------------------------------
     Lifecycle
     ---------------------------------------------------------------------- */
  async function onMount(container, params = {}) {
    const item = params.item || { title: 'Virtual Run', duration: 1800 };
    const profile = window.Profiles.getActiveProfile() || (window.Profiles.getAll()[0] || null);
    if (profile) window.Theme.applyProfileTheme(profile);

    const profileId = profile ? profile.id : 'guest';
    const last = await window.Storage.get(`run_last_${profileId}`);
    const total = (item.trim && item.trim.end > item.trim.start)
      ? item.trim.end - item.trim.start
      : (item.duration || 1800);
    const now = Date.now();

    S = {
      item, profileId, total,
      weight: (profile && profile.weight) || 60,
      ageFactor: ageFactor((profile && profile.age) || 30),
      stepLen: getStepLength(profile),
      startAt: now,
      steps: 0, distance: 0, kcal: 0,
      speed: 0, speedTarget: 0, maxSpeed: 0, cadence: 0, stepInterval: 1,
      lastBest: last && last.maxSpeed ? last.maxSpeed : 0, recordShown: false,
      lastStepAt: 0, win: [],
      rate: CFG.MIN_RATE, videoTime: 0, acc: 0, srcFps: item.fps || CFG.SRC_FPS,
      queue: [], ready: [], frameCount: 0, lastFrameAt: 0, waiting: false, demoOffset: 0,
      lastT: performance.now(), tickCount: 0,
      finished: false, saved: false, allowExit: false, hydrateTimer: null
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
        <div class="run-clock" id="run-clock">${clockText(new Date())}</div>
      </div>

      <div class="run-status" id="run-status">${t('run_buffering')}</div>

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
            <div class="run-tile-sub">${t('run_total')} ${fmt(total)} · ${t('run_started')} ${clockText(new Date(now))}</div>
          </div>
        </div>
        <div class="run-progress"><div class="run-progress-fill" id="rs-progress"></div></div>
      </div>
    `;

    R = {
      speed: container.querySelector('#rs-speed'), speedSub: container.querySelector('#rs-speed-sub'),
      cadence: container.querySelector('#rs-cadence'), steps: container.querySelector('#rs-steps'),
      distance: container.querySelector('#rs-distance'), kcal: container.querySelector('#rs-kcal'),
      time: container.querySelector('#rs-time'), progress: container.querySelector('#rs-progress'),
      clock: container.querySelector('#run-clock'), hydrate: container.querySelector('#run-hydrate'),
      status: container.querySelector('#run-status')
    };

    container.querySelector('#run-end-btn').addEventListener('click', () => openModal(confirmModal));

    // Video layer lives under the screen (the screen has safe-area margins, the video must be full-bleed)
    layerEl = document.createElement('div');
    layerEl.id = 'run-video-layer';
    canvas = document.createElement('canvas');
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    layerEl.appendChild(canvas);
    document.getElementById('app').appendChild(layerEl);
    document.getElementById('app').classList.add('run-mode');
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

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

    // Events from Java (hydrate / optional step through the generic channel)
    nativeHandler = (e) => {
      const d = e.detail || {};
      if (d.type === 'hydrate' || d.type === 'run_hydrate' || d.type === 'breath') onHydrate();
      else if (d.type === 'run_step') onStep(d.payload && d.payload.ts);
    };
    window.addEventListener('matpad:nativeEvent', nativeHandler);

    // Desktop testing: tap "S" about 3 times per second
    keyHandler = (e) => {
      if ((e.key === 's' || e.key === 'S') && !window.Bridge.isAvailable()) onStep();
    };
    window.addEventListener('keydown', keyHandler);

    renderStats();
    tickId = setInterval(tick, 250);
    S.lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function onBack() {
    if (!S || S.allowExit) return false;
    if (summaryModal && summaryModal.classList.contains('active')) { closeModal(summaryModal); exitRun(); return true; }
    if (confirmModal && confirmModal.classList.contains('active')) { closeModal(confirmModal); return true; }
    openModal(confirmModal);
    return true;
  }

  function onLeave() {
    finalize();
    if (rafId) cancelAnimationFrame(rafId);
    if (tickId) clearInterval(tickId);
    rafId = tickId = null;
    if (S) clearTimeout(S.hydrateTimer);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    if (nativeHandler) window.removeEventListener('matpad:nativeEvent', nativeHandler);
    [layerEl, confirmModal, summaryModal].forEach(el => el && el.parentNode && el.parentNode.removeChild(el));
    const app = document.getElementById('app');
    if (app) app.classList.remove('run-mode');
    layerEl = confirmModal = summaryModal = canvas = ctx = null;
    R = {};
    S = null;
  }

  function getDefaultFocus(container) {
    return container.querySelector('#run-end-btn');
  }

  // Public API for Java: webView.evaluateJavascript("MatPadRun.onStep()", null)
  window.MatPadRun = { onStep, onFrame, setFrameInfo, onHydrate, getBufferSize };

  return { onMount, onBack, onLeave, getDefaultFocus };
})();
