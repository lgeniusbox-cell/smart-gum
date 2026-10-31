/*!
 * spotify-overlay.js
 * TV-optimized Spotify companion drawer for MatPad TV.
 *   - Spotify-only: search (Web API), PKCE login, full-length playback
 *   - Playback = Spotify Connect control through the Web API (works in any WebView),
 *     plus the Web Playback SDK as a local "MatPad TV" device when the WebView has Widevine/EME
 *   - Requires Spotify Premium (Spotify's rule for playback + Development Mode apps)
 *   - Spotify embed iframe only as a last-resort fallback (30-second previews if not logged in)
 *   - TV remote D-pad / gamepad navigation, keyboard only requested on Enter
 */
(function () {
  'use strict';
  if (window.SpotifyOverlay) return;

  /* ------------------------------------------------------------------ */
  /*  CONFIG                                                             */
  /* ------------------------------------------------------------------ */
  var CONFIG = {
    CLIENT_ID: 'c71dede0d5f54fae87823d248c5eeadb',
    REDIRECT_URI: location.origin + location.pathname,
    TOKEN_PROXY_URL: '',
    PAGE_SIZE: 10   // Spotify Dev Mode caps /search at limit=10 (Feb 2026)
  };

  var API = 'https://api.spotify.com/v1';
  var TOKEN_URL = 'https://accounts.spotify.com/api/token';
  var AUTH_URL = 'https://accounts.spotify.com/authorize';

  // Curated MatPad workout & gaming playlists that play with zero-config in Spotify Embed
  var CURATED_PLAYLISTS = [
    {
      id: '37i9dQZF1DXadOVCgGhL7j',
      type: 'playlist',
      title: 'Running Tempo 160-175 BPM',
      sub: 'High cadence beats for treadmill & running mat',
      icon: '🏃',
      cover: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: '37i9dQZF1DX76Wlfdnj7AP',
      type: 'playlist',
      title: 'Beast Mode Cardio',
      sub: 'Heavy bass & energetic EDM remixes',
      icon: '⚡',
      cover: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: '37i9dQZF1DXdLEN7aqioXM',
      type: 'playlist',
      title: 'Gaming Energy & Phonk',
      sub: 'Drift phonk & electro for Lava Runner reflex',
      icon: '🎮',
      cover: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: '37i9dQZF1DX35JVl5u92Wj',
      type: 'playlist',
      title: 'Cardio Dance Hits',
      sub: 'Uptempo pop & electronic club floor fillers',
      icon: '🔥',
      cover: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: '37i9dQZF1DXd9rSDyQguIk',
      type: 'playlist',
      title: 'Lo-Fi Chill Focus',
      sub: 'Smooth instrumental beats for steady sessions',
      icon: '🎧',
      cover: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: '37i9dQZF1DX4WYpdgoIcn6',
      type: 'playlist',
      title: 'Cool Down & Stretch',
      sub: 'Ambient calming tracks post-workout recovery',
      icon: '🧘',
      cover: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=400&q=80'
    }
  ];

  var QUICK_MOODS = [
    { label: '🏃 160 BPM Run', query: 'Running 160 BPM' },
    { label: '⚡ Cardio Energy', query: 'Cardio Workout' },
    { label: '🎮 Gaming Bass', query: 'Gaming EDM' },
    { label: '🔥 Drift Phonk', query: 'Gym Phonk' },
    { label: '🎧 Lo-Fi Beats', query: 'Lo-Fi Beats' },
    { label: '💪 Gym Hits', query: 'Workout Motivation' }
  ];

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function randomString(len) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    var out = '';
    var arr = new Uint8Array(len);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < len; i++) out += chars.charAt(arr[i] % chars.length);
    return out;
  }

  function b64url(buf) {
    var s = '';
    var bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* ------------------------------------------------------------------ */
  /*  Auth & Tokens                                                      */
  /* ------------------------------------------------------------------ */
  var memToken = null;

  function clientIdMissing() {
    return !CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.indexOf('PASTE_') === 0;
  }

  function hasSession() {
    if (CONFIG.TOKEN_PROXY_URL) return true;
    return !!(lsGet('sp_refresh') || lsGet('sp_access'));
  }

  function saveTokens(data) {
    lsSet('sp_access', data.access_token);
    lsSet('sp_exp', String(Date.now() + (data.expires_in || 3600) * 1000 - 30000));
    if (data.refresh_token) lsSet('sp_refresh', data.refresh_token);
  }

  function clearTokens() {
    memToken = null;
    lsDel('sp_access');
    lsDel('sp_exp');
    lsDel('sp_refresh');
  }

  function formPost(params) {
    var body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error_description || j.error || 'Login failed');
        return j;
      });
    });
  }

  function startLogin() {
    if (clientIdMissing()) return Promise.reject(new Error('Spotify Client ID is required.'));
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('Secure login requires crypto.subtle (HTTPS).'));
    }
    var verifier = randomString(96);
    var state = randomString(16);
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      lsSet('sp_verifier', verifier);
      lsSet('sp_state', state);
      lsSet('sp_reopen', '1');
      var scopes = 'streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state playlist-read-private';
      var q = 'client_id=' + encodeURIComponent(CONFIG.CLIENT_ID) +
        '&response_type=code' +
        '&redirect_uri=' + encodeURIComponent(CONFIG.REDIRECT_URI) +
        '&code_challenge_method=S256' +
        '&code_challenge=' + b64url(digest) +
        '&state=' + encodeURIComponent(state) +
        '&scope=' + encodeURIComponent(scopes);
      window.location.href = AUTH_URL + '?' + q;
    });
  }

  function handleRedirect() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return Promise.resolve(); }
    var code = params.get('code');
    var err = params.get('error');
    if (!code && !err) return Promise.resolve();

    function cleanUrl() {
      try {
        params.delete('code'); params.delete('state'); params.delete('error');
        var qs = params.toString();
        history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      } catch (e) { /* ignore */ }
    }

    if (err) { cleanUrl(); lsSet('sp_login_error', err); return Promise.resolve(); }
    if (params.get('state') !== lsGet('sp_state')) { cleanUrl(); return Promise.resolve(); }

    return formPost({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: CONFIG.REDIRECT_URI,
      client_id: CONFIG.CLIENT_ID,
      code_verifier: lsGet('sp_verifier') || ''
    }).then(function (data) {
      saveTokens(data);
      lsDel('sp_verifier'); lsDel('sp_state');
      cleanUrl();
    }).catch(function (e) {
      lsSet('sp_login_error', e.message);
      cleanUrl();
    });
  }

  function refreshToken() {
    var rt = lsGet('sp_refresh');
    if (!rt) { clearTokens(); return Promise.reject(new Error('AUTH_REQUIRED')); }
    return formPost({ grant_type: 'refresh_token', refresh_token: rt, client_id: CONFIG.CLIENT_ID })
      .then(function (data) { saveTokens(data); return data.access_token; })
      .catch(function () { clearTokens(); throw new Error('AUTH_REQUIRED'); });
  }

  function getToken(force) {
    if (CONFIG.TOKEN_PROXY_URL) {
      if (!force && memToken && memToken.exp > Date.now()) return Promise.resolve(memToken.value);
      return fetch(CONFIG.TOKEN_PROXY_URL).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.access_token) throw new Error('Token proxy returned no access_token.');
        memToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 30000 };
        return memToken.value;
      });
    }
    var access = lsGet('sp_access');
    var exp = parseInt(lsGet('sp_exp') || '0', 10);
    if (!force && access && exp > Date.now()) return Promise.resolve(access);
    return refreshToken();
  }

  function apiError(message, status, reason) {
    var e = new Error(message);
    e.status = status;
    e.reason = reason;
    return e;
  }

  // opts: { method, body }. Resolves {} for 204 / empty bodies.
  function api(path, opts, retried) {
    opts = opts || {};
    return getToken(!!retried).then(function (token) {
      var init = { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + token } };
      if (opts.body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
      return fetch(API + path, init);
    }).then(function (r) {
      if (r.status === 401 && !retried) return api(path, opts, true);
      if (r.status === 401) { clearTokens(); throw apiError('AUTH_REQUIRED', 401); }
      if (r.status === 429) {
        var wait = r.headers.get('Retry-After');
        throw apiError('Spotify rate limit. Retry in ' + (wait || 'a few') + 's.', 429, 'RATE_LIMIT');
      }
      return r.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = {}; }
        if (!r.ok) {
          var er = j && j.error;
          var msg = (er && (er.message || er)) || ('Spotify error ' + r.status);
          throw apiError(String(msg), r.status, er && er.reason);
        }
        return j;
      });
    });
  }

  function parseSpotifyUrl(input) {
    var s = String(input || '').trim();
    if (!s) return null;
    var m = s.match(/(playlist|track|album|artist)[/:]([A-Za-z0-9]{15,})/);
    if (m) return { type: m[1], id: m[2] };
    if (/^[A-Za-z0-9]{18,32}$/.test(s)) return { type: 'playlist', id: s };
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Styles: Sleek Right-Center Mobile Aspect Ratio Drawer               */
  /* ------------------------------------------------------------------ */
  var CSS = `
    .sp-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 7, 6, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 2100;
      opacity: 0;
      pointer-events: none;
      transition: opacity 280ms ease;
    }
    .sp-backdrop.sp-open {
      opacity: 1;
      pointer-events: auto;
    }

    .sp-ov {
      --sp-bg: #0d120f;
      --sp-surface: #141b16;
      --sp-surface-hover: #1c261f;
      --sp-border: rgba(30, 215, 96, 0.24);
      --sp-border-hover: rgba(30, 215, 96, 0.6);
      --sp-text: #f3f7f4;
      --sp-dim: #90a395;
      --sp-accent: #1ed760;
      --sp-glow: rgba(30, 215, 96, 0.35);

      position: fixed;
      right: 3vw;
      top: 4.5vh;
      bottom: 4.5vh;
      width: min(440px, 35vw);
      z-index: 2101;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #17211a 0%, #0c110e 100%);
      color: var(--sp-text);
      border: 1.5px solid var(--sp-border);
      border-radius: 26px;
      box-shadow: -16px 0 45px rgba(0, 0, 0, 0.8), 0 0 35px rgba(30, 215, 96, 0.14);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      box-sizing: border-box;
      transform: translate3d(115%, 0, 0);
      transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 320ms ease;
      overflow: hidden;
    }
    .sp-ov * { box-sizing: border-box; }
    .sp-ov.sp-open {
      transform: translate3d(0, 0, 0);
    }

    /* TV D-Pad Focus Ring inside drawer */
    .sp-ov .sp-nav:focus,
    .sp-ov .sp-nav.sp-focused {
      outline: 3px solid var(--sp-accent) !important;
      outline-offset: 2px !important;
      border-color: var(--sp-accent) !important;
      box-shadow: 0 0 20px var(--sp-glow) !important;
      transform: scale(1.02);
      z-index: 2;
    }

    /* Header */
    .sp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1vw;
      padding: 1.8vh 1.4vw;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(18, 25, 20, 0.7);
    }
    .sp-brand {
      display: flex;
      align-items: center;
      gap: 0.8vw;
    }
    .sp-logo-svg {
      width: 2.8vh;
      height: 2.8vh;
      fill: var(--sp-accent);
    }
    .sp-title {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: #fff;
    }
    .sp-head-actions {
      display: flex;
      align-items: center;
      gap: 0.6vw;
    }
    .sp-hint-pill {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--sp-dim);
      background: rgba(255, 255, 255, 0.06);
      padding: 0.3vh 0.6vw;
      border-radius: 999px;
      letter-spacing: 0.04em;
    }
    .sp-close-btn {
      width: 4.2vh;
      height: 4.2vh;
      border-radius: 50%;
      background: var(--sp-surface);
      border: 1px solid var(--sp-border);
      color: var(--sp-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.2rem;
      transition: all 180ms ease;
    }

    /* Scrollable Drawer Body */
    .sp-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.8vh 1.4vw;
      display: flex;
      flex-direction: column;
      gap: 1.8vh;
      scrollbar-width: thin;
      scrollbar-color: var(--sp-border) transparent;
    }

    /* Search input row */
    .sp-search-row {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }
    .sp-search-icon {
      position: absolute;
      left: 1vw;
      width: 2vh;
      height: 2vh;
      fill: var(--sp-dim);
      pointer-events: none;
    }
    .sp-input {
      width: 100%;
      background: var(--sp-surface);
      border: 1.5px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 1.2vh 1vw 1.2vh 2.8vw;
      color: #fff;
      font-size: 0.95rem;
      font-family: inherit;
      transition: all 180ms ease;
    }
    .sp-input::placeholder {
      color: var(--sp-dim);
    }
    .sp-input:focus {
      border-color: var(--sp-accent);
      background: #18221c;
    }

    /* Mood Chips */
    .sp-chips-label {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sp-dim);
    }
    .sp-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6vh 0.5vw;
    }
    .sp-chip {
      background: var(--sp-surface);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--sp-text);
      font-size: 0.82rem;
      font-weight: 600;
      padding: 0.6vh 0.9vw;
      border-radius: 999px;
      cursor: pointer;
      transition: all 160ms ease;
    }
    .sp-chip:hover {
      background: var(--sp-surface-hover);
      border-color: var(--sp-accent);
      color: #fff;
    }

    /* Playlist & Track Cards */
    .sp-section-title {
      font-size: 0.9rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sp-cards-list {
      display: flex;
      flex-direction: column;
      gap: 1vh;
    }
    .sp-card {
      display: flex;
      align-items: center;
      gap: 1vw;
      background: var(--sp-surface);
      border: 1.5px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 1vh 1vw;
      cursor: pointer;
      text-align: left;
      transition: transform 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
    }
    .sp-card:hover {
      background: var(--sp-surface-hover);
      border-color: var(--sp-border-hover);
    }
    .sp-card.sp-playing {
      border-color: var(--sp-accent);
      background: rgba(30, 215, 96, 0.09);
      box-shadow: 0 0 16px rgba(30, 215, 96, 0.2);
    }
    .sp-card-thumb {
      width: 5.6vh;
      height: 5.6vh;
      border-radius: 10px;
      background: #1a241e;
      object-fit: cover;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      flex-shrink: 0;
    }
    .sp-card-body {
      flex: 1;
      min-width: 0;
    }
    .sp-card-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sp-card-sub {
      font-size: 0.78rem;
      color: var(--sp-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.2vh;
    }
    .sp-play-pill {
      font-size: 0.75rem;
      font-weight: 800;
      background: rgba(30, 215, 96, 0.15);
      color: var(--sp-accent);
      border: 1px solid rgba(30, 215, 96, 0.3);
      padding: 0.5vh 0.8vw;
      border-radius: 999px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.3vw;
      transition: all 160ms ease;
    }
    .sp-card:hover .sp-play-pill,
    .sp-card.sp-playing .sp-play-pill {
      background: var(--sp-accent);
      color: #04120a;
    }

    /* Embedded & Preview Player Container */
    .sp-player-wrap {
      border-top: 1.5px solid rgba(30, 215, 96, 0.25);
      background: #090e0b;
      padding: 1.2vh 1.4vw;
      display: none;
    }
    .sp-player-wrap.sp-active {
      display: block;
    }
    .sp-player-frame {
      width: 100%;
      height: 152px;
      border: 0;
      border-radius: 16px;
      background: #000;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
      display: none;
    }

    /* In-Drawer Preview Audio Player Bar */
    .sp-preview-player {
      display: flex;
      flex-direction: column;
      gap: 0.8vh;
      background: linear-gradient(135deg, rgba(20, 32, 23, 0.95), rgba(12, 18, 14, 0.98));
      border: 1px solid rgba(30, 215, 96, 0.3);
      border-radius: 16px;
      padding: 1vh 1.2vw;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7);
    }
    .sp-prev-main {
      display: flex;
      align-items: center;
      gap: 0.9vw;
    }
    .sp-prev-thumb {
      width: 4.8vh;
      height: 4.8vh;
      border-radius: 10px;
      object-fit: cover;
      background: #19251d;
      flex-shrink: 0;
    }
    .sp-prev-meta {
      flex: 1;
      min-width: 0;
    }
    .sp-prev-title {
      font-size: 0.92rem;
      font-weight: 800;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sp-prev-artist {
      font-size: 0.78rem;
      color: var(--sp-accent);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }
    .sp-prev-controls {
      display: flex;
      align-items: center;
      gap: 0.6vw;
    }
    .sp-ctrl-btn {
      width: 4vh;
      height: 4vh;
      border-radius: 50%;
      background: var(--sp-surface);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.05rem;
      transition: all 180ms ease;
    }
    .sp-ctrl-btn.sp-btn-play {
      background: var(--sp-accent);
      color: #04120a;
      border-color: var(--sp-accent);
      font-size: 1.15rem;
    }
    .sp-ctrl-btn:hover {
      transform: scale(1.08);
      border-color: var(--sp-accent);
    }

    /* Sound Bars (Equalizer Animation) */
    .sp-eq-anim {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 18px;
      padding: 0 0.3vw;
    }
    .sp-eq-bar {
      width: 3px;
      background: var(--sp-accent);
      border-radius: 2px;
      height: 6px;
      animation: sp-eq-bounce 0.75s ease-in-out infinite alternate;
    }
    .sp-eq-bar:nth-child(1) { animation-delay: 0.1s; }
    .sp-eq-bar:nth-child(2) { animation-delay: 0.35s; }
    .sp-eq-bar:nth-child(3) { animation-delay: 0.2s; }
    .sp-eq-bar:nth-child(4) { animation-delay: 0.45s; }
    @keyframes sp-eq-bounce {
      0% { height: 4px; }
      50% { height: 16px; }
      100% { height: 8px; }
    }
    .sp-eq-paused .sp-eq-bar {
      animation-play-state: paused !important;
      height: 4px !important;
    }

    /* Progress & Scrubber Bar */
    .sp-scrubber-row {
      display: flex;
      align-items: center;
      gap: 0.8vw;
      width: 100%;
    }
    .sp-progress-track {
      flex: 1;
      height: 6px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      overflow: hidden;
      position: relative;
    }
    .sp-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #1db954, #1ed760);
      border-radius: 999px;
      transition: width 150ms linear;
    }
    .sp-progress-time {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--sp-dim);
      font-family: 'JetBrains Mono', monospace;
      white-space: nowrap;
    }

    /* Notice / Notification Box */
    .sp-notice-box {
      background: rgba(30, 215, 96, 0.08);
      border: 1px solid rgba(30, 215, 96, 0.25);
      border-radius: 14px;
      padding: 1.2vh 1.2vw;
      font-size: 0.82rem;
      line-height: 1.4;
      color: #d1ded5;
      position: relative;
    }
    .sp-notice-title {
      font-weight: 800;
      font-size: 0.86rem;
      margin-bottom: 0.4vh;
      display: flex;
      align-items: center;
      gap: 0.4vw;
      color: var(--sp-accent);
    }
    .sp-notice-close {
      position: absolute;
      top: 0.8vh;
      right: 0.8vw;
      background: transparent;
      border: 0;
      color: var(--sp-dim);
      font-size: 1rem;
      cursor: pointer;
    }

    /* Direct link input bar */
    .sp-link-row {
      display: flex;
      gap: 0.5vw;
    }
    .sp-btn-action {
      background: var(--sp-accent);
      color: #04120a;
      border: 0;
      font-weight: 800;
      font-size: 0.85rem;
      padding: 0 1.2vw;
      border-radius: 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 160ms ease;
    }
  `;

  function injectCss() {
    if (document.getElementById('sp-style')) return;
    var st = document.createElement('style');
    st.id = 'sp-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /*  Playback engine                                                   */
  /*  1) Web Playback SDK -> a local "MatPad TV" Connect device, only    */
  /*     when the WebView supports Widevine/EME (many TV WebViews don't) */
  /*  2) Spotify Connect via Web API -> plays on any of the user's       */
  /*     devices (phone, speaker, Spotify TV app). Always available.     */
  /* ------------------------------------------------------------------ */
  var DEVICE_NAME = 'MatPad TV';
  var P = {
    sdk: null,
    sdkDeviceId: null,
    sdkLoading: false,
    nowUri: null,
    state: null,      // { playing, progress, duration, at }
    pollTimer: null,
    tickTimer: null
  };

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function widevineAvailable() {
    if (!window.isSecureContext || !navigator.requestMediaKeySystemAccess) return Promise.resolve(false);
    return navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }]
    }]).then(function () { return true; }, function () { return false; });
  }

  function initWebPlayback() {
    if (P.sdk || P.sdkLoading || !hasSession()) return;
    P.sdkLoading = true;
    widevineAvailable().then(function (ok) {
      if (!ok) { P.sdkLoading = false; return; }  // Connect-only mode
      window.onSpotifyWebPlaybackSDKReady = function () {
        var player = new window.Spotify.Player({
          name: DEVICE_NAME,
          getOAuthToken: function (cb) { getToken().then(cb).catch(function () {}); },
          volume: 0.8
        });
        player.addListener('ready', function (e) { P.sdkDeviceId = e.device_id; });
        player.addListener('not_ready', function () { P.sdkDeviceId = null; });
        ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(function (ev) {
          player.addListener(ev, function (e) {
            console.warn('[Spotify SDK] ' + ev + ':', e && e.message);
            if (ev !== 'playback_error') P.sdkDeviceId = null;  // fall back to Connect devices
          });
        });
        P.sdk = player;
        player.connect();
      };
      var sc = document.createElement('script');
      sc.src = 'https://sdk.scdn.co/spotify-player.js';
      sc.async = true;
      sc.onerror = function () { P.sdkLoading = false; };
      document.head.appendChild(sc);
    });
  }

  function stopWebPlayback() {
    if (P.sdk) { try { P.sdk.disconnect(); } catch (e) { /* ignore */ } }
    P.sdk = null; P.sdkDeviceId = null; P.sdkLoading = false;
  }

  // Prefer this page's own SDK device, then the active device, then any usable one.
  function pickDevice() {
    return api('/me/player/devices').then(function (r) {
      var list = ((r && r.devices) || []).filter(function (d) { return !d.is_restricted; });
      return list.filter(function (d) { return d.id === P.sdkDeviceId; })[0] ||
        list.filter(function (d) { return d.is_active; })[0] ||
        list[0] || null;
    });
  }

  // payload: { uris:[...], offset?:{uri} } or { context_uri }
  // meta: { title, artist, img, uri, embed?:{type,id} }
  function playSpotify(payload, meta) {
    if (!hasSession()) { renderAccountBar(); focusLoginButton(); return Promise.resolve(); }
    if (P.sdk && P.sdk.activateElement) { try { P.sdk.activateElement(); } catch (e) { /* ignore */ } }
    return pickDevice().then(function (dev) {
      if (!dev) throw apiError('NO_DEVICE', 404, 'NO_DEVICE');
      var pre = (dev.id === P.sdkDeviceId && !dev.is_active)
        ? api('/me/player', { method: 'PUT', body: { device_ids: [dev.id], play: false } }).then(function () { return delay(350); })
        : Promise.resolve();
      return pre.then(function () {
        return api('/me/player/play?device_id=' + encodeURIComponent(dev.id), { method: 'PUT', body: payload });
      }).then(function () {
        hideEmbed();
        P.state = null;
        P.nowUri = meta && meta.uri || null;
        if (meta) showNowPlaying(meta);
        refreshState(900);
        if (window.Notify) {
          window.Notify.show({
            type: 'success', title: 'Now Playing on ' + dev.name,
            message: (meta && meta.title) || '', duration: 3000
          });
        }
      });
    }).catch(function (err) { handlePlayError(err, meta); });
  }

  function handlePlayError(err, meta) {
    var reason = err && err.reason;
    var text;
    if (err && err.message === 'AUTH_REQUIRED') { renderAccountBar(); focusLoginButton(); return; }
    if (reason === 'PREMIUM_REQUIRED') {
      text = 'Spotify Premium is required to play full songs.';
    } else if (reason === 'NO_DEVICE' || reason === 'NO_ACTIVE_DEVICE' || (err && err.status === 404)) {
      text = 'No Spotify device found. Open Spotify on your phone, speaker or TV (same account), then press play again.';
      if (meta && meta.embed) {
        text += ' Showing the Spotify embed meanwhile (30-second previews only).';
        playEmbed(meta.embed.type, meta.embed.id);
      }
    } else if (err && err.status === 403) {
      text = 'Spotify refused the request. The app owner needs Premium and your account must be listed under Users and Access.';
    } else {
      text = (err && err.message) || 'Playback failed.';
    }
    showNotice('<div class="sp-notice-title"><span>⚠️</span> Spotify</div><div>' + escapeHtml(text) + '</div>', true);
  }

  function playerCmd(method, path) {
    return api(path, { method: method }).then(function () { refreshState(500); }).catch(function (e) { handlePlayError(e); });
  }
  function togglePlayback() { playerCmd('PUT', P.state && P.state.playing ? '/me/player/pause' : '/me/player/play'); }
  function skipNext() { playerCmd('POST', '/me/player/next'); }
  function skipPrev() { playerCmd('POST', '/me/player/previous'); }

  // Poll /me/player (kept slow: Dev Mode apps share a small quota)
  function refreshState(wait) {
    clearTimeout(P.pollTimer);
    if (!S.open || !hasSession()) return;
    P.pollTimer = setTimeout(function () {
      if (!S.open || !hasSession()) return;
      api('/me/player').then(applyState).catch(function () {}).then(function () { refreshState(5000); });
    }, wait == null ? 5000 : wait);
  }

  function applyState(st) {
    if (!st || !st.item) {
      P.state = null; P.nowUri = null;
      hideNowPlaying();
      return;
    }
    var it = st.item;
    var artist = (it.artists || []).map(function (a) { return a.name; }).join(', ') || (it.show && it.show.name) || '';
    var imgs = (it.album && it.album.images) || (it.show && it.show.images) || [];
    var img = imgs.length ? imgs[Math.min(1, imgs.length - 1)].url : '';
    P.nowUri = it.uri;
    P.state = { playing: !!st.is_playing, progress: st.progress_ms || 0, duration: it.duration_ms || 0, at: Date.now() };
    showNowPlaying({ title: it.name, artist: artist, img: img, uri: it.uri });
    paintProgress();
  }

  function startTick() { if (!P.tickTimer) P.tickTimer = setInterval(paintProgress, 500); }
  function stopTick() { clearInterval(P.tickTimer); P.tickTimer = null; }

  function paintProgress() {
    if (!P.state || !dom.prevFill) return;
    var cur = P.state.progress + (P.state.playing ? Date.now() - P.state.at : 0);
    cur = Math.min(cur, P.state.duration || cur);
    dom.prevFill.style.width = (P.state.duration ? (cur / P.state.duration) * 100 : 0) + '%';
    dom.prevTime.textContent = formatTime(cur / 1000) + ' / ' + formatTime(P.state.duration / 1000);
  }

  function updatePlayUI(isPlaying) {
    if (dom.prevPlayBtn) dom.prevPlayBtn.innerHTML = isPlaying ? '⏸' : '▶';
    if (dom.prevEq) dom.prevEq.classList.toggle('sp-eq-paused', !isPlaying);
  }

  function showNowPlaying(meta) {
    if (!dom.previewPlayer || !dom.playerWrap) return;
    dom.prevCover.src = meta.img || '';
    dom.prevCover.style.visibility = meta.img ? 'visible' : 'hidden';
    dom.prevTitle.textContent = meta.title || 'Track';
    dom.prevArtist.textContent = meta.artist || '';
    if (!P.state) { dom.prevFill.style.width = '0%'; dom.prevTime.textContent = '0:00 / 0:00'; }
    updatePlayUI(!P.state || P.state.playing);
    dom.previewPlayer.style.display = 'flex';
    dom.playerWrap.classList.add('sp-active');
    updateActiveCardHighlight();
  }

  function hideNowPlaying() {
    if (dom.previewPlayer) dom.previewPlayer.style.display = 'none';
    if (dom.playerWrap && (!dom.playerFrame || dom.playerFrame.style.display === 'none')) {
      dom.playerWrap.classList.remove('sp-active');
    }
    updateActiveCardHighlight();
  }

  function updateActiveCardHighlight() {
    if (!dom.resultsBox) return;
    var playing = !!(P.state && P.state.playing);
    dom.resultsBox.querySelectorAll('.sp-card').forEach(function (card) {
      var cur = P.nowUri && card.getAttribute('data-uri') === P.nowUri;
      card.classList.toggle('sp-playing', !!cur);
      var pill = card.querySelector('.sp-play-pill');
      if (pill) pill.innerHTML = cur ? (playing ? '🔊 PLAYING' : '⏸ PAUSED') : '▶ PLAY';
    });
  }

  function hideEmbed() {
    if (!dom.playerFrame) return;
    dom.playerFrame.src = '';
    dom.playerFrame.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /*  Input "lock" helpers                                              */
  /*  Inputs are read-only (+ inputmode=none) while merely focused so   */
  /*  the on-screen keyboard never pops up on D-pad navigation. The     */
  /*  keyboard is only requested after the user presses Enter / OK.     */
  /* ------------------------------------------------------------------ */
  function lockInput(el) {
    if (!el) return;
    el.readOnly = true;
    el.setAttribute('inputmode', 'none');
  }

  function isEditing(el) {
    return !!el && el.tagName === 'INPUT' && !el.readOnly;
  }

  function unlockInput(el) {
    if (!el) return;
    el.__spUnlocking = true;          // stop the blur handler re-locking us
    el.readOnly = false;
    el.setAttribute('inputmode', el.type === 'search' ? 'search' : 'text');
    el.blur();                        // blur + focus makes Android WebView show the IME
    el.focus();
    el.__spUnlocking = false;
    try {
      var n = el.value.length;
      el.setSelectionRange(n, n);
    } catch (e) { /* search/url inputs may not support selection */ }
  }

  // Leave edit mode: hides the keyboard, re-locks, keeps D-pad focus on the field.
  function finishEditing(el) {
    if (!el) return;
    el.blur();   // blur handler re-locks the input
    el.focus();  // now read-only, so no keyboard is requested
  }

  function wireLockedInput(el) {
    lockInput(el);
    el.addEventListener('blur', function () {
      if (!el.__spUnlocking) lockInput(el);
    });
    // Touch / mouse tap counts as an explicit "press" on the field
    el.addEventListener('click', function () {
      if (el.readOnly) unlockInput(el);
    });
  }

  function submitInput(el) {
    if (el === dom.searchInput) {
      clearTimeout(S.searchTimer);
      var q = el.value.trim();
      if (q) runSearch(q);
    } else if (el === dom.linkInput) {
      handleDirectLink();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Overlay State & UI                                                */
  /* ------------------------------------------------------------------ */
  var S = {
    open: false,
    activeUri: null,
    searchTimer: null,
    lastQuery: '',
    offset: 0
  };
  var dom = {};
  var lastFocusedBeforeOpen = null;

  function buildDrawer() {
    if (dom.root) return;
    injectCss();

    // Backdrop
    dom.backdrop = h('div', {
      class: 'sp-backdrop',
      onclick: requestClose
    });

    // Drawer Container
    dom.root = h('div', { class: 'sp-ov' });

    // Header
    dom.head = h('div', { class: 'sp-head' }, [
      h('div', { class: 'sp-brand' }, [
        h('svg', { class: 'sp-logo-svg', viewBox: '0 0 24 24', html: '<path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.625.625 0 01-.277-1.22c3.807-.87 7.075-.497 9.712 1.12a.624.624 0 01.207.857zm1.224-2.719a.78.78 0 01-1.073.257c-2.688-1.652-6.785-2.131-9.964-1.166a.78.78 0 01-.453-1.493c3.629-1.102 8.147-.57 11.233 1.329a.78.78 0 01.257 1.073zm.105-2.835C14.693 8.948 9.387 8.77 6.309 9.704a.936.936 0 11-.546-1.79c3.528-1.071 9.39-.864 13.167 1.378a.936.936 0 01-.245 1.578z"/>' }),
        h('span', { class: 'sp-title', text: 'Spotify Music' })
      ]),
      h('div', { class: 'sp-head-actions' }, [
        h('span', { class: 'sp-hint-pill', text: 'BACK to exit' }),
        h('button', {
          class: 'sp-close-btn sp-nav',
          type: 'button',
          'aria-label': 'Close Spotify',
          html: '✕',
          onclick: requestClose
        })
      ])
    ]);

    // Body
    dom.body = h('div', { class: 'sp-body' });

    // Search bar
    dom.searchInput = h('input', {
      class: 'sp-input sp-nav',
      type: 'search',
      placeholder: 'Search song, artist, playlist...',
      'aria-label': 'Search Spotify',
      autocomplete: 'off'
    });
    dom.searchInput.addEventListener('input', onSearchInput);
    wireLockedInput(dom.searchInput);

    var searchRow = h('div', { class: 'sp-search-row' }, [
      h('svg', { class: 'sp-search-icon', viewBox: '0 0 24 24', html: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' }),
      dom.searchInput
    ]);

    // Moods row
    var moodChips = QUICK_MOODS.map(function (m) {
      return h('button', {
        class: 'sp-chip sp-nav',
        type: 'button',
        text: m.label,
        onclick: function () {
          dom.searchInput.value = m.query;
          runSearch(m.query);
        }
      });
    });

    var moodsSection = h('div', null, [
      h('div', { class: 'sp-chips-label', text: 'Workout & Running Vibes', style: 'margin-bottom: 0.8vh;' }),
      h('div', { class: 'sp-chips-row' }, moodChips)
    ]);

    // Direct link input row
    dom.linkInput = h('input', {
      class: 'sp-input sp-nav',
      type: 'text',
      placeholder: 'Or paste Spotify link (playlist / track / album)...',
      style: 'font-size: 0.85rem;'
    });
    wireLockedInput(dom.linkInput);
    var linkRow = h('div', { class: 'sp-link-row' }, [
      dom.linkInput,
      h('button', {
        class: 'sp-btn-action sp-nav',
        type: 'button',
        text: 'Play',
        onclick: handleDirectLink
      })
    ]);

    // Notice box for instant mode or auth info
    dom.noticeBox = h('div', { class: 'sp-notice-box', style: 'display: none;' });

    // Results container
    dom.resultsBox = h('div', { class: 'sp-cards-list' });

    // Featured Curated Section
    dom.curatedSection = h('div', null, [
      h('div', { class: 'sp-section-title', text: 'Featured TV Mat Playlists' }),
      h('div', { class: 'sp-cards-list', style: 'margin-top: 1vh;' }, renderCuratedCards())
    ]);

    // Account / login box
    dom.accountBox = h('div', { class: 'sp-notice-box' });

    // Assemble body
    dom.body.appendChild(dom.accountBox);
    dom.body.appendChild(searchRow);
    dom.body.appendChild(moodsSection);
    dom.body.appendChild(linkRow);
    dom.body.appendChild(dom.noticeBox);
    dom.body.appendChild(dom.resultsBox);
    dom.body.appendChild(dom.curatedSection);
    renderAccountBar();

    // Bottom Embedded Player Wrap
    dom.playerWrap = h('div', { class: 'sp-player-wrap' });

    // Spotify Iframe Embed Player
    dom.playerFrame = h('iframe', {
      class: 'sp-player-frame',
      allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
      loading: 'lazy'
    });

    // Now-playing bar (state comes from Spotify, audio plays on the Spotify device)
    dom.prevCover = h('img', { class: 'sp-prev-thumb', alt: 'Cover' });
    dom.prevTitle = h('div', { class: 'sp-prev-title', text: 'Track Title' });
    dom.prevArtist = h('div', { class: 'sp-prev-artist', text: 'Artist' });
    dom.prevEq = h('div', { class: 'sp-eq-anim' }, [
      h('div', { class: 'sp-eq-bar' }),
      h('div', { class: 'sp-eq-bar' }),
      h('div', { class: 'sp-eq-bar' }),
      h('div', { class: 'sp-eq-bar' })
    ]);

    dom.prevPrevBtn = h('button', { class: 'sp-ctrl-btn sp-nav', type: 'button', 'aria-label': 'Previous', html: '⏮', onclick: skipPrev });
    dom.prevPlayBtn = h('button', { class: 'sp-ctrl-btn sp-btn-play sp-nav', type: 'button', 'aria-label': 'Play/Pause', html: '⏸', onclick: togglePlayback });
    dom.prevNextBtn = h('button', { class: 'sp-ctrl-btn sp-nav', type: 'button', 'aria-label': 'Next', html: '⏭', onclick: skipNext });

    dom.prevFill = h('div', { class: 'sp-progress-fill' });
    dom.prevTime = h('span', { class: 'sp-progress-time', text: '0:00 / 0:00' });

    dom.previewPlayer = h('div', { class: 'sp-preview-player', style: 'display: none;' }, [
      h('div', { class: 'sp-prev-main' }, [
        dom.prevCover,
        h('div', { class: 'sp-prev-meta' }, [dom.prevTitle, dom.prevArtist]),
        dom.prevEq,
        h('div', { class: 'sp-prev-controls' }, [dom.prevPrevBtn, dom.prevPlayBtn, dom.prevNextBtn])
      ]),
      h('div', { class: 'sp-scrubber-row' }, [
        h('div', { class: 'sp-progress-track' }, [dom.prevFill]),
        dom.prevTime
      ])
    ]);

    dom.playerWrap.appendChild(dom.previewPlayer);
    dom.playerWrap.appendChild(dom.playerFrame);

    // Assemble Root
    dom.root.appendChild(dom.head);
    dom.root.appendChild(dom.body);
    dom.root.appendChild(dom.playerWrap);

    document.body.appendChild(dom.backdrop);
    document.body.appendChild(dom.root);

    // Attach TV input listener
    setupInputListener();
  }

  function renderCuratedCards() {
    return CURATED_PLAYLISTS.map(function (p) {
      return h('div', {
        class: 'sp-card sp-nav',
        tabindex: '0',
        role: 'button',
        onclick: function () {
          playSpotify({ context_uri: 'spotify:' + p.type + ':' + p.id },
            { title: p.title, artist: 'Playlist', img: p.cover, uri: 'spotify:' + p.type + ':' + p.id, embed: { type: p.type, id: p.id } });
        }
      }, [
        h('img', {
          class: 'sp-card-thumb',
          src: p.cover,
          alt: p.title,
          onerror: function () { this.style.display = 'none'; }
        }),
        h('div', { class: 'sp-card-body' }, [
          h('div', { class: 'sp-card-title', text: p.icon + ' ' + p.title }),
          h('div', { class: 'sp-card-sub', text: p.sub })
        ]),
        h('div', { class: 'sp-play-pill', text: '▶ PLAY' })
      ]);
    });
  }

  function playEmbed(type, id) {
    if (!dom.playerWrap || !dom.playerFrame) return;

    if (dom.previewPlayer) dom.previewPlayer.style.display = 'none';
    dom.playerFrame.style.display = 'block';

    var embedUrl = 'https://open.spotify.com/embed/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '?utm_source=generator&theme=0';
    dom.playerFrame.src = embedUrl;
    dom.playerWrap.classList.add('sp-active');

    if (window.Notify) {
      window.Notify.show({
        type: 'success',
        title: 'Spotify Player',
        message: 'Loaded ' + type + ' into player',
        duration: 3000
      });
    }

    // Scroll player into view
    setTimeout(function () {
      dom.playerWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 200);
  }

  function handleDirectLink() {
    var val = dom.linkInput ? dom.linkInput.value : '';
    var parsed = parseSpotifyUrl(val);
    if (parsed) {
      var uri = 'spotify:' + parsed.type + ':' + parsed.id;
      playSpotify(parsed.type === 'track' ? { uris: [uri] } : { context_uri: uri },
        { title: 'Spotify ' + parsed.type, artist: '', img: '', uri: uri, embed: { type: parsed.type, id: parsed.id } });
      dom.linkInput.value = '';
    } else {
      showNotice(
        '<div class="sp-notice-title"><span>⚠️</span> Direct Link Notice</div>' +
        '<div>Please enter a valid Spotify playlist or track URL (e.g. open.spotify.com/playlist/...)</div>',
        true
      );
    }
  }

  function onSearchInput() {
    clearTimeout(S.searchTimer);
    var q = dom.searchInput ? dom.searchInput.value.trim() : '';
    if (!q) {
      dom.resultsBox.innerHTML = '';
      dom.noticeBox.style.display = 'none';
      dom.curatedSection.style.display = '';
      return;
    }
    if (!hasSession()) return;
    S.searchTimer = setTimeout(function () { runSearch(q); }, 700);
  }

  /* ------------------------------------------------------------------ */
  /*  Account bar (login / logout)                                      */
  /* ------------------------------------------------------------------ */
  function focusLoginButton() {
    var b = dom.accountBox && dom.accountBox.querySelector('.sp-nav');
    if (b) { try { b.focus(); b.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }

  function doLogin() {
    lsDel('sp_login_error');
    startLogin().catch(function (e) {
      showNotice('<div class="sp-notice-title"><span>⚠️</span> Login</div><div>' + escapeHtml(e.message) + '</div>', true);
    });
  }

  function doLogout() {
    clearTokens();
    stopWebPlayback();
    clearTimeout(P.pollTimer);
    P.state = null; P.nowUri = null;
    hideNowPlaying();
    dom.resultsBox.innerHTML = '';
    dom.curatedSection.style.display = '';
    renderAccountBar();
  }

  function renderAccountBar() {
    if (!dom.accountBox) return;
    dom.accountBox.innerHTML = '';
    if (hasSession()) {
      lsDel('sp_login_error');
      dom.accountBox.style.display = '';
      dom.accountBox.appendChild(h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:1vw;' }, [
        h('div', { class: 'sp-notice-title', style: 'margin:0;', html: '<span>✅</span> Connected to Spotify' }),
        h('button', { class: 'sp-chip sp-nav', type: 'button', text: 'Log out', onclick: doLogout })
      ]));
      return;
    }
    var err = lsGet('sp_login_error');
    dom.accountBox.style.display = '';
    dom.accountBox.appendChild(h('div', { class: 'sp-notice-title', html: '<span>🎧</span> Log in to play full songs' }));
    dom.accountBox.appendChild(h('div', { text: 'Search and full-length playback need a Spotify Premium login. Music plays on your Spotify device (phone, speaker, Spotify TV app) or on this TV when supported.' }));
    if (err) {
      dom.accountBox.appendChild(h('div', { style: 'color:#ff8a80;margin-top:0.6vh;', text: 'Login failed: ' + err }));
    }
    dom.accountBox.appendChild(h('button', {
      class: 'sp-btn-action sp-nav', type: 'button', text: 'Log in with Spotify',
      style: 'margin-top:1vh;padding:1.1vh 1.4vw;', onclick: doLogin
    }));
  }

  /* ------------------------------------------------------------------ */
  /*  Spotify search                                                    */
  /* ------------------------------------------------------------------ */
  function runSearch(query, more) {
    query = (query || '').trim();
    if (!query) return;
    if (!hasSession()) { renderAccountBar(); focusLoginButton(); return; }

    if (!more) {
      S.lastQuery = query;
      S.offset = 0;
      dom.resultsBox.innerHTML = '<div style="padding: 2.5vh 0; text-align: center; color: var(--sp-dim); font-size: 0.9rem;">🔎 Searching Spotify for "<strong>' + escapeHtml(query) + '</strong>"...</div>';
    }

    api('/search?q=' + encodeURIComponent(query) + '&type=track,playlist&limit=' + CONFIG.PAGE_SIZE + '&offset=' + S.offset)
      .then(function (res) {
        dom.curatedSection.style.display = 'none';
        dom.noticeBox.style.display = 'none';
        renderSpotifyResults(res, query, !!more);
      })
      .catch(handleSearchError);
  }

  function handleSearchError(err) {
    var msg;
    if (err && err.message === 'AUTH_REQUIRED') {
      renderAccountBar();
      msg = 'Your Spotify session expired. Please log in again.';
    } else if (err && err.status === 403) {
      msg = 'Spotify refused the search. In Development Mode only users added under "Users and Access" (max 5) can log in, and the app owner needs Premium.';
    } else {
      msg = (err && err.message) || 'Search failed.';
    }
    dom.resultsBox.innerHTML = '<div style="padding: 2.5vh 0; text-align: center; color: var(--sp-dim);">' + escapeHtml(msg) + '</div>';
    dom.curatedSection.style.display = '';
  }

  function renderSpotifyResults(data, query, append) {
    var tracks = ((data.tracks && data.tracks.items) || []).filter(Boolean).map(function (t) {
      var imgs = (t.album && t.album.images) || [];
      return {
        kind: 'track', uri: t.uri, title: t.name,
        sub: (t.artists || []).map(function (a) { return a.name; }).join(', ') + (t.album && t.album.name ? ' · ' + t.album.name : ''),
        artist: (t.artists || []).map(function (a) { return a.name; }).join(', '),
        img: imgs.length ? imgs[Math.min(1, imgs.length - 1)].url : ''
      };
    });
    var lists = ((data.playlists && data.playlists.items) || []).filter(Boolean).map(function (p) {
      return {
        kind: 'playlist', uri: p.uri, title: p.name,
        sub: 'Playlist · ' + (p.owner && p.owner.display_name ? p.owner.display_name : 'Spotify'),
        artist: 'Playlist', img: p.images && p.images[0] ? p.images[0].url : ''
      };
    });
    var items = tracks.concat(lists);

    if (!items.length && !append) {
      dom.resultsBox.innerHTML = '<div style="padding: 2.5vh 0; text-align: center; color: var(--sp-dim);">No results for "<strong>' + escapeHtml(query) + '</strong>". Try another artist, track or workout vibe.</div>';
      dom.curatedSection.style.display = '';
      return;
    }

    var trackUris = tracks.map(function (t) { return t.uri; });
    var list;
    if (append && dom.resultsBox.__list) {
      list = dom.resultsBox.__list;
      if (dom.resultsBox.__more) dom.resultsBox.__more.remove();
    } else {
      dom.resultsBox.innerHTML = '';
      dom.resultsBox.appendChild(h('div', { class: 'sp-section-title' }, [
        h('span', { text: 'Spotify results' }),
        h('span', { style: 'font-size: 0.72rem; color: var(--sp-dim); font-weight: 600;', text: 'Press OK to Play' })
      ]));
      list = h('div', { class: 'sp-cards-list', style: 'margin-top: 1vh;' });
      dom.resultsBox.appendChild(list);
      dom.resultsBox.__list = list;
    }

    items.forEach(function (item) {
      var isCur = P.nowUri && P.nowUri === item.uri;
      var card = h('div', {
        class: 'sp-card sp-nav' + (isCur ? ' sp-playing' : ''),
        'data-uri': item.uri, tabindex: '0', role: 'button',
        onclick: function () {
          var meta = { title: item.title, artist: item.artist, img: item.img, uri: item.uri };
          if (item.kind === 'track') {
            // queue the whole result list, starting at the chosen track
            playSpotify({ uris: trackUris, offset: { uri: item.uri } }, meta);
          } else {
            playSpotify({ context_uri: item.uri }, meta);
          }
        }
      }, [
        item.img ? h('img', { class: 'sp-card-thumb', src: item.img, alt: item.title, onerror: function () { this.style.display = 'none'; } })
                 : h('div', { class: 'sp-card-thumb', text: item.kind === 'track' ? '🎵' : '💿' }),
        h('div', { class: 'sp-card-body' }, [
          h('div', { class: 'sp-card-title', text: item.title }),
          h('div', { class: 'sp-card-sub', text: item.sub })
        ]),
        h('div', { class: 'sp-play-pill', html: isCur ? '🔊 PLAYING' : '▶ PLAY' })
      ]);
      list.appendChild(card);
    });

    // Dev Mode caps each page at 10 → offer paging
    var total = Math.max((data.tracks && data.tracks.total) || 0, (data.playlists && data.playlists.total) || 0);
    if (S.offset + CONFIG.PAGE_SIZE < Math.min(total, 1000)) {
      dom.resultsBox.__more = h('button', {
        class: 'sp-btn-action sp-nav', type: 'button', text: 'Show more',
        style: 'margin-top:1vh;padding:1.1vh 1.4vw;width:100%;',
        onclick: function () { S.offset += CONFIG.PAGE_SIZE; runSearch(S.lastQuery, true); }
      });
      dom.resultsBox.appendChild(dom.resultsBox.__more);
    } else {
      dom.resultsBox.__more = null;
    }
  }

  function showNotice(html, isWarn) {
    if (!dom.noticeBox) return;
    dom.noticeBox.innerHTML = html + '<button class="sp-notice-close" aria-label="Dismiss notice" onclick="this.parentElement.style.display=\'none\'">✕</button>';
    dom.noticeBox.style.display = '';
  }

  /* ------------------------------------------------------------------ */
  /*  TV Remote Navigation Engine                                        */
  /* ------------------------------------------------------------------ */
  function getNavElements() {
    if (!dom.root) return [];
    var all = Array.from(dom.root.querySelectorAll('.sp-nav:not([disabled])'));
    return all.filter(function (el) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function navigateDpad(dir) {
    var items = getNavElements();
    if (!items.length) return;

    var cur = document.activeElement;
    if (!cur || !dom.root.contains(cur)) {
      items[0].focus();
      return;
    }

    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;

    var best = null;
    var bestScore = Infinity;

    items.forEach(function (target) {
      if (target === cur) return;
      var tr = target.getBoundingClientRect();
      var tcx = tr.left + tr.width / 2;
      var tcy = tr.top + tr.height / 2;

      var dx = tcx - cx;
      var dy = tcy - cy;

      var main = 0, cross = 0;
      if (dir === 'Up') {
        if (dy >= -2) return;
        main = -dy;
        cross = Math.abs(dx);
      } else if (dir === 'Down') {
        if (dy <= 2) return;
        main = dy;
        cross = Math.abs(dx);
      } else if (dir === 'Left') {
        if (dx >= -2) return;
        main = -dx;
        cross = Math.abs(dy);
      } else if (dir === 'Right') {
        if (dx <= 2) return;
        main = dx;
        cross = Math.abs(dy);
      }

      var score = main + cross * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = target;
      }
    });

    if (best) {
      best.focus();
      try {
        best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      } catch (e) {}
    }
  }

  function setupInputListener() {
    if (window.Input && window.Input.addListener) {
      window.Input.addListener(function (action) {
        if (!S.open) return;

        var curEl = document.activeElement;
        var editing = isEditing(curEl) && dom.root.contains(curEl);

        if (action === window.Input.ACTIONS.BACK) {
          if (editing) { finishEditing(curEl); return; }  // first Back only leaves the field
          requestClose();
          return;
        }

        if (action === window.Input.ACTIONS.OK) {
          var cur = curEl;
          if (cur && dom.root.contains(cur)) {
            if (cur === dom.searchInput || cur === dom.linkInput) {
              if (cur.readOnly) {
                unlockInput(cur);          // Enter #1: request keyboard
              } else {
                submitInput(cur);          // Enter #2: submit + hide keyboard
                finishEditing(cur);
              }
            } else {
              cur.click();
            }
          } else {
            var items = getNavElements();
            if (items.length) items[0].focus();
          }
          return;
        }

        if (editing) {
          // Left/Right belong to the text caret while typing
          if (action === window.Input.ACTIONS.LEFT || action === window.Input.ACTIONS.RIGHT) return;
          // Up/Down leave the field (and hide the keyboard) before navigating
          finishEditing(curEl);
        }

        var dirMap = {
          UP: 'Up',
          DOWN: 'Down',
          LEFT: 'Left',
          RIGHT: 'Right'
        };
        if (dirMap[action]) {
          navigateDpad(dirMap[action]);
        }
      });
    } else {
      // Fallback only if central Input engine is absent
      window.addEventListener('keydown', function (e) {
        if (!S.open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          requestClose();
          return;
        }
        var map = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
        if (map[e.key]) {
          var activeTag = document.activeElement ? document.activeElement.tagName : '';
          if (activeTag === 'INPUT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            return;
          }
          e.preventDefault();
          navigateDpad(map[e.key]);
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Public Open & Close Controls                                      */
  /* ------------------------------------------------------------------ */
  function open() {
    buildDrawer();
    lastFocusedBeforeOpen = (window.Focus && window.Focus.getCurrent) ? window.Focus.getCurrent() : document.activeElement;

    dom.backdrop.classList.add('sp-open');
    dom.root.classList.add('sp-open');
    S.open = true;

    // 1. Suspend global TV Focus engine navigation on background screen
    if (window.Focus) {
      if (typeof window.Focus.suspend === 'function') {
        window.Focus.suspend();
      }
      if (typeof window.Focus.hideFocusRing === 'function') {
        window.Focus.hideFocusRing();
      }
    }

    // 2. Clear focused/pressed classes from background elements
    var bgFocused = document.querySelectorAll('.focusable.focused, .focusable.pressed');
    bgFocused.forEach(function (el) {
      el.classList.remove('focused', 'pressed');
    });

    // 3. Mark background screen container inert / non-clickable
    var screenContainer = document.getElementById('screen-container');
    if (screenContainer) {
      screenContainer.setAttribute('aria-hidden', 'true');
      screenContainer.style.pointerEvents = 'none';
    }

    // 4. Start playback engine + now-playing sync (only if logged in)
    renderAccountBar();
    if (hasSession()) {
      initWebPlayback();
      startTick();
      refreshState(300);
    }

    // 5. Default focus inside drawer
    setTimeout(function () {
      if (dom.searchInput) {
        dom.searchInput.focus();
      } else {
        var navItems = getNavElements();
        if (navItems.length) navItems[0].focus();
      }
    }, 150);
  }

  function requestClose() {
    if (!S.open || !dom.root) return;
    dom.root.classList.remove('sp-open');
    if (dom.backdrop) dom.backdrop.classList.remove('sp-open');
    S.open = false;

    // Make sure no keyboard is left open and inputs are locked again
    if (dom.searchInput) dom.searchInput.blur();
    if (dom.linkInput) dom.linkInput.blur();

    // 1. Restore background screen container interactivity
    var screenContainer = document.getElementById('screen-container');
    if (screenContainer) {
      screenContainer.removeAttribute('aria-hidden');
      screenContainer.style.pointerEvents = '';
    }

    // 2. Stop UI polling. Music keeps playing on the Spotify device (workout companion).
    clearTimeout(P.pollTimer);
    stopTick();

    // 3. Resume global TV Focus engine
    if (window.Focus) {
      if (typeof window.Focus.resume === 'function') {
        window.Focus.resume();
      }
      if (typeof window.Focus.showFocusRing === 'function') {
        window.Focus.showFocusRing();
      }
    }

    // 4. Restore focus to previous background element
    setTimeout(function () {
      if (lastFocusedBeforeOpen && lastFocusedBeforeOpen.isConnected) {
        if (window.Focus && window.Focus.setFocus) {
          window.Focus.setFocus(lastFocusedBeforeOpen);
        } else if (lastFocusedBeforeOpen.focus) {
          lastFocusedBeforeOpen.focus();
        }
      } else if (window.Focus && window.Focus.focusFirstAvailable) {
        window.Focus.focusFirstAvailable();
      }
    }, 180);
  }

  /* ------------------------------------------------------------------ */
  /*  Top Bar Button Binding                                            */
  /* ------------------------------------------------------------------ */
  function bindHeaderButton() {
    var btn = document.getElementById('dash-spotify-btn');
    if (btn && !btn.__spBound) {
      btn.__spBound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        open();
      });
    }
  }

  function watchHeaderButton() {
    bindHeaderButton();
    if (!window.MutationObserver) return;
    new MutationObserver(function () {
      bindHeaderButton();
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ */
  /*  Bootstrap & Exports                                               */
  /* ------------------------------------------------------------------ */
  window.SpotifyOverlay = {
    open: open,
    close: requestClose,
    isOpen: function () { return S.open; },
    play: playSpotify,
    login: startLogin,
    logout: doLogout,
    config: CONFIG
  };

  function boot() {
    handleRedirect().then(function () {
      watchHeaderButton();
      if (lsGet('sp_reopen') === '1') {
        lsDel('sp_reopen');
        setTimeout(open, 350);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
