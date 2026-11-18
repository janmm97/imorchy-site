// v4 site header (kit v1.4): Features menu and, below 900px, the Menu sheet. External module (deferred),
// no inline code (CSP). Open/close is instant on purpose (Nora, 2026-11-18: motion comes in v4.1).
(() => {
  document.documentElement.classList.add("js");
  const nav = document.querySelector(".nav");
  const fbtn = document.getElementById("fbtn"), fmenu = document.getElementById("fmenu");
  const mbtn = document.getElementById("mbtn"), list = document.getElementById("navlist");
  if (!nav || !fbtn || !fmenu || !mbtn || !list) return;
  function disclosure(btn, panel, onToggle) {
    const set = (open) => { btn.setAttribute("aria-expanded", String(open)); onToggle(open); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); set(btn.getAttribute("aria-expanded") !== "true"); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && btn.getAttribute("aria-expanded") === "true") { e.preventDefault(); set(false); btn.focus(); }
    });
    document.addEventListener("click", (e) => { if (!panel.contains(e.target) && btn.getAttribute("aria-expanded") === "true") set(false); });
    return set;
  }
  disclosure(fbtn, fmenu, (o) => fmenu.classList.toggle("open", o));
  const setMenu = disclosure(mbtn, list, (o) => nav.classList.toggle("open", o));
  // Following an in-page link (/#how) closes the sheet.
  list.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
})();

// Demo loops load only on pages that have one.
if (document.querySelector("[data-scene]")) import("/js/demos.mjs");
