// ---------- Konto: Anmeldung nur auf Einladung, Ende-zu-Ende verschlüsselte Synchronisierung, App teilen ----------
// Dienst: Supabase (EU-Server), eingerichtet in data/login.json (öffentliche Projektadresse und öffentlicher Schlüssel – nie der
// geheime). Anmeldung mit dem Anmelde-Passwort aus der Einladung oder mit einem Code aus der E-Mail; Fremde können sich nicht
// registrieren (create_user: false, Registrierung im Projekt aus, die App ruft nie /signup auf). Die eigenen Daten (Portfolio, Journal, Merkliste, Alarme, Vermögen …) werden vor dem Hochladen mit einem
// Schlüssel aus dem Sync-Passwort verschlüsselt (PBKDF2-SHA-256 → AES-256-GCM, Name des Eintrags als Zusatzdaten): Der Dienst
// und der Besitzer des Projekts sehen nur Zeichensalat. Der Schlüssel bleibt nicht exportierbar in diesem Browser (IndexedDB).
// Bots & Copy-Trading: sobald die Anmeldung eingerichtet ist, nur für die Rolle „owner“ (Tabelle profiles) – Ausblenden der
// Ansicht, kein Geheimnis: die Bot-Daten selbst sind öffentlich. Ohne Einrichtung bleibt alles wie bisher.
(() => {
  const AUTH = "dtd-auth", PENDING = "dtd-auth-pending", SYNC = "dtd-sync", CFG = "dtd-login", REQ = "dtd-auth-req";
  // Was zwischen den Geräten mitwandert: die eigenen Daten – keine Bedienzustände (zuletzt offener Bereich, Gesehen-Markierungen …)
  const SYNC_KEYS = ["dtd-portfolio", "daytrade-journal-v1", "dtd-watch", "dtd-alarms", "dtd-wealth", "dtd-sparplan", "dtd-layout", "dtd-risk-budget",
    "dtd-account", "dtd-cmp", "dtd-smart", "dtd-swing", "daytrade-traders-v1", "dtd-ntfy-topic", "dtd-push-brief"];
  const CHECK = "__check", ITER = 310000, VERIFY = "rojkomoney-sync-v1";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const APP_URL = `${location.origin}${location.pathname}`;
  let cfg = null, key = null, busy = false, lastError = "", lastSync = 0, timer = null, step = "email", pendingEmail = "", needConfirm = false, passMsg = null;
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del: k => { try { localStorage.removeItem(k); } catch { /* egal */ } },
  };
  const session = () => { const s = store.get(AUTH, null); return s && s.access_token && s.refresh_token && s.user && s.user.id ? s : null; };
  const syncState = () => { const s = store.get(SYNC, null); return s && typeof s === "object" ? { hash: s.hash || {}, at: s.at || {}, last: s.last || 0, uid: s.uid || null } : { hash: {}, at: {}, last: 0, uid: null }; };

  // ---------- Einrichtung: nur öffentliche Werte, ein geheimer Schlüssel wird nie benutzt ----------
  const b64urlJson = s => { try { return JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))); } catch { return null; } };
  function validCfg(c) {
    if (!c || typeof c !== "object") return null;
    const url = String(c.url || "").replace(/\/$/, ""), k = String(c.anonKey || "");
    if (!/^https:\/\/[a-z0-9-]{6,40}\.supabase\.co$/.test(url) || !k) return null;
    if (/^sb_secret_/.test(k)) return null;
    if (k.split(".").length === 3) { const p = b64urlJson(k.split(".")[1]); if (!p || p.role !== "anon") return null; }
    else if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k)) return null;
    return { url, anonKey: k };
  }
  cfg = validCfg(store.get(CFG, null));   // letzter bekannter Stand – sofort, damit die Bots nicht kurz aufblitzen
  const loadCfg = () => fetch(`data/login.json?t=${Date.now()}`, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(d => {
    const c = validCfg(d);
    if (d && (d.url || d.anonKey) && !c) console.warn("data/login.json: Anmeldung aus – ungültige Adresse oder kein öffentlicher Schlüssel");
    const changed = JSON.stringify(c) !== JSON.stringify(cfg);
    cfg = c;
    if (c) store.set(CFG, c); else ls.del(CFG);
    if (changed) { access(); paintButton(); }
    return cfg;
  });

  // ---------- Supabase ansprechen (nur die Projektadresse; keine Weiterleitungen, Zeitlimit) ----------
  async function api(path, { method = "GET", body, auth = true, prefer = "", retry = true } = {}) {
    if (!cfg) throw new Error("Anmeldung ist nicht eingerichtet.");
    const h = { apikey: cfg.anonKey, "Content-Type": "application/json" };
    if (prefer) h.Prefer = prefer;
    if (auth) { const s = await fresh(); if (!s) throw Object.assign(new Error("Bitte erneut anmelden."), { status: 401 }); h.Authorization = `Bearer ${s.access_token}`; }
    const res = await fetch(cfg.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (res.status === 401 && auth && retry) { await refresh(true); return api(path, { method, body, auth, prefer, retry: false }); }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
    if (!res.ok) throw Object.assign(new Error((data && (data.msg || data.message || data.error_description || data.error)) || `Fehler ${res.status}`), { status: res.status });
    return data;
  }
  function saveSession(n, base = session()) {
    const s = { access_token: n.access_token, refresh_token: n.refresh_token, expires_at: Number(n.expires_at) || Math.floor(Date.now() / 1000) + (Number(n.expires_in) || 3600),
      user: n.user && n.user.id ? { id: n.user.id, email: n.user.email || "" } : (base && base.user) || null, role: (base && base.role) || null };
    store.set(AUTH, s);
    return s;
  }
  let refreshing = null;
  function refresh(force = false) {
    const s = session();
    if (!s) return Promise.resolve(null);
    if (!force && s.expires_at * 1000 - Date.now() > 60000) return Promise.resolve(s);
    refreshing = refreshing || api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh_token }, auth: false })
      .then(n => saveSession(n, s))
      .catch(e => { if (e.status === 400 || e.status === 401) signOutLocal("Die Anmeldung ist abgelaufen – bitte neu anmelden."); return null; })
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  const fresh = () => refresh(false);

  // ---------- Verschlüsselung ----------
  const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(k, text, name) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(name) }, k, enc.encode(text)));
    return `v1.${b64(iv)}.${b64(ct)}`;
  }
  async function unseal(k, s, name) {
    const [v, iv, ct] = String(s || "").split(".");
    if (v !== "v1" || !iv || !ct) throw new Error("unbekanntes Format");
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(name) }, k, unb64(ct)));
  }
  const hashOf = async s => (s === null || s === undefined ? "-" : b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))).slice(0, 24));
  // Schlüssel nicht exportierbar in IndexedDB – das Sync-Passwort wird nie gespeichert
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("kein IndexedDB"));
      const r = indexedDB.open("rojkomoney", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("keys");
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result, tx = db.transaction("keys", mode), q = fn(tx.objectStore("keys"));
        tx.oncomplete = () => { db.close(); res(q ? q.result : undefined); };
        tx.onerror = () => { db.close(); rej(tx.error); };
      };
    });
  }
  const keyLoad = uid => idb("readonly", st => st.get(uid)).catch(() => null);
  const keySave = (uid, k) => idb("readwrite", st => st.put(k, uid)).catch(() => null);
  const keyDrop = uid => idb("readwrite", st => st.delete(uid)).catch(() => null);

  // ---------- Anmelden ----------
  async function requestCode(email) {
    await api(`/auth/v1/otp?redirect_to=${encodeURIComponent(APP_URL)}`, { method: "POST", body: { email, create_user: false }, auth: false });
    ls.set(REQ, JSON.stringify({ email, at: Date.now() }));   // ein Link aus dieser Mail gilt ohne Rückfrage – nur auf diesem Gerät
  }
  // Mit dem Anmelde-Passwort aus der Einladung (braucht keinen Mailversand – Supabase schickt kostenlos nur an das eigene Team)
  async function signInPassword(email, password) {
    const n = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, auth: false });
    if (!n || !n.access_token) throw new Error("Invalid login credentials");
    saveSession(n, null);
    await afterLogin();
  }
  async function changeLoginPassword(a, b) {
    if (String(a).length < 10) throw new Error("Das Anmelde-Passwort braucht mindestens 10 Zeichen.");
    if (a !== b) throw new Error("Die beiden Eingaben stimmen nicht überein.");
    await api("/auth/v1/user", { method: "PUT", body: { password: a } });
  }
  async function verifyCode(email, token) {
    const n = await api("/auth/v1/verify", { method: "POST", body: { type: "email", email, token }, auth: false });
    if (!n || !n.access_token) throw new Error("Der Code passt nicht.");
    saveSession(n, null);
    await afterLogin();
  }
  async function afterLogin() {
    const s = session();
    if (!s) return;
    const st = syncState();
    if (st.uid && st.uid !== s.user.id) store.set(SYNC, { hash: {}, at: {}, last: 0, uid: s.user.id });   // anderes Konto: neu abgleichen
    await loadRole();
    key = await keyLoad(s.user.id) || null;
    if (key) sync({ initial: true });
  }
  async function loadRole() {
    try {
      const r = await api("/rest/v1/profiles?select=role");
      const role = Array.isArray(r) && r[0] && r[0].role === "owner" ? "owner" : "user";
      const s = session(); if (s) { s.role = role; store.set(AUTH, s); }
    } catch { /* Rolle unbekannt: bleibt wie zuletzt */ }
    access();
  }
  function signOutLocal(msg = "") {
    const s = session();
    ls.del(AUTH);
    if (s) keyDrop(s.user.id);
    key = null; step = "email"; lastError = msg; needConfirm = false;
    access(); paintButton();
  }
  async function signOut() {
    try { await api("/auth/v1/logout", { method: "POST" }); } catch { /* lokal abmelden genügt */ }
    signOutLocal();
  }

  // ---------- Sync-Passwort: festlegen (erstes Gerät) oder prüfen (weitere Geräte) ----------
  async function unlock(pass, confirmPass) {
    const s = session();
    if (!s) throw new Error("Bitte zuerst anmelden.");
    if (String(pass).length < 10) throw new Error("Das Sync-Passwort braucht mindestens 10 Zeichen.");
    const rows = await api(`/rest/v1/user_data?select=k,v&k=eq.${CHECK}`);
    const check = Array.isArray(rows) && rows[0] ? JSON.parse(rows[0].v) : null;
    if (!check) {
      if (confirmPass !== undefined && confirmPass !== pass) throw new Error("Die beiden Eingaben stimmen nicht überein.");
      if (confirmPass === undefined) return "neu";
      const salt = crypto.getRandomValues(new Uint8Array(16)), k = await deriveKey(pass, salt);
      await api("/rest/v1/user_data?on_conflict=user_id,k", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
        body: [{ user_id: s.user.id, k: CHECK, v: JSON.stringify({ salt: b64(salt), check: await seal(k, VERIFY, CHECK), iter: ITER }), updated_at: new Date().toISOString() }] });
      key = k;
    } else {
      const k = await deriveKey(pass, unb64(check.salt));
      try { if (await unseal(k, check.check, CHECK) !== VERIFY) throw new Error(); } catch { throw new Error("Das Sync-Passwort stimmt nicht."); }
      key = k;
    }
    await keySave(s.user.id, key);
    await sync({ initial: true });
    return "ok";
  }

  // ---------- Abgleich: je Eintrag gilt die neuere Änderung; beim ersten Abgleich eines Geräts entscheidet der Mensch ----------
  const original = store.set.bind(store);
  store.set = (k, val) => {
    original(k, val);
    if (!SYNC_KEYS.includes(k)) return;
    const st = syncState(); st.at[k] = Date.now(); original(SYNC, st);
    schedule();
  };
  function schedule(ms = 3000) { clearTimeout(timer); if (session() && key) timer = setTimeout(() => sync(), ms); }
  async function sync({ initial = false } = {}) {
    const s = session();
    if (!cfg || !s || !key || busy) return null;
    busy = true; lastError = ""; paintButton();
    try {
      const rows = await api("/rest/v1/user_data?select=k,v,updated_at");
      const st = syncState(), remote = new Map();
      st.uid = s.user.id;
      for (const r of Array.isArray(rows) ? rows : []) if (SYNC_KEYS.includes(r.k)) remote.set(r.k, r);
      const plan = [], firstConflicts = [];
      for (const k of SYNC_KEYS) {
        const local = ls.get(k), lh = await hashOf(local), last = st.hash[k];
        const r = remote.get(k);
        let rv = null;
        if (r) { try { rv = await unseal(key, r.v, k); } catch { throw new Error("Die Daten in der Cloud lassen sich mit diesem Sync-Passwort nicht öffnen."); } }
        const rh = r ? await hashOf(rv) : null;
        const localChanged = last === undefined ? local !== null : lh !== last;
        const remoteChanged = !!r && (last === undefined || rh !== last);
        if (r && rh === lh) { st.hash[k] = lh; continue; }
        if (remoteChanged && !localChanged) plan.push({ k, act: "pull", rv, rh });
        else if (localChanged && !remoteChanged) plan.push({ k, act: local === null ? "drop" : "push", local, lh });
        else if (localChanged && remoteChanged) {
          if (last === undefined) firstConflicts.push({ k, rv, rh, local, lh });
          else plan.push((st.at[k] || 0) > Date.parse(r.updated_at || 0) ? { k, act: "push", local, lh } : { k, act: "pull", rv, rh });
        }
      }
      if (firstConflicts.length) {
        const names = firstConflicts.map(c => LABEL[c.k] || c.k).join(", ");
        const cloud = confirm(`Auf diesem Gerät und in Ihrem Konto stehen unterschiedliche Daten: ${names}.\n\nOK = die Daten aus dem Konto übernehmen. Die bisherigen dieses Geräts bleiben eine Woche lang über „Rückgängig“ (Portfolio → Sicherung) erhalten.\nAbbrechen = die Daten dieses Geräts behalten und ins Konto hochladen.`);
        for (const c of firstConflicts) plan.push(cloud ? { k: c.k, act: "pull", rv: c.rv, rh: c.rh, undo: true } : { k: c.k, act: "push", local: c.local, lh: c.lh });
      }
      const pulls = plan.filter(p => p.act === "pull"), pushes = plan.filter(p => p.act === "push"), drops = plan.filter(p => p.act === "drop");
      if (pulls.some(p => p.undo)) {   // vorher den Stand dieses Geräts sichern – gleiches Format wie beim Laden einer Sicherung
        const before = {}; for (const p of pulls) before[p.k] = ls.get(p.k);
        original("dtd-restore-undo", { at: new Date().toISOString(), from: "dem Konto", data: before });
      }
      for (const p of pulls) { ls.set(p.k, p.rv); st.hash[p.k] = p.rh; }
      if (pushes.length) {
        const now = new Date().toISOString(), body = [];
        for (const p of pushes) body.push({ user_id: s.user.id, k: p.k, v: await seal(key, p.local, p.k), updated_at: now });
        await api("/rest/v1/user_data?on_conflict=user_id,k", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body });
        for (const p of pushes) st.hash[p.k] = p.lh;
      }
      for (const p of drops) { await api(`/rest/v1/user_data?k=eq.${encodeURIComponent(p.k)}`, { method: "DELETE", prefer: "return=minimal" }); st.hash[p.k] = "-"; }
      st.last = Date.now(); original(SYNC, st); lastSync = st.last;
      if (pulls.length) applied(initial);
      return { pulled: pulls.length, pushed: pushes.length + drops.length };
    } catch (e) {
      lastError = e.message || String(e);
      return null;
    } finally {
      busy = false; paintButton(); refreshDrawer();
    }
  }
  // Neue Daten aus dem Konto: neu laden, damit alle Bereiche sie zeigen – nicht mitten in einer Eingabe
  function applied(initial) {
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (initial || document.hidden || !typing) { setTimeout(() => location.reload(), initial ? 300 : 50); return; }
    toast("Konto", "Neue Daten von einem anderen Gerät sind da – die Seite lädt neu, sobald Sie fertig sind.", 6000);
    document.addEventListener("focusout", () => setTimeout(() => location.reload(), 400), { once: true });
  }
  const LABEL = { "dtd-portfolio": "Portfolio", "daytrade-journal-v1": "Journal", "dtd-watch": "Merkliste", "dtd-alarms": "Kursalarme", "dtd-wealth": "Vermögensprofil",
    "dtd-sparplan": "Sparplan", "dtd-layout": "Seite anpassen", "dtd-risk-budget": "Risiko-Budget", "dtd-account": "Kontogröße", "dtd-cmp": "Vergleich", "dtd-smart": "Hinweise",
    "dtd-swing": "Swing-Planer", "daytrade-traders-v1": "Trader", "dtd-ntfy-topic": "Handy-Kanal", "dtd-push-brief": "Morgen-Meldung" };

  // ---------- Bots & Copy-Trading: mit eingerichteter Anmeldung nur für den Besitzer ----------
  window.DTD.botsAllowed = () => !cfg || (session() || {}).role === "owner";
  function access() {
    window.dispatchEvent(new Event("dtd:access"));
    const v = document.querySelector("#views > .view:not([hidden])");
    if (v && (v.id === "bot" || v.id === "daily") && !window.DTD.botsAllowed()) location.hash = "home";
  }

  // ---------- App teilen ----------
  async function share() {
    const data = { title: "RojkoMoney", text: "RojkoMoney – Börsen-Cockpit: Aktien-Check, Marktlage, Vermögen. Ihre Daten bleiben bei Ihnen.", url: APP_URL };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(APP_URL); toast("Teilen", "Link kopiert – jetzt einfach in einer Nachricht einfügen.", 4000); }
    catch { const el = $("accLink"); if (el) { el.focus(); el.select(); } toast("Teilen", "Link markiert – kopieren und verschicken.", 4000); }
  }

  // ---------- Knopf in der Kopfzeile und Fenster ----------
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  let btn = null;
  function paintButton() {
    if (!btn) return;
    const s = session(), state = !cfg ? "off" : !s ? "out" : !key ? "lock" : lastError ? "err" : "on";
    btn.dataset.acc = state;
    const label = { off: "Konto und App teilen", out: "Anmelden, Konto und App teilen", lock: "Konto: Sync-Passwort fehlt", err: "Konto: Abgleich gestört", on: "Konto: angemeldet und abgeglichen" }[state];
    btn.setAttribute("aria-label", label); btn.title = label;
  }
  const ago = t => { if (!t) return "noch nie"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "gerade eben" : m < 60 ? `vor ${m} Min.` : `vor ${Math.round(m / 60)} Std.`; };
  function body() {
    const s = session(), share = `<h3 class="swing-h3">App teilen</h3>
      <p class="small">Jeder mit dem Link kann RojkoMoney öffnen und am Handy über „Zum Home-Bildschirm“ wie eine App installieren. Eigene Daten bleiben im eigenen Browser${cfg ? " – oder, mit Einladung, verschlüsselt im eigenen Konto" : ""}.</p>
      <div class="push-row"><input id="accLink" class="push-val" readonly value="${esc(APP_URL)}" aria-label="Link zur App"><button type="button" class="btn" data-acc-act="share">Teilen</button></div>`;
    if (!cfg) return `${share}<h3 class="swing-h3">Anmeldung</h3><p class="small muted">Die Anmeldung für Freunde ist noch nicht eingerichtet (Anleitung: LOGIN.md im Repository). Bis dahin bleiben alle Daten nur in diesem Browser.</p>`;
    let top;
    if (!s) {
      top = step === "code"
        ? `<form class="acc-form" data-acc-form="code"><p class="small">Wir haben einen Code an <b>${esc(pendingEmail)}</b> geschickt (auch im Spam-Ordner nachsehen).</p>
            <label>Code aus der E-Mail<input id="accCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
            <div class="btn-row"><button class="btn" type="submit">Anmelden</button><button class="btn ghost" type="button" data-acc-act="back">Andere E-Mail</button></div></form>`
        : `<form class="acc-form" data-acc-form="email"><p class="small">Nur auf Einladung: Melden Sie sich mit der E-Mail-Adresse an, mit der Sie eingeladen wurden.</p>
            <label>E-Mail<input id="accEmail" type="email" autocomplete="username" required value="${esc(pendingEmail)}"></label>
            <label>Anmelde-Passwort<input id="accLogin" type="password" autocomplete="current-password"></label>
            <p class="small muted">Das Anmelde-Passwort steht in Ihrer Einladung. Feld leer lassen = Code per E-Mail.</p>
            <div class="btn-row"><button class="btn" type="submit">Anmelden</button></div></form>`;
    } else if (!key) {
      top = `<form class="acc-form" data-acc-form="pass"><p class="small">Angemeldet als <b>${esc(s.user.email)}</b>. Ihre Daten werden mit Ihrem <b>Sync-Passwort</b> verschlüsselt, bevor sie das Gerät verlassen – niemand sonst kann sie lesen, auch der Dienst nicht. Auf jedem Gerät einmal eingeben. Ohne das Passwort lassen sich die Daten im Konto nicht wiederherstellen.</p>
          <label>Sync-Passwort (mind. 10 Zeichen)<input id="accPass" type="password" autocomplete="current-password" minlength="10" required></label>
          ${needConfirm ? `<p class="small">Neues Konto: Bitte merken oder sicher notieren – und zur Bestätigung ein zweites Mal eingeben.</p>` : ""}
          <label id="accPass2Row"${needConfirm ? "" : " hidden"}>Noch einmal (neues Passwort)<input id="accPass2" type="password" autocomplete="new-password" minlength="10"${needConfirm ? " required" : ""}></label>
          <div class="btn-row"><button class="btn" type="submit">Weiter</button><button class="btn ghost" type="button" data-acc-act="logout">Abmelden</button></div></form>`;
    } else {
      const owner = s.role === "owner";
      top = `<p class="small">Angemeldet als <b>${esc(s.user.email)}</b>${owner ? " · Besitzer" : ""}. Zuletzt abgeglichen: ${busy ? "läuft …" : ago(lastSync || syncState().last)}.</p>
        ${lastError ? `<p class="small down" role="alert">${esc(lastError)}</p>` : ""}
        <p class="small muted">Portfolio, Journal, Merkliste, Kursalarme, Vermögen, Sparplan und Ihre Seiten-Einstellungen sind auf allen Ihren Geräten gleich – Ende-zu-Ende verschlüsselt.</p>
        <div class="btn-row"><button class="btn" type="button" data-acc-act="sync">Jetzt abgleichen</button><button class="btn ghost" type="button" data-acc-act="logout">Abmelden</button><button class="btn ghost" type="button" data-acc-act="forget">Passwort auf diesem Gerät vergessen</button></div>
        <details class="more acc-more"${passMsg ? " open" : ""}><summary>Anmelde-Passwort ändern</summary>
          <form class="acc-form" data-acc-form="loginpass"><p class="small muted">Das Passwort aus der Einladung kennt auch der Besitzer – am besten gleich ein eigenes festlegen. Das Sync-Passwort bleibt davon unberührt.</p>
            <label>Neues Anmelde-Passwort (mind. 10 Zeichen)<input id="accNewLogin" type="password" autocomplete="new-password" minlength="10" required></label>
            <label>Noch einmal<input id="accNewLogin2" type="password" autocomplete="new-password" minlength="10" required></label>
            ${passMsg ? `<p class="small ${passMsg.ok ? "up" : "down"}" role="${passMsg.ok ? "status" : "alert"}">${esc(passMsg.text)}</p>` : ""}
            <div class="btn-row"><button class="btn" type="submit">Ändern</button></div></form></details>
        ${owner ? `<h3 class="swing-h3">Freunde einladen</h3><p class="small">Im Supabase-Projekt unter <b>Authentication → Users → Add user → Create new user</b> die E-Mail und ein Start-Passwort eintragen, Häkchen bei „Auto Confirm User“. Dann den Link (Teilen) und getrennt davon das Start-Passwort schicken. Ihr Freund meldet sich hier an und ändert das Passwort danach selbst. Bots & Copy-Trading sieht nur Ihr Konto.</p>` : ""}`;
    }
    return `${lastError && !(s && key) ? `<p class="small down" role="alert">${esc(lastError)}</p>` : ""}${top}${share}`;
  }
  const isOpen = () => !$("drawer").hidden && $("drawerTitle").textContent === "Konto";
  function open() { openDrawer("Konto", body(), focusFirst); }
  function refreshDrawer() { if (isOpen()) { $("drawerBody").innerHTML = body(); } }
  const focusFirst = () => { const el = $("drawerBody").querySelector("input:not([readonly])"); if (el) el.focus(); };
  window.DTD.openAccount = open;
  window.DTD.shareApp = share;

  document.addEventListener("click", e => {
    const b = e.target.closest("[data-acc-act]");
    if (!b) return;
    const act = b.dataset.accAct;
    if (act === "share") share();
    if (act === "back") { step = "email"; lastError = ""; refreshDrawer(); focusFirst(); }
    if (act === "logout") signOut().then(refreshDrawer);
    if (act === "sync") sync().then(refreshDrawer);
    if (act === "forget") { const s = session(); if (s) keyDrop(s.user.id); key = null; paintButton(); refreshDrawer(); }
  });
  document.addEventListener("submit", async e => {
    const f = e.target.closest("[data-acc-form]");
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.accForm, sub = f.querySelector('[type="submit"]');
    if (sub) sub.disabled = true;
    lastError = ""; passMsg = null;
    try {
      if (kind === "email") {
        pendingEmail = $("accEmail").value.trim().toLowerCase();
        const pw = $("accLogin").value;
        if (pw) { await signInPassword(pendingEmail, pw); step = "email"; }
        else { await requestCode(pendingEmail); step = "code"; }
      } else if (kind === "loginpass") {
        await changeLoginPassword($("accNewLogin").value, $("accNewLogin2").value);
        passMsg = { ok: true, text: "Anmelde-Passwort geändert – ab jetzt mit dem neuen anmelden." };
      } else if (kind === "code") {
        await verifyCode(pendingEmail, $("accCode").value.trim());
        step = "email";
      } else if (kind === "pass") {
        const r = await unlock($("accPass").value, needConfirm ? $("accPass2").value : undefined);
        needConfirm = r === "neu";
        if (needConfirm) { const pass = $("accPass").value; refreshDrawer(); $("accPass").value = pass; $("accPass2").focus(); return; }
      }
    } catch (err) {
      const m = String(err.message || err), wait = /after (\d+) seconds?/i.exec(m);
      const text = /not authori[sz]ed/i.test(m) ? "Codes per E-Mail verschickt dieses Projekt nur an sein Team (eigener Mailversand nicht eingerichtet). Bitte mit dem Anmelde-Passwort aus der Einladung anmelden."
        : /signups? not allowed|not found|user not found/i.test(m) ? "Diese E-Mail ist nicht eingeladen. Bitten Sie den Besitzer der App um eine Einladung."
        : /invalid login credentials|invalid_credentials|invalid_grant/i.test(m) ? "E-Mail oder Anmelde-Passwort stimmt nicht."
        : /email not confirmed/i.test(m) ? "Diese E-Mail ist noch nicht bestätigt – der Besitzer muss beim Anlegen „Auto Confirm User“ anhaken."
        : /expired|invalid|token/i.test(m) && kind === "code" ? "Der Code ist falsch oder abgelaufen – bitte einen neuen anfordern."
        : /different from the old/i.test(m) ? "Das neue Anmelde-Passwort muss sich vom bisherigen unterscheiden."
        : /reauthenticat/i.test(m) ? "Für diese Änderung bitte kurz ab- und wieder anmelden, dann gleich noch einmal ändern."
        : /weak|at least \d+ characters/i.test(m) ? "Das Passwort ist zu schwach – bitte länger und weniger vorhersehbar."
        : wait ? `Bitte noch ${wait[1]} Sekunden warten, dann noch einmal.`
        : /rate limit|too many/i.test(m) ? "Zu viele Versuche – bitte in ein paar Minuten noch einmal." : m;
      if (kind === "loginpass") passMsg = { ok: false, text }; else lastError = text;
    }
    paintButton(); refreshDrawer(); focusFirst();
  });

  // Kopfzeile: Konto-Knopf (neben dem Farbschema)
  const bar = document.querySelector(".appbar");
  if (bar) {
    btn = document.createElement("button");
    btn.type = "button"; btn.className = "icon-btn acc-btn"; btn.innerHTML = ICON;
    btn.addEventListener("click", open);
    bar.insertBefore(btn, bar.querySelector(".livechip"));
    paintButton();
  }

  // ---------- Start ----------
  (async () => {
    await loadCfg();
    const p = store.get(PENDING, null);
    if (p) {
      ls.del(PENDING);
      if (p.error) { lastError = /expired/i.test(p.error) ? "Der Link ist abgelaufen – bitte hier einen Code anfordern." : p.error; if (cfg) setTimeout(open, 400); }
      else if (cfg && p.access_token && Date.now() - p.at < 3600e3) {
        try {
          const u = await (await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${p.access_token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) })).json();
          // Fremd untergeschobener Link (Anmeldung in ein anderes Konto, in das dann die eigenen Daten wandern würden)? Nur ohne
          // Rückfrage, wenn dieses Gerät vor kurzem einen Code für genau diese E-Mail angefordert hat.
          const req = store.get(REQ, null), mail = String(u && u.email || "").toLowerCase();
          const asked = !!req && req.email === mail && Date.now() - req.at < 3600e3;
          if (!u || !u.id) lastError = "Die Anmeldung über den Link hat nicht geklappt – bitte hier anmelden.";
          else if (asked || confirm(`Über einen Link als ${mail || "unbekannt"} anmelden?\n\nNur bestätigen, wenn Sie den Link selbst angefordert haben – sonst würden Ihre Daten in ein fremdes Konto wandern.`)) {
            ls.del(REQ); saveSession({ ...p, user: u }, null); await afterLogin(); if (!key) setTimeout(open, 400);
          } else lastError = "Anmeldung über den Link abgebrochen.";
        } catch { lastError = "Die Anmeldung über den Link hat nicht geklappt – bitte hier anmelden."; }
      }
    }
    const s = session();
    if (cfg && s) {
      if (!s.role) await loadRole();
      key = await keyLoad(s.user.id) || null;
      paintButton();
      if (key) sync();
    }
    // regelmäßig abgleichen, solange die Seite offen ist, und beim Zurückkehren zur Seite
    setInterval(() => { if (!document.hidden) sync(); }, 5 * 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastSync > 60000) sync(); });
  })();
})();
