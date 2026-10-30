/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Persistent Storage Layer
 * IndexedDB with automatic timeouts, localStorage fallback, and memory fallback.
 * Guaranteed never to hang or block boot on any browser / WebView / GitHub Pages.
 */

window.Storage = (function () {
  'use strict';

  const DB_NAME = window.CONFIG.IDB_NAME || 'matpad_tv_db';
  const STORE_NAME = window.CONFIG.IDB_STORE || 'cache_store';
  const CACHE_VERSION = window.CONFIG.CACHE_VERSION || 1;

  let dbPromise = null;
  let useFallback = false;
  const memoryStore = new Map();

  function memoryGet(key) {
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  }

  function memorySet(key, val) {
    memoryStore.set(key, val);
    return true;
  }

  function memoryDel(key) {
    memoryStore.delete(key);
    return true;
  }

  function lsGet(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        const item = localStorage.getItem(`matpad_${key}`);
        return item ? JSON.parse(item) : memoryGet(key);
      }
    } catch (e) {}
    return memoryGet(key);
  }

  function lsSet(key, value) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`matpad_${key}`, JSON.stringify(value));
      }
    } catch (e) {}
    memorySet(key, value);
    return true;
  }

  function lsDel(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`matpad_${key}`);
      }
    } catch (e) {}
    memoryDel(key);
    return true;
  }

  function initDB() {
    if (dbPromise) return dbPromise;

    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      useFallback = true;
      return Promise.resolve(null);
    }

    dbPromise = new Promise((resolve) => {
      let isSettled = false;
      const safeResolve = (val) => {
        if (!isSettled) {
          isSettled = true;
          resolve(val);
        }
      };

      // Strict 600ms timeout: if IndexedDB hangs, fall back immediately
      const timer = setTimeout(() => {
        useFallback = true;
        safeResolve(null);
      }, 600);

      try {
        const req = indexedDB.open(DB_NAME, CACHE_VERSION);

        req.onupgradeneeded = (e) => {
          try {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME);
            }
          } catch (err) {}
        };

        req.onsuccess = (e) => {
          clearTimeout(timer);
          safeResolve(e.target.result);
        };

        req.onerror = () => {
          clearTimeout(timer);
          useFallback = true;
          safeResolve(null);
        };

        req.onblocked = () => {
          clearTimeout(timer);
          useFallback = true;
          safeResolve(null);
        };
      } catch (err) {
        clearTimeout(timer);
        useFallback = true;
        safeResolve(null);
      }
    });

    return dbPromise;
  }

  async function get(key) {
    try {
      const db = await initDB();
      if (!db || useFallback) {
        return lsGet(key);
      }

      return await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve(lsGet(key));
          }
        }, 500);

        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(key);

          req.onsuccess = () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(req.result !== undefined ? req.result : lsGet(key));
            }
          };

          req.onerror = () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(lsGet(key));
            }
          };

          tx.onerror = () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(lsGet(key));
            }
          };
        } catch (e) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(lsGet(key));
          }
        }
      });
    } catch (e) {
      return lsGet(key);
    }
  }

  async function set(key, value) {
    try {
      lsSet(key, value); // Keep localStorage and memory in sync immediately
      const db = await initDB();
      if (!db || useFallback) {
        return true;
      }

      return await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(value, key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(true);
          tx.onerror = () => resolve(true);
        } catch (e) {
          resolve(true);
        }
      });
    } catch (e) {
      return true;
    }
  }

  async function del(key) {
    try {
      lsDel(key);
      const db = await initDB();
      if (!db || useFallback) {
        return true;
      }

      return await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(true);
          tx.onerror = () => resolve(true);
        } catch (e) {
          resolve(true);
        }
      });
    } catch (e) {
      return true;
    }
  }

  return {
    get,
    set,
    del
  };
})();
