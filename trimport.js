// ---------- Import aus dem Depot: Trade Republic (App: Profil → Kontoauszüge → Transaktionsexport) und Scalable Capital
// (Web-Broker: Transaktionen → Export, CSV) – oder eine andere Umsatzliste als CSV ----------
// Die Datei wird nur in diesem Browser gelesen – nichts wird hochgeladen. Die Broker beschreiben ihr Format nicht öffentlich;
// darum erkennt der Import Trennzeichen, Zahlen- und Datumsformat und die Spalten selbst (deutsche und englische Namen), und jede
// Zuordnung lässt sich im Fenster ändern. Stornierte oder abgelehnte Aufträge (Spalte Status) zählen nicht. Jeder Kauf merkt sich
// sein Depot: Ein neuer Import aus demselben Depot ersetzt dessen Einträge, Käufe aus dem anderen Depot bleiben – so ergibt sich je
// Wert eine gemeinsame Position. Käufe (auch Sparplan, Saveback, Round-up) und Verkäufe je ISIN ergeben Stück und
// Ø Kaufkurs nach dem gleitenden Durchschnittspreis (wie bei der KESt). Die Kurse werden zum EZB-Kurs am Handelstag in die
// Währung der Kursdaten umgerechnet (US-Aktien in Dollar), das Kürzel schlägt der Import über Name und ISIN-Land vor.
// Übernommen wird erst nach einem Klick; der bisherige Stand bleibt 7 Tage über „Stand vor dem Laden zurückholen“ erhalten.
(() => {
  const MAX_BYTES = 5e6, MAX_ROWS = 20000;
  const FIELDS = ["date", "type", "isin", "name", "qty", "price", "amount", "fee", "cur", "status"];
  const LABEL = { date: "Datum", type: "Art", isin: "ISIN", name: "Name", qty: "Stück", price: "Kurs je Stück", amount: "Betrag", fee: "Gebühr", cur: "Währung", status: "Status" };
  const DEPOTS = { tr: "Trade Republic", sc: "Scalable Capital", ot: "anderes Depot" };
  // Spaltennamen nach Vorrang (normalisiert: klein, ohne Umlautpunkte und Sonderzeichen)
  const SYN = {
    date: ["date", "datum", "datetime", "timestamp", "zeitpunkt", "buchungsdatum", "transactiondate", "tradedate", "handelsdatum", "time", "zeit", "valuedate", "valuta"],
    type: ["type", "typ", "transactiontype", "transaktionstyp", "transaktionsart", "art", "kategorie", "category", "action", "aktion", "subtype"],
    isin: ["isin"],
    name: ["name", "instrument", "instrumentname", "wertpapier", "wertpapiername", "bezeichnung", "title", "titel", "asset", "assetname", "security", "securityname", "description", "beschreibung"],
    qty: ["shares", "quantity", "qty", "stuck", "stueck", "stucke", "stuecke", "anzahl", "menge", "units", "numberofshares", "anteile"],
    price: ["price", "kurs", "preis", "pricepershare", "unitprice", "ausfuhrungskurs", "ausfuehrungskurs", "executionprice", "shareprice"],
    amount: ["amount", "betrag", "total", "gesamt", "gesamtbetrag", "summe", "netamount", "nettobetrag", "cashamount", "value", "wert"],
    fee: ["fee", "fees", "gebuhr", "gebuehr", "gebuhren", "gebuehren", "kosten", "commission", "fremdkosten"],
    cur: ["currency", "wahrung", "waehrung", "ccy", "currencycode"],
    status: ["status", "state", "orderstatus", "auftragsstatus", "zustand"],
  };
  const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,19}$/;
  const normH = s => String(s || "").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // ---------- Datei lesen ----------
  function sniff(text) {
    const line = (text.split(/\r?\n/).find(l => l.trim()) || "").replace(/"[^"]*"/g, "");
    const n = d => line.split(d).length - 1;
    return [";", ",", "\t"].reduce((a, b) => (n(b) > n(a) ? b : a), ",");
  }
  function parseCsv(text, d) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && !cell.trim()) { q = true; cell = ""; continue; }
      if (c === d) { row.push(cell); cell = ""; continue; }
      if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; continue; }
      cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(v => v.trim())).filter(r => r.some(Boolean));
  }
  // Depot aus Dateiname und Spalten (Scalable: reference, description, assetType); sonst Trade Republic – im Fenster änderbar
  function depotOf(fileName, header) {
    const h = header.map(normH), fn = String(fileName || "").toLowerCase();
    if (/scalable/.test(fn) || (h.includes("reference") && (h.includes("assettype") || h.includes("description")))) return "sc";
    if (/trade.?republic|traderepublic/.test(fn)) return "tr";
    return "tr";
  }
  function guess(header) {
    const h = header.map(normH), used = new Set(), map = {};
    for (const f of FIELDS) {
      map[f] = -1;
      for (const s of SYN[f]) { const i = h.findIndex((x, k) => x === s && !used.has(k)); if (i >= 0) { map[f] = i; used.add(i); break; } }
    }
    return map;
  }
  // Zahlen: 1.234,56 · 1,234.56 · 1234.56 · −12,5 · (12,50) · 12,50- ; nur Komma = Dezimalkomma
  function toNum(s) {
    let t = String(s ?? "").trim().replace(/[\s '’]/g, "").replace(/[€$£]|EUR|USD|CHF|GBP/gi, "").replace(/^−/, "-");
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
    const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (lc >= 0) t = t.replace(",", ".");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
    const v = parseFloat(t);
    return Number.isFinite(v) ? (neg ? -Math.abs(v) : v) : null;
  }
  function toDay(s) {
    const t = String(s || "").trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t), y, mo, d;
    if (m) [y, mo, d] = [m[1], m[2], m[3]];
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/.exec(t))) [y, mo, d] = [m[3].length === 2 ? `20${m[3]}` : m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0")];
    else return null;
    const iso = `${y}-${mo}-${d}`, dt = new Date(`${iso}T12:00:00Z`);
    return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
  }
  // ISIN mit Prüfziffer (Luhn über die Ziffernfolge)
  function isinOk(s) {
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s)) return false;
    const digits = s.split("").map(c => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");
    let sum = 0;
    for (let i = digits.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) { let v = +digits[i]; if (dbl) { v *= 2; if (v > 9) v -= 9; } sum += v; }
    return sum % 10 === 0;
  }
  const SELL = /verkauf|sell|sale|veräu|verau|abgang/i;
  const BUY = /kauf|buy|purchase|sparplan|saving|invest|saveback|round.?up|zugang|bonus|erwerb/i;
  const OTHER = /dividend|distribution|aussch[uü]tt|zins|interest|steuer|tax|geb[uü]hr|fee|einzahl|auszahl|deposit|withdraw|[uü]berweis|transfer|[uü]bertrag|split|kapitalma|corporate|karte|card/i;
  const VOID = /cancel|storn|reject|abgelehnt|fail|expired|abgelaufen|pending|offen|declined|nicht ausgef/i;
  function side(type, qty, amount) {
    if (type) { if (SELL.test(type)) return "s"; if (BUY.test(type)) return "b"; if (OTHER.test(type)) return null; }
    if (qty < 0) return "s";
    if (Number.isFinite(amount) && amount !== 0) return amount < 0 ? "b" : "s";
    return type ? null : "b";
  }
  // Zeilen → Käufe und Verkäufe je ISIN (Kurs in der Handelswährung, meist Euro)
  function analyze(rows, map) {
    const cell = (r, f) => (map[f] >= 0 ? r[map[f]] || "" : "");
    const pos = new Map(), skipped = { noIsin: 0, other: 0, bad: 0 };
    rows.slice(1).forEach((r, i) => {
      const isin = cell(r, "isin").toUpperCase().replace(/\s/g, "");
      if (!isinOk(isin)) { skipped.noIsin++; return; }
      if (VOID.test(cell(r, "status"))) { skipped.other++; return; }   // storniert, abgelehnt, noch offen
      const qRaw = toNum(cell(r, "qty")), amount = toNum(cell(r, "amount")), fee = toNum(cell(r, "fee"));
      const s = side(cell(r, "type"), qRaw, amount), q = Math.abs(qRaw || 0), d = toDay(cell(r, "date"));
      if (!s) { skipped.other++; return; }
      let p = toNum(cell(r, "price"));
      p = p ? Math.abs(p) : null;
      if (!p && Number.isFinite(amount) && q > 0) { const f = Math.abs(fee || 0), gross = Math.abs(amount) + (s === "b" ? -f : f); p = gross > 0 ? gross / q : null; }
      if (!(q > 0) || !(p > 0) || !d) { skipped.bad++; return; }
      const cur = (/^[A-Z]{3}$/.test(cell(r, "cur").toUpperCase()) ? cell(r, "cur").toUpperCase() : "EUR");
      let P = pos.get(isin);
      if (!P) pos.set(isin, P = { isin, name: "", buys: [], sells: [] });
      if (!P.name && cell(r, "name")) P.name = cell(r, "name").slice(0, 80);
      (s === "b" ? P.buys : P.sells).push({ q, p, d, cur, i });
    });
    for (const P of pos.values()) {
      const ev = [...P.buys.map(t => ({ ...t, k: "b" })), ...P.sells.map(t => ({ ...t, k: "s" }))].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i));
      let held = 0, avg = 0;
      for (const e of ev) { if (e.k === "b") { avg = (held * avg + e.q * e.p) / (held + e.q); held += e.q; } else held = Math.max(0, held - e.q); }
      P.held = Math.round(held * 1e6) / 1e6; P.avg = avg; P.cur = P.buys.length && P.buys.every(t => t.cur === P.buys[0].cur) ? P.buys[0].cur : null;
    }
    return { list: [...pos.values()].sort((a, b) => (b.held > 0) - (a.held > 0) || a.name.localeCompare(b.name, "de")), skipped };
  }

  // ---------- Kürzel vorschlagen: Name in den Aktien-Daten, passend zum Land der ISIN ----------
  const TV2SUF = { VIE: "VI", XETR: "DE", MIL: "MI", BME: "MC", SIX: "SW", OMXSTO: "ST", OMXCOP: "CO", OMXHEX: "HE", OSL: "OL", LSE: "L" };
  const pfSym = s => { const m = /^([A-Z]+):([A-Z0-9_.]+)$/.exec(s || ""); return m ? (TV2SUF[m[1]] ? `${m[2].replace(/_/g, "-")}.${TV2SUF[m[1]]}` : "") : s; };
  const pool = () => { const st = window.DTD.shared && window.DTD.shared.get("stocks"); return st ? window.DTD.stockPool(st) : []; };
  function region(cc, x) {
    const suf = (/\.([A-Z]+)$/.exec(x.outside ? pfSym(x.sym) : x.sym) || [])[1] || "";
    if (cc === "US") return !suf || /^[A-Z]$/.test(suf);          // US-Kürzel, auch BRK.B
    if (cc === "AT") return x.cc === "AT";
    if (cc === "DE") return x.cc === "DE" || suf === "DE";
    if (cc === "IE" || cc === "LU") return x.type === "ETF";
    return true;
  }
  function guessSym(P) {
    const cc = P.isin.slice(0, 2), clean = P.name.replace(/[.,;:()"/]/g, " ").replace(/\s+/g, " ").trim(), w = clean.split(" ");
    const tries = [clean, w.slice(0, 2).join(" "), w[0]].filter((t, i, a) => t && t.length >= 3 && a.indexOf(t) === i);
    for (const t of tries) {
      const hit = window.DTD.matchStocks(pool(), t, 12).find(x => region(cc, x) && window.DTD.matchRank(x, t) <= 2);
      if (hit) { const s = hit.outside ? pfSym(hit.sym) : hit.sym; if (SYM.test(s)) return s; }
    }
    return "";
  }

  // ---------- Umrechnen in die Währung der Kursdaten ----------
  // EZB-Kurse: Einheiten je 1 Euro; rateOn(„EUR“) = 1
  function convert(t, target) {
    const rate = c => (c === "EUR" ? 1 : window.DTD.pfRateOn ? window.DTD.pfRateOn(c, t.d) : null);
    if (!target) return null;
    if (t.cur === target) return t.p;
    const a = rate(t.cur), b = rate(target);
    return a && b ? t.p / a * b : null;
  }
  function build(P, sym) {
    const target = window.DTD.pfCurrency ? window.DTD.pfCurrency(sym) : "";
    if (!target) return { err: "Währung der Kursdaten unklar (z. B. London) – bitte selbst im Portfolio eintragen" };
    const conv = list => list.map((t, k) => ({ q: t.q, p: convert(t, target), d: t.d, t: t.i * 10 + k }));
    const lots = conv(P.buys), sells = conv(P.sells);
    if ([...lots, ...sells].some(t => !(t.p > 0))) return { err: "Wechselkurs für ein Handelsdatum fehlt" };
    return { lots: lots.map(t => ({ ...t, p: Math.round(t.p * 1e4) / 1e4 })), sells: sells.map(t => ({ ...t, p: Math.round(t.p * 1e4) / 1e4 })), target };
  }

  // ---------- Fenster ----------
  let st = null;   // { file, delim, rows, map, res, syms: Map(isin → Kürzel), off: Set(isin) }
  const fmtQ = v => fmt(v, v % 1 ? Math.min(6, Math.max(2, String(v).split(".")[1].length)) : 0);
  const price = v => (!Number.isFinite(v) ? "–" : v >= 1000 ? fmt(v, 0) : v >= 1 ? fmt(v, 2) : fmt(v, 4));
  function body() {
    const header = st.rows[0] || [], res = st.res, open = res.list.filter(P => P.held > 0), sold = res.list.filter(P => !(P.held > 0));
    const sel = f => `<label>${LABEL[f]}<select data-tr-map="${f}"><option value="-1">–</option>${header.map((h, i) => `<option value="${i}"${st.map[f] === i ? " selected" : ""}>${esc(h.slice(0, 40)) || `Spalte ${i + 1}`}</option>`).join("")}</select></label>`;
    const row = (P, k) => {
      const sym = st.syms.get(P.isin) || "", on = P.held > 0 && SYM.test(sym) && !st.off.has(P.isin);
      const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
      return `<tr${P.held > 0 ? "" : ` class="muted"`}><td><input type="checkbox" data-tr-on="${esc(P.isin)}" aria-label="${esc(P.name || P.isin)} übernehmen"${on ? " checked" : ""}${P.held > 0 ? "" : " disabled"}></td>
        <td><b>${esc(P.name || "–")}</b><div class="muted small">${esc(P.isin)} · ${n(P.buys.length, "Kauf", "Käufe")}${P.sells.length ? `, ${n(P.sells.length, "Verkauf", "Verkäufe")}` : ""}</div>
          ${P.held > 0 ? `<label class="tr-symrow small">Kürzel wie bei eToro <input id="trSym${k}" class="tr-sym" data-tr-sym="${esc(P.isin)}" value="${esc(sym)}" placeholder="wählen" spellcheck="false"></label>` : ""}</td>
        <td class="num">${P.held > 0 ? `${fmtQ(P.held)} Stück${P.avg > 0 ? `<div class="muted small">Ø ${price(P.avg)}${P.cur ? ` ${esc(P.cur)}` : ""}</div>` : ""}` : "verkauft"}</td></tr>`;
    };
    const s = res.skipped, skip = s.noIsin + s.other + s.bad;
    return `<p class="small">Gelesen wird nur in diesem Browser – die Datei wird nirgends hochgeladen. <b>${esc(st.file)}</b>: ${st.rows.length - 1} Zeilen, getrennt mit „${st.delim === "\t" ? "Tab" : esc(st.delim)}“.</p>
      <label class="tr-depot small">Aus welchem Depot? <select data-tr-src>${Object.entries(DEPOTS).map(([k, v]) => `<option value="${k}"${st.src === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <p class="small muted">Käufe aus einem anderen Depot bleiben erhalten und werden mit diesen zusammengeführt; ein erneuter Import aus diesem Depot ersetzt seine bisherigen Einträge.</p>
      <details class="more"${FIELDS.some(f => st.map[f] < 0 && ["date", "isin", "qty"].includes(f)) ? " open" : ""}><summary>Spalten zuordnen</summary>
        <p class="small muted">Die Zuordnung ist erraten. Passt etwas nicht, hier die richtige Spalte wählen – Kurs je Stück oder Betrag genügt.</p>
        <div class="tr-map">${FIELDS.map(sel).join("")}</div></details>
      <p class="small">${open.length ? `<b>${open.length}</b> Werte im Bestand` : "Kein Bestand erkannt"}${sold.length ? `, ${sold.length} ganz verkauft` : ""}${skip ? ` · ${skip} Zeilen übersprungen (ohne ISIN, Einzahlungen, Zinsen, Dividenden${s.bad ? ` oder ohne Stück, Kurs oder Datum: ${s.bad}` : ""})` : ""}.</p>
      ${res.list.length ? `<div class="table-wrap"><table class="tr-table"><thead><tr><th scope="col"><span class="sr-only">Übernehmen</span></th><th scope="col">Wert</th><th scope="col" class="num">Bestand</th></tr></thead>
        <tbody>${res.list.map(row).join("")}</tbody></table></div>
        <p class="small muted">Ø Kauf nach dem gleitenden Durchschnittspreis, in der Währung der Datei. Beim Übernehmen rechnet die Seite zum EZB-Kurs des Handelstags in die Währung der Kursdaten um (US-Aktien in Dollar). Ein Wert mit gleichem Kürzel im Portfolio wird ersetzt; der bisherige Stand bleibt 7 Tage über „Stand vor dem Laden zurückholen“ erhalten.</p>
        <div class="btn-row"><button type="button" class="btn" data-tr-act="apply">Ins Portfolio übernehmen</button><button type="button" class="btn ghost" data-tr-act="close">Abbrechen</button></div>`
        : `<p class="small down" role="alert">Keine Käufe oder Verkäufe gefunden. Bitte unter „Spalten zuordnen“ mindestens Datum, ISIN, Stück und Kurs oder Betrag wählen.</p>`}`;
  }
  function paint() {
    $("drawerBody").innerHTML = body();
    $("drawerBody").querySelectorAll("[data-tr-sym]").forEach(inp => {
      if (window.DTD.attachSuggest) window.DTD.attachSuggest(inp, { source: text => (text ? window.DTD.matchStocks(pool(), text, 8) : []), onPick: s => { inp.value = pfSym(s); remember(inp); } });
    });
  }
  const remember = inp => {
    const isin = inp.dataset.trSym, v = inp.value.trim().toUpperCase();
    st.syms.set(isin, v);
    const box = $("drawerBody").querySelector(`[data-tr-on="${CSS.escape(isin)}"]`);
    if (box && SYM.test(v) && !st.off.has(isin)) box.checked = true;
  };
  function recompute() {
    st.res = analyze(st.rows, st.map);
    for (const P of st.res.list) if (!st.syms.has(P.isin)) st.syms.set(P.isin, P.held > 0 ? guessSym(P) : "");
  }
  async function start(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) return toast("Import", "Die Datei ist zu groß (höchstens 5 MB).", 6000);
    let text = await file.text();
    text = text.replace(/^﻿/, "");
    const S = window.DTD.shared;
    await Promise.all([S.get("stocks") ? null : S.load("stocks"), S.get("fx") ? null : S.load("fx")]);
    const delim = sniff(text), rows = parseCsv(text, delim);
    if (rows.length < 2) return toast("Import", "In der Datei stehen keine Zeilen – bitte den Transaktionsexport als CSV wählen.", 7000);
    st = { file: String(file.name || "Datei").slice(0, 60), delim, rows, map: guess(rows[0]), syms: new Map(), off: new Set(), src: depotOf(file.name, rows[0]) };
    recompute();
    openDrawer("Import aus dem Depot", body());
    paint();
  }
  function apply() {
    const recs = [], problems = [], left = [];
    const picked = new Set([...$("drawerBody").querySelectorAll("[data-tr-on]:checked")].map(b => b.dataset.trOn));
    for (const P of st.res.list) {
      if (!(P.held > 0)) continue;
      if (!picked.has(P.isin)) { left.push(P.name || P.isin); continue; }
      const sym = (st.syms.get(P.isin) || "").toUpperCase();
      if (!SYM.test(sym)) { problems.push(`${P.name || P.isin}: kein Kürzel`); continue; }
      const b = build(P, sym);
      if (b.err) { problems.push(`${P.name || P.isin}: ${b.err}`); continue; }
      recs.push({ sym, lots: b.lots, sells: b.sells, note: `${DEPOTS[st.src]} · ${P.isin}` });
    }
    // in der Datei ganz verkauft: die Einträge dieses Depots fallen bei einem erneuten Import weg
    const drop = st.res.list.filter(P => !(P.held > 0)).map(guessSym).filter(Boolean);
    if (!recs.length) return toast("Import", problems.length ? `Nichts übernommen – ${problems.slice(0, 3).join("; ")}.` : "Nichts ausgewählt – bitte Werte anhaken und ein Kürzel eintragen.", 8000);
    // Rückfrage nur, wenn von Hand eingetragene Käufe ersetzt würden (Einträge ohne Depot)
    const pf = store.get("dtd-portfolio", []), byHand = h => !h.lots || !h.lots.length || h.lots.some(l => !l.s) || (h.sells || []).some(l => !l.s);
    const same = recs.filter(r => (Array.isArray(pf) ? pf : []).some(h => h && h.sym === r.sym && byHand(h))).map(r => r.sym);
    if (same.length && !confirm(`${same.length} Wert(e) stehen schon von Hand eingetragen im Portfolio (${same.slice(0, 6).join(", ")}${same.length > 6 ? " …" : ""}) und werden durch den Import ersetzt. Käufe aus anderen Depots bleiben. Weiter?`)) return;
    const r = window.DTD.pfImport(recs, `dem Import aus ${DEPOTS[st.src]}`, st.src, drop);
    closeDrawer();
    toast("Import", `${r.added} Wert(e) aus ${DEPOTS[st.src]} übernommen${r.merged ? `, ${r.merged} mit einem anderen Depot zusammengeführt` : ""}${r.replaced ? `, ${r.replaced} ersetzt` : ""}.${problems.length ? ` Nicht übernommen: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? " …" : ""}.` : ""}${left.length ? ` Nicht ausgewählt: ${left.length}.` : ""} Rückgängig: „Sichern und übertragen“ → „Stand vor dem Laden zurückholen“.`, 10000);
  }

  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "trFile") { const f = t.files && t.files[0]; t.value = ""; start(f).catch(err => toast("Import", `Die Datei ließ sich nicht lesen (${err.message || err}).`, 7000)); return; }
    if (!st) return;
    if (t.dataset && t.dataset.trMap) { st.map[t.dataset.trMap] = +t.value; recompute(); paint(); return; }
    if (t.dataset && "trSrc" in t.dataset) { if (DEPOTS[t.value]) st.src = t.value; return; }
    if (t.dataset && t.dataset.trOn) { if (t.checked) st.off.delete(t.dataset.trOn); else st.off.add(t.dataset.trOn); return; }
    if (t.dataset && t.dataset.trSym) remember(t);
  });
  document.addEventListener("input", e => { if (st && e.target.dataset && e.target.dataset.trSym) st.syms.set(e.target.dataset.trSym, e.target.value.trim().toUpperCase()); });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-tr-act]");
    if (!b || !st) return;
    if (b.dataset.trAct === "apply") apply();
    if (b.dataset.trAct === "close") closeDrawer();
  });
  window.DTD.trImport = { sniff, parseCsv, guess, toNum, toDay, isinOk, analyze, depotOf };
})();
