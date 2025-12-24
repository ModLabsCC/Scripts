// ==UserScript==
// @name        PocketBase Dark Mode
// @namespace   ModLabs
// @version     1.0.0
// @description Adds a simple css inject that inverts the colors except for images on PocketBase UI.
// @author      ModLabs
// @match       *://*/*
// @grant       none
// ==/UserScript==

const isPocketBaseAdminPage = () =>
  !!document.querySelector(
    'link[rel="prefetch"][href="./libs/tinymce/skins/ui/pocketbase/skin.min.css"][as="style"]'
  );

let pbIntervalId = null;

if (isPocketBaseAdminPage()) {
  pbIntervalId = setInterval(() => {
    if (!document.querySelector("#pb_dark_mode_patch")) {
      const el = document.createElement("style");
      el.id = "pb_dark_mode_patch";
      el.textContent = `
        body { filter: invert(1); }
        img  { filter: invert(1); }
      `;
      document.head.appendChild(el);
    }
  }, 1);
}
