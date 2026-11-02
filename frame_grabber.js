(function () {
  if (window === window.top || window.parent !== window.top) return;
  var parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
  var cfg = { fps: 15, width: 480, rate: 1 };
  var video = null, lastSent = 0;

  // Keep a reference to the real play() before we replace it
  var nativePlay = HTMLMediaElement.prototype.play;

  function applyRate() {
    if (!video) return;
    if (cfg.rate <= 0) { if (!video.paused) video.pause(); return; }
    if (video.paused) nativePlay.call(video).catch(function () {}); // bypass wrapper
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
    if (video === v) return;          // already attached to this element
    video = v;
    video.addEventListener('ratechange', applyRate);
    video.requestVideoFrameCallback(onFrame);
    window.parent.postMessage({ type: 'yt-ready' }, parentOrigin);
  }

  // Override play(): "this" is the video element that YouTube is starting
  HTMLMediaElement.prototype.play = function () {
    if (this instanceof HTMLVideoElement) {
      attach(this);
    }
    return nativePlay.apply(this, arguments); // must return the original promise
  };

  function onFrame(now, meta) {
    video.requestVideoFrameCallback(onFrame);
    if (video.paused || video.ended || !video.videoWidth) return;
    if (now - lastSent < 1000 / cfg.fps) return;
    lastSent = now;
    var w = video.videoWidth;
    var h = video.videoHeight;
    try {
      var frame = new VideoFrame(video);
      window.parent.postMessage(
        { type: 'yt-frame', frame: frame, t: meta.mediaTime, w: w, h: h },
        parentOrigin, [frame]);
    } catch (err) {
      window.parent.postMessage({ type: 'yt-error', msg: String(err) }, parentOrigin);
    }
  }
})();
