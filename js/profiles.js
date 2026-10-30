/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Profile Management & Avatar Synchronization
 * Handles local profiles, salted PIN hashing (SubtleCrypto / JS fallback), and avatar cache.
 */

window.Profiles = (function () {
  'use strict';

  const PROFILES_KEY = 'profiles_list';
  const AVATARS_KEY = 'avatars_cache';
  const DEFAULT_PROFILES = [
    {
      id: 'p_child_1',
      name: 'Leo',
      age: 9,
      weight: 32,
      sex: 'male',
      type: 'child',
      avatar: window.Utils ? window.Utils.generateFallbackAvatarSvg('Leo', true, 0) : '',
      pinHash: '',
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    },
    {
      id: 'p_adult_1',
      name: 'Sarah',
      age: 29,
      weight: 64,
      sex: 'female',
      type: 'adult',
      avatar: window.Utils ? window.Utils.generateFallbackAvatarSvg('Sarah', false, 1) : '',
      pinHash: '',
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    }
  ];

  let cachedProfiles = [...DEFAULT_PROFILES];
  let cachedAvatars = null;
  let activeProfile = null;

  /**
   * Salted SHA-256 hash using Web Cryptography API with JS fallback
   */
  async function hashPin(pin) {
    if (!pin) return '';
    const salt = window.CONFIG.PIN.SALT || 'MatPad_TV_Secure_Salt_2026';
    const combined = `${salt}:${pin}:${salt}`;

    if (window.crypto && window.crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(combined);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn('[Profiles] SubtleCrypto failed, using JS fallback hash.');
      }
    }

    // Pure JS fallback hash (FNV-1a 32-bit variant doubled)
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < combined.length; i++) {
      const code = combined.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code;
      h2 = Math.imul(h2, 0x5bd1e995);
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  async function verifyPin(profile, inputPin) {
    if (!profile || !profile.pinHash) return true;
    const computed = await hashPin(inputPin);
    return computed === profile.pinHash;
  }

  async function loadAll() {
    try {
      const list = await window.Storage.get(PROFILES_KEY);
      if (Array.isArray(list) && list.length > 0) {
        cachedProfiles = list;
      } else {
        // Seed initial friendly profiles for immediate out-of-the-box delight
        cachedProfiles = [
          {
            id: 'p_child_1',
            name: 'Leo',
            age: 9,
            weight: 32,
            sex: 'male',
            type: 'child',
            avatar: window.Utils.generateFallbackAvatarSvg('Leo', true, 0),
            pinHash: '',
            createdAt: Date.now() - 86400000,
            updatedAt: Date.now() - 86400000
          },
          {
            id: 'p_adult_1',
            name: 'Sarah',
            age: 29,
            weight: 64,
            sex: 'female',
            type: 'adult',
            avatar: window.Utils.generateFallbackAvatarSvg('Sarah', false, 1),
            pinHash: '', // Unprotected initially for smooth exploration
            createdAt: Date.now() - 172800000,
            updatedAt: Date.now() - 172800000
          }
        ];
        await window.Storage.set(PROFILES_KEY, cachedProfiles);
      }
    } catch (e) {
      cachedProfiles = [];
    }
    return cachedProfiles;
  }

  function getAll() {
    return cachedProfiles;
  }

  function getById(id) {
    return cachedProfiles.find(p => p.id === id) || null;
  }

  async function saveProfile(profileData) {
    const isEdit = Boolean(profileData.id);
    const id = isEdit ? profileData.id : `prof_${Date.now()}`;
    const now = Date.now();

    const profile = {
      id: id,
      name: (profileData.name || 'Player').trim(),
      age: parseInt(profileData.age, 10) || 12,
      weight: parseInt(profileData.weight, 10) || 45,
      sex: profileData.sex || 'male',
      type: profileData.type || 'child',
      avatar: profileData.avatar || window.Utils.generateFallbackAvatarSvg(profileData.name, profileData.type === 'child', 0),
      pinHash: profileData.pinHash || '',
      createdAt: profileData.createdAt || now,
      updatedAt: now
    };

    const existingIdx = cachedProfiles.findIndex(p => p.id === id);
    if (existingIdx !== -1) {
      cachedProfiles[existingIdx] = profile;
    } else {
      cachedProfiles.push(profile);
    }

    await window.Storage.set(PROFILES_KEY, cachedProfiles);

    // Notify native Android bridge
    if (window.Bridge) {
      window.Bridge.onProfileSaved(profile);
    }

    return profile;
  }

  async function deleteProfile(id) {
    const idx = cachedProfiles.findIndex(p => p.id === id);
    if (idx !== -1) {
      cachedProfiles.splice(idx, 1);
      await window.Storage.set(PROFILES_KEY, cachedProfiles);

      if (window.Bridge) {
        window.Bridge.onProfileDeleted(id);
      }
      return true;
    }
    return false;
  }

  function setActiveProfile(profile) {
    activeProfile = profile;
    if (profile && window.Theme) {
      window.Theme.applyProfileTheme(profile);
    }
  }

  function getActiveProfile() {
    return activeProfile;
  }

  /**
   * Load Avatars from remote JSON with local storage caching and SVG fallbacks
   */
  async function loadAvatars() {
    if (cachedAvatars) return cachedAvatars;

    // 1. Check local storage cache
    const stored = await window.Storage.get(AVATARS_KEY);
    if (stored && stored.child && stored.adult) {
      cachedAvatars = stored;
      // Background re-fetch to keep avatars fresh
      refreshAvatarsInBackground();
      return cachedAvatars;
    }

    // 2. Fetch avatars from repo directory (with remote backup fallback)
    try {
      let res;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), window.CONFIG.FETCH_TIMEOUT_MS);
        res = await fetch(window.CONFIG.AVATARS_URL, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (localErr) {
        if (window.CONFIG.REMOTE_BACKUP_BASE_URL) {
          const backupUrl = `${window.CONFIG.REMOTE_BACKUP_BASE_URL}avatars/avatars.json`;
          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(() => controller2.abort(), window.CONFIG.FETCH_TIMEOUT_MS);
          res = await fetch(backupUrl, { signal: controller2.signal });
          clearTimeout(timeoutId2);
          if (!res.ok) throw new Error(`Backup HTTP ${res.status}`);
        } else {
          throw localErr;
        }
      }

      if (res && res.ok) {
        const data = await res.json();
        if (data && (Array.isArray(data.child) || Array.isArray(data.adult))) {
          cachedAvatars = {
            child: data.child || [],
            adult: data.adult || [],
            updatedAt: Date.now()
          };
          await window.Storage.set(AVATARS_KEY, cachedAvatars);
          return cachedAvatars;
        }
      }
    } catch (err) {
      console.warn('[Profiles] Could not fetch avatars, using built-in SVGs:', err.message);
    }

    // 3. Fallback: Generate built-in SVG avatars so creation is never blocked
    cachedAvatars = {
      child: [0, 1, 2, 3, 4, 5, 6, 7].map(i => window.Utils.generateFallbackAvatarSvg(`K${i+1}`, true, i)),
      adult: [0, 1, 2, 3, 4, 5, 6, 7].map(i => window.Utils.generateFallbackAvatarSvg(`A${i+1}`, false, i)),
      updatedAt: Date.now()
    };
    return cachedAvatars;
  }

  async function refreshAvatarsInBackground() {
    try {
      const res = await fetch(window.CONFIG.AVATARS_URL + `?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && (data.child || data.adult)) {
          cachedAvatars = {
            child: data.child || [],
            adult: data.adult || [],
            updatedAt: Date.now()
          };
          await window.Storage.set(AVATARS_KEY, cachedAvatars);
        }
      }
    } catch (e) {}
  }

  return {
    loadAll,
    getAll,
    getById,
    saveProfile,
    deleteProfile,
    setActiveProfile,
    getActiveProfile,
    hashPin,
    verifyPin,
    loadAvatars
  };
})();
