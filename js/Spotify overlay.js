/*!
 * spotify-overlay.js
 * Self-contained Spotify overlay for the matpad page (TV remote + touch).
 *
 * HOW TO USE
 *   1. Paste your Client ID in CONFIG.CLIENT_ID below.
 *   2. Add  <script src="spotify-overlay.js"></script>  at the end of index.html
 *      (or paste this whole file at the end of index.js).
 *   3. In the Spotify dashboard, add this exact Redirect URI:
 *        https://lgeniusbox-cell.github.io/matpad-app/
 *
 * It adds a "Spotify" button before your Settings / Profile button, opens a
 * full-screen overlay (search songs / artists / albums / playlists, open a
 * playlist by link, saved playlists) and plays through Spotify's embed player.
 * Public API: window.SpotifyOverlay.open() / .close()
 */
(function () {
  'use strict';
  if (window.SpotifyOverlay) return;

  /* ------------------------------------------------------------------ */
  /*  CONFIG                                                             */
  /* ------------------------------------------------------------------ */
  var CONFIG = {
    CLIENT_ID: 'PASTE_YOUR_CLIENT_ID',
    // Must match a Redirect URI registered in the Spotify dashboard.
    REDIRECT_URI: location.origin + location.pathname,
    // Optional: URL of your own tiny server that returns
    // {"access_token":"...","expires_in":3600} (Client Credentials flow).
    // If set, no login screen is shown.
    TOKEN_PROXY_URL: '',
    // Optional CSS selector of the header button the Spotify button goes before
    // (e.g. '#settings-btn'). Leave empty to auto-detect Settings / Profile.
    BUTTON_SELECTOR: '',
    PAGE_SIZE: 10 // Spotify caps search at 10 per request
  };

  var API = 'https://api.spotify.com/v1';
  var TOKEN_URL = 'https://accounts.spotify.com/api/token';
  var AUTH_URL = 'https://accounts.spotify.com/authorize';

  /* ------------------------------------------------------------------ */
  /*  Small helpers                                                      */
  /* ------------------------------------------------------------------ */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function lsJson(k, def) { try { var v = JSON.parse(lsGet(k)); return v == null ? def : v; } catch (e) { return def; } }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
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

  function isTV() { return window.__deviceMode === 'tv'; }

  /* ------------------------------------------------------------------ */
  /*  Auth (PKCE, no secret) + optional token proxy                      */
  /* ------------------------------------------------------------------ */
  var memToken = null; // {value, exp}

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
    lsDel('sp_access'); lsDel('sp_exp'); lsDel('sp_refresh');
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
    if (clientIdMissing()) return Promise.reject(new Error('Set CONFIG.CLIENT_ID first.'));
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('This browser cannot do secure login (crypto.subtle needs HTTPS).'));
    }
    var verifier = randomString(96);
    var state = randomString(16);
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      lsSet('sp_verifier', verifier);
      lsSet('sp_state', state);
      lsSet('sp_reopen', '1');
      var q = 'client_id=' + encodeURIComponent(CONFIG.CLIENT_ID) +
        '&response_type=code' +
        '&redirect_uri=' + encodeURIComponent(CONFIG.REDIRECT_URI) +
        '&code_challenge_method=S256' +
        '&code_challenge=' + b64url(digest) +
        '&state=' + encodeURIComponent(state);
      window.location.href = AUTH_URL + '?' + q;
    });
  }

  // Runs on page load: finish the login if we came back with ?code=...
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

  /* ------------------------------------------------------------------ */
  /*  API                                                                */
  /* ------------------------------------------------------------------ */
  function api(path, retried) {
    return getToken(!!retried).then(function (token) {
      return fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
    }).then(function (r) {
      if (r.status === 401 && !retried) return api(path, true);
      if (r.status === 401) { clearTokens(); throw new Error('AUTH_REQUIRED'); }
      if (r.status === 429) {
        var wait = r.headers.get('Retry-After');
        throw new Error('Spotify is rate limiting requests. Try again in ' + (wait || 'a few') + ' seconds.');
      }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var msg = (j && j.error && (j.error.message || j.error)) || ('Spotify error ' + r.status);
          throw new Error(String(msg));
        }
        return j;
      });
    });
  }

  function img(images) {
    if (!images || !images.length) return '';
    // pick a mid-size image when available
    var best = images[images.length > 1 ? 1 : 0];
    return (best && best.url) || '';
  }

  function names(list) {
    return (list || []).map(function (a) { return a && a.name; }).filter(Boolean).join(', ');
  }

  function norm(type, o, fallbackImg) {
    if (!o || !o.id) return null;
    if (type === 'track') {
      return { type: 'track', id: o.id, name: o.name, sub: names(o.artists) + (o.album && o.album.name ? ' · ' + o.album.name : ''), img: img(o.album && o.album.images) || fallbackImg || '' };
    }
    if (type === 'artist') {
      return { type: 'artist', id: o.id, name: o.name, sub: (o.genres && o.genres.length) ? o.genres.slice(0, 2).join(', ') : 'Artist', img: img(o.images) };
    }
    if (type === 'album') {
      return { type: 'album', id: o.id, name: o.name, sub: names(o.artists) + (o.release_date ? ' · ' + String(o.release_date).slice(0, 4) : ''), img: img(o.images) };
    }
    if (type === 'playlist') {
      return { type: 'playlist', id: o.id, name: o.name, sub: (o.owner && o.owner.display_name) ? 'By ' + o.owner.display_name : 'Playlist', img: img(o.images) };
    }
    return null;
  }

  function search(query, type, offset) {
    var path = '/search?q=' + encodeURIComponent(query) + '&type=' + type + '&limit=' + CONFIG.PAGE_SIZE + '&offset=' + offset;
    return api(path).then(function (j) {
      var box = j[type + 's'] || { items: [], total: 0 };
      var raw = box.items || [];
      return { raw: raw.length, total: box.total || 0, items: raw.map(function (o) { return norm(type, o); }).filter(Boolean) };
    });
  }

  function artistAlbums(id, offset) {
    return api('/artists/' + id + '/albums?include_groups=album,single&limit=' + CONFIG.PAGE_SIZE + '&offset=' + offset).then(function (j) {
      var raw = j.items || [];
      return { raw: raw.length, total: j.total || 0, items: raw.map(function (o) { return norm('album', o); }).filter(Boolean) };
    });
  }

  function albumTracks(id, offset) {
    return api('/albums/' + id + '/tracks?limit=50&offset=' + offset).then(function (j) {
      var raw = j.items || [];
      return { raw: raw.length, total: j.total || 0, items: raw.map(function (o) { return norm('track', o); }).filter(Boolean) };
    });
  }

  function playlistTracks(id, offset) {
    function shape(j) {
      var raw = j.items || [];
      var items = raw.map(function (x) {
        var t = x && (x.track || x.item || x);
        return t && t.type === 'track' ? norm('track', t) : null;
      }).filter(Boolean);
      return { raw: raw.length, total: j.total || 0, items: items };
    }
    var q = '?limit=50&offset=' + offset;
    // Spotify renamed the playlist tracks endpoint in 2026; try the new one first.
    return api('/playlists/' + id + '/items' + q).then(shape).catch(function (e) {
      if (e.message === 'AUTH_REQUIRED') throw e;
      return api('/playlists/' + id + '/tracks' + q).then(shape);
    });
  }

  function playlistMeta(id) {
    return api('/playlists/' + id + '?fields=name').then(function (j) { return j.name || 'Playlist'; });
  }

  function parseSpotifyId(input, kind) {
    var s = String(input || '').trim();
    var m = s.match(new RegExp(kind + '[/:]([A-Za-z0-9]{10,})'));
    if (m) return m[1];
    if (/^[A-Za-z0-9]{10,}$/.test(s)) return s;
    return '';
  }

  /* ------------------------------------------------------------------ */
  /*  Styles                                                             */
  /* ------------------------------------------------------------------ */
  var CSS = '' +
    '.sp-ov{--sp-bg:#0e1310;--sp-panel:#17201a;--sp-line:#2a372e;--sp-text:#f1f5f2;--sp-dim:#9db0a3;--sp-accent:#1ed760;--sp-scale:1;' +
    'position:fixed;inset:0;z-index:2147483000;display:none;flex-direction:column;background:var(--sp-bg);color:var(--sp-text);' +
    'font:calc(16px*var(--sp-scale))/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box}' +
    '.sp-ov *{box-sizing:border-box}' +
    '.sp-ov.sp-open{display:flex}' +
    '.sp-ov.sp-tv{--sp-scale:1.35}' +
    '.sp-ov button,.sp-ov input{font:inherit;color:inherit}' +
    '.sp-ov :focus{outline:3px solid var(--sp-accent);outline-offset:2px}' +
    '.sp-ov :focus:not(:focus-visible){outline:3px solid var(--sp-accent);outline-offset:2px}' +
    '.sp-head{display:flex;align-items:center;gap:.75em;padding:.75em 1em;border-bottom:1px solid var(--sp-line)}' +
    '.sp-title{flex:1;font-weight:700;font-size:1.15em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sp-btn{background:var(--sp-panel);border:1px solid var(--sp-line);border-radius:.6em;padding:.55em 1em;cursor:pointer;min-height:2.4em}' +
    '.sp-btn:hover{border-color:var(--sp-accent)}' +
    '.sp-btn.sp-primary{background:var(--sp-accent);border-color:var(--sp-accent);color:#04120a;font-weight:700}' +
    '.sp-btn.sp-on{border-color:var(--sp-accent);box-shadow:inset 0 -3px 0 var(--sp-accent)}' +
    '.sp-body{flex:1;overflow-y:auto;padding:1em;-webkit-overflow-scrolling:touch}' +
    '.sp-row{display:flex;flex-wrap:wrap;gap:.5em;margin-bottom:.9em;align-items:center}' +
    '.sp-input{flex:1;min-width:10em;background:var(--sp-panel);border:1px solid var(--sp-line);border-radius:.6em;padding:.6em .9em;min-height:2.6em}' +
    '.sp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(150px*var(--sp-scale)),1fr));gap:1em}' +
    '.sp-card{display:flex;flex-direction:column;gap:.4em;text-align:left;background:var(--sp-panel);border:1px solid var(--sp-line);border-radius:.7em;padding:.6em;cursor:pointer}' +
    '.sp-card:hover{border-color:var(--sp-accent)}' +
    '.sp-cover{width:100%;aspect-ratio:1/1;border-radius:.45em;background:#223027 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--sp-dim);font-size:2em}' +
    '.sp-card.sp-artist .sp-cover{border-radius:50%}' +
    '.sp-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
    '.sp-sub{color:var(--sp-dim);font-size:.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sp-msg{padding:2em 1em;text-align:center;color:var(--sp-dim)}' +
    '.sp-msg strong{color:var(--sp-text)}' +
    '.sp-err{color:#ff9b9b}' +
    '.sp-more{display:block;margin:1.2em auto 0}' +
    '.sp-player{border-top:1px solid var(--sp-line);padding:.6em 1em;background:var(--sp-panel);display:none}' +
    '.sp-player.sp-show{display:block}' +
    '.sp-player iframe{width:100%;border:0;border-radius:.7em;display:block}' +
    '.sp-note{color:var(--sp-dim);font-size:.8em;margin-top:.4em}' +
    '.sp-saved{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5em}' +
    '.sp-saved li{display:flex;gap:.5em}' +
    '.sp-saved .sp-btn:first-child{flex:1;text-align:left}' +
    '.sp-float{position:fixed;top:12px;right:12px;z-index:2147482000}' +
    '@media (prefers-reduced-motion:no-preference){.sp-card,.sp-btn{transition:border-color .12s}}';

  function injectCss() {
    if (document.getElementById('sp-style')) return;
    var st = document.createElement('style');
    st.id = 'sp-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /*  Overlay                                                            */
  /* ------------------------------------------------------------------ */
  var S = { open: false, tab: 'search', type: 'track', stack: [], depth: 0, closing: false, reqId: 0 };
  var el = {}; // dom refs
  var searchTimer = null;
  var lastFocus = null;

  var TYPES = [
    { id: 'track', label: 'Songs' },
    { id: 'artist', label: 'Artists' },
    { id: 'album', label: 'Albums' },
    { id: 'playlist', label: 'Playlists' }
  ];

  function build() {
    if (el.root) return;
    injectCss();

    el.title = h('div', { class: 'sp-title', text: 'Spotify' });
    el.back = h('button', { class: 'sp-btn', type: 'button', 'aria-label': 'Back', text: 'Back', onclick: function () { history.back(); } });
    el.close = h('button', { class: 'sp-btn', type: 'button', 'aria-label': 'Close Spotify', text: 'Close', onclick: requestClose });

    // --- root (tabs + search + playlists) ---
    el.tabSearch = h('button', { class: 'sp-btn', type: 'button', text: 'Search', onclick: function () { setTab('search'); } });
    el.tabPlaylists = h('button', { class: 'sp-btn', type: 'button', text: 'Playlists', onclick: function () { setTab('playlists'); } });

    el.input = h('input', { class: 'sp-input', type: 'search', placeholder: 'Song, artist, album or playlist', 'aria-label': 'Search Spotify', autocomplete: 'off' });
    el.input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 500);
    });
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); }
    });
    el.typeBtns = TYPES.map(function (t) {
      return h('button', { class: 'sp-btn', type: 'button', text: t.label, 'data-type': t.id, onclick: function () { S.type = t.id; markTypes(); runSearch(); } });
    });
    el.results = h('div');
    el.searchPanel = h('div', null, [
      h('div', { class: 'sp-row' }, [el.input]),
      h('div', { class: 'sp-row' }, el.typeBtns),
      el.results
    ]);

    el.plInput = h('input', { class: 'sp-input', type: 'text', placeholder: 'Paste a Spotify playlist link', 'aria-label': 'Playlist link', autocomplete: 'off' });
    el.plInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') openPlaylistFromInput(); });
    el.plMsg = h('div', { class: 'sp-msg sp-err', style: 'display:none;padding:.4em 0;text-align:left' });
    el.savedBox = h('ul', { class: 'sp-saved' });
    el.playlistsPanel = h('div', { style: 'display:none' }, [
      h('div', { class: 'sp-row' }, [el.plInput, h('button', { class: 'sp-btn sp-primary', type: 'button', text: 'Open', onclick: openPlaylistFromInput })]),
      el.plMsg,
      h('div', { class: 'sp-name', text: 'Saved playlists', style: 'margin:1em 0 .5em' }),
      el.savedBox
    ]);

    el.rootBox = h('div', null, [
      h('div', { class: 'sp-row' }, [el.tabSearch, el.tabPlaylists]),
      el.searchPanel,
      el.playlistsPanel
    ]);
    el.viewBox = h('div', { style: 'display:none' });
    el.authBox = h('div', { style: 'display:none' });

    el.body = h('div', { class: 'sp-body' }, [el.rootBox, el.viewBox, el.authBox]);

    el.playerFrameBox = h('div');
    el.player = h('div', { class: 'sp-player' }, [
      el.playerFrameBox,
      h('div', { class: 'sp-row', style: 'margin:.5em 0 0' }, [
        h('button', { class: 'sp-btn', type: 'button', text: 'Stop player', onclick: stopPlayer }),
        h('a', { class: 'sp-btn', id: 'sp-open-link', href: '#', target: '_blank', rel: 'noopener', text: 'Open in Spotify', style: 'text-decoration:none' })
      ]),
      h('div', { class: 'sp-note', text: 'Full songs play when you are signed in to Spotify in this app. Otherwise you hear previews.' })
    ]);

    el.root = h('div', { class: 'sp-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Spotify' }, [
      h('div', { class: 'sp-head' }, [el.back, el.title, el.close]),
      el.body,
      el.player
    ]);
    document.body.appendChild(el.root);

    el.root.addEventListener('keydown', onKey, true);
    markTypes();
    renderSaved();
  }

  function markTypes() {
    el.typeBtns.forEach(function (b) {
      b.classList.toggle('sp-on', b.getAttribute('data-type') === S.type);
    });
  }

  function setTab(tab) {
    S.tab = tab;
    el.searchPanel.style.display = tab === 'search' ? '' : 'none';
    el.playlistsPanel.style.display = tab === 'playlists' ? '' : 'none';
    el.tabSearch.classList.toggle('sp-on', tab === 'search');
    el.tabPlaylists.classList.toggle('sp-on', tab === 'playlists');
  }

  /* ---------- history integration so the Android Back button works ---------- */
  function pushHistory() {
    try { history.pushState({ spotify: true }, ''); S.depth++; } catch (e) { /* ignore */ }
  }

  window.addEventListener('popstate', function () {
    if (!S.open) return;
    if (S.closing) { S.closing = false; S.depth = 0; hide(); return; }
    if (S.depth > 0) S.depth--;
    if (S.stack.length > 0) { S.stack.pop(); renderStack(); return; }
    hide();
  });

  function requestClose() {
    if (S.depth > 1) { S.closing = true; try { history.go(-(S.depth - 1)); } catch (e) { hide(); } }
    else if (S.depth === 1) { history.back(); }
    else hide();
  }

  /* ---------- open / close ---------- */
  function open() {
    build();
    lastFocus = document.activeElement;
    el.root.classList.toggle('sp-tv', isTV());
    el.root.classList.add('sp-open');
    S.open = true;
    S.stack = [];
    S.depth = 0;
    pushHistory();
    renderStack();
  }

  function hide() {
    if (!el.root) return;
    clearTimeout(searchTimer);
    stopPlayer();
    el.root.classList.remove('sp-open');
    S.open = false;
    S.stack = [];
    S.depth = 0;
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) { /* ignore */ }
  }

  function renderStack() {
    var top = S.stack[S.stack.length - 1];
    el.back.style.display = S.stack.length ? '' : 'none';
    if (!top) {
      el.title.textContent = 'Spotify';
      el.viewBox.style.display = 'none';
      if (needsAuth()) { showAuth(); return; }
      el.authBox.style.display = 'none';
      el.rootBox.style.display = '';
      setTab(S.tab);
      focusFirst();
      return;
    }
    el.rootBox.style.display = 'none';
    el.authBox.style.display = 'none';
    el.viewBox.style.display = '';
    el.title.textContent = top.title;
    el.viewBox.textContent = '';
    if (top.embed) {
      var row = h('div', { class: 'sp-row' }, [
        h('button', { class: 'sp-btn sp-primary', type: 'button', text: 'Play', onclick: function () { play(top.embed.type, top.embed.id); } })
      ]);
      if (top.embed.type === 'playlist') {
        row.appendChild(h('button', { class: 'sp-btn', type: 'button', text: 'Save playlist', onclick: function (e) { savePlaylist(top.embed.id, top.title, e.currentTarget); } }));
      }
      el.viewBox.appendChild(row);
    }
    var listBox = h('div');
    el.viewBox.appendChild(listBox);
    paginate(listBox, top.fetcher);
    focusFirst();
  }

  function pushView(view) {
    S.stack.push(view);
    pushHistory();
    renderStack();
  }

  function focusFirst() {
    setTimeout(function () {
      if (!S.open) return;
      var target = S.stack.length ? el.viewBox.querySelector('button') : (S.tab === 'search' ? el.input : el.plInput);
      if (target && target.focus) try { target.focus(); } catch (e) { /* ignore */ }
    }, 30);
  }

  /* ---------- auth screen ---------- */
  function needsAuth() {
    return clientIdMissing() || !hasSession();
  }

  function showAuth(message) {
    el.rootBox.style.display = 'none';
    el.viewBox.style.display = 'none';
    el.authBox.style.display = '';
    el.authBox.textContent = '';
    var loginErr = lsGet('sp_login_error');
    if (loginErr) lsDel('sp_login_error');

    if (clientIdMissing()) {
      el.authBox.appendChild(h('div', { class: 'sp-msg' }, [
        h('p', null, [h('strong', { text: 'Spotify is not set up yet.' })]),
        h('p', { text: 'Add your Client ID to CONFIG.CLIENT_ID in spotify-overlay.js, then reload the page.' })
      ]));
      return;
    }
    var box = h('div', { class: 'sp-msg' }, [
      h('p', null, [h('strong', { text: 'Connect Spotify to search and browse.' })]),
      message ? h('p', { class: 'sp-err', text: message }) : null,
      loginErr ? h('p', { class: 'sp-err', text: 'Login failed: ' + loginErr }) : null
    ]);
    var btn = h('button', { class: 'sp-btn sp-primary', type: 'button', text: 'Connect Spotify', onclick: function () {
      startLogin().catch(function (e) { showAuth(e.message); });
    } });
    box.appendChild(btn);
    el.authBox.appendChild(box);
    setTimeout(function () { try { btn.focus(); } catch (e) { /* ignore */ } }, 30);
  }

  function handleApiError(e, container) {
    if (e && e.message === 'AUTH_REQUIRED') { S.stack = []; showAuth('Your Spotify session expired. Connect again.'); return; }
    container.textContent = '';
    container.appendChild(h('div', { class: 'sp-msg' }, [
      h('p', { class: 'sp-err', text: (e && e.message) || 'Something went wrong.' }),
      h('button', { class: 'sp-btn', type: 'button', text: 'Try again', onclick: function () { if (container.__retry) container.__retry(); } })
    ]));
  }

  /* ---------- paginated list ---------- */
  function paginate(container, fetcher) {
    var st = { offset: 0, total: null, items: [], busy: false };
    var myReq = ++S.reqId;
    var grid = h('div', { class: 'sp-grid' });
    var footer = h('div');
    container.textContent = '';
    container.appendChild(grid);
    container.appendChild(footer);

    function more() {
      if (st.busy) return;
      st.busy = true;
      footer.textContent = '';
      footer.appendChild(h('div', { class: 'sp-msg', text: 'Loading…' }));
      fetcher(st.offset).then(function (res) {
        if (myReq !== S.reqId && !S.stack.length) return; // stale search
        st.busy = false;
        st.total = res.total;
        st.offset += res.raw;
        res.items.forEach(function (it) { grid.appendChild(card(it)); });
        st.items = st.items.concat(res.items);
        footer.textContent = '';
        if (!st.items.length) {
          footer.appendChild(h('div', { class: 'sp-msg', text: 'Nothing found.' }));
        } else if (res.raw > 0 && st.offset < st.total) {
          footer.appendChild(h('button', { class: 'sp-btn sp-more', type: 'button', text: 'Load more', onclick: more }));
        }
      }).catch(function (e) {
        st.busy = false;
        footer.textContent = '';
        container.__retry = more;
        handleApiError(e, footer);
      });
    }
    more();
  }

  function card(item) {
    var cover = h('div', { class: 'sp-cover' });
    if (item.img) cover.style.backgroundImage = 'url("' + item.img.replace(/"/g, '%22') + '")';
    else cover.textContent = '♪';
    return h('button', { class: 'sp-card sp-' + item.type, type: 'button', onclick: function () { onItem(item); } }, [
      cover,
      h('div', { class: 'sp-name', text: item.name || '' }),
      h('div', { class: 'sp-sub', text: item.sub || '' })
    ]);
  }

  function onItem(item) {
    if (item.type === 'track') { play('track', item.id); return; }
    if (item.type === 'artist') {
      pushView({ title: item.name, embed: { type: 'artist', id: item.id }, fetcher: function (o) { return artistAlbums(item.id, o); } });
    } else if (item.type === 'album') {
      pushView({ title: item.name, embed: { type: 'album', id: item.id }, fetcher: function (o) { return albumTracks(item.id, o); } });
    } else if (item.type === 'playlist') {
      pushView({ title: item.name, embed: { type: 'playlist', id: item.id }, fetcher: function (o) { return playlistTracks(item.id, o); } });
    }
  }

  /* ---------- search ---------- */
  function runSearch() {
    var q = el.input.value.trim();
    if (!q) { el.results.textContent = ''; return; }
    var type = S.type;
    var listBox = h('div');
    el.results.textContent = '';
    el.results.appendChild(listBox);
    paginate(listBox, function (offset) { return search(q, type, offset); });
  }

  /* ---------- playlists tab ---------- */
  function openPlaylistFromInput() {
    var id = parseSpotifyId(el.plInput.value, 'playlist');
    el.plMsg.style.display = 'none';
    if (!id) {
      el.plMsg.textContent = 'That does not look like a Spotify playlist link.';
      el.plMsg.style.display = '';
      return;
    }
    openPlaylist(id, 'Playlist');
    playlistMeta(id).then(function (name) {
      var top = S.stack[S.stack.length - 1];
      if (top && top.embed && top.embed.id === id) { top.title = name; el.title.textContent = name; }
    }).catch(function () { /* title stays generic */ });
  }

  function openPlaylist(id, title) {
    pushView({ title: title, embed: { type: 'playlist', id: id }, fetcher: function (o) { return playlistTracks(id, o); } });
  }

  function getSaved() { return lsJson('sp_saved', []); }

  function savePlaylist(id, name, btn) {
    var list = getSaved().filter(function (p) { return p.id !== id; });
    list.unshift({ id: id, name: name || 'Playlist' });
    lsSet('sp_saved', JSON.stringify(list.slice(0, 50)));
    renderSaved();
    if (btn) btn.textContent = 'Saved';
  }

  function renderSaved() {
    var list = getSaved();
    el.savedBox.textContent = '';
    if (!list.length) {
      el.savedBox.appendChild(h('li', { class: 'sp-sub', text: 'No saved playlists yet. Open one and choose Save playlist.' }));
      return;
    }
    list.forEach(function (p) {
      el.savedBox.appendChild(h('li', null, [
        h('button', { class: 'sp-btn', type: 'button', text: p.name, onclick: function () { openPlaylist(p.id, p.name); } }),
        h('button', { class: 'sp-btn', type: 'button', 'aria-label': 'Remove ' + p.name, text: 'Remove', onclick: function () {
          lsSet('sp_saved', JSON.stringify(getSaved().filter(function (x) { return x.id !== p.id; })));
          renderSaved();
        } })
      ]));
    });
  }

  /* ---------- embed player ---------- */
  function play(type, id) {
    var height = type === 'track' ? 152 : 232;
    el.playerFrameBox.textContent = '';
    var frame = h('iframe', {
      src: 'https://open.spotify.com/embed/' + type + '/' + id + '?theme=0',
      height: String(height),
      allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
      loading: 'lazy',
      title: 'Spotify player'
    });
    el.playerFrameBox.appendChild(frame);
    var link = el.player.querySelector('#sp-open-link');
    if (link) link.href = 'https://open.spotify.com/' + type + '/' + id;
    el.player.classList.add('sp-show');
  }

  function stopPlayer() {
    if (!el.player) return;
    el.playerFrameBox.textContent = '';
    el.player.classList.remove('sp-show');
  }

  /* ---------- remote control: arrow-key spatial navigation ---------- */
  function visible(e) {
    if (e.disabled) return false;
    var r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
  }

  function onKey(e) {
    var k = e.key;
    if (k === 'Escape' || k === 'BrowserBack' || k === 'GoBack') {
      e.preventDefault(); e.stopPropagation();
      history.back();
      return;
    }
    var dir = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[k];
    if (!dir) return;
    var cur = document.activeElement;
    // let the caret move inside text fields on left/right
    if (cur && cur.tagName === 'INPUT' && (dir === 'Left' || dir === 'Right')) return;
    var nodes = [].slice.call(el.root.querySelectorAll('button,input,a[href]')).filter(visible);
    if (!cur || !el.root.contains(cur) || cur === el.root || cur.tagName === 'IFRAME') {
      if (nodes[0]) { e.preventDefault(); nodes[0].focus(); }
      return;
    }
    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var best = null, bestScore = Infinity;
    nodes.forEach(function (n) {
      if (n === cur) return;
      var q = n.getBoundingClientRect();
      var dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
      var main, cross;
      if (dir === 'Right') { if (dx <= 1) return; main = dx; cross = Math.abs(dy); }
      else if (dir === 'Left') { if (dx >= -1) return; main = -dx; cross = Math.abs(dy); }
      else if (dir === 'Down') { if (dy <= 1) return; main = dy; cross = Math.abs(dx); }
      else { if (dy >= -1) return; main = -dy; cross = Math.abs(dx); }
      var score = main + cross * 2;
      if (score < bestScore) { bestScore = score; best = n; }
    });
    if (best) {
      e.preventDefault();
      best.focus();
      try { best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Header button                                                      */
  /* ------------------------------------------------------------------ */
  var btnEl = null;

  function findReference() {
    if (CONFIG.BUTTON_SELECTOR) {
      var forced = document.querySelector(CONFIG.BUTTON_SELECTOR);
      if (forced) return forced;
    }
    var re = /(setting|settings|profile|profil|param|réglage|reglage|account|compte)/i;
    var cands = document.querySelectorAll('button,a,[role="button"],[onclick],li,div,span');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c.closest && c.closest('.sp-ov')) continue;
      if (c.children.length > 4) continue; // skip big containers
      var label = [c.id, typeof c.className === 'string' ? c.className : '', c.getAttribute('aria-label') || '', c.title || '', (c.textContent || '').trim().slice(0, 24)].join(' ');
      if (re.test(label) && visible(c)) return c;
    }
    return null;
  }

  function makeButtonLike(ref) {
    var b = ref.cloneNode(false);
    b.removeAttribute('id');
    b.removeAttribute('onclick');
    b.removeAttribute('href');
    b.removeAttribute('name');
    b.setAttribute('data-sp-btn', '1');
    b.setAttribute('aria-label', 'Spotify');
    b.setAttribute('title', 'Spotify');
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    var iconOnly = !(ref.textContent || '').trim();
    b.textContent = iconOnly ? '♫' : '♫ Spotify';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(); });
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return b;
  }

  function placeButton() {
    if (btnEl && document.body.contains(btnEl)) return true;
    var ref = findReference();
    if (!ref || !ref.parentNode) return false;
    btnEl = makeButtonLike(ref);
    ref.parentNode.insertBefore(btnEl, ref);
    return true;
  }

  function floatingButton() {
    if (btnEl && document.body.contains(btnEl)) return;
    injectCss();
    btnEl = h('button', { class: 'sp-btn sp-float', type: 'button', 'aria-label': 'Spotify', text: '♫ Spotify', onclick: open });
    btnEl.style.cssText = 'background:#17201a;color:#f1f5f2;border:1px solid #2a372e;border-radius:10px;padding:8px 14px;font:600 15px system-ui,sans-serif;cursor:pointer';
    document.body.appendChild(btnEl);
  }

  function ensureButton() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (placeButton()) { clearInterval(timer); watchButton(); return; }
      if (tries >= 20) { clearInterval(timer); floatingButton(); }
    }, 750);
    if (placeButton()) { clearInterval(timer); watchButton(); }
  }

  // If the page re-renders its header and drops our button, put it back.
  function watchButton() {
    if (!window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        if (!btnEl || !document.body.contains(btnEl)) placeButton();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */
  window.SpotifyOverlay = { open: open, close: requestClose, config: CONFIG };

  function boot() {
    handleRedirect().then(function () {
      ensureButton();
      if (lsGet('sp_reopen') === '1') {
        lsDel('sp_reopen');
        setTimeout(open, 300);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
