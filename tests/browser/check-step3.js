// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Schritt 3: Smarte Alarme und persönliche Startseite – node check-step3.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Testdaten: feste Dateien in tests/browser/fixtures, abgeleitete aus make-fixtures.mjs (FIXTURES_TMP)
const FX = { 'stocks-2053.json': 'stocks.json', 'fund-cty.json': 'fund.json', 'swing-2053.json': 'swing.json', 'fund-earn.json': 'fund-earn.json' };
const fx = n => (FX[n] ? path.join(__dirname, 'fixtures', FX[n]) : path.join(process.env.FIXTURES_TMP || '/tmp/rojko-fixtures', n));

(async () => {
  const [port, out] = process.argv.slice(2);
  // Testdaten: Kreuzungen und Termine gezielt auslösen
  const st = JSON.parse(fs.readFileSync(fx('stocks-2053.json'), 'utf8'));
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const set = (sym, f) => { const x = st.items.find(y => y.sym === sym); f(x); };
  set('NVDA', x => { x.d200 = -0.4; x.chg1d = -3; });               // fällt unter den 200er (Depot)
  set('TSLA', x => { x.d200 = 0.3; x.chg1d = 2; });                 // steigt über den 200er (Merkliste)
  set('AMD', x => { x.earn = { date: day(1), hour: 'amc', eps: 1.2 }; });   // Zahlen morgen (Depot)
  set('MU', x => { x.chg1d = -6.2; });                              // große Bewegung (Merkliste)
  const stocks = JSON.stringify(st), swing = fs.readFileSync(fx('swing-2053.json'), 'utf8'), fund = fs.readFileSync(fx('fund-cty.json'), 'utf8');
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }], ['small', { width: 360, height: 740 }]]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(() => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'p1', sym: 'NVDA', buy: 150, qty: 10 }, { id: 'p2', sym: 'AMD', buy: 120, qty: 5 }]));
      localStorage.setItem('dtd-watch', JSON.stringify(['TSLA', 'MU']));
    });
    await p.route('**/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route('**/swing.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: swing }));
    await p.route('**/fund-data/fund.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: fund }));
    await p.route(/tradingview|finnhub\.io/, r => r.abort());
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
    await p.waitForSelector('#hinweise .al-row', { timeout: 15000 });
    await p.waitForTimeout(800);
    const home = await p.evaluate(() => ({
      alerts: [...document.querySelectorAll('#hinweise > .al-list .al-row')].map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 90)),
      badge: document.getElementById('homeBadge').hidden ? 'aus' : document.getElementById('homeBadge').textContent,
      depot: (document.querySelector('#ovSmart .grid-2 .card .stats') || {}).innerText,
      watch: [...document.querySelectorAll('#ovSmart .w-list .w-row')].map(r => r.querySelector('.chip-btn').textContent),
      neu: [...document.querySelectorAll('#ovSmart .nh-row')].map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 70)),
      dates: [...document.querySelectorAll('#ovSmart .card:last-child .al-row')].map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 70)),
      header: document.querySelector('.appbar').offsetHeight,
      contentTop: Math.round(document.getElementById('ovSmart').getBoundingClientRect().top),
    }));
    console.log(`${name} Hinweise (${home.badge}): ${JSON.stringify(home.alerts)}`);
    if (name === 'desk') { console.log(`  Depot: ${home.depot && home.depot.replace(/\s+/g, ' ')}`); console.log(`  Merkliste: ${home.watch}`); console.log(`  Neu heute: ${JSON.stringify(home.neu)}`); console.log(`  Termine: ${JSON.stringify(home.dates)}`); }
    console.log(`${name} Kopfzeile ${home.header}px · Inhalt beginnt bei ${home.contentTop}px`);
    const has = re => home.alerts.some(a => re.test(a));
    check(has(/^NVDA.*fällt unter den 200/) && has(/^TSLA.*steigt über den 200/) && has(/^AMD.*morgen Quartalszahlen/) && has(/^MU.*-6,2 %/), `${name}: Hinweise ${JSON.stringify(home.alerts)}`);
    check(/^NVDA/.test(home.alerts[0]), `${name}: wichtigster Hinweis zuerst? ${home.alerts[0]}`);
    check(home.badge !== 'aus' && +home.badge >= 3, `${name}: Zahl am Reiter ${home.badge}`);
    check(home.watch.join() === 'TSLA,MU' && home.neu.length >= 1 && home.dates.some(d => /AMD/.test(d)), `${name}: Startseite ${JSON.stringify({ w: home.watch, n: home.neu.length, d: home.dates })}`);
    if (name !== 'desk') check(home.header <= 110, `${name}: Kopfzeile ${home.header}px`);
    // Hinweis-Typ abschalten
    await p.click('#hinweise .sa-set summary'); await p.click('#hinweise [data-smart="ma200"]'); await p.waitForTimeout(300);
    const after = await p.$$eval('#hinweise > .al-list .al-row', r => r.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 40)));
    check(!after.some(a => /200-Tage/.test(a)), `${name}: abgeschalteter Typ noch sichtbar ${JSON.stringify(after)}`);
    await p.click('#hinweise [data-smart="ma200"]'); await p.waitForTimeout(200);
    try { if (name !== 'small') { await p.screenshot({ path: `${out}/${name}-home.png` }); await p.screenshot({ path: `${out}/${name}-home-full.png`, fullPage: true }); } } catch { /* Bildschirmfoto nur zur Ansicht */ }
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(w[0] <= w[1], `${name}: Startseite zu breit ${w}`);
    // Termine-Link zum Kalender
    await p.click('#ovSmart a[href="#kalender"]'); await p.waitForTimeout(1500);
    const kal = await p.evaluate(() => ({ v: [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join(), top: document.getElementById('kalender') ? Math.round(document.getElementById('kalender').getBoundingClientRect().top) : null }));
    check(kal.v === 'tools' && kal.top !== null && kal.top < 250, `${name}: Kalender-Link ${JSON.stringify(kal)}`);
    await ctx.close();
  }
  console.log('JS-Fehler:', JSON.stringify(errs));
  console.log(fails.length ? `FEHLER (${fails.length}):\n - ${fails.join('\n - ')}` : 'Alle Prüfungen bestanden.');
  await b.close();
})();
