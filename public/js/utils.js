/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Utility Functions & Embedded SVG Icons
 */

window.Utils = (function () {
  'use strict';

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, delay);
    };
  }

  function throttle(fn, limit) {
    let inThrottle = false;
    let lastArgs = null;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => {
          inThrottle = false;
          if (lastArgs) {
            fn.apply(this, lastArgs);
            lastArgs = null;
          }
        }, limit);
      } else {
        lastArgs = args;
      }
    };
  }

  function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDuration(totalSeconds) {
    const sec = parseInt(totalSeconds, 10);
    if (isNaN(sec) || sec <= 0) return '0 min';

    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }
    return `${minutes} min`;
  }

  /**
   * Parse YouTube Video ID from any format:
   * youtu.be/ID, youtube.com/watch?v=ID, embed/ID, shorts/ID, live/ID
   */
  function parseYouTubeId(url) {
    if (!url || typeof url !== 'string') return '';
    const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : '';
  }

  function getYouTubeThumbnailCandidates(ytId) {
    if (!ytId) return [];
    return [
      `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`,
      `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`
    ];
  }

  /**
   * Generates a colorful fallback SVG data URL for missing banners
   */
  function generateFallbackBanner(title = 'MatPad', subtitle = 'Activity') {
    const safeTitle = escapeHTML(title);
    const safeSubtitle = escapeHTML(subtitle);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a101f"/>
            <stop offset="100%" stop-color="#04060b"/>
          </linearGradient>
          <radialGradient id="glow" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="600" height="400" fill="url(#bg)"/>
        <rect width="600" height="400" fill="url(#glow)"/>
        <circle cx="300" cy="180" r="45" fill="#00e5ff" fill-opacity="0.15" stroke="#00e5ff" stroke-width="2"/>
        <polygon points="292,165 315,180 292,195" fill="#00e5ff"/>
        <text x="300" y="270" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-weight="bold" font-size="24">${safeTitle}</text>
        <text x="300" y="305" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-weight="600" font-size="16" letter-spacing="2">${safeSubtitle.toUpperCase()}</text>
      </svg>
    `.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /**
   * Generates built-in fallback SVG avatars if remote avatars JSON fails or offline
   */
  function generateFallbackAvatarSvg(name = 'M', isChild = false, index = 0) {
    const initials = (name.trim().charAt(0) || 'M').toUpperCase();
    const childPalettes = [
      { bg1: '#ff007f', bg2: '#7928ca', text: '#ffffff' },
      { bg1: '#00f0ff', bg2: '#0070f3', text: '#05070f' },
      { bg1: '#ffea00', bg2: '#ff9100', text: '#05070f' },
      { bg1: '#00e676', bg2: '#00b0ff', text: '#05070f' },
      { bg1: '#7928ca', bg2: '#ff0080', text: '#ffffff' }
    ];

    const adultPalettes = [
      { bg1: '#0f172a', bg2: '#0284c7', text: '#38bdf8' },
      { bg1: '#18181b', bg2: '#16a34a', text: '#4ade80' },
      { bg1: '#1e1b4b', bg2: '#9333ea', text: '#c084fc' },
      { bg1: '#0f172a', bg2: '#dc2626', text: '#f87171' },
      { bg1: '#1e293b', bg2: '#475569', text: '#f1f5f9' }
    ];

    const palList = isChild ? childPalettes : adultPalettes;
    const pal = palList[index % palList.length];

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="avGrad${index}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${pal.bg1}"/>
            <stop offset="100%" stop-color="${pal.bg2}"/>
          </linearGradient>
        </defs>
        <rect width="160" height="160" rx="80" fill="url(#avGrad${index})"/>
        <text x="80" y="98" text-anchor="middle" fill="${pal.text}" font-family="sans-serif" font-weight="900" font-size="64">${initials}</text>
      </svg>
    `.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /**
   * Embedded SVG Icons for zero-dependency TV UI
   */
  const ICONS = {
    arrowLeft: '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
    gamepad: '<svg viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>',
    run: '<svg viewBox="0 0 24 24"><path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 6.5 1.4z"/></svg>',
    games: '<svg viewBox="0 0 24 24"><path d="M15 7.5V2H9v5.5l3 3 3-3zM7.5 9H2v6h5.5l3-3-3-3zM9 16.5V22h6v-5.5l-3-3-3 3zM16.5 9l-3 3 3 3H22V9h-5.5z"/></svg>',
    relax: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
    cardio: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    backspace: '<svg viewBox="0 0 24 24"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z"/></svg>'
  };

  function getIcon(name) {
    return ICONS[name] || '';
  }

  return {
    debounce,
    throttle,
    escapeHTML,
    formatDuration,
    parseYouTubeId,
    getYouTubeThumbnailCandidates,
    generateFallbackBanner,
    generateFallbackAvatarSvg,
    getIcon
  };
})();
