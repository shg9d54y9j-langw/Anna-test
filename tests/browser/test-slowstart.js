// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Start bei sehr schlechtem Netz: Nach dem ersten Besuch (Service Worker hat alles gespeichert) antwortet der Server je Anfrage
// 2,5 s verzögert – auch dem Service Worker. Die Seite darf höchstens kurz auf das Netz warten und muss dann vollständig aus dem
// Speicher starten (Seite und Skripte in derselben Version, ohne Fehler). Eigener kleiner Server mit umschaltbarer Verzögerung.
// node test-slowstart.js <port> <ausgabe>
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
let delay = 0;
const server = http.createServer((req, res) => setTimeout(() => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
  res.end(fs.readFileSync(f));
}, delay));

(async () => {
  const [, out] = process.argv.slice(2);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
  await p.route(/tradingview|finnhub\.io/, r => r.abort());
  await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
  await p.addInitScript(() => { localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'a', sym: 'NVDA', buy: 150, qty: 10 }])); });
  await p.goto(`http://localhost:${port}/?sw=1#home`, { waitUntil: 'load' });
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => null);
  if (!(await p.evaluate(() => !!navigator.serviceWorker.controller))) { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(500); }
  await p.waitForTimeout(3000);   // Speicher füllen
  check(await p.evaluate(() => !!navigator.serviceWorker.controller), 'Service Worker steuert die Seite');
  const ctl = await ctx.newCDPSession(p);
  await ctl.send('Network.enable'); await ctl.send('Network.clearBrowserCache');   // HTTP-Speicher leer, wie nach mehr als 10 Minuten

  delay = 2500;   // sehr schlechtes Netz – gilt für alle Anfragen, auch die des Service Workers
  const t0 = Date.now();
  await p.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => null);
  const loaded = Date.now() - t0;
  const content = await p.waitForSelector('#ovSmart [data-home="depot"]', { timeout: 15000 }).then(() => Date.now() - t0).catch(() => null);
  console.log(`   geladen nach ${loaded} ms, Startseite mit Inhalt nach ${content} ms`);
  check(loaded < 8000, `Seite trotz 2,5 s Netzverzögerung nach ${loaded} ms geladen (vorher über 90 s)`);
  check(content !== null && content < 10000, `Startseite mit Inhalt nach ${content} ms`);
  check(await p.evaluate(() => typeof window.DTD.openGroup === 'function' && !!document.getElementById('tab-vermoegen')), 'Seite und Skripte passen zusammen (gleiche Version aus dem Speicher)');
  delay = 0;
  try { await p.screenshot({ path: `${out}/slowstart.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close(); server.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
