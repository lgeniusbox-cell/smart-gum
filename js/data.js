/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Content Loader & Cache Sync Engine
 * Incremental batch downloading (batches of 3), offline caching, and YouTube thumbnail processing.
 */

window.Data = (function () {
  'use strict';

  const syncingCategories = new Set();

  function getCategoryCacheKey(category) {
    return `category_cache_${category}`;
  }

  async function getLocalCategoryData(category) {
    const key = getCategoryCacheKey(category);
    const cached = await window.Storage.get(key);
    if (cached && typeof cached === 'object' && cached.items) {
      return cached;
    }
    return {
      lastIndex: 0,
      items: {},
      updatedAt: 0
    };
  }

  async function saveLocalCategoryData(category, cacheObj) {
    const key = getCategoryCacheKey(category);
    await window.Storage.set(key, cacheObj);
  }

  function getItemsArray(cacheObj) {
    if (!cacheObj || !cacheObj.items) return [];
    return Object.keys(cacheObj.items)
      .map(k => parseInt(k, 10))
      .sort((a, b) => a - b)
      .map(k => cacheObj.items[k])
      .filter(Boolean);
  }

  /**
   * Syncs category in background against GitHub raw
   */
  async function syncCategory(category, onNewItemCallback) {
    if (syncingCategories.has(category)) return;
    syncingCategories.add(category);

    const folder = window.CONFIG.CATEGORIES[category.toUpperCase()] || category;
    const baseUrl = `${window.CONFIG.BASE_URL}${folder}/`;
    const indexUrl = `${baseUrl}index.txt?t=${Date.now()}`;

    let cache = await getLocalCategoryData(category);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), window.CONFIG.FETCH_TIMEOUT_MS);
      const res = await fetch(indexUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const rawText = await res.text();
      const cleanText = rawText.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
      const remoteN = parseInt(cleanText, 10);

      if (isNaN(remoteN) || remoteN < 0) {
        throw new Error('Invalid index integer in remote index.txt');
      }

      console.log(`[Data] Category "${category}": remote N = ${remoteN}, local lastIndex = ${cache.lastIndex}`);

      if (remoteN < cache.lastIndex) {
        // Content was removed or reset on server
        console.warn(`[Data] Remote index lowered from ${cache.lastIndex} to ${remoteN}. Resetting cache.`);
        cache = { lastIndex: 0, items: {}, updatedAt: Date.now() };
        await saveLocalCategoryData(category, cache);
      }

      if (remoteN > cache.lastIndex) {
        // Fetch missing items in small parallel batches (e.g. 3 at a time)
        const missingNumbers = [];
        for (let i = cache.lastIndex + 1; i <= remoteN; i++) {
          missingNumbers.push(i);
        }

        const batchSize = window.CONFIG.BATCH_SIZE || 3;
        for (let b = 0; b < missingNumbers.length; b += batchSize) {
          const batch = missingNumbers.slice(b, b + batchSize);
          await Promise.all(batch.map(async (num) => {
            const item = await fetchContentItem(baseUrl, num, category);
            if (item) {
              cache.items[num] = item;
              cache.lastIndex = Math.max(cache.lastIndex, num);
              cache.updatedAt = Date.now();
              await saveLocalCategoryData(category, cache);

              if (typeof onNewItemCallback === 'function') {
                onNewItemCallback(item);
              }
            }
          }));
        }

        if (window.Notify) {
          window.Notify.show({
            type: 'success',
            title: window.t(category),
            message: 'Catalog synchronized with newest content.',
            duration: 3000
          });
        }
      }
    } catch (err) {
      console.warn(`[Data] Offline or sync error for "${category}":`, err.message);
      // Offline mode feedback
      if (window.Notify) {
        window.Notify.show({
          type: 'info',
          title: 'Offline Mode',
          message: window.t('offline_mode'),
          duration: 3500
        });
      }

      // If cache is completely empty, populate high-quality mock data so user can experience the app immediately
      if (Object.keys(cache.items).length === 0) {
        console.log(`[Data] Seeding offline demonstration items for "${category}"...`);
        seedFallbackItems(category, cache);
        await saveLocalCategoryData(category, cache);
        if (typeof onNewItemCallback === 'function') {
          getItemsArray(cache).forEach(onNewItemCallback);
        }
      }
    } finally {
      syncingCategories.delete(category);
    }

    return cache;
  }

  async function fetchContentItem(baseUrl, itemNum, category, retryCount = 0) {
    const itemUrl = `${baseUrl}v${itemNum}.json?t=${Date.now()}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), window.CONFIG.FETCH_TIMEOUT_MS);
      const res = await fetch(itemUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const rawJson = await res.json();
      return sanitizeItem(rawJson, itemNum, category);
    } catch (e) {
      if (retryCount < (window.CONFIG.MAX_RETRY_ATTEMPTS || 2)) {
        await new Promise(r => setTimeout(r, 600));
        return fetchContentItem(baseUrl, itemNum, category, retryCount + 1);
      }
      console.warn(`[Data] Failed to load ${itemUrl} after retries.`);
      return null;
    }
  }

  function sanitizeItem(raw, id, category) {
    if (!raw || typeof raw !== 'object') return null;

    const isRun = category === 'virtual_run' || raw.type === 'virtual_run';
    const title = raw.title || raw.name || (isRun ? `Scenic Run #${id}` : `Game Quest #${id}`);
    const ytId = window.Utils.parseYouTubeId(raw.url || '');

    let banner = raw.banner || '';
    let thumbCandidates = [];

    if (ytId) {
      thumbCandidates = window.Utils.getYouTubeThumbnailCandidates(ytId);
      if (!banner) banner = thumbCandidates[0];
    }

    if (!banner) {
      banner = window.Utils.generateFallbackBanner(title, raw.place || raw.genre || category);
    }

    return {
      id: id,
      type: raw.type || (isRun ? 'virtual_run' : 'game'),
      url: raw.url || '',
      title: title,
      banner: banner,
      thumbCandidates: thumbCandidates,
      place: raw.place || (isRun ? 'Mountain' : ''),
      genre: raw.genre || (isRun ? 'Trail' : 'Arcade'),
      duration: typeof raw.duration === 'number' ? raw.duration : (isRun ? 1800 : 600),
      trim: raw.trim || null,
      source: raw.source || '',
      keymapping: raw.keymapping || {},
      script: raw.script || {}
    };
  }

  function seedFallbackItems(category, cache) {
    if (category === 'virtual_run') {
      const runs = [
        {
          id: 1,
          type: 'virtual_run',
          url: 'https://youtu.be/aZqQmzHLliQ?si=eD9F7eamfQ_zXo7e',
          title: 'Peninsula Road Trail',
          place: 'Mountain',
          duration: 3611,
          trim: { start: 13, end: 3309.4 }
        },
        {
          id: 2,
          type: 'virtual_run',
          url: 'https://youtu.be/k1BneeJTDcU',
          title: 'Tropical Pacific Coastline',
          place: 'Beach',
          duration: 2700,
          trim: { start: 0, end: 2700 }
        },
        {
          id: 3,
          type: 'virtual_run',
          url: 'https://youtu.be/77ZozI0rw7w',
          title: 'Tokyo Neon Night Sprint',
          place: 'City',
          duration: 1850,
          trim: { start: 10, end: 1850 }
        },
        {
          id: 4,
          type: 'virtual_run',
          url: 'https://youtu.be/1La4QzGeaaQ',
          title: 'Alpine Meadow Pass',
          place: 'Forest',
          duration: 3120,
          trim: { start: 5, end: 3100 }
        }
      ];
      runs.forEach((r, idx) => {
        cache.items[idx + 1] = sanitizeItem(r, idx + 1, 'virtual_run');
      });
      cache.lastIndex = runs.length;
    } else {
      const games = [
        {
          id: 1,
          type: 'game',
          source: 'yt-v-interactive',
          url: 'https://youtu.be/2Vv-BfVoq4g',
          title: 'Lava Runner Reflex',
          genre: 'Agility',
          duration: 480,
          keymapping: { up: 1, down: 2, left: 3, right: 4 },
          script: {}
        },
        {
          id: 2,
          type: 'game',
          source: 'yt-v-interactive',
          url: 'https://youtu.be/kJQP7kiw5Fk',
          title: 'Rhythm Tile Dash',
          genre: 'Music & Beat',
          duration: 600,
          keymapping: { pad_1: 'left', pad_2: 'right' },
          script: {}
        },
        {
          id: 3,
          type: 'game',
          source: 'yt-v-interactive',
          url: 'https://youtu.be/fJ9rUzIMcZQ',
          title: 'Target Dodge Extreme',
          genre: 'Precision',
          duration: 900,
          keymapping: {},
          script: {}
        }
      ];
      games.forEach((g, idx) => {
        cache.items[idx + 1] = sanitizeItem(g, idx + 1, 'games');
      });
      cache.lastIndex = games.length;
    }
  }

  return {
    getLocalCategoryData,
    getItemsArray,
    syncCategory
  };
})();
