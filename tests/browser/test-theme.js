// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Farbschema: ohne Wahl wie das Gerät (hell oder dunkel), Schalter in der Kopfzeile (automatisch → hell → dunkel, bleibt nach dem
// Neuladen), Wahl in „Seite anpassen“, Kopfzeilenfarbe des Handys, Diagrammfarben passend. node test-theme.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(colorScheme) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  }
  const state = p => p.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name="theme-color"]').content, pref: window.RojkoTheme.get(), series: PAL.series1, label: document.querySelector('.theme-btn').getAttribute('aria-label') }));

  // ohne Wahl: wie das Gerät
  const dark = await page('dark');
  let s = await state(dark);
  check(s.theme === 'dark' && s.pref === 'auto' && s.meta === '#07070a' && s.bg === 'rgb(7, 7, 10)', `Gerät dunkel → dunkel (${s.bg})`);
  const light = await page('light');
  s = await state(light);
  check(s.theme === 'light' && s.pref === 'auto' && s.meta === '#f4f4f7' && s.bg === 'rgb(244, 244, 247)' && s.series === '#4f56e8', `Gerät hell → hell, Diagrammfarben hell (${s.bg}, ${s.series})`);
  try { await light.screenshot({ path: `${out}/theme-light.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // Schalter: automatisch → hell → dunkel → automatisch (Gerät dunkel)
  check(/wie das Gerät/.test(s.label), `Schalter beschriftet: ${s.label}`);
  await Promise.all([dark.waitForNavigation({ waitUntil: 'load' }), dark.click('.theme-btn')]);
  await dark.waitForTimeout(300);
  s = await state(dark);
  check(s.pref === 'light' && s.theme === 'light' && /hell/.test(s.label), `1. Tippen: hell, Seite neu geladen (${s.theme})`);
  await Promise.all([dark.waitForNavigation({ waitUntil: 'load' }), dark.click('.theme-btn')]);
  await dark.waitForTimeout(300);
  s = await state(dark);
  check(s.pref === 'dark' && s.theme === 'dark', `2. Tippen: dunkel (${s.theme})`);
  await dark.click('.theme-btn'); await dark.waitForTimeout(400);   // automatisch: Gerät ist dunkel, also kein Neuladen nötig
  s = await state(dark);
  check(s.pref === 'auto' && s.theme === 'dark', `3. Tippen: wie das Gerät (${s.theme})`);
  await dark.reload({ waitUntil: 'load' });
  s = await state(dark);
  check(s.pref === 'auto', 'Wahl bleibt nach dem Neuladen');

  // „Seite anpassen“: Farbschema hell
  await dark.click('#home .home-custom [data-layout-open]');
  await dark.waitForSelector('#layBody [data-theme-set="light"]');
  await Promise.all([dark.waitForNavigation({ waitUntil: 'load' }), dark.click('#layBody [data-theme-set="light"]')]);
  s = await state(dark);
  check(s.pref === 'light' && s.theme === 'light', '„Seite anpassen“ stellt auf hell');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
