/**
 * YouTube iframe injected script v2 (document-start, YouTube origins only)
 *
 * Stage 1: video starts normally, our opaque canvas covers the page.
 * Stage 2: once frames are being drawn, hide the <video> + YouTube UI
 *          (hidden=true + CSS) to avoid TV buffering problems.
 * Diagnostics are sent to the main page as { type:'yt-log', msg }.
 *
 * main -> iframe: yt-config {rate, fps, hide} | yt-snapshot
 * iframe -> main: yt-ready | yt-first-frame | yt-stats | yt-buffering
 *                 | yt-error | yt-log | yt-snapshot-result
 */
(function () {
  if (window === window.top) return;
  if (window.__ytInjCanvas) return;
  window.__ytInjCanvas = true;

  var TAG = '[YT-INJ canvas]';
  var W = 1280, H = 720;
  var HIDE_AFTER_FRAMES = 5;
  var cfg = { fps: 30, rate: 1, hide: true };
  var video = null, canvas = null, ctx = null, hideStyle = null;
  var lastDraw = 0, lastTime = -1, drawn = 0, fpsCount = 0, fpsStart = performance.now();
  var firstFrameSent = false, hidden = false, attachTimer = null, lastKick = 0;
  var nativePlay = HTMLMediaElement.prototype.play;

  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }
  function log(m) {
    console.log(TAG, m);
    post({ type: 'yt-log', msg: String(m) });
  }

  window.addEventListener('error', function (e) { log('JS error: ' + e.message); });

  // ---------------------------------------------------------------------
  // DOM setup (waits for <html> if the script runs very early)
  // ---------------------------------------------------------------------
  function setupDom() {
    if (canvas) return true;
    var root = document.documentElement;
    if (!root) return false;

    var st = document.createElement('style');
    st.textContent =
      'html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}' +
      '#yt-canvas{position:fixed!important;top:0!important;left:0!important;' +
      'width:100vw!important;height:100vh!important;display:block!important;' +
      'z-index:2147483647!important;pointer-events:none!important;background:#000!important}';
    root.appendChild(st);

    canvas = document.createElement('canvas');
    canvas.id = 'yt-canvas';
    canvas.width = W;
    canvas.height = H;
    root.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    log('dom ready');
    return true;
  }

  // Stage 2: hide video + YouTube UI
  function hideEverything() {
    if (hidden || !cfg.hide || !video) return;
    hidden = true;
    hideStyle = document.createElement('style');
    hideStyle.textContent =
      'body{display:none!important}' +
      'video{display:none!important;visibility:hidden!important}';
    document.documentElement.appendChild(hideStyle);
    video.hidden = true;
    video.style.setProperty('display', 'none', 'important');
    video.style.setProperty('visibility', 'hidden', 'important');
    log('video + UI hidden');
    setTimeout(applyRate, 300); // make sure it still plays
  }

  function showEverything() {
    if (!hidden) return;
    hidden = false;
    if (hideStyle && hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle);
    if (video) {
      video.hidden = false;
      video.style.removeProperty('display');
      video.style.removeProperty('visibility');
    }
  }

  // ---------------------------------------------------------------------
  // Rate control (rate <= 0 = pause)
  // ---------------------------------------------------------------------
  function applyRate() {
    if (!video) return;
    if (cfg.rate <= 0) {
      if (!video.paused) video.pause();
      return;
    }
    video.muted = true;
    if (video.paused && !video.ended) {
      var p = nativePlay.call(video);
      if (p && p.catch) p.catch(function (err) { log('play() rejected: ' + err); });
    }
    if (Math.abs(video.playbackRate - cfg.rate) > 0.01) video.playbackRate = cfg.rate;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'yt-config') {
      if (d.fps) cfg.fps = d.fps;
      if (typeof d.rate === 'number') cfg.rate = d.rate;
      if (typeof d.hide === 'boolean') {
        cfg.hide = d.hide;
        if (!cfg.hide) showEverything();
      }
      applyRate();
    } else if (d.type === 'yt-snapshot') {
      var url = null;
      try { url = canvas.toDataURL('image/png'); } catch (err) { log('snapshot failed: ' + err); }
      post({ type: 'yt-snapshot-result', dataUrl: url });
    }
  });

  // ---------------------------------------------------------------------
  // Draw loop
  // ---------------------------------------------------------------------
  function drawCover() {
    var bw = video.videoWidth, bh = video.videoHeight;
    if (!bw || !bh) return false;
    var s = Math.max(W / bw, H / bh);
    var w = bw * s, h = bh * s;
    ctx.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
    return true;
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!setupDom()) return;
    if (!canvas.isConnected) document.documentElement.appendChild(canvas);
    if (!video) return;

    // Not playing although it should? kick it (max once per second)
    if (cfg.rate > 0 && video.paused && !video.ended && now - lastKick > 1000) {
      lastKick = now;
      applyRate();
      var btn = document.querySelector('.ytp-large-play-button');
      if (btn) { try { btn.click(); } catch (e) {} }
    }

    if (video.readyState < 2) return;
    if (now - lastDraw < 1000 / cfg.fps) return;
    if (video.currentTime === lastTime) return;
    if (!drawCover()) return;

    lastDraw = now;
    lastTime = video.currentTime;
    drawn++;
    fpsCount++;

    if (!firstFrameSent) {
      firstFrameSent = true;
      log('first frame drawn ' + video.videoWidth + 'x' + video.videoHeight);
      post({ type: 'yt-first-frame' });
    }
    if (drawn === HIDE_AFTER_FRAMES) hideEverything();

    if (now - fpsStart >= 1000) {
      post({
        type: 'yt-stats',
        fps: fpsCount,
        t: video.currentTime,
        buffering: video.readyState < 3 && !video.paused,
        rate: video.playbackRate
      });
      fpsCount = 0;
      fpsStart = now;
    }
  }

  // ---------------------------------------------------------------------
  // Attach to <video>
  // ---------------------------------------------------------------------
  function attach(v) {
    if (video === v) return;
    video = v;
    lastTime = -1;
    v.muted = true;
    log('video element found');

    ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'stalled', 'emptied'].forEach(function (ev) {
      v.addEventListener(ev, function () {
        log('event ' + ev + ' rs=' + v.readyState + ' paused=' + v.paused);
      });
    });
    v.addEventListener('error', function () {
      var c = v.error ? v.error.code : '?';
      log('video error code ' + c);
      post({ type: 'yt-error', msg: 'video error ' + c });
    });
    v.addEventListener('ratechange', applyRate);
    v.addEventListener('pause', function () { if (cfg.rate > 0 && !v.ended) setTimeout(applyRate, 50); });
    v.addEventListener('loadeddata', function () { lastTime = -1; });
    v.addEventListener('seeked', function () { lastTime = -1; });
    v.addEventListener('waiting', function () { post({ type: 'yt-buffering', value: true }); });
    v.addEventListener('playing', function () { post({ type: 'yt-buffering', value: false }); });

    post({ type: 'yt-ready' });
  }

  function findVideo() {
    var v = document.querySelector('video');
    if (v) attach(v);
  }

  setupDom();
  requestAnimationFrame(loop);
  findVideo();

  new MutationObserver(function () {
    if (attachTimer) return;
    attachTimer = setTimeout(function () { attachTimer = null; setupDom(); findVideo(); }, 300);
  }).observe(document, { childList: true, subtree: true });

  // Heartbeat for the first 20 s: shows exactly where it is stuck
  var beats = 0;
  var hb = setInterval(function () {
    beats++;
    if (beats > 20 || firstFrameSent) { clearInterval(hb); return; }
    log('hb ' + beats + ' video=' + !!video +
        (video ? ' rs=' + video.readyState + ' paused=' + video.paused +
                 ' w=' + video.videoWidth + ' t=' + video.currentTime.toFixed(1) : '') +
        ' | ' + location.href.slice(0, 60));
  }, 1000);

  log('loaded');
})();
