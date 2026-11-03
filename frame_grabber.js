(function () {
  // Run only in the embed frame that is a direct child of our page
  if (window === window.top || window.parent !== window.top) return;

  var TAG = '[YT-INJ vf]';
  var parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
  var cfg = { fps: 15, rate: 1 };
  var video = null, lastSent = 0, sent = 0, failed = 0;
  var nativePlay = HTMLMediaElement.prototype.play;

  console.log(TAG, 'loaded | parentOrigin =', parentOrigin, '| VideoFrame =', typeof VideoFrame);

  function post(msg, transfer) {
    window.parent.postMessage(msg, parentOrigin, transfer);
  }

  function applyRate() {
    if (!video) return;
    if (cfg.rate <= 0) { if (!video.paused) video.pause(); return; }
    if (video.paused) nativePlay.call(video).catch(function () {}); // bypass our wrapper
    if (Math.abs(video.playbackRate - cfg.rate) > 0.01) video.playbackRate = cfg.rate;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (d && d.type === 'yt-config') {
      if (d.fps) cfg.fps = d.fps;
      if (typeof d.rate === 'number') cfg.rate = d.rate;
      applyRate();
    }
  });

  // force = true: ignore paused state and fps throttle (used for the first still frame)
  function grab(mediaTime, force) {
    if (!video || !video.videoWidth || video.readyState < 2) return;
    if (!force) {
      if (video.paused || video.ended) return;
      var now = performance.now();
      if (now - lastSent < 1000 / cfg.fps) return;
      lastSent = now;
    }

    if (typeof VideoFrame === 'undefined') {
      post({ type: 'yt-error', msg: 'VideoFrame not supported in this WebView' });
      return;
    }

    var frame = null;
    try {
      frame = new VideoFrame(video);
      post({
        type: 'yt-frame',
        frame: frame,
        t: mediaTime,
        w: video.videoWidth,
        h: video.videoHeight,
        srcW: video.videoWidth,
        srcH: video.videoHeight
      }, [frame]);                         // transfer: frame is detached here after this call
      sent++;
      if (sent === 1 || sent % 100 === 0) console.log(TAG, 'frames posted:', sent);
    } catch (err) {
      failed++;
      if (failed <= 3) console.log(TAG, 'send failed:', String(err));
      // Never leave a frame open, otherwise the decoder stalls and Chrome logs a GC warning
      if (frame) { try { frame.close(); } catch (e) {} }
      try { post({ type: 'yt-error', msg: String(err) }); } catch (e) {}
    }
  }

  function onFrame(now, meta) {
    video.requestVideoFrameCallback(onFrame);   // re-arm first
    grab(meta.mediaTime, false);
  }

  function attach(v) {
    if (video === v) return;                     // already attached to this element
    video = v;
    console.log(TAG, 'attached to <video>');
    video.addEventListener('ratechange', applyRate);
    // One forced still frame, so the canvas has a picture even if the video starts paused
    video.addEventListener('loadeddata', function () { grab(video.currentTime, true); });
    video.addEventListener('seeked', function () { grab(video.currentTime, true); });
    video.requestVideoFrameCallback(onFrame);
    post({ type: 'yt-ready' });
  }

 

  // Fallback in case autoplay starts without a play() call
  var existing = document.querySelector('video');
  if (existing) {
    attach(existing);
  } else {
    var obs = new MutationObserver(function () {
      var v = document.querySelector('video');
      if (v) { obs.disconnect(); attach(v); }
    });
    obs.observe(document, { childList: true, subtree: true });
  }
})();
