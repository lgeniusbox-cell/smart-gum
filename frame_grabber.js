/**
 * YouTube iframe injected script (document-start, YouTube origins only)
 *
 * - Hides the whole YouTube UI and the <video> element (hidden=true + CSS),
 *   which avoids the buffering problems some TVs have with a visible video.
 * - Draws the video on its OWN <canvas> inside the iframe: ctx.drawImage(video, ...)
 *   The iframe itself is the visible background of the main page.
 * - No frame is sent to the main page. Only small status messages are.
 *
 * Messages from main  -> iframe: yt-config {rate, fps} | yt-snapshot
 * Messages iframe -> main:      yt-ready | yt-first-frame | yt-stats | yt-buffering
 *                               | yt-error | yt-snapshot-result
 */
(function () {
  if (window === window.top) return;     // only inside the embed frame
  if (window.__ytInjCanvas) return;      // never run twice
  window.__ytInjCanvas = true;

  var TAG = '[YT-INJ canvas]';
  var W = 1280, H = 720;                 // canvas backing size (CSS scales it to the iframe)
  var cfg = { fps: 30, rate: 1 };
  var video = null, canvas = null, ctx = null;
  var lastDraw = 0, lastTime = -1, drawn = 0, fpsCount = 0, fpsStart = performance.now();
  var firstFrameSent = false, attachTimer = null;
  var nativePlay = HTMLMediaElement.prototype.play;

  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // 1) Hide everything except our canvas
  // ---------------------------------------------------------------------
  var style = document.createElement('style');
  style.textContent =
    'html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}' +
    'body{display:none!important}' +                       // whole YouTube UI
    'video{display:none!important;visibility:hidden!important}' +
    '#yt-canvas{position:fixed!important;top:0!important;left:0!important;' +
    'width:100vw!important;height:100vh!important;display:block!important;' +
    'z-index:2147483647!important;pointer-events:none!important;background:#000!important}';
  (document.head || document.documentElement).appendChild(style);

  canvas = document.createElement('canvas');
  canvas.id = 'yt-canvas';
  canvas.width = W;
  canvas.height = H;
  document.documentElement.appendChild(canvas);            // child of <html>, not <body>
  ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  function hideVideo(v) {
    v.hidden = true;
    v.muted = true;
    v.style.setProperty('display', 'none', 'important');
    v.style.setProperty('visibility', 'hidden', 'important');
  }

  // ---------------------------------------------------------------------
  // 2) Playback rate control (rate <= 0 means pause)
  // ---------------------------------------------------------------------
  function applyRate() {
    if (!video) return;
    if (cfg.rate <= 0) {
      if (!video.paused) video.pause();
      return;
    }
    if (video.paused) nativePlay.call(video).catch(function () {});
    if (Math.abs(video.playbackRate - cfg.rate) > 0.01) video.playbackRate = cfg.rate;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'yt-config') {
      if (d.fps) cfg.fps = d.fps;
      if (typeof d.rate === 'number') cfg.rate = d.rate;
      applyRate();
    } else if (d.type === 'yt-snapshot') {
      var url = null;
      try { url = canvas.toDataURL('image/png'); } catch (err) {}
      post({ type: 'yt-snapshot-result', dataUrl: url });
    }
  });

  // ---------------------------------------------------------------------
  // 3) Draw loop: video -> canvas (cover fit)
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

    // YouTube sometimes rebuilds the DOM: make sure our canvas is still there
    if (!canvas.isConnected) document.documentElement.appendChild(canvas);

    if (!video || video.readyState < 2) return;
    if (now - lastDraw < 1000 / cfg.fps) return;
    if (video.currentTime === lastTime) return;            // paused / no new frame

    if (!drawCover()) return;
    lastDraw = now;
    lastTime = video.currentTime;
    drawn++;
    fpsCount++;

    if (!firstFrameSent) {
      firstFrameSent = true;
      post({ type: 'yt-first-frame' });
    }
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
  // 4) Attach to the <video> element
  // ---------------------------------------------------------------------
  function attach(v) {
    if (video === v) return;
    video = v;
    lastTime = -1;
    hideVideo(v);

    // YouTube may reset these attributes: re-apply
    new MutationObserver(function () {
      if (!v.hidden || v.style.display !== 'none') hideVideo(v);
    }).observe(v, { attributes: true, attributeFilter: ['hidden', 'style'] });

    v.addEventListener('ratechange', applyRate);
    v.addEventListener('pause', function () { if (cfg.rate > 0 && !v.ended) applyRate(); });
    v.addEventListener('loadeddata', function () { lastTime = -1; });
    v.addEventListener('seeked', function () { lastTime = -1; });
    v.addEventListener('waiting', function () { post({ type: 'yt-buffering', value: true }); });
    v.addEventListener('playing', function () { post({ type: 'yt-buffering', value: false }); });
    v.addEventListener('error', function () { post({ type: 'yt-error', msg: 'video error' }); });

    console.log(TAG, 'attached to <video>');
    post({ type: 'yt-ready' });
  }

  function findVideo() {
    var v = document.querySelector('video');
    if (v) attach(v);
  }

  requestAnimationFrame(loop);
  findVideo();

  // Keep watching (throttled) in case YouTube replaces the <video> element
  new MutationObserver(function () {
    if (attachTimer) return;
    attachTimer = setTimeout(function () { attachTimer = null; findVideo(); }, 500);
  }).observe(document, { childList: true, subtree: true });

  console.log(TAG, 'loaded');
})();
