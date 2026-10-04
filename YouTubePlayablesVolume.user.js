// ==UserScript==
// @name         YouTube Playables Volume
// @namespace    ModLabs
// @version      1.0.0
// @description  Adds a hover volume slider to YouTube games, including WebAudio sound.
// @author       ModLabs
// @license      Apache License 2.0
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtube.com/*
// @match        https://*.playables.usercontent.goog/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ModLabsCC/Scripts/main/YouTubePlayablesVolume.user.js
// @downloadURL  https://raw.githubusercontent.com/ModLabsCC/Scripts/main/YouTubePlayablesVolume.user.js
// ==/UserScript==

(function () {
  'use strict';

  const installed = Symbol.for('ModLabs.YouTubePlayablesVolume');
  if (window[installed]) return;
  window[installed] = true;
  const channel = 'modlabs.youtube-playables-volume';
  const youtubeOrigins = new Set(['https://www.youtube.com', 'https://m.youtube.com', 'https://youtube.com']);

  function isGameUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.endsWith('.playables.usercontent.goog');
    } catch { return false; }
  }

  function createAudioControl() {
    let volume = 0;
    const buses = new Map();
    const levels = new WeakMap();
    const routedMedia = new WeakSet();
    const seenMedia = new WeakSet();
    const mediaRefs = new Set();
    const mediaPrototype = window.HTMLMediaElement?.prototype;
    const descriptor = mediaPrototype && Object.getOwnPropertyDescriptor(mediaPrototype, 'volume');

    function rememberMedia(element) {
      if (!levels.has(element)) levels.set(element, descriptor.get.call(element));
      if (!seenMedia.has(element)) {
        seenMedia.add(element);
        mediaRefs.add(new WeakRef(element));
      }
      const effectiveVolume = levels.get(element) * (routedMedia.has(element) ? 1 : volume);
      if (descriptor.get.call(element) !== effectiveVolume) descriptor.set.call(element, effectiveVolume);
    }

    // Games may use unattached Audio() elements, not just <audio> in the DOM.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(mediaPrototype, 'volume', {
        ...descriptor,
        get() {
          rememberMedia(this);
          return levels.get(this);
        },
        set(value) {
          const level = Number(value);
          if (!Number.isFinite(level) || level < 0 || level > 1) {
            return descriptor.set.call(this, value);
          }
          levels.set(this, level);
          rememberMedia(this);
        }
      });
      const play = mediaPrototype.play;
      mediaPrototype.play = function (...args) {
        rememberMedia(this);
        return play.apply(this, args);
      };
      if (window.Audio) window.Audio = new Proxy(window.Audio, {
        construct(target, args, newTarget) {
          const element = Reflect.construct(target, args, newTarget);
          rememberMedia(element);
          return element;
        },
        apply(target, receiver, args) {
          const element = Reflect.apply(target, receiver, args);
          rememberMedia(element);
          return element;
        }
      });
      document.addEventListener('play', event => {
        if (event.target instanceof HTMLMediaElement) rememberMedia(event.target);
      }, true);
      const trackMedia = root => {
        if (root instanceof HTMLMediaElement) rememberMedia(root);
        root.querySelectorAll?.('audio, video').forEach(rememberMedia);
      };
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) trackMedia(node);
      }).observe(document, { childList: true, subtree: true });
      trackMedia(document);
    }

    const nodePrototype = window.AudioNode?.prototype;
    if (nodePrototype) {
      const connect = nodePrototype.connect;
      const disconnect = nodePrototype.disconnect;

      function busFor(context) {
        if (!buses.has(context)) {
          const bus = context.createGain();
          bus.gain.value = volume;
          connect.call(bus, context.destination);
          buses.set(context, bus);
          context.addEventListener('statechange', () => {
            if (context.state === 'closed') buses.delete(context);
          });
        }
        return buses.get(context);
      }

      // Unity, Howler and other engines can keep their own gain/mute controls.
      nodePrototype.connect = function (destination, ...args) {
        if (destination === this.context.destination) {
          connect.call(this, busFor(this.context), ...args);
          return destination;
        }
        return connect.call(this, destination, ...args);
      };
      nodePrototype.disconnect = function (...args) {
        if (args[0] === this.context.destination && buses.has(this.context)) {
          args[0] = buses.get(this.context);
        }
        return disconnect.apply(this, args);
      };

      // Media routed through WebAudio must be attenuated only once.
      const prototypes = new Set([window.AudioContext?.prototype, window.webkitAudioContext?.prototype]);
      for (const prototype of prototypes) {
        if (!prototype?.createMediaElementSource || !descriptor) continue;
        const createSource = prototype.createMediaElementSource;
        prototype.createMediaElementSource = function (element, ...args) {
          const source = createSource.call(this, element, ...args);
          routedMedia.add(element);
          rememberMedia(element);
          return source;
        };
      }
    }

    return value => {
      if (value === volume) return;
      volume = value;
      for (const [context, bus] of buses) {
        if (context.state === 'closed') { buses.delete(context); continue; }
        const now = context.currentTime;
        bus.gain.cancelScheduledValues(now);
        if (volume === 0) bus.gain.setValueAtTime(0, now);
        else bus.gain.setTargetAtTime(volume, now, 0.015);
      }
      for (const ref of mediaRefs) {
        const element = ref.deref();
        if (element) rememberMedia(element);
        else mediaRefs.delete(ref);
      }
    };
  }

  function startGameFrame() {
    if (window.parent === window) return;
    const originHint = new URLSearchParams(location.hash.slice(1)).get('origin');
    let parentOrigin = youtubeOrigins.has(originHint) ? originHint : null;
    try {
      const referrerOrigin = new URL(document.referrer).origin;
      if (youtubeOrigins.has(referrerOrigin)) parentOrigin = referrerOrigin;
    } catch { /* The origin in YouTube's iframe URL also works without a referrer. */ }
    if (!parentOrigin) return;
    const setVolume = createAudioControl();
    const ready = () => window.parent.postMessage({ channel, type: 'ready' }, parentOrigin);
    let retry;
    window.addEventListener('message', event => {
      if (event.source !== window.parent || !youtubeOrigins.has(event.origin) || event.data?.channel !== channel) return;
      if (event.data.type === 'query') { ready(); return; }
      const volume = event.data.volume;
      if (event.data.type !== 'volume' || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) return;
      setVolume(volume);
      clearInterval(retry);
    });
    ready();
    retry = setInterval(ready, 1000);
  }

  function startYouTubeControls() {
    const storageKey = 'modlabs.youtube-playables-volume';
    const frames = new Map();
    let controller;
    let volume = 1;
    let lastVolume = 1;

    function loadVolume() {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (typeof saved?.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) volume = saved.volume;
        if (typeof saved?.lastVolume === 'number' && saved.lastVolume > 0 && saved.lastVolume <= 1) lastVolume = saved.lastVolume;
      } catch { /* Storage may be disabled; the slider still works for this page. */ }
    }
    function saveVolume() {
      try { localStorage.setItem(storageKey, JSON.stringify({ volume, lastVolume })); } catch {}
    }
    loadVolume();

    function muted() { return controller?.button.getAttribute('aria-pressed') !== 'true'; }
    function send(frame, message) {
      frame.contentWindow?.postMessage({ channel, ...message }, new URL(frame.src).origin);
    }
    function update() {
      const effectiveVolume = controller && !muted() ? volume : 0;
      for (const [frame, state] of frames) {
        if (state.ready) send(frame, { type: 'volume', volume: effectiveVolume });
      }
      if (!controller) return;
      const percent = Math.round(effectiveVolume * 100);
      const ready = [...frames.values()].some(state => state.ready);
      controller.input.disabled = !ready;
      controller.input.value = String(percent);
      controller.input.setAttribute('aria-valuetext', `${percent}%`);
      controller.input.style.setProperty('--ytg-volume-fill', `${percent}%`);
      if (controller.output.textContent !== `${percent}%`) controller.output.textContent = `${percent}%`;
      controller.panel.title = ready ? '' : 'Reload the game page to activate the volume slider.';
    }

    window.addEventListener('message', event => {
      if (event.data?.channel !== channel || event.data.type !== 'ready') return;
      for (const frame of document.querySelectorAll('iframe')) {
        if (!isGameUrl(frame.src) || event.source !== frame.contentWindow || event.origin !== new URL(frame.src).origin) continue;
        trackFrame(frame);
        frames.get(frame).ready = true;
        update();
      }
    });

    function trackFrame(frame) {
      if (frames.get(frame)?.src === frame.src) return;
      frames.get(frame)?.remove();
      const loaded = () => {
        frames.get(frame).ready = false;
        send(frame, { type: 'query' });
        update();
      };
      frame.addEventListener('load', loaded);
      frames.set(frame, { src: frame.src, ready: false, remove: () => frame.removeEventListener('load', loaded) });
      send(frame, { type: 'query' });
    }

    function unmount() {
      if (!controller) return;
      controller.anchor.classList.remove('ytg-volume-anchor');
      delete controller.anchor.dataset.ytgDismissed;
      controller.anchor.removeEventListener('pointerenter', controller.reveal);
      controller.anchor.removeEventListener('focusin', controller.reveal);
      controller.panel.remove();
      controller = null;
    }

    function mount(button) {
      const anchor = button.closest('toggle-button-view-model') || button.parentElement;
      const panel = document.createElement('div');
      panel.className = 'ytg-volume-popover';
      const inner = document.createElement('div');
      inner.className = 'ytg-volume-panel';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0'; input.max = '100'; input.step = '1';
      input.setAttribute('aria-label', document.documentElement.lang.startsWith('de') ? 'Spiellautstärke' : 'Game volume');
      const output = document.createElement('span');
      output.setAttribute('aria-hidden', 'true');
      inner.append(input, output);
      panel.append(inner);
      const reveal = () => { delete anchor.dataset.ytgDismissed; };
      controller = { button, anchor, panel, input, output, reveal, wasMuted: button.getAttribute('aria-pressed') !== 'true' };
      anchor.classList.add('ytg-volume-anchor');
      anchor.addEventListener('pointerenter', reveal);
      anchor.addEventListener('focusin', reveal);
      anchor.append(panel);
      for (const type of ['pointerdown', 'click', 'keydown', 'keyup']) panel.addEventListener(type, event => event.stopPropagation());
      panel.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        button.focus();
        anchor.dataset.ytgDismissed = 'true';
      });
      input.addEventListener('input', () => {
        volume = Number(input.value) / 100;
        if (volume > 0) lastVolume = volume;
        saveVolume();
        // Apply attenuation before unmuting, avoiding a burst at full volume.
        update();
        if (muted() !== (volume === 0)) button.click();
        controller.wasMuted = muted();
        update();
      });
    }

    const style = document.createElement('style');
    style.textContent = `
      .ytg-volume-anchor { position: relative; display: inline-flex; }
      .ytg-volume-popover { position: absolute; bottom: 100%; right: -8px; padding-bottom: 8px; z-index: 5000; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(4px); transition: opacity .15s, transform .15s, visibility .15s; }
      .ytg-volume-anchor:hover .ytg-volume-popover, .ytg-volume-anchor:focus-within .ytg-volume-popover { opacity: 1; visibility: visible; pointer-events: auto; transform: none; }
      .ytg-volume-anchor[data-ytg-dismissed] .ytg-volume-popover { opacity: 0; visibility: hidden; pointer-events: none; }
      .ytg-volume-panel { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 22px; background: var(--yt-spec-menu-background, #282828); color: var(--yt-spec-text-primary, #fff); box-shadow: 0 4px 18px #0005; font: 12px/1.4 Roboto, Arial, sans-serif; }
      .ytg-volume-panel span { min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
      .ytg-volume-panel input { appearance: none; width: 100px; height: 24px; margin: 0; padding: 0; background: transparent; color: inherit; cursor: pointer; }
      .ytg-volume-panel input::-webkit-slider-runnable-track { height: 3px; border-radius: 3px; background: linear-gradient(to right, currentColor var(--ytg-volume-fill), #8888 var(--ytg-volume-fill)); }
      .ytg-volume-panel input::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4.5px; border-radius: 50%; background: currentColor; }
      .ytg-volume-panel input::-moz-range-track { height: 3px; border-radius: 3px; background: #8888; }
      .ytg-volume-panel input::-moz-range-progress { height: 3px; background: currentColor; }
      .ytg-volume-panel input::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: currentColor; }
      .ytg-volume-panel input:focus-visible { outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff); outline-offset: 3px; border-radius: 4px; }
      .ytg-volume-panel input:disabled { opacity: .45; cursor: wait; }
      @media (prefers-reduced-motion: reduce) { .ytg-volume-popover { transition: none; transform: none; } }
    `;
    function sync() {
      if (!style.isConnected) (document.head || document.documentElement)?.append(style);
      const active = /^\/playables\/[^/]+\/?$/.test(location.pathname);
      const button = active && document.querySelector('.ytMiniAppTopBarViewModelEndButtons toggle-button-view-model button[aria-pressed]');
      if (controller?.wasMuted && button?.getAttribute('aria-pressed') === 'true' && volume === 0) {
        volume = lastVolume; saveVolume();
      }
      if (controller && (controller.button !== button || !controller.panel.isConnected)) unmount();
      if (button && !controller) mount(button);
      for (const [frame, state] of frames) {
        if (active && frame.isConnected && isGameUrl(frame.src)) continue;
        state.remove(); frames.delete(frame);
      }
      if (active) for (const frame of document.querySelectorAll('iframe')) if (isGameUrl(frame.src)) trackFrame(frame);
      if (controller) controller.wasMuted = muted();
      update();
    }
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; sync(); });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'src'] });
    for (const type of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate']) window.addEventListener(type, sync);
    window.addEventListener('storage', event => { if (event.key === storageKey) { loadVolume(); sync(); } });
    setInterval(sync, 1000);
    sync();
  }

  if (isGameUrl(location.href)) startGameFrame();
  else if (window.parent === window) startYouTubeControls();
})();
