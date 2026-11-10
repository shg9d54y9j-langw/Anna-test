// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Komplett-Sicherung: herunterladen, in frischem Browser laden, Rückgängig, falsche Datei, Erinnerung: node test-backup.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function ctxPage(seed, vp = { width: 1280, height: 900 }) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Europe/Vienna', locale: 'de-AT', acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`console: ${m.text()}`); });
    if (seed) await p.addInitScript(s => { if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview\.com|finnhub\.io|news-data/, r => r.abort());
    return { ctx, p };
  }
  const SEED = {
    'dtd-portfolio': [{ id: 'p1', sym: 'NVDA', buy: 150, qty: 10, date: '2026-03-02', stop: 120, note: 'KI; Chips' }, { id: 'p2', sym: 'SIE.DE', buy: 180.5, qty: null, date: null, stop: null, note: '' }],
    'dtd-watch': ['AAPL', 'MSFT', 'TSLA'],
    'daytrade-journal-v1': [{ id: 'j1', ts: '2026-11-02T10:00:00Z', date: '02.11.', sym: 'AMD', dir: 'Long', in: 100, out: 120, qty: 3, note: 'Ümlaut ✓' }],
    'dtd-alarms': [{ id: 'a1', sym: 'NVDA', price: 200, dir: 'up' }],
    'dtd-tools': { preset: 'quality', sort: 'note', dir: -1, cal: 'alle' },
    'dtd-smart': { off: ['move'] },
  };

  // 1) Startseite mit Bestand: Erinnerung, Sprung zum Abschnitt, Abschnitt aufgeklappt
  const A = await ctxPage(SEED);
  await A.p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
  await A.p.waitForSelector('#ovSmart .backup-nudge', { timeout: 15000 }).catch(() => null);
  const nudge = await A.p.$eval('#ovSmart .backup-nudge', e => e.textContent).catch(() => '');
  check(/noch keine Sicherung/.test(nudge), `Startseite erinnert: „${nudge.trim().slice(0, 90)}“`);
  await A.p.click('#ovSmart .backup-nudge a');
  await A.p.waitForTimeout(1200);
  const st1 = await A.p.evaluate(() => ({ view: [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(), open: !!(document.getElementById('pfBackup') || {}).open, txt: (document.getElementById('pfBackup') || {}).innerText || '', top: document.getElementById('pfBackup') ? Math.round(document.getElementById('pfBackup').getBoundingClientRect().top) : null }));
  check(st1.view === 'portfolio' && st1.open, `Link führt ins Portfolio, Abschnitt offen (Ansicht ${st1.view}, offen ${st1.open}, oben ${st1.top}px)`);
  check(/Noch keine Sicherung gemacht/.test(st1.txt) && /2 Aktien im Depot/.test(st1.txt) && /3 Aktien auf der Merkliste/.test(st1.txt) && /1 Trade im Journal/.test(st1.txt) && /1 Kursalarm/.test(st1.txt), `Abschnitt zählt den Bestand: ${st1.txt.replace(/\s+/g, ' ').slice(0, 260)}`);
  check(/Sicherung empfohlen/i.test(await A.p.$eval('#pfBackup summary', e => e.textContent)), 'Hinweis „Sicherung empfohlen“ in der Überschrift');
  try { await A.p.screenshot({ path: `${out}/backup-card.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Aufgeklappt bleibt aufgeklappt, wenn das Portfolio neu gezeichnet wird
  await A.p.evaluate(() => window.DTD.reloadPortfolio());
  await A.p.waitForTimeout(800);
  check(await A.p.$eval('#pfBackup', e => e.open), 'Abschnitt bleibt beim Neuzeichnen offen');

  // 2) Herunterladen
  const [dl] = await Promise.all([A.p.waitForEvent('download'), A.p.click('#pfBackup [data-act="backup"]')]);
  const file = path.join(out, dl.suggestedFilename());
  await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(/^rojkomoney-sicherung-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), `Dateiname ${dl.suggestedFilename()}`);
  const keys = Object.keys(j.data).sort();
  check(j.app === 'RojkoMoney' && j.version === 1 && ['daytrade-journal-v1', 'dtd-alarms', 'dtd-portfolio', 'dtd-smart', 'dtd-tools', 'dtd-watch'].every(k => keys.includes(k)) && !keys.includes('dtd-backup-at') && !keys.includes('seeded'), `Inhalt der Datei: ${keys.join(', ')}`);
  check(j.data['dtd-portfolio'][0].note === 'KI; Chips' && j.data['daytrade-journal-v1'][0].note === 'Ümlaut ✓', 'Notizen mit Sonderzeichen unverändert');
  await A.p.waitForTimeout(400);
  const st2 = await A.p.evaluate(() => ({ txt: document.getElementById('pfBackup').innerText, pill: !!document.querySelector('#pfBackup .pill-due'), at: localStorage.getItem('dtd-backup-at') }));
  check(/Letzte Sicherung: heute/.test(st2.txt) && !st2.pill && st2.at, `Nach dem Sichern: „Letzte Sicherung: heute“, kein Hinweis mehr (${st2.at})`);
  await A.p.goto(`http://localhost:${port}/#home`); await A.p.waitForTimeout(1500);
  check(!(await A.p.$('#ovSmart .backup-nudge')) && !!(await A.p.$('#ovSmart')), 'Startseite: keine Erinnerung mehr');

  // 3) Frischer Browser (Handy): Sicherung laden
  const B = await ctxPage(null, { width: 390, height: 844 });
  await B.p.goto(`http://localhost:${port}/#pfBackup`, { waitUntil: 'load' });
  await B.p.waitForSelector('#pfBackup[open]', { timeout: 10000 }).catch(() => null);
  check(/In diesem Browser ist noch nichts gespeichert/.test(await B.p.$eval('#pfBackup', e => e.innerText).catch(() => '')), 'Leerer Browser: „noch nichts gespeichert“');
  let dialogText = '';
  B.p.on('dialog', d => { dialogText = d.message(); d.accept(); });
  const [fc] = await Promise.all([B.p.waitForEvent('filechooser'), B.p.click('#pfBackup [data-act="restore"]')]);
  await Promise.all([B.p.waitForNavigation({ waitUntil: 'load' }), fc.setFiles(file)]);
  check(/Sicherung vom \d\d\.\d\d\.\d{4}/.test(dialogText) && /In der Datei: 2 Aktien im Depot, 3 Aktien auf der Merkliste, 1 Trade im Journal, 1 Kursalarm/.test(dialogText) && /Jetzt in diesem Browser: nichts Gespeichertes/.test(dialogText), `Rückfrage: ${dialogText.replace(/\n+/g, ' | ')}`);
  await B.p.waitForTimeout(1200);
  const st3 = await B.p.evaluate(() => ({ pf: JSON.parse(localStorage.getItem('dtd-portfolio') || '[]').map(h => h.sym).join(), watch: JSON.parse(localStorage.getItem('dtd-watch') || '[]').join(), journal: JSON.parse(localStorage.getItem('daytrade-journal-v1') || '[]').length, tools: JSON.parse(localStorage.getItem('dtd-tools') || 'null'), toast: [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | '), undo: !!localStorage.getItem('dtd-restore-undo') }));
  check(st3.pf === 'NVDA,SIE.DE' && st3.watch === 'AAPL,MSFT,TSLA' && st3.journal === 1 && st3.tools && st3.tools.preset === 'quality', `Geladen: Depot ${st3.pf}, Merkliste ${st3.watch}, Journal ${st3.journal}, Screener ${st3.tools && st3.tools.preset}`);
  check(/Sicherung geladen: 2 Aktien im Depot/.test(st3.toast), `Meldung nach dem Laden: ${st3.toast.replace(/\s+/g, ' ').slice(0, 160)}`);
  await B.p.goto(`http://localhost:${port}/#portfolio`); await B.p.waitForTimeout(1500);
  const cards = await B.p.$$eval('#portfolioBody .pf-list [data-id]', l => l.length).catch(() => 0);
  check(cards === 2, `Portfolio zeigt ${cards} Aktien nach dem Laden`);
  try { await B.p.screenshot({ path: `${out}/backup-phone-portfolio.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // 4) Browser mit eigenem Bestand: laden, dann Rückgängig
  const C = await ctxPage({ 'dtd-portfolio': [{ id: 'x1', sym: 'AMZN', buy: 200, qty: 1 }], 'dtd-watch': ['META'] });
  await C.p.goto(`http://localhost:${port}/#pfBackup`, { waitUntil: 'load' });
  await C.p.waitForSelector('#pfBackup[open]', { timeout: 10000 }).catch(() => null);
  let ctext = '';
  C.p.on('dialog', d => { ctext = d.message(); d.accept(); });
  const [fc2] = await Promise.all([C.p.waitForEvent('filechooser'), C.p.click('#pfBackup [data-act="restore"]')]);
  await Promise.all([C.p.waitForNavigation({ waitUntil: 'load' }), fc2.setFiles(file)]);
  check(/Jetzt in diesem Browser: 1 Aktie im Depot, 1 Aktie auf der Merkliste/.test(ctext), `Rückfrage nennt den jetzigen Stand: ${ctext.split('\n').filter(Boolean)[2] || ''}`);
  await C.p.goto(`http://localhost:${port}/#pfBackup`); await C.p.waitForTimeout(1500);
  const undoBtn = await C.p.$('#pfBackup [data-act="undo-restore"]');
  check(!!undoBtn, 'Knopf „Stand vor dem Laden zurückholen“ erscheint');
  if (undoBtn) {
    await Promise.all([C.p.waitForNavigation({ waitUntil: 'load' }), undoBtn.click()]);
    await C.p.waitForTimeout(1000);
    const st4 = await C.p.evaluate(() => ({ pf: JSON.parse(localStorage.getItem('dtd-portfolio') || '[]').map(h => h.sym).join(), watch: JSON.parse(localStorage.getItem('dtd-watch') || '[]').join(), journal: localStorage.getItem('daytrade-journal-v1'), alarms: localStorage.getItem('dtd-alarms'), undo: localStorage.getItem('dtd-restore-undo'), toast: [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ') }));
    check(st4.pf === 'AMZN' && st4.watch === 'META' && st4.journal === null && st4.alarms === null && st4.undo === null, `Rückgängig: Depot ${st4.pf}, Merkliste ${st4.watch}, Journal ${st4.journal}, Alarme ${st4.alarms}, Rückweg gelöscht ${st4.undo === null}`);
    check(/Stand von vor dem Laden ist zurück/.test(st4.toast), `Meldung nach Rückgängig: ${st4.toast.replace(/\s+/g, ' ').slice(0, 100)}`);
  }

  // 5) Falsche Dateien: nichts ändert sich
  const bad1 = path.join(out, 'kein-backup.json'), bad2 = path.join(out, 'kaputt.json'), bad3 = path.join(out, 'fremd.json');
  fs.writeFileSync(bad1, JSON.stringify({ hello: 'world' }));
  fs.writeFileSync(bad2, '{ das ist kein json');
  fs.writeFileSync(bad3, JSON.stringify({ app: 'RojkoMoney', data: { 'evil-key': 1, '__proto__x': 2, 'dtd-Portfolio': 3 } }));
  for (const [f, want] of [[bad1, /keine Sicherung dieser Seite/], [bad2, /keine Sicherung dieser Seite/], [bad3, /keine Daten/]]) {
    let asked = false;
    const h = d => { asked = true; d.dismiss(); };
    C.p.on('dialog', h);
    const [fc3] = await Promise.all([C.p.waitForEvent('filechooser'), C.p.click('#pfBackup [data-act="restore"]')]);
    await fc3.setFiles(f);
    await C.p.waitForTimeout(500);
    const t = await C.p.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.innerText).join(' | '));
    const pf = await C.p.evaluate(() => JSON.parse(localStorage.getItem('dtd-portfolio') || '[]').map(h => h.sym).join());
    check(want.test(t) && !asked && pf === 'AMZN', `${path.basename(f)}: Meldung „${(t.match(want) || [''])[0]}“, keine Rückfrage, Depot unverändert (${pf})`);
    C.p.off('dialog', h);
  }
  // Abbrechen in der Rückfrage: nichts geändert
  C.p.removeAllListeners('dialog');
  C.p.on('dialog', d => d.dismiss());
  const [fc4] = await Promise.all([C.p.waitForEvent('filechooser'), C.p.click('#pfBackup [data-act="restore"]')]);
  await fc4.setFiles(file);
  await C.p.waitForTimeout(700);
  check(await C.p.evaluate(() => JSON.parse(localStorage.getItem('dtd-portfolio') || '[]').map(h => h.sym).join()) === 'AMZN', 'Abbrechen in der Rückfrage ändert nichts');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
