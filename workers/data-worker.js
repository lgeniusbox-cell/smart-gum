/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Data Web Worker
 * Offloads JSON parsing, cache diffing, and sanitization from the main UI thread.
 */

self.onmessage = function (e) {
  const { id, type, payload } = e.data || {};
  if (!type) return;

  try {
    let result = null;

    switch (type) {
      case 'PARSE_INDEX': {
        // payload: raw text from index.txt
        const text = (payload || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
        const num = parseInt(text, 10);
        result = isNaN(num) ? 0 : Math.max(0, num);
        break;
      }

      case 'DIFF_ITEMS': {
        // payload: { localIndices: number[], remoteMax: number }
        const { localIndices = [], remoteMax = 0 } = payload;
        const localSet = new Set(localIndices);
        const missing = [];
        for (let i = 1; i <= remoteMax; i++) {
          if (!localSet.has(i)) {
            missing.push(i);
          }
        }
        result = missing;
        break;
      }

      case 'SANITIZE_ITEMS': {
        // payload: raw items array
        const rawItems = payload || [];
        result = rawItems.filter(Boolean).map(item => {
          return {
            id: item.id || Date.now(),
            type: item.type || 'unknown',
            title: item.title || item.name || 'Untitled',
            url: item.url || '',
            banner: item.banner || '',
            place: item.place || '',
            genre: item.genre || '',
            duration: typeof item.duration === 'number' ? item.duration : 0,
            trim: item.trim || null,
            keymapping: item.keymapping || {},
            script: item.script || {}
          };
        });
        break;
      }

      default:
        result = null;
    }

    self.postMessage({ id, success: true, result });
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
