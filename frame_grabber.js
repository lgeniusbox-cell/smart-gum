(function () {
  if (window === window.top || window.parent !== window.top) return;
  var parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
  var cfg = { fps: 15, width: 480, rate: 1 };
  var video = null, lastSent = 0;

  function applyRate() {
    if (!video) return;
    if (cfg.rate <= 0) { if (!video.paused) video.pause(); return; }
    if (video.paused) video.play().catch(function(){});
    if (Math.abs(video.playbackRate - cfg.rate) > 0.01) video.playbackRate = cfg.rate;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (d && d.type === 'yt-config') {
      if (d.fps) cfg.fps = d.fps;
      if (d.width) cfg.width = d.width;
      if (typeof d.rate === 'number') cfg.rate = d.rate;
      applyRate();
    }
  });

  function attach(v) {
    video = v;
    video.addEventListener('ratechange', applyRate);
    video.requestVideoFrameCallback(onFrame);
    window.parent.postMessage({ type: 'yt-ready' }, parentOrigin);
  }

  function onFrame(now, meta) {
    video.requestVideoFrameCallback(onFrame);
    if (video.paused || video.ended || !video.videoWidth) return;
    if (now - lastSent < 1000 / cfg.fps) return;
    lastSent = now;
    var w = video.videoWidth;
    var h = video.videoHeight;
    try {
      var frame = new VideoFrame(video);
      window.parent.postMessage({ type: 'yt-frame', frame: frame, t: meta.mediaTime, w: w, h: h },
                                parentOrigin, [frame]);
    } catch (err) {
      window.parent.postMessage({ type: 'yt-error', msg: String(err) }, parentOrigin);
    }
  }

  var existing = document.querySelector('video');
  if (existing) { attach(existing); return; }
  var obs = new MutationObserver(function () {
    var v = document.querySelector('video');
    if (v) { obs.disconnect(); attach(v); }
  });
  obs.observe(document, { childList: true, subtree: true });
})();
