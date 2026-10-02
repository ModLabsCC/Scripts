// ==UserScript==
// @name         Soundcloud Download Button
// @namespace    ModLabs
// @version      1.3.1-GitHub
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
  let icon;
  let currentPath;
  let request;
  let resetTimer;

  function getDownload() {
    // The new track UI lives in a /n/ iframe; userscript managers run us there too.
    const pathname = location.pathname.replace(/^\/n\//, '/');
    const match = pathname.match(/^\/([^/]+)\/(?:sets\/([^/]+)|([^/]+))\/?$/);
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
    const state = text === 'Downloading…' ? 'loading' :
      text === 'Download complete!' ? 'complete' : text === 'Retry download' ? 'error' : 'ready';
    if (button.dataset.state !== state) {
      button.dataset.state = state;
      const paths = {
        ready: '<path d="M12 3.75V15M7.5 10.5 12 15l4.5-4.5M3.75 15.75v4.5h16.5v-4.5"/>',
        loading: '<circle cx="12" cy="12" r="8.25" stroke-dasharray="36 16"/>',
        complete: '<path d="m5.25 12 4.5 4.5 9-9"/>',
        error: '<path d="M18.75 8.25A7.5 7.5 0 1 0 19.5 12M18.75 3.75v4.5h-4.5"/>'
      };
      icon.innerHTML = paths[state];
    }
  }

  function getToolbar() {
    const menu = document.querySelector('[aria-label="Track-Header"] button[id^="desktop-menu-button-"][aria-haspopup="true"]');
    if (menu) return {
      element: menu.parentElement,
      reference: menu.parentElement.querySelector('button:not(#scr-download-button)'),
      before: menu,
      modern: true
    };
    const element = document.querySelector(toolbarSelector);
    return element && { element, modern: false };
  }

  function styleButton(toolbar) {
    const ui = toolbar.modern ? 'modern' : 'legacy';
    const className = toolbar.modern ? `${toolbar.reference.className}${button.disabled ? ' Mui-disabled' : ''}` :
      'sc-button-secondary sc-button sc-button-medium';
    if (button.dataset.ui === ui && button.className === className) return;
    button.dataset.ui = ui;
    // Reuse the live MUI classes, including theme/hover states, rather than hashed selectors.
    button.className = className;
    if (toolbar.modern) {
      button.setAttribute('variant', toolbar.reference.getAttribute('variant') || 'outlined');
      button.style.cssText = toolbar.reference.style.cssText;
      icon.setAttribute('width', '24');
      icon.setAttribute('height', '24');
      label.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    } else {
      button.removeAttribute('variant');
      button.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
      icon.setAttribute('width', '16');
      icon.setAttribute('height', '16');
      label.style.cssText = '';
    }
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
    const toolbar = target && getToolbar();
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
      button = toolbar.modern ? toolbar.reference.cloneNode(false) : document.createElement('button');
      for (const attribute of ['aria-describedby', 'aria-controls', 'aria-owns', 'aria-haspopup', 'aria-expanded']) {
        button.removeAttribute(attribute);
      }
      button.type = 'button';
      button.id = 'scr-download-button';
      icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.5');
      icon.setAttribute('stroke-linecap', 'square');
      button.appendChild(icon);
      label = document.createElement('span');
      label.setAttribute('aria-live', 'polite');
      button.appendChild(label);
      setLabel(target.label);
      button.addEventListener('click', download);
    }
    styleButton(toolbar);
    if (button.parentElement !== toolbar.element) {
      if (toolbar.modern) toolbar.element.insertBefore(button, toolbar.before);
      else toolbar.element.prepend(button);
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    #scr-download-button[data-ui="legacy"]:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
    #scr-download-button[data-ui="legacy"]:disabled { opacity: .55; cursor: wait; }
    #scr-download-button[data-state="loading"] svg { animation: scr-download-spin 1s linear infinite; }
    @keyframes scr-download-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      #scr-download-button[data-state="loading"] svg { animation: none; }
    }
  `;
  document.documentElement.appendChild(style);

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
