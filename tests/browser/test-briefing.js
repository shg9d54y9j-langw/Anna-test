// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Tagesbriefing „Heute wichtig“: ganz oben auf der Startseite, Stop erreicht (auch im Tagestief) und Kursalarm zuerst, dann Stop in der Nähe und
// Quartalszahlen morgen, höchstens fünf Punkte, antippen öffnet die Aktie; ohne Depot ein kurzer Hinweis. Feste Uhrzeit:
// Montag, 16.11.2026, 08:00 Uhr in Wien (NVDA meldet am Dienstag). node test-briefing.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(seed) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Vienna', locale: 'de-AT' })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.clock.setFixedTime(new Date('2026-11-16T07:00:00Z'));
    await p.addInitScript(s => { if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
    await p.waitForSelector('#briefing', { timeout: 15000 }).catch(() => null);
    await p.waitForTimeout(500);
    return p;
  }
  const p = await page({
    // KO: Stop über dem Kurs (erreicht); AAPL: Stop knapp unter dem Tagestief (2,9 % darunter, nicht erreicht); NVDA: Zahlen am Dienstag
    'dtd-portfolio': [{ id: 'a', sym: 'KO', buy: 60, qty: 10, stop: 96 }, { id: 'b', sym: 'NVDA', buy: 150, qty: 5 }, { id: 'c', sym: 'AAPL', buy: 180, stop: 341 }],
    'dtd-alarms': [{ id: 'x', sym: 'TSLA', price: 380, dir: 'up' }],
    'dtd-watch': ['MSFT'],
    'dtd-wn-seen': 'zzz',
  });
  const first = await p.$eval('#ovSmart', e => e.firstElementChild && e.firstElementChild.dataset.home);
  check(first === 'brief', `„Heute wichtig“ ist die erste Karte (${first})`);
  const rows = await p.$$eval('#briefing .brief-row', l => l.map(r => ({ now: r.classList.contains('now'), t: r.innerText.replace(/\s+/g, ' ').trim() })));
  console.log(rows.map(r => `  ${r.now ? '!' : '·'} ${r.t}`).join('\n'));
  check(rows.length >= 4 && rows.length <= 5, `höchstens fünf Punkte (${rows.length})`);
  check(rows[0].now && rows[1].now && rows.slice(0, 2).some(r => /KO hat Ihren Stop 96,00 erreicht/.test(r.t)) && rows.slice(0, 2).some(r => /Kursalarm TSLA über 380,00 erreicht/.test(r.t)), 'Stop erreicht und Kursalarm zuerst, hervorgehoben');
  check(rows.some(r => /AAPL liegt nur 2,9 % über Ihrem Stop 341,00/.test(r.t)) && !rows.some(r => /AAPL hat Ihren Stop/.test(r.t)), 'Stop in der Nähe (AAPL 2,9 %), aber nicht erreicht');
  check(rows.some(r => /NVDA meldet morgen nach Börsenschluss Quartalszahlen – der Kurs kann stark springen, Stop prüfen/.test(r.t)), 'Quartalszahlen morgen für eine Depot-Aktie');
  const foot = await p.$eval('#briefing .brief-foot', e => e.innerText);
  check(/\d+ Punkte heute prüfen/.test(foot), `Fußzeile: ${foot}`);
  try { await (await p.$('#briefing')).screenshot({ path: `${out}/briefing.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  await p.click('#briefing .brief-row [data-open="KO"]'); await p.waitForTimeout(600);
  check(await p.evaluate(() => location.hash === '#aktie' && document.getElementById('stockInput').value === 'KO'), 'Antippen öffnet die Aktie im Aktien-Check');

  // ohne Depot und Merkliste
  const q = await page({ 'dtd-wn-seen': 'zzz' });
  const txt = await q.$eval('#briefing', e => e.innerText.replace(/\s+/g, ' '));
  check(/Depot eintragen/.test(txt), `ohne Depot: Hinweis zum Eintragen (${txt.slice(0, 120)})`);
  const w = await q.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(w[0] <= w[1], 'nichts zu breit');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
