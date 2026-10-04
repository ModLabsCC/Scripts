// ==UserScript==
// @name         Soundcloud Download Button
// @namespace    ModLabs
// @version      1.3.4-GitHub
// @description  A Script that adds a Download button to SoundCloud
// @author       ModLabs
// @license      Apache License 2.0
// @match        https://soundcloud.com/*
// @updateURL    https://raw.githubusercontent.com/ModLabsCC/Scripts/main/SoundcloudDownloadButton.js
// @downloadURL  https://raw.githubusercontent.com/ModLabsCC/Scripts/main/SoundcloudDownloadButton.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const toolbarSelector = '.listenEngagement__actions .sc-button-group, .systemPlaylistDetails__controls';
  const downloads = new Map();
  let button;

  function getDownload(pathname = location.pathname) {
    // The new track UI lives in a /n/ iframe; userscript managers run us there too.
    pathname = pathname.replace(/^\/n\//, '/');
    const match = pathname.match(/^\/([^/]+)\/(?:sets\/([^/]+)|([^/]+))\/?$/);
    if (!match || (!match[2] && match[3] === 'sets')) return null;
    const playlist = Boolean(match[2]);
    const slug = match[2] || match[3];
    return {
      path: `/${match[1]}/${playlist ? 'sets/' : ''}${slug}`,
      label: playlist ? 'Download Playlist' : 'Download',
      filename: `${match[1]} - ${slug.replace(/:/g, '_')}.${playlist ? 'm3u8' : 'mp3'}`,
      playlist,
      systemPlaylist: playlist && match[1] === 'discover'
    };
  }

  function getLinkDownload(link, album = false) {
    if (!link) return null;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return null;
    const target = getDownload(url.pathname);
    // Personalized sets need their complete detail page, not a feed preview.
    if (!target || target.systemPlaylist) return null;
    target.label = target.playlist ? (album ? 'Download Album' : 'Download Playlist') : 'Download Track';
    return target;
  }

  function getSystemPlaylistBlob() {
    const tracks = [...document.querySelectorAll('.systemPlaylistTrackList__list .trackItem__trackTitle')];
    const count = Number(document.querySelector('.systemPlaylistTrackCount .genericTrackCount__title')?.textContent.replace(/\D/g, ''));
    if (!tracks.length) throw new Error('The playlist tracks have not loaded yet. Please try again.');
    if (count > tracks.length) throw new Error('Scroll to the end of the playlist to load all tracks, then retry.');

    // The download service cannot resolve /discover/sets; use its individual track endpoints.
    const lines = ['#EXTM3U'];
    for (const track of tracks) {
      const url = new URL(track.href, location.origin);
      if (url.origin !== location.origin || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) {
        throw new Error('The playlist contains an invalid track link.');
      }
      const artist = track.closest('.trackItem')?.querySelector('.trackItem__username')?.textContent.trim();
      const title = [artist, track.textContent.trim()].filter(Boolean).join(' - ').replace(/[\r\n]+/g, ' ');
      lines.push(`#EXTINF:-1,${title}`, `https://api.modlabs.cc/scr${url.pathname.replace(/\/$/, '')}`);
    }
    return new Blob([`${lines.join('\n')}\n`], { type: 'application/vnd.apple.mpegurl' });
  }

  function setLabel(state, text, title = text) {
    const { button, label, icon } = state;
    if (label.textContent !== text) label.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    const iconState = text === 'Downloading…' ? 'loading' :
      text === 'Download complete!' ? 'complete' : text === 'Retry download' ? 'error' : 'ready';
    if (button.dataset.state !== iconState) {
      button.dataset.state = iconState;
      const paths = {
        ready: '<path d="M12 3.75V15M7.5 10.5 12 15l4.5-4.5M3.75 15.75v4.5h16.5v-4.5"/>',
        loading: '<circle cx="12" cy="12" r="8.25" stroke-dasharray="36 16"/>',
        complete: '<path d="m5.25 12 4.5 4.5 9-9"/>',
        error: '<path d="M18.75 8.25A7.5 7.5 0 1 0 19.5 12M18.75 3.75v4.5h-4.5"/>'
      };
      icon.innerHTML = paths[iconState];
    }
  }

  function cancelDownload(state) {
    state.request?.abort();
    state.request = null;
    clearTimeout(state.resetTimer);
    state.button.disabled = false;
    state.button.removeAttribute('aria-busy');
  }

  function syncTarget(state) {
    const target = state.getTarget();
    if (target?.path !== state.path) {
      cancelDownload(state);
      state.path = target?.path;
      if (target) setLabel(state, target.label);
    }
    return target;
  }

  function createButton(getTarget) {
    const button = document.createElement('button');
    button.type = 'button';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('stroke-linecap', 'square');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    button.appendChild(icon);
    const label = document.createElement('span');
    label.setAttribute('aria-live', 'polite');
    button.appendChild(label);
    const state = { button, icon, label, getTarget };
    downloads.set(button, state);
    syncTarget(state);
    button.addEventListener('click', event => {
      // Track rows also handle clicks to start playback.
      event.preventDefault();
      event.stopPropagation();
      download(state);
    });
    return button;
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
    const { icon, label } = downloads.get(button);
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

  async function download(state) {
    const target = syncTarget(state);
    if (!target || state.request) return;
    const { button } = state;

    clearTimeout(state.resetTimer);
    const controller = new AbortController();
    state.request = controller;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setLabel(state, 'Downloading…');
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      let blob;
      if (target.systemPlaylist) {
        blob = getSystemPlaylistBlob();
      } else {
        const response = await fetch(`https://api.modlabs.cc/scr${target.path}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Download service returned HTTP ${response.status}.`);
        const type = (response.headers.get('content-type') || '').toLowerCase();
        if (/json|html/.test(type)) throw new Error('Download service returned an error instead of a file.');
        blob = await response.blob();
      }
      if (!blob.size) throw new Error('Download service returned an empty file.');
      if (target.playlist && !(await blob.text()).trimStart().startsWith('#EXTM3U')) {
        throw new Error('Download service returned an invalid playlist.');
      }
      if (controller.signal.aborted || !button.isConnected || state.getTarget()?.path !== target.path) return;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = target.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setLabel(state, 'Download complete!');
    } catch (error) {
      if (state.request !== controller || !button.isConnected || state.getTarget()?.path !== target.path) return;
      const message = controller.signal.aborted ? 'Download timed out. Please try again.' : error.message;
      setLabel(state, 'Retry download', message);
      console.error('[Soundcloud Download Button]', message);
    } finally {
      clearTimeout(timeout);
      if (state.request === controller) {
        state.request = null;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        state.resetTimer = setTimeout(() => {
          if (state.getTarget()?.path === target.path && !state.request) setLabel(state, target.label);
        }, 5000);
      }
    }
  }

  function syncButton() {
    const target = getDownload();
    const toolbar = target && getToolbar();
    if (button) syncTarget(downloads.get(button));
    if (!toolbar) {
      button?.remove();
      return;
    }
    if (!button) {
      button = createButton(getDownload);
      button.id = 'scr-download-button';
    }
    styleButton(toolbar);
    if (button.parentElement !== toolbar.element) {
      if (toolbar.modern) toolbar.element.insertBefore(button, toolbar.before);
      else toolbar.element.prepend(button);
    }
  }

  function syncQuickButton(container, getTarget, className, before = null) {
    const target = getTarget();
    let quick = container.querySelector('.scr-download-quick');
    if (!target) {
      quick?.remove();
      return;
    }
    if (!quick) {
      quick = createButton(getTarget);
      quick.className = `sc-button-secondary sc-button sc-button-small scr-download-quick ${className}`;
      downloads.get(quick).label.className = 'sc-visuallyhidden';
      container.insertBefore(quick, before);
    }
    syncTarget(downloads.get(quick));
  }

  function syncButtons() {
    syncButton();
    // Card headers stay visible even when a playlist only previews a few tracks.
    for (const header of document.querySelectorAll('.sound__header')) {
      const container = header.querySelector('.soundTitle__titleContainer');
      if (!container) continue;
      syncQuickButton(container, () => getLinkDownload(
        header.querySelector('.soundTitle__title'),
        /^Album\b/i.test(header.querySelector('.releaseDateCompact')?.textContent.trim() || '')
      ), 'scr-download-card', header.querySelector('.soundTitle__additionalContainer'));
    }
    for (const row of document.querySelectorAll('.trackItem')) {
      // Keep our icon outside the native actions that only appear on hover.
      const container = row.querySelector('.trackItem__additional');
      if (!container) continue;
      syncQuickButton(container, () => getLinkDownload(row.querySelector('.trackItem__trackTitle')), 'scr-download-track');
    }
    for (const [quick, state] of downloads) {
      if (quick === button || quick.isConnected) continue;
      cancelDownload(state);
      downloads.delete(quick);
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .systemPlaylistDetails__controls > #scr-download-button { margin-right: 10px; }
    .scr-download-quick { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; min-width: 28px; height: 28px; padding: 0; margin-left: 8px; }
    .scr-download-card { align-self: center; }
    .scr-download-quick svg { pointer-events: none; }
    #scr-download-button[data-ui="legacy"]:focus-visible, .scr-download-quick:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
    #scr-download-button[data-ui="legacy"]:disabled, .scr-download-quick:disabled { opacity: .55; cursor: wait; }
    #scr-download-button[data-state="loading"] svg, .scr-download-quick[data-state="loading"] svg { animation: scr-download-spin 1s linear infinite; }
    @keyframes scr-download-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      #scr-download-button[data-state="loading"] svg, .scr-download-quick[data-state="loading"] svg { animation: none; }
    }
  `;
  document.documentElement.appendChild(style);

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncButtons();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', syncButtons);
  // SoundCloud also changes routes with pushState without replacing the toolbar.
  setInterval(syncButtons, 500);
  syncButtons();
})();
