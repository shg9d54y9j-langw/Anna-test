// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Design „Präzision“ mit den Hauptbereichen (Bots & Copy-Trading über den eigenen Knopf oben): Computer mit Seitenleiste (Reihenfolge, Pfeiltasten, Hervorhebung), Umschaltleiste in
// zusammengelegten Bereichen (merkt sich den Teil), Tablet mit Reitern oben, Handy mit allen sieben Bereichen in der Leiste unten
// und gekürzter Einleitung, die sich antippen lässt; nirgends zu breit. node test-design.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const ORDER = 'home,portfolio,aktie,markt,tools,ideas';

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page(vp) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data/, r => r.abort());
    return p;
  }
  const wide = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  // Computer: Seitenleiste mit Gruppen
  const d = await page({ width: 1440, height: 900 });
  await d.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
  await d.waitForTimeout(800);
  const side = await d.evaluate(() => {
    const nav = document.querySelector('.tabs'), cs = getComputedStyle(nav), r = nav.getBoundingClientRect();
    return { dir: cs.flexDirection, w: Math.round(r.width), left: Math.round(r.left), groups: [...nav.querySelectorAll('.tab-group')].filter(g => g.offsetParent).map(g => g.textContent),
      order: [...nav.querySelectorAll('.tab')].map(t => t.dataset.tab).join(), main: Math.round(document.querySelector('main').getBoundingClientRect().left) };
  });
  check(side.dir === 'column' && side.left === 0 && side.w > 200 && side.main >= side.w, `Seitenleiste links (${side.w} px), Inhalt daneben ab ${side.main} px`);
  check(side.order === ORDER, `Hauptbereiche in der Seitenleiste, ohne Bots: ${side.order}`);
  // eigener Knopf „Bots & Copy-Trading“ in der Kopfzeile: öffnet Trend-Bot und Copy-Trading mit Tagesempfehlung
  const bb = await d.evaluate(() => { const b = document.getElementById('botsBtn'); return { inBar: !!b.closest('.appbar'), text: b.innerText.trim(), label: b.getAttribute('aria-label') }; });
  check(bb.inBar && bb.text === 'Bots & Copy-Trading' && /Tagesempfehlung/.test(bb.label), `Knopf oben in der Kopfzeile (${JSON.stringify(bb)})`);
  await d.click('#botsBtn'); await d.waitForTimeout(500);
  const bv = await d.evaluate(() => ({ view: document.querySelector('#views > .view:not([hidden])').id, cur: document.getElementById('botsBtn').getAttribute('aria-current'), tabSel: document.querySelectorAll('.tab[aria-selected="true"]').length, parts: [...document.querySelectorAll('#bot > .viewswitch [data-view]')].map(x => x.dataset.view).join() }));
  check(bv.view === 'bot' && bv.cur === 'page' && bv.tabSel === 0 && bv.parts === 'bot,daily', `Knopf öffnet Trend-Bot | Copy-Trading & Tagesempfehlung, als aktiv markiert (${JSON.stringify(bv)})`);
  await d.goto(`http://localhost:${port}/#home`); await d.waitForTimeout(400);
  check(await d.evaluate(() => !document.getElementById('botsBtn').hasAttribute('aria-current')), 'auf der Startseite ist der Knopf nicht markiert');
  const sel = await d.evaluate(() => { const t = document.querySelector('.tab[aria-selected="true"]'); return { id: t.dataset.tab, bg: getComputedStyle(t).backgroundColor }; });
  check(sel.id === 'home' && sel.bg !== 'rgba(0, 0, 0, 0)', `gewählter Bereich hervorgehoben (${sel.bg})`);
  await d.focus('#tab-home'); await d.keyboard.press('ArrowDown'); await d.waitForTimeout(300);
  await d.keyboard.press('ArrowDown'); await d.waitForTimeout(400);
  const now = await d.evaluate(() => [location.hash, document.activeElement.id]);
  check(now[0] === '#aktie' && now[1] === 'tab-aktie', `Pfeiltaste nach unten folgt der Seitenleiste (${now.join(' ')})`);
  const bar = await d.evaluate(() => { const a = document.querySelector('.appbar'); return [getComputedStyle(a).position, Math.round(a.getBoundingClientRect().height)]; });
  check(bar[0] === 'sticky' && bar[1] <= 64, `Kopfzeile bleibt oben (${bar.join(', ')} px)`);
  for (const v of ['home', 'portfolio', 'aktie', 'tools']) { await d.goto(`http://localhost:${port}/#${v}`); await d.waitForTimeout(600); check(await wide(d), `Computer ${v}: nichts zu breit`); }
  try { await d.goto(`http://localhost:${port}/#home`); await d.waitForTimeout(500); await d.screenshot({ path: `${out}/design-desk.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // Tablet: Reiter oben, keine Gruppen-Überschriften
  const t = await page({ width: 900, height: 1000 });
  await t.goto(`http://localhost:${port}/#markt`, { waitUntil: 'load' });
  await t.waitForTimeout(600);
  const tab = await t.evaluate(() => ({ dir: getComputedStyle(document.querySelector('.tabs')).flexDirection, groups: [...document.querySelectorAll('.tab-group')].filter(g => g.offsetParent).length, line: getComputedStyle(document.querySelector('#tab-markt'), '::after').height }));
  check(tab.dir === 'row' && tab.groups === 0 && tab.line === '2px', `Tablet: Reiter oben mit Unterstrich, ohne Gruppen (${JSON.stringify(tab)})`);
  check(await wide(t), 'Tablet: nichts zu breit');

  // Handy: Leiste unten, Einleitung gekürzt und antippbar
  const m = await page({ width: 390, height: 844 });
  await m.goto(`http://localhost:${port}/#portfolio`, { waitUntil: 'load' });
  await m.waitForTimeout(800);
  const mob = await m.evaluate(() => ({ tabs: getComputedStyle(document.querySelector('.tabs')).display, nav: getComputedStyle(document.querySelector('.bottomnav')).display, on: (document.querySelector('.bottomnav button.on') || {}).dataset?.go }));
  check(mob.tabs === 'none' && mob.nav === 'grid' && mob.on === 'portfolio', `Handy: Leiste unten, Depot hervorgehoben (${JSON.stringify(mob)})`);
  const lead = '#portfolio .view-head .lead';
  const h0 = await m.$eval(lead, e => e.getBoundingClientRect().height);
  await m.click(lead); await m.waitForTimeout(200);
  const h1 = await m.$eval(lead, e => e.getBoundingClientRect().height);
  check(h0 < 90 && h1 > h0 * 1.5, `Einleitung erst drei Zeilen (${Math.round(h0)} px), angetippt ganz (${Math.round(h1)} px)`);
  const btns = await m.$$eval('.bottomnav button', l => l.map(b => b.dataset.go || 'mehr').join());
  check(btns === ORDER, `Leiste unten mit allen Hauptbereichen (${btns})`);
  // Ideen: Umschaltleiste, der zuletzt benutzte Teil bleibt gemerkt
  await m.click('.bottomnav [data-go="ideas"]'); await m.waitForTimeout(500);
  const vs = await m.evaluate(() => { const v = document.querySelector('#views > .view:not([hidden])'); return { id: v.id, n: v.querySelectorAll(':scope > .viewswitch [data-view]').length, sel: (v.querySelector(':scope > .viewswitch [aria-selected="true"]') || {}).dataset?.view }; });
  check(vs.id === 'hot' && vs.n === 4 && vs.sel === 'hot', `Ideen öffnet HotStuff mit Umschaltleiste (${JSON.stringify(vs)})`);
  await m.click('#hot > .viewswitch [data-view="swing"]'); await m.waitForTimeout(500);
  await m.click('.bottomnav [data-go="home"]'); await m.waitForTimeout(300);
  await m.click('.bottomnav [data-go="ideas"]'); await m.waitForTimeout(500);
  const back = await m.evaluate(() => [location.hash, (document.querySelector('.bottomnav button.on') || {}).dataset?.go, document.querySelector('#swing > .viewswitch [aria-selected="true"]').textContent]);
  check(back[0] === '#swing' && back[1] === 'ideas' && /Swing/.test(back[2]), `zuletzt benutzter Teil bleibt gemerkt (${back.join(' · ')})`);
  const oldUrl = await m.evaluate(async () => { location.hash = 'daily'; await new Promise(r => setTimeout(r, 400)); return [document.getElementById('botsBtn').getAttribute('aria-current'), !document.getElementById('daily').hidden, document.querySelectorAll('.bottomnav button.on').length]; });
  check(oldUrl[0] === 'page' && oldUrl[1] && oldUrl[2] === 0, `alte Adresse #daily landet bei Bots → Copy-Trading, Knopf oben markiert (${oldUrl})`);
  const mb = await m.evaluate(() => { const b = document.getElementById('botsBtn'), r = b.getBoundingClientRect(), s = document.getElementById('sessions').getBoundingClientRect(); return { text: b.innerText.trim(), sameRow: Math.abs(r.top - s.top) < 12, right: Math.round(r.right) }; });
  check(mb.text === 'Bots' && mb.sameRow && mb.right <= 390, `Handy: Knopf „Bots“ neben den Börsenzeiten (${JSON.stringify(mb)})`);
  check(await wide(m), 'Handy: nichts zu breit');

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
