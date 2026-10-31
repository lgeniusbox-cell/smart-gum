/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Java <-> JavaScript Android WebView Bridge
 * Safe communication layer wrapping window.Android with browser fallbacks.
 */

window.Bridge = (function () {
  'use strict';

  function onRunBuffer(status) {
  callNative('onRunBuffer', JSON.stringify(status));
}

function onRunStopped(summary) {
  if (!isAvailable()) { console.log('[Bridge SIMULATION] run stopped', summary); return; }
  callNative('onRunStopped', JSON.stringify(summary));
}


  function isAvailable() {
    return typeof window.Android !== 'undefined' && window.Android !== null;
  }

  function callNative(methodName, ...args) {
    if (isAvailable() && typeof window.Android[methodName] === 'function') {
      try {
        window.Android[methodName](...args);
        return true;
      } catch (err) {
        console.error(`[Bridge] Error invoking Android.${methodName}:`, err);
        return false;
      }
    } else {
      // Desktop testing simulation: log nicely
      console.log(`[Bridge SIMULATION] Android.${methodName}:`, ...args);
      return false;
    }
  }

  /**
   * Sanitizes profile payload for native Android interface.
   * STRICT SECURITY RULE: NEVER sends raw PIN or PIN hash!
   */
  function sanitizeProfileForNative(profile) {
    if (!profile) return '{}';
    const safeData = {
      id: profile.id,
      name: profile.name,
      age: profile.age,
      weight: profile.weight,
      sex: profile.sex,
      type: profile.type,
      avatar: profile.avatar,
      hasPin: Boolean(profile.pinHash),
      createdAt: profile.createdAt || Date.now(),
      updatedAt: profile.updatedAt || Date.now()
    };
    return JSON.stringify(safeData);
  }

  function onAppReady() {
    callNative('onAppReady');
  }

  function onProfileSaved(profile) {
    const jsonStr = sanitizeProfileForNative(profile);
    callNative('onProfileSaved', jsonStr);
  }

  function onProfileSelected(profile) {
    const jsonStr = sanitizeProfileForNative(profile);
    callNative('onProfileSelected', jsonStr);
  }

  function onProfileDeleted(profileId) {
    callNative('onProfileDeleted', String(profileId));
  }

  function onContentSelected(category, item) {
    const payload = Object.assign({}, item, {
      category: category,
      id: item.id || Date.now()
    });
    callNative('onContentSelected', category, JSON.stringify(payload));
  }

  function onNotification(notif) {
    try {
      callNative('onNotification', JSON.stringify(notif));
    } catch (e) {}
  }

  function onExitRequested() {
    if (isAvailable() && typeof window.Android.onExitRequested === 'function') {
      callNative('onExitRequested');
    } else {
      console.log('[Bridge SIMULATION] Exit application requested');
      if (window.Notify) {
        window.Notify.show({
          type: 'info',
          title: 'Exit Requested',
          message: 'Running in browser. On TV this closes the app.'
        });
      }
    }
  }

  // Setup inbound callback namespace for Java -> JS events
  window.MatPadApp = window.MatPadApp || {};
  window.MatPadApp.onNativeEvent = function (type, jsonString) {
    console.log(`[Bridge INBOUND] Received native event "${type}":`, jsonString);
    let payload = {};
    try {
      if (jsonString) payload = JSON.parse(jsonString);
    } catch (e) {
      payload = { raw: jsonString };
    }

    // Dispatch custom DOM event for modules to react
    const event = new CustomEvent('matpad:nativeEvent', {
      detail: { type, payload }
    });
    window.dispatchEvent(event);

    // Global handling for standard lifecycle events
    if (type === 'pause') {
      if (window.BgController) window.BgController.pause();
      if (window.Input) window.Input.pause();
    } else if (type === 'resume') {
      if (window.BgController) window.BgController.resume();
      if (window.Input) window.Input.resume();
    } else if (type === 'backPressed') {
      if (window.Router) window.Router.handleBack();
    }
  };

  return {
    isAvailable,
    onAppReady,
    onProfileSaved,
    onProfileSelected,
    onProfileDeleted,
    onContentSelected,
    onNotification,
    onExitRequested,
       onRunBuffer,
   onRunStopped
  };
})();
