// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Note-Bilanz im Browser: volle Bilanz, früher Stand, fehlende Datei, Verweis aus dem Aktien-Check, Handy, gleiche Noten wie der Server;
// „Note lernt dazu“: Gewichte je Teilnote (angepasst, noch lernend, ältere Datei ohne Angabe) und Noten mit gelernten Gewichten
// node test-bilanz.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  const stocks = fs.readFileSync(fx('stocks-2053.json'), 'utf8'), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const full = fs.readFileSync(fx('nt-track.json'), 'utf8'), early = fs.readFileSync(fx('nt-early.json'), 'utf8'), serverNotes = JSON.parse(fs.readFileSync(fx('nt-notes.json'), 'utf8'));
  const weights = JSON.parse(fs.readFileSync(fx('nt-weights.json'), 'utf8')), serverNotesW = JSON.parse(fs.readFileSync(fx('nt-notes-w.json'), 'utf8'));
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(track, vp = { width: 1280, height: 900 }, recent = null) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`console: ${m.text()}`); });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route('**/stock-data/note-track.json*', r => (track === 404 ? r.fulfill({ status: 404, body: 'Not Found' }) : track === 'abort' ? r.abort() : r.fulfill({ status: 200, contentType: 'application/json', body: track })));
    // Notenverlauf mit Gewichten nur, wenn verlangt – sonst wie vor dem ersten Lernen (Test unabhängig von der echten Datei)
    await p.route('**/stock-data/note-recent.json*', r => (recent ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recent) }) : r.fulfill({ status: 404, body: '' })));
    await p.route(/tradingview\.com|finnhub\.io|news-data/, r => r.abort());
    return p;
  }
  const text = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');

  // 1) Volle Bilanz im Bereich Werkzeuge
  const p = await page(full);
  await p.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await p.waitForSelector('#ntBody .nt-table', { timeout: 15000 }).catch(() => null);
  await p.waitForTimeout(600);
  const t1 = await text(p, '#notebilanz');
  check(/Seit dem \d\d\.\d\d\.2026 merkt sich die Seite/.test(t1) && /70 Messtage/.test(t1), `Kopf: ${t1.slice(0, 170)}`);
  check(/Bisher trennt die Note/.test(t1) && /einem Monat/.test(t1) && /Aussagekraft: gut/i.test(t1), `Urteil: ${(t1.match(/Bisher[^.]*\.[^.]*\./) || [''])[0].slice(0, 220)}`);
  const rows = await p.$$eval('#notebilanz .nt-table tbody tr', r => r.map(x => [...x.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim())));
  console.log('  Tabelle:', JSON.stringify(rows.map(r => r.slice(0, 3))));
  check(rows.length === 6 && rows[0][0].startsWith('80–100') && rows[5][0].startsWith('Alle') && rows.every(r => r.length === 4), `Tabelle: ${rows.length} Zeilen × ${rows[0] && rows[0].length} Spalten`);
  check(/^\+0,9/.test(rows[0][2]) && /^−0,8/.test(rows[4][2]) && /Treffer/.test(rows[0][2]) && /Ø aller/.test(rows[5][2]), `Monatsspalte: beste ${rows[0][2]}, schwächste ${rows[4][2]}`);
  const svg = await p.evaluate(() => { const s = document.querySelector('#ntChart svg'); return s ? { paths: s.querySelectorAll('path').length, labels: [...s.querySelectorAll('.dlabel')].map(t => t.textContent), aria: s.getAttribute('aria-label') } : null; });
  check(svg && svg.paths === 3 && svg.labels.length === 3, `Diagramm: ${svg && svg.paths} Linien, Beschriftung ${svg && JSON.stringify(svg.labels)}`);
  await p.hover('#ntChart .hit').catch(() => null);
  await p.waitForTimeout(150);
  const tip = await text(p, '#ntChart .viz-tip');
  check(/Note 80–100: [+−±]/.test(tip) && /Alle Aktien/.test(tip) && /Note 0–19/.test(tip), `Fadenkreuz-Werte: ${tip.slice(0, 120)}`);
  try { await (await p.$('#notebilanz')).screenshot({ path: `${out}/bilanz-desk.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // „Note lernt dazu“: angepasst, mit Treffsicherheit je Teilnote
  check(/Note lernt dazu/.test(t1) && /Seit 240 Messtagen gemessen – die Gewichte sind zu 50 % an die eigenen Messungen angepasst \(voll ab 360 Tagen\)/.test(t1), `Lernstand: ${(t1.match(/Seit \d+ Messtagen[^.]*\./) || ['fehlt'])[0]}`);
  const lw = await p.$$eval('#notebilanz .nt-learn tbody tr', r => r.map(x => [...x.cells].map(c => c.innerText.trim())));
  console.log('  Gewichte:', JSON.stringify(lw));
  const pct = s => parseFloat(s.replace(',', '.'));
  check(lw.length === 6 && lw.every(r => r.length === 5) && lw[0][0] === 'Trend' && lw[0][1] === '25 %' && pct(lw[0][2]) > 25 && /^\+0,0\d\d$/.test(lw[0][3]) && lw[4][0] === 'Experten' && pct(lw[4][2]) < 15 && /^−0,0\d\d$/.test(lw[4][3]) && /^−\d/.test(lw[4][4]), 'Tabelle: Trend stärker, Experten schwächer gewichtet, Treffsicherheit mit Vorzeichen');
  const total = lw.reduce((s, r) => s + pct(r[2]), 0);
  check(Math.abs(total - 100) < 0.6, `aktuelle Gewichte ergeben zusammen 100 % (${total.toFixed(1)})`);
  check(lw.every(r => pct(r[2]) >= pct(r[1]) * 0.5 - 0.1 && pct(r[2]) <= pct(r[1]) * 1.5 + 0.1), 'jede Teilnote zwischen halbem und anderthalbfachem Standardgewicht');
  // Sprungleiste kennt den Abschnitt
  check(await p.evaluate(() => !!document.querySelector('#notebilanz[data-section="Note-Bilanz"]')), 'Abschnitt „Note-Bilanz“ in der Sprungleiste');

  // 2) Gleiche Noten wie der Server (gleiche Daten)
  await p.evaluate(() => window.DTD.scoreReady());
  const diff = await p.evaluate(sn => { const all = window.DTD.scoreAll(); let n = 0, bad = []; for (const [s, v] of Object.entries(sn)) { n++; const w = all.get(s); if (!w || w.note !== v) bad.push(`${s}:${v}/${w && w.note}`); } return { n, bad: bad.slice(0, 5), nbad: bad.length }; }, serverNotes);
  check(diff.n > 700 && diff.nbad === 0, `Website und Server rechnen dieselben Noten (${diff.n} Aktien, Abweichungen ${diff.nbad} ${diff.bad.join(' ')})`);

  // 2b) Mit gelernten Gewichten im Notenverlauf rechnet die Seite wie der Server mit denselben Gewichten
  const pw = await page(full, undefined, { updated: '2026-11-11T09:40:00Z', dates: { now: '2026-11-11' }, keys: ['now'], n: {}, w: weights });
  await pw.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await pw.evaluate(() => window.DTD.scoreReady());
  const dw = await pw.evaluate(([sn, so]) => { const all = window.DTD.scoreAll(); let n = 0, bad = 0, changed = 0; for (const [s, v] of Object.entries(sn)) { n++; const w = all.get(s); if (!w || w.note !== v) bad++; if (so[s] !== v) changed++; } return { n, bad, changed, w: window.DTD.scoreWeights() }; }, [serverNotesW, serverNotes]);
  check(dw.n > 700 && dw.bad === 0 && dw.changed > 50, `gelernte Gewichte: Website wie Server (${dw.n} Aktien, Abweichungen ${dw.bad}, ${dw.changed} Noten anders als mit Standardgewichten)`);
  check(Object.keys(weights).every(k => Math.abs(dw.w[k] - weights[k]) < 0.002), 'Seite übernimmt die Gewichte aus dem Notenverlauf');
  const bogus = await page(full, undefined, { dates: { now: '2026-11-11' }, n: {}, w: { trend: 0.9, quality: 0.9 } });
  await bogus.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await bogus.evaluate(() => window.DTD.scoreReady());
  check(await bogus.evaluate(() => window.DTD.scoreWeights().trend === 0.25 && window.DTD.scoreWeights().risk === 0.1), 'unvollständige oder unsinnige Gewichte: Standardgewichte');
  await pw.context().close(); await bogus.context().close();

  // 3) Verweis aus der Gesamtnote im Aktien-Check
  await p.goto(`http://localhost:${port}/#aktie`); await p.waitForFunction(() => window.DTD.stockData && window.DTD.stockData());
  await p.fill('#stockInput', 'NVDA'); await p.press('#stockInput', 'Enter');
  await p.waitForSelector('#skNote a[href="#notebilanz"]', { timeout: 10000 }).catch(() => null);
  const link = await p.$('#skNote a[href="#notebilanz"]');
  check(!!link, 'Gesamtnote im Aktien-Check verweist auf die Bilanz');
  if (link) {
    await link.click(); await p.waitForTimeout(1200);
    const st = await p.evaluate(() => ({ view: [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(), top: document.getElementById('notebilanz') ? Math.round(document.getElementById('notebilanz').getBoundingClientRect().top) : null }));
    check(st.view === 'tools' && st.top !== null && st.top < 260, `Sprung in die Werkzeuge zur Bilanz (Ansicht ${st.view}, oben ${st.top}px)`);
  }

  // 4) Früher Stand: noch keine Bilanz, Termine
  const q = await page(early, { width: 390, height: 844 });
  await q.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await q.waitForSelector('#ntBody .nt-verdict', { timeout: 15000 }).catch(() => null);
  const t2 = await text(q, '#notebilanz');
  check(/1 Messtag\b/.test(t2) && /Noch zu früh/.test(t2) && /Wochen-Bilanz kommt voraussichtlich am \d\d\.\d\d\.\d{4}/.test(t2) && !(await q.$('#ntChart svg')), `Früher Stand: ${(t2.match(/Noch zu früh[^.]*\.[^.]*\./) || [''])[0]}`);
  const cells = await q.$$eval('#notebilanz .nt-table tbody tr:first-child td', c => c.map(x => x.innerText.trim()));
  check(cells.slice(1).every(c => /^ab \d\d\.\d\d\.$/.test(c)), `Zellen ohne Daten zeigen den Termin: ${JSON.stringify(cells)}`);
  check(/Noch keine Messung: .* die erste voraussichtlich am \d\d\.\d\d\.2026\. Angepasst wird ab 120 Messtagen, bis dahin gelten die Standardgewichte aus der Forschung/.test(t2), `Früher Stand: Termin der ersten Messung, Standardgewichte (${(t2.match(/Noch keine Messung[^.]*\./) || ['fehlt'])[0]})`);
  const lwe = await q.$$eval('#notebilanz .nt-learn tbody tr', r => r.map(x => [...x.cells].map(c => c.innerText.trim())));
  check(lwe.length === 6 && lwe.every(r => r[1] === r[2].replace(',0', '') && r[3] === '–'), `Früher Stand: aktuell = Standard, noch ohne Treffsicherheit (${JSON.stringify(lwe[0])})`);
  const ov = await q.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(ov[0] <= ov[1], `Handy ohne seitliches Scrollen (${ov[0]} ≤ ${ov[1]})`);
  try { await (await q.$('#notebilanz')).screenshot({ path: `${out}/bilanz-phone-early.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // Handy mit voller Bilanz
  const q2 = await page(full, { width: 360, height: 740 });
  await q2.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await q2.waitForSelector('#ntChart svg', { timeout: 15000 }).catch(() => null);
  const ov2 = await q2.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('#ntChart svg') ? document.querySelector('#ntChart svg').getAttribute('width') : null]);
  check(ov2[0] <= ov2[1] && ov2[2] !== null, `Kleines Handy mit Diagramm ohne seitliches Scrollen (${ov2[0]} ≤ ${ov2[1]}, Diagramm ${ov2[2]} px)`);
  try { await (await q2.$('#notebilanz')).screenshot({ path: `${out}/bilanz-phone-full.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // ältere Datei ohne Angaben zum Lernen
  const old = JSON.parse(full); delete old.learn;
  const o = await page(JSON.stringify(old));
  await o.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await o.waitForSelector('#ntBody .nt-table', { timeout: 15000 }).catch(() => null);
  check(/Die Gewichte stammen aus der Forschung \(Trend 25 %, Qualität 20 %, Bewertung 15 %, Wachstum 15 %, Experten 15 %, Sicherheit 10 %\)/.test(await text(o, '#notebilanz')) && !(await o.$('.nt-learn')), 'ältere Bilanz ohne Lernangaben: Standardgewichte erklärt');
  await o.context().close();

  // 5) Datei fehlt (vor dem ersten Lauf) / nicht erreichbar
  const r = await page(404);
  await r.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await r.waitForFunction(() => document.getElementById('ntBody') && !/Lade/.test(document.getElementById('ntBody').innerText), null, { timeout: 15000 }).catch(() => null);
  check(/Ab dem nächsten Lauf der Aktien-Daten/.test(await text(r, '#notebilanz')), 'Vor dem ersten Lauf: Erklärung statt Fehler');
  const s = await page('abort');
  await s.goto(`http://localhost:${port}/#notebilanz`, { waitUntil: 'load' });
  await s.waitForFunction(() => document.getElementById('ntBody') && !/Lade/.test(document.getElementById('ntBody').innerText), null, { timeout: 15000 }).catch(() => null);
  check(/gerade nicht erreichbar/.test(await text(s, '#notebilanz')), 'Ohne Netz: Hinweis statt Fehler');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
