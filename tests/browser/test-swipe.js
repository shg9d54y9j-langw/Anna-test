// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Wischen am Handy mit echten Touch-Ereignissen: links = nächster Bereich bzw. Teil, rechts = vorheriger; Teile zusammengelegter
// Bereiche einzeln, in einen Bereich von links hinein = sein erster Teil; Bots nur unter sich; nichts am Bildschirmrand, bei eher
// senkrechter Bewegung, in Tabellen, bei offenem Fenster; ausgeblendete Bereiche übersprungen; abschaltbar unter „Seite
// anpassen“; kein Neuladen durch „Ziehen zum Aktualisieren“; am Computer ohne Wirkung. node test-swipe.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');

(async () => {
  const [port] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function open(vp = { width: 390, height: 844 }, touch = true) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
    await p.route(/tradingview|finnhub\.io/, r => r.abort());
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.addInitScript(() => { localStorage.setItem('dtd-swipe-hint', 'true'); window.__stay = 1; });
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
    await p.waitForTimeout(700);
    p.cdp = await ctx.newCDPSession(p);
    return p;
  }
  // Wischbewegung von (x1,y1) nach (x2,y2) in ms Millisekunden
  async function swipe(p, x1, y1, x2, y2, ms = 220) {
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= 6; i++) { await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 6, y: y1 + (y2 - y1) * i / 6 }] }); await p.waitForTimeout(ms / 6); }
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(450);
  }
  const hash = p => p.evaluate(() => location.hash);
  const goto = async (p, h) => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(500); await p.evaluate(() => window.scrollTo(0, 0)); };
  const left = p => swipe(p, 300, 420, 90, 430), right = p => swipe(p, 90, 420, 300, 430);

  const p = await open();
  await left(p);
  check(await hash(p) === '#portfolio', `Startseite, nach links gewischt: Portfolio (${await hash(p)})`);
  await left(p);
  check(await hash(p) === '#vermoegen', `weiter: Vermögen (${await hash(p)})`);
  await right(p); await right(p);
  check(await hash(p) === '#home', 'zweimal nach rechts: zurück zur Startseite');
  await right(p);
  check(await hash(p) === '#home', 'am Anfang nach rechts: bleibt');
  await swipe(p, 8, 420, 230, 430);
  check(await hash(p) === '#home', 'Start am linken Rand (Zurück-Geste des Browsers): nichts');
  await swipe(p, 300, 300, 210, 450);
  check(await hash(p) === '#home', 'eher senkrecht: nichts');
  await swipe(p, 300, 420, 90, 430, 1500);
  check(await hash(p) === '#home', 'zu langsam (1,5 s): nichts');
  // Teile zusammengelegter Bereiche
  await goto(p, 'aktie'); await left(p);
  check(await hash(p) === '#setup', `Aktien-Check → Trade planen (${await hash(p)})`);
  await left(p);
  check(await hash(p) === '#markt', `Trade planen → Markt (${await hash(p)})`);
  await goto(p, 'tools'); await left(p);
  check(await hash(p) === '#hot', `Werkzeuge → Ideen beginnt beim ersten Teil (${await hash(p)})`);
  await left(p);
  check(await hash(p) === '#swing', 'HotStuff → Swing-Planer');
  await goto(p, 'theorie'); await left(p);
  check(await hash(p) === '#theorie', 'letzter Teil: bleibt');
  // Bots nur unter sich
  await goto(p, 'bot'); await left(p);
  check(await hash(p) === '#daily', 'Trend-Bot → Copy-Trading');
  await left(p);
  check(await hash(p) === '#daily', 'nicht aus den Bots hinaus in die Hauptbereiche');
  // in einer Tabelle wischen gehört der Tabelle
  await goto(p, 'portfolio');
  const tbl = await p.$('#jTable');
  await tbl.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
  const box = await tbl.boundingBox();
  await swipe(p, Math.min(330, box.x + box.width - 20), box.y + 12, 90, box.y + 16);
  check(await hash(p) === '#portfolio', 'in einer Tabelle: kein Bereichswechsel');
  // offenes Fenster
  await goto(p, 'home');
  await p.click('#home .home-custom [data-layout-open]'); await p.waitForTimeout(300);
  await left(p);
  check(await hash(p) === '#home', 'bei offenem Fenster: nichts');
  // abschalten unter „Seite anpassen“
  await p.click('[data-swipe-toggle]'); await p.waitForTimeout(100);
  await p.click('#drawerClose'); await p.waitForTimeout(200);
  await left(p);
  check(await hash(p) === '#home' && await p.evaluate(() => localStorage.getItem('dtd-swipe')) === '"off"', 'abgeschaltet: Wischen wirkt nicht');
  await p.evaluate(() => window.DTD.swipe.set(true));
  // ausgeblendeter Bereich wird übersprungen
  await p.evaluate(() => { localStorage.setItem('dtd-layout', JSON.stringify({ hide: ['vermoegen'] })); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700);
  await goto(p, 'portfolio'); await left(p);
  check(await hash(p) === '#aktie', `Vermögen ausgeblendet: Portfolio → Aktien-Check (${await hash(p)})`);
  check(await p.evaluate(() => window.__stay === 1), 'kein Neuladen durch „Ziehen zum Aktualisieren“');
  // Computer: ohne Wirkung
  const d = await open({ width: 1280, height: 900 }, true);
  await swipe(d, 900, 500, 400, 510);
  check(await hash(d) === '#home', 'Computerbreite: Wischen ohne Wirkung');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
