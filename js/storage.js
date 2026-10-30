/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Persistent Storage Layer
 * IndexedDB with automatic graceful localStorage fallback and quota handling.
 */

window.Storage = (function () {
  'use strict';

  const DB_NAME = window.CONFIG.IDB_NAME || 'matpad_tv_db';
  const STORE_NAME = window.CONFIG.IDB_STORE || 'cache_store';
  const CACHE_VERSION = window.CONFIG.CACHE_VERSION || 1;

  let dbPromise = null;
  let useFallback = false;

  function initDB() {
    if (dbPromise) return dbPromise;

    if (!('indexedDB' in window)) {
      useFallback = true;
      return Promise.resolve(null);
    }

    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, CACHE_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => {
          useFallback = true;
          resolve(null);
        };
      } catch (err) {
        useFallback = true;
        resolve(null);
      }
    });

    return dbPromise;
  }

  async function get(key) {
    try {
      const db = await initDB();
      if (!db || useFallback) {
        const item = localStorage.getItem(`matpad_${key}`);
        return item ? JSON.parse(item) : null;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => {
            const item = localStorage.getItem(`matpad_${key}`);
            resolve(item ? JSON.parse(item) : null);
          };
        } catch (e) {
          const item = localStorage.getItem(`matpad_${key}`);
          resolve(item ? JSON.parse(item) : null);
        }
      });
    } catch (e) {
      try {
        const item = localStorage.getItem(`matpad_${key}`);
        return item ? JSON.parse(item) : null;
      } catch (err) {
        return null;
      }
    }
  }

  async function set(key, value) {
    try {
      const db = await initDB();
      if (!db || useFallback) {
        localStorage.setItem(`matpad_${key}`, JSON.stringify(value));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(value, key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => {
            try {
              localStorage.setItem(`matpad_${key}`, JSON.stringify(value));
            } catch (err) {}
            resolve(true);
          };
        } catch (e) {
          try {
            localStorage.setItem(`matpad_${key}`, JSON.stringify(value));
          } catch (err) {}
          resolve(true);
        }
      });
    } catch (e) {
      try {
        localStorage.setItem(`matpad_${key}`, JSON.stringify(value));
      } catch (err) {}
      return false;
    }
  }

  async function del(key) {
    try {
      const db = await initDB();
      if (!db || useFallback) {
        localStorage.removeItem(`matpad_${key}`);
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  return {
    get,
    set,
    del
  };
})();
