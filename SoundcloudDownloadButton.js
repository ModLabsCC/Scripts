// ==UserScript==
// @name         Soundcloud Download Button
// @namespace    ModLabs
// @version      1.2.0-GitHub
// @description  A Script that adds a Download button to SoundCloud
// @author       ModLabs
// @license      Apache License 2.0
// @match        https://soundcloud.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const toolbarSelector = '.listenEngagement__actions .sc-button-group';
  let button;
  let label;
  let currentPath;
  let request;
  let resetTimer;

  function getDownload() {
    const match = location.pathname.match(/^\/([^/]+)\/(?:sets\/([^/]+)|([^/]+))\/?$/);
    if (!match || (!match[2] && match[3] === 'sets')) return null;
    const playlist = Boolean(match[2]);
    const slug = match[2] || match[3];
    return {
      path: `/${match[1]}/${playlist ? 'sets/' : ''}${slug}`,
      label: playlist ? 'Download Playlist' : 'Download',
      filename: `${match[1]} - ${slug}.${playlist ? 'm3u8' : 'mp3'}`,
      playlist
    };
  }

  function setLabel(text, title = text) {
    if (label.textContent !== text) label.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  async function download() {
    const target = getDownload();
    if (!target || request || target.path !== currentPath) return;

    clearTimeout(resetTimer);
    const controller = new AbortController();
    request = controller;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setLabel('Downloading…');
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(`https://api.modlabs.cc/scr${target.path}`, {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Download service returned HTTP ${response.status}.`);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (/json|html/.test(type)) throw new Error('Download service returned an error instead of a file.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('Download service returned an empty file.');
      if (target.playlist && !(await blob.text()).trimStart().startsWith('#EXTM3U')) {
        throw new Error('Download service returned an invalid playlist.');
      }
      if (controller.signal.aborted || getDownload()?.path !== target.path) return;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = target.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setLabel('Download complete!');
    } catch (error) {
      if (request !== controller || getDownload()?.path !== target.path) return;
      const message = controller.signal.aborted ? 'Download timed out. Please try again.' : error.message;
      setLabel('Retry download', message);
      console.error('[Soundcloud Download Button]', message);
    } finally {
      clearTimeout(timeout);
      if (request === controller) {
        request = null;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        resetTimer = setTimeout(() => {
          if (currentPath === target.path && !request) setLabel(target.label);
        }, 5000);
      }
    }
  }

  function syncButton() {
    const target = getDownload();
    const toolbar = target && document.querySelector(toolbarSelector);
    if (target?.path !== currentPath) {
      request?.abort();
      request = null;
      clearTimeout(resetTimer);
      currentPath = target?.path;
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        if (target) setLabel(target.label);
      }
    }
    if (!toolbar) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'scr-download-button';
      button.className = 'sc-button-secondary sc-button sc-button-medium';
      button.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v9m-3-3 3 3 3-3M2 10v4h12v-4"/></svg>';
      label = document.createElement('span');
      button.appendChild(label);
      setLabel(target.label);
      button.addEventListener('click', download);
    }
    if (button.parentElement !== toolbar) toolbar.prepend(button);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncButton();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', syncButton);
  // SoundCloud also changes routes with pushState without replacing the toolbar.
  setInterval(syncButton, 500);
  syncButton();
})();
