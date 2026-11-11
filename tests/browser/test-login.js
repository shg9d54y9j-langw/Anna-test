// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Konto (login.js) gegen ein nachgebautes Supabase: nur Eingeladene bekommen einen Code (create_user: false), falscher Code,
// Sync-Passwort festlegen (zweimal) und auf einem zweiten Gerät prüfen; im Konto liegt nur Verschlüsseltes (kein Kürzel, keine
// Notiz im Klartext); Daten kommen auf dem zweiten Gerät an, Änderungen wandern zurück; erster Abgleich mit eigenen Daten fragt
// nach und hebt den bisherigen Stand auf; Anmelden mit dem Passwort aus der Einladung und es ändern; Code-Versand nur ans Team →
// klarer Hinweis; Bots & Copy-Trading nur für den Besitzer; Abmelden; Anmelde-Link aus der E-Mail (fremd untergeschoben → Rückfrage);
// ohne Einrichtung alles wie bisher; ein geheimer Schlüssel in data/login.json schaltet die Anmeldung ab. node test-login.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');

const SB = 'https://testproj01.supabase.co';
const jwt = payload => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXI`;
const ANON = jwt({ iss: 'supabase', ref: 'testproj01', role: 'anon' });
const SECRET = jwt({ iss: 'supabase', ref: 'testproj01', role: 'service_role' });

// ---------- nachgebautes Supabase (Anmeldung, Zeilen je Nutzer wie mit Row Level Security) ----------
const users = { 'freund@example.com': { id: 'u-friend', role: null, pw: 'Start-Passwort-1' }, 'herr@example.com': { id: 'u-owner', role: 'owner', pw: 'Herr-Passwort-12' },
  'teamlos@example.com': { id: 'u-nomail', role: null, pw: 'Teamlos-Passwort-1', noMail: true } };
const codes = {}, tokens = {}, rows = {}, calls = [];
let n = 0;
const issue = (uid, email) => { const at = `at-${++n}`, rt = `rt-${n}`; tokens[at] = uid; tokens[rt] = uid; return { access_token: at, refresh_token: rt, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email } }; };
const emailOf = uid => Object.keys(users).find(e => users[e].id === uid);
async function supabase(route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method(), H = req.headers();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  calls.push(`${m} ${p}`);
  if (H.apikey !== ANON) return json(401, { message: 'Invalid API key' });
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (p === '/auth/v1/otp') {
    if (body.create_user !== false) return json(400, { msg: 'create_user must be false' });
    if (!users[body.email]) return json(422, { msg: 'Signups not allowed for otp' });
    if (users[body.email].noMail) return json(400, { code: 400, error_code: 'email_address_not_authorized', msg: `Email address "${body.email}" cannot be used as it is not authorized` });
    codes[body.email] = '246810'; return json(200, {});
  }
  if (p === '/auth/v1/verify') return codes[body.email] && codes[body.email] === body.token && body.type === 'email' ? json(200, issue(users[body.email].id, body.email)) : json(403, { msg: 'Token has expired or is invalid' });
  if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const u = users[body.email];
    return u && u.pw === body.password ? json(200, issue(u.id, body.email)) : json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (p === '/auth/v1/token') { const uid = tokens[body.refresh_token]; return uid ? json(200, issue(uid, emailOf(uid))) : json(400, { msg: 'Invalid Refresh Token' }); }
  const uid = tokens[String(H.authorization || '').replace(/^Bearer /, '')];
  if (!uid) return json(401, { message: 'JWT expired' });
  if (p === '/auth/v1/user' && m === 'PUT') {
    const u = users[emailOf(uid)];
    if (body.password === u.pw) return json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
    u.pw = body.password; return json(200, { id: uid, email: emailOf(uid) });
  }
  if (p === '/auth/v1/user') return json(200, { id: uid, email: emailOf(uid) });
  if (p === '/auth/v1/logout') { for (const t of Object.keys(tokens)) if (tokens[t] === uid) delete tokens[t]; return json(204); }
  if (p === '/rest/v1/profiles') { const r = users[emailOf(uid)].role; return json(200, r ? [{ role: r }] : []); }
  if (p === '/rest/v1/user_data') {
    const mine = rows[uid] = rows[uid] || {};
    if (m === 'GET') { const k = url.searchParams.get('k'); return json(200, Object.entries(mine).filter(([kk]) => !k || k === `eq.${kk}`).map(([kk, r]) => ({ k: kk, v: r.v, updated_at: r.updated_at }))); }
    if (m === 'POST') { for (const r of body) { if (r.user_id !== uid) return json(403, { message: 'new row violates row-level security policy' }); mine[r.k] = { v: r.v, updated_at: r.updated_at || new Date().toISOString() }; } return json(201); }
    if (m === 'DELETE') { delete mine[String(url.searchParams.get('k') || '').replace(/^eq\./, '')]; return json(204); }
  }
  return json(404, { message: 'unbekannt' });
}

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function device(seed = null, login = { url: SB, anonKey: ANON }, hash = 'home', dialog = null) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${port}` });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    if (dialog) p.on('dialog', dialog);
    await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
    await p.route(/tradingview|finnhub\.io/, r => r.abort());
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/\/data\/login\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(login) }));
    await p.route(/^https:\/\/testproj01\.supabase\.co\//, supabase);
    if (seed) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); } }, seed);
    await p.goto(`http://localhost:${port}/#${hash}`, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    return p;
  }
  const acc = p => p.$eval('.acc-btn', e => e.dataset.acc).catch(() => null);
  const drawer = p => p.$eval('#drawerBody', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  const openAcc = async p => { if (await p.$eval('#drawer', e => e.hidden)) { await p.click('.acc-btn'); await p.waitForTimeout(200); } };
  const submit = async (p, sel, val) => { await p.fill(sel, val); await p.press(sel, 'Enter'); await p.waitForTimeout(700); };
  async function signIn(p, email) {
    await openAcc(p);
    await submit(p, '#accEmail', email);
    await submit(p, '#accCode', codes[email]);
  }
  const bots = p => p.$eval('#botsBtn', e => !e.hidden).catch(() => null);
  const PF = [{ id: 'a', sym: 'NVDA', buy: 150, qty: 10, note: 'Langfristig halten' }];

  // 1) Gerät A mit eigenen Daten: nur Eingeladene, falscher Code, Sync-Passwort festlegen, verschlüsselt hochladen
  const A = await device({ 'dtd-portfolio': PF, 'dtd-watch': ['AAPL'], 'daytrade-journal-v1': [{ id: 'j1', ts: '2026-11-03T10:00:00Z', sym: 'NVDA', dir: 'Long', in: 100, out: 110, qty: 5, note: 'Ausbruch gekauft' }] });
  check(await acc(A) === 'out' && await bots(A) === false, `eingerichtet, abgemeldet: Konto-Knopf da, Bots ausgeblendet (${await acc(A)}, ${await bots(A)})`);
  await openAcc(A);
  await submit(A, '#accEmail', 'fremd@example.com');
  check(/nicht eingeladen/.test(await drawer(A)) && calls.includes('POST /auth/v1/otp'), 'Fremde E-Mail: „nicht eingeladen“ (Registrierung aus)');
  await submit(A, '#accEmail', 'freund@example.com');
  check(/Code an freund@example.com/.test(await drawer(A)), 'Eingeladene E-Mail: Code verschickt');
  await submit(A, '#accCode', '000000');
  check(/falsch oder abgelaufen/.test(await drawer(A)), 'falscher Code abgelehnt');
  await submit(A, '#accCode', codes['freund@example.com']);
  check(await acc(A) === 'lock' && /Sync-Passwort/.test(await drawer(A)), 'angemeldet, Sync-Passwort wird verlangt');
  await submit(A, '#accPass', 'kurz');
  check(await A.$eval('#accPass', e => !e.checkValidity()) && !(rows['u-friend'] || {}).__check, 'zu kurzes Passwort nicht angenommen (mindestens 10 Zeichen)');
  await submit(A, '#accPass', 'Geheim-Passwort-123');
  check(!(await A.$eval('#accPass2Row', e => e.hidden)), 'neues Konto: Passwort zur Bestätigung ein zweites Mal');
  await A.fill('#accPass', 'Geheim-Passwort-123'); await submit(A, '#accPass2', 'Anders-Passwort-123');
  check(/stimmen nicht überein/.test(await drawer(A)), 'unterschiedliche Eingaben abgelehnt');
  await A.fill('#accPass', 'Geheim-Passwort-123'); await A.fill('#accPass2', 'Geheim-Passwort-123'); await A.press('#accPass2', 'Enter');
  await A.waitForTimeout(2500);
  const mine = rows['u-friend'] || {}, blob = JSON.stringify(mine);
  check(await acc(A) === 'on' && mine['dtd-portfolio'] && mine['dtd-watch'] && mine['daytrade-journal-v1'] && mine.__check, `abgeglichen: ${Object.keys(mine).join(', ')}`);
  check(!/NVDA|Langfristig|Ausbruch|AAPL/.test(blob) && Object.entries(mine).filter(([k]) => k !== '__check').every(([, r]) => /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(r.v)), 'im Konto nur Verschlüsseltes – kein Kürzel, keine Notiz im Klartext');
  check(!JSON.stringify(rows).includes('Geheim-Passwort'), 'das Sync-Passwort selbst wird nie übertragen');
  check(await bots(A) === false, 'Freund (Rolle „user“): Bots ausgeblendet');
  await A.evaluate(() => { location.hash = 'bot'; }); await A.waitForTimeout(500);
  check(await A.evaluate(() => location.hash) === '#home', 'Freund: Adresse #bot führt zur Startseite');
  try { await (await A.$('#drawer')).screenshot({ path: `${out}/login-konto.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // 2) Gerät B ohne Daten: falsches, dann richtiges Passwort – die Daten kommen an
  const B = await device();
  await signIn(B, 'freund@example.com');
  await submit(B, '#accPass', 'Falsches-Passwort-1');
  check(/stimmt nicht/.test(await drawer(B)), 'zweites Gerät: falsches Sync-Passwort abgelehnt');
  await B.fill('#accPass', 'Geheim-Passwort-123'); await B.press('#accPass', 'Enter');
  await B.waitForTimeout(3000);   // Abgleich, dann lädt die Seite neu
  const gotB = await B.evaluate(() => ({ pf: JSON.parse(localStorage.getItem('dtd-portfolio') || 'null'), j: JSON.parse(localStorage.getItem('daytrade-journal-v1') || 'null'), w: JSON.parse(localStorage.getItem('dtd-watch') || 'null') }));
  check(gotB.pf && gotB.pf[0].sym === 'NVDA' && gotB.pf[0].note === 'Langfristig halten' && gotB.j && gotB.j[0].note === 'Ausbruch gekauft' && gotB.w.includes('AAPL'), 'zweites Gerät: Portfolio, Journal und Merkliste angekommen');
  check(await B.evaluate(() => !!JSON.parse(localStorage.getItem('dtd-auth') || 'null')) && await acc(B) === 'on', 'zweites Gerät: angemeldet und abgeglichen (Schlüssel bleibt nach dem Neuladen)');
  // Änderung auf B wandert ins Konto, dann zu A
  await B.evaluate(() => { store.set('dtd-watch', ['AAPL', 'MSFT']); });
  await B.waitForTimeout(4500);
  await openAcc(A); await A.click('[data-acc-act="sync"]'); await A.waitForTimeout(2500);
  check((await A.evaluate(() => JSON.parse(localStorage.getItem('dtd-watch') || '[]'))).includes('MSFT'), 'Änderung auf Gerät B kommt auf Gerät A an');

  // 3) Gerät C mit eigenem, anderem Portfolio: Rückfrage, Cloud übernehmen, bisheriger Stand bleibt über „Rückgängig“
  const C = await device({ 'dtd-portfolio': [{ id: 'c', sym: 'KO', buy: 60, qty: 3 }] });
  await signIn(C, 'freund@example.com');
  let asked = '';
  C.once('dialog', d => { asked = d.message(); d.accept(); });
  await C.fill('#accPass', 'Geheim-Passwort-123'); await C.press('#accPass', 'Enter');
  await C.waitForTimeout(3000);
  const gotC = await C.evaluate(() => ({ pf: JSON.parse(localStorage.getItem('dtd-portfolio') || 'null'), undo: JSON.parse(localStorage.getItem('dtd-restore-undo') || 'null') }));
  check(/unterschiedliche Daten: Portfolio/.test(asked) && gotC.pf[0].sym === 'NVDA' && gotC.undo && /KO/.test(gotC.undo.data['dtd-portfolio']), `erster Abgleich mit eigenen Daten: Rückfrage, Konto übernommen, alter Stand aufgehoben`);

  // 3b) Anmelden mit dem Passwort aus der Einladung (ohne Mailversand), dann ein eigenes Anmelde-Passwort festlegen
  const P = await device();
  await openAcc(P);
  await P.fill('#accEmail', 'freund@example.com'); await submit(P, '#accLogin', 'Falsch-Passwort-9');
  check(/Anmelde-Passwort stimmt nicht/.test(await drawer(P)) && calls.includes('POST /auth/v1/token') && await acc(P) === 'out', 'falsches Anmelde-Passwort abgelehnt');
  const otpBefore = calls.filter(c => c === 'POST /auth/v1/otp').length;
  await P.fill('#accEmail', 'freund@example.com'); await submit(P, '#accLogin', 'Start-Passwort-1');
  check(await acc(P) === 'lock' && calls.filter(c => c === 'POST /auth/v1/otp').length === otpBefore, 'Anmelden mit dem Passwort aus der Einladung – ohne E-Mail-Code');
  await P.fill('#accPass', 'Geheim-Passwort-123'); await P.press('#accPass', 'Enter');
  await P.waitForTimeout(3000);   // Abgleich, dann lädt die Seite neu
  check(await acc(P) === 'on' && /NVDA/.test(await P.evaluate(() => localStorage.getItem('dtd-portfolio') || '')), 'Passwort-Anmeldung: Sync-Passwort, Daten angekommen');
  await openAcc(P); await P.click('.acc-more > summary');
  await P.fill('#accNewLogin', 'Eigenes-Passwort-77'); await submit(P, '#accNewLogin2', 'Anderes-Passwort-77');
  check(/stimmen nicht überein/.test(await drawer(P)) && users['freund@example.com'].pw === 'Start-Passwort-1', 'Anmelde-Passwort ändern: unterschiedliche Eingaben abgelehnt');
  await P.fill('#accNewLogin', 'Eigenes-Passwort-77'); await submit(P, '#accNewLogin2', 'Eigenes-Passwort-77');
  check(/Anmelde-Passwort geändert/.test(await drawer(P)) && users['freund@example.com'].pw === 'Eigenes-Passwort-77' && await acc(P) === 'on', 'Anmelde-Passwort geändert (Sync bleibt an)');
  check(!JSON.stringify(rows).includes('Passwort-77') && !JSON.stringify(rows).includes('Start-Passwort'), 'Anmelde-Passwörter landen nie in den Daten');
  // Code-Versand verweigert (kostenloser Mailversand nur ans Team): verständlicher Hinweis aufs Passwort
  const Q = await device();
  await openAcc(Q); await submit(Q, '#accEmail', 'teamlos@example.com');
  check(/nur an sein Team/.test(await drawer(Q)) && /Anmelde-Passwort/.test(await drawer(Q)), 'Code nur ans Team: Hinweis, mit dem Anmelde-Passwort anzumelden');

  // 4) Besitzer: Bots sichtbar und erreichbar
  const D = await device();
  check(await bots(D) === false, 'nicht angemeldet: Bots ausgeblendet');
  await signIn(D, 'herr@example.com');
  await D.waitForTimeout(500);
  check(await bots(D) === true, 'Besitzer angemeldet: Bots & Copy-Trading sichtbar');
  await D.keyboard.press('Escape');
  await D.evaluate(() => { location.hash = 'bot'; }); await D.waitForTimeout(600);
  check(await D.evaluate(() => location.hash) === '#bot' && !(await D.$eval('#bot', e => e.hidden)), 'Besitzer: Bereich Trend-Bot öffnet');

  // 5) Abmelden: Zugang weg, eigene Daten bleiben
  await openAcc(A); await A.click('[data-acc-act="logout"]'); await A.waitForTimeout(600);
  const gotA = await A.evaluate(() => ({ auth: localStorage.getItem('dtd-auth'), pf: localStorage.getItem('dtd-portfolio') }));
  check(!gotA.auth && /NVDA/.test(gotA.pf) && await acc(A) === 'out', 'Abmelden: Zugang gelöscht, Daten auf dem Gerät bleiben');

  // 6) Anmelde-Link aus der E-Mail: Zugang aus der Adresse übernommen, Adresse sofort sauber; ohne eigene Anforderung erst nach Rückfrage
  const linkHash = l => `access_token=${l.access_token}&refresh_token=${l.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`;
  const prompts = [];
  const E = await device({ 'dtd-auth-req': { email: 'freund@example.com', at: Date.now() } }, { url: SB, anonKey: ANON }, linkHash(issue('u-friend', 'freund@example.com')), d => { prompts.push(d.message()); d.dismiss(); });
  await E.waitForTimeout(800);
  check(await E.evaluate(() => location.hash) === '#home' && !(await E.evaluate(() => location.href)).includes('access_token') && await acc(E) === 'lock' && !prompts.length, 'Anmelde-Link (auf diesem Gerät angefordert): angemeldet ohne Rückfrage, Zugang nicht mehr in der Adresse');
  const E2 = await device(null, { url: SB, anonKey: ANON }, linkHash(issue('u-owner', 'herr@example.com')), d => { prompts.push(d.message()); d.dismiss(); });
  await E2.waitForTimeout(800);
  check(/herr@example\.com/.test(prompts.join(' ')) && await acc(E2) === 'out' && !(await E2.evaluate(() => localStorage.getItem('dtd-auth'))) && await E2.evaluate(() => location.hash) === '#home', 'untergeschobener Link: Rückfrage nennt das Konto, Abbrechen meldet nicht an');
  const E3 = await device(null, { url: SB, anonKey: ANON }, linkHash(issue('u-friend', 'freund@example.com')), d => d.accept());
  await E3.waitForTimeout(800);
  check(await acc(E3) === 'lock', 'Link von einem anderen Gerät angefordert: nach Bestätigen angemeldet');
  const F = await device(null, { url: SB, anonKey: ANON }, 'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await F.waitForTimeout(800);
  check(/abgelaufen/.test(await drawer(F)) && await F.evaluate(() => location.hash) === '#home', 'abgelaufener Link: klarer Hinweis, Adresse sauber');

  // 7) Ohne Einrichtung wie bisher; geheimer Schlüssel in der Einrichtung schaltet die Anmeldung ab
  const G = await device(null, { url: '', anonKey: '' });
  check(await acc(G) === 'off' && await bots(G) === true, 'ohne Einrichtung: Bots wie bisher sichtbar, Konto nur zum Teilen');
  await openAcc(G);
  check(/noch nicht eingerichtet/.test(await drawer(G)) && /App teilen/.test(await drawer(G)), 'Fenster: App teilen und Hinweis zur Einrichtung');
  await G.click('[data-acc-act="share"]'); await G.waitForTimeout(300);
  const shared = await G.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/localhost:\d+\/$/.test(shared) || /markiert/.test(await G.$eval('#toasts', e => e.innerText).catch(() => '')), `Teilen: Link kopiert (${shared})`);
  const H = await device(null, { url: SB, anonKey: SECRET });
  check(await acc(H) === 'off', 'geheimer service_role-Schlüssel in data/login.json: Anmeldung bleibt aus');
  const I = await device(null, { url: 'https://evil.example.com', anonKey: ANON });
  check(await acc(I) === 'off', 'fremde Adresse in data/login.json: Anmeldung bleibt aus');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + [...new Set(errs)].join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
