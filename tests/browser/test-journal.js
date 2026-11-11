// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Journal-Auswertung: Erwartungswert, Verhältnis Ø Gewinn : Ø Verlust, Serien, bester/schlechtester Trade, Tabellen nach Wochentag,
// Tageszeit, Richtung, Aktie und Schlagwort, Einsichten in Worten (Freitage, Short-Trades, #fomo, #breakout); unter 5 Trades ein
// Hinweis; nach einem neuen Trade sofort neu gerechnet. node test-journal.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const T = (ts, sym, dir, i, o, q, note = '') => ({ id: `j${ts}${sym}`, ts, date: '', sym, dir, in: i, out: o, qty: q, note });
const JOURNAL = [
  T('2026-10-30T10:00:00Z', 'NVDA', 'Long', 100, 97, 1, 'zu früh #fomo'),
  T('2026-11-02T10:00:00Z', 'AAPL', 'Long', 100, 110, 1, '#breakout'),
  T('2026-11-03T10:00:00Z', 'MSFT', 'Long', 100, 106, 1, '#breakout'),
  T('2026-11-04T15:00:00Z', 'NVDA', 'Long', 100, 104, 1, '#Breakout am Nachmittag'),
  T('2026-11-05T10:00:00Z', 'AMD', 'Long', 50, 55, 2),
  T('2026-11-06T10:00:00Z', 'TSLA', 'Long', 100, 95, 1, '#fomo'),
  T('2026-11-06T14:00:00Z', 'TSLA', 'Short', 100, 104, 1, '#fomo'),
  T('2026-11-09T10:00:00Z', 'AAPL', 'Long', 100, 103, 1, '#breakout'),
  T('2026-11-16T10:00:00Z', 'KO', 'Long', 60, 62, 1),
  T('2026-11-12T10:00:00Z', 'MSFT', 'Short', 100, 102, 1),
  T('2026-11-13T10:00:00Z', 'KO', 'Short', 60, 63, 1, '#fomo'),
];

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(journal) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Vienna', locale: 'de-AT' })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(j => { if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1'); localStorage.setItem('daytrade-journal-v1', JSON.stringify(j)); }, journal);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data|fx-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#jInsights`, { waitUntil: 'load' });
    await p.waitForSelector('#jInsights .card-title', { timeout: 15000 });
    await p.waitForTimeout(600);
    return p;
  }
  const p = await page(JOURNAL);
  const t = await p.$eval('#jInsights', e => e.innerText.replace(/\s+/g, ' '));
  console.log('  ', t.slice(0, 600));
  check(/11 Trades/.test(t), '11 Trades ausgewertet');
  check(/Erwartungswert je Trade \+1,64 \$/.test(t), 'Erwartungswert +1,64 $ (18 $ in 11 Trades)');
  check(/Ø Gewinn : Ø Verlust 1 : 0,58/.test(t), 'Verhältnis 1 : 0,58 (Ø +5,83 / Ø −3,40)');
  check(/Längste Serie 4 \/ 2/.test(t), 'Serien: 4 Gewinne, 2 Verluste');
  check(/Bester \/ schlechtester \+10,00 \$ \/ −5,00 \$/.test(t), 'bester +10, schlechtester −5');
  check(/Gutes Verhältnis: Gewinne im Schnitt 1,7-mal so groß wie Verluste/.test(t), 'Einsicht: gutes Verhältnis');
  check(/Freitags läuft es am schlechtesten \(−15,00 \$ in 4 Trades, Trefferquote 0 %\)/.test(t), 'Einsicht: Freitage');
  check(/Short-Trades kosten Sie Geld \(−9,00 \$\), Long-Trades bringen \+27,00 \$/.test(t), 'Einsicht: Short-Trades');
  check(/Schlagwort #fomo: im Schnitt −3,75 \$ je Trade \(4 Trades\) – dieses Muster meiden/.test(t), 'Einsicht: #fomo meiden');
  check(/Schlagwort #breakout: im Schnitt \+5,75 \$ je Trade \(4 Trades\) – Ihr bestes Muster/.test(t), 'Einsicht: #breakout (auch groß geschrieben erkannt)');
  const days = await p.$$eval('#jInsights table', ts => ts.map(x => x.closest('.js-grid > div').querySelector('h3').textContent));
  check(days.join() === 'Wochentag,Tageszeit,Richtung,Aktien (beste und schlechteste),Schlagwörter in der Notiz', `Tabellen: ${days.join(', ')}`);
  const slots = await p.$$eval('#jInsights table', ts => [...ts[1].querySelectorAll('tbody tr td:first-child')].map(td => td.innerText.trim()));
  check(slots.join() === 'vor 12 Uhr,12–15:30 Uhr,ab 15:30 Uhr', `Tageszeiten in zeitlicher Reihenfolge: ${slots.join(', ')}`);
  const fri = await p.$eval('#jInsights table', e => [...e.querySelectorAll('tbody tr')].map(r => r.innerText.replace(/\s+/g, ' ')).find(r => /^Fr/.test(r)) || '');
  check(/^Fr 4 0 % −3,75 \$ −15,00 \$/.test(fri), `Freitag in der Tabelle: ${fri}`);
  try { await (await p.$('#jInsights')).screenshot({ path: `${out}/journal-insights.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }
  // neuer Trade → sofort neu gerechnet
  await p.fill('#jSym', 'NVDA'); await p.selectOption('#jDir', 'Long'); await p.fill('#jIn', '100'); await p.fill('#jOut', '120'); await p.fill('#jQty', '1');
  await p.click('#jForm button[type="submit"]'); await p.waitForTimeout(400);
  check(/12 Trades/.test(await p.$eval('#jInsights', e => e.innerText)), 'neuer Trade: sofort 12 Trades');

  const few = await page(JOURNAL.slice(0, 3));
  check(/Ab 5 abgeschlossenen Trades/.test(await few.$eval('#jInsights', e => e.innerText)), 'unter 5 Trades: Hinweis statt Auswertung');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
