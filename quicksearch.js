// ---------- Schnellsuche in der Kopfzeile: auf jeder Seite eine Aktie suchen (Strg+K oder „/“) ----------
// Gleiche Vorschläge wie im Aktien-Check (Name oder Kürzel, zuletzt angesehene im leeren Feld); Auswahl öffnet die Aktienübersicht.
// Am Handy ein Lupen-Knopf neben der Uhr, der ein Suchfeld oben einblendet.
(() => {
  const bar = document.querySelector(".appbar");
  if (!bar || !window.DTD.attachSuggest) return;
  const S = window.DTD.shared;
  const box = document.createElement("div");
  box.className = "qs";
  box.innerHTML = `<button type="button" class="qs-open icon-btn" aria-label="Aktie suchen" title="Aktie suchen (Strg+K)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></button>
    <form class="qs-form" role="search"><input id="qsInput" type="search" placeholder="Aktie suchen …" aria-label="Aktie suchen – Name oder Kürzel" spellcheck="false" enterkeyhint="search"><kbd class="qs-kbd">Strg K</kbd><button type="button" class="qs-close icon-btn" aria-label="Suche schließen">✕</button></form>`;
  bar.insertBefore(box, bar.querySelector(".sessions"));
  const input = box.querySelector("#qsInput");
  const recent = () => { const r = store.get("dtd-stock-recent", []); return Array.isArray(r) ? r.filter(v => typeof v === "string").slice(0, 6) : []; };
  const items = () => { const st = S.get("stocks"); return st && Array.isArray(st.items) ? st.items : []; };
  const close = () => { box.classList.remove("open"); input.blur(); };
  window.DTD.attachSuggest(input, {
    source: text => (text ? window.DTD.matchStocks(items(), text, 8) : recent().map(v => items().find(y => y.sym === v)).filter(Boolean)),
    onPick: sym => { input.value = ""; close(); if (window.DTD.openStock) window.DTD.openStock(sym); },
    emptyTitle: "Zuletzt angesehen",
  });
  input.addEventListener("focus", () => { if (!S.get("stocks")) S.load("stocks").then(() => input.dispatchEvent(new Event("input"))); });
  box.querySelector(".qs-form").addEventListener("submit", e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const hit = window.DTD.matchStocks(items(), q, 1)[0];
    input.value = "";
    close();
    if (window.DTD.openStock) window.DTD.openStock(hit ? hit.sym : q.toUpperCase());
  });
  box.querySelector(".qs-open").addEventListener("click", () => { box.classList.add("open"); setTimeout(() => input.focus(), 30); });
  box.querySelector(".qs-close").addEventListener("click", close);
  // Strg+K / Cmd+K überall, „/“ wenn gerade nicht in ein Feld getippt wird
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      box.classList.add("open");
      input.focus();
      input.select();
    } else if (e.key === "Escape" && box.classList.contains("open")) close();
  });
})();
