// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Sparplan-Rechner (Vermögen → #sparplan), Zahlen unabhängig nachgerechnet: Endwert mit der Rentenformel (Rate am Monatsanfang),
// KESt beim Verkauf, Kaufkraft nach Inflation; Ziel: nötige Rate und Monat, in dem es erreicht ist; jährliche KESt auf
// Dividenden (Ein-Jahres-Beispiel von Hand), Kosten der TER mit entgangenem Zinseszins, jährliche Erhöhung der Rate, Warnung bei
// hoher Gebühr, Vorgaben für die Rendite, Diagramm mit Fadenkreuz und Pfeiltasten, Tabelle, gespeicherte Eingaben, Handy-Breite.
// node test-sparplan.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const de0 = v => Math.abs(v).toLocaleString('de-DE', { maximumFractionDigits: 0 });
const eur = v => `${v < 0 ? '−' : ''}${de0(v)} €`;
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function open(width = 1280) {
    const ctx = await b.newContext({ viewport: { width, height: 900 }, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-11-11T10:00:00Z'));
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data|fx-data|wealth-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#sparplan`, { waitUntil: 'load' });
    await p.waitForSelector('#sparplan #spOut .kpi', { timeout: 15000 });
    return p;
  }
  const kpis = p => p.$eval('#spOut .stats', e => e.innerText.replace(/\s+/g, ' '));
  const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  async function set(p, v) {
    const adv = ['ter', 'fee', 'dyn', 'infl', 'div'];
    if (Object.keys(v).some(k => adv.includes(k)) && !(await p.$eval('#sparplan .sp-more', d => d.open))) await p.click('#sparplan .sp-more summary');
    const id = { start: 'spStart', rate: 'spRate', years: 'spYears', ret: 'spRet', goal: 'spGoal', ter: 'spTer', fee: 'spFee', dyn: 'spDyn', infl: 'spInfl', div: 'spDiv' };
    for (const [k, x] of Object.entries(v)) await p.fill(`#${id[k]}`, String(x));
    await p.waitForTimeout(150);
  }

  const p = await open();
  check(await p.$eval('#vermoegen', e => !e.hidden), 'Sprung #sparplan öffnet den Bereich Vermögen');
  await p.waitForTimeout(300);
  check((await p.$$eval('#vermoegen > .subnav button', bs => bs.map(x => x.textContent))).includes('Sparplan'), 'Knopf „Sparplan“ in der Leiste „Springen zu“');

  // 1) Rentenformel: 100 € am Monatsanfang, 6 % im Jahr, 10 Jahre, ohne Kosten und Dividenden
  await set(p, { start: 0, rate: 100, years: 10, ret: 6, goal: '', ter: 0, fee: 0, dyn: 0, infl: 2, div: 0 });
  const g = Math.pow(1.06, 1 / 12) - 1, A = m => (1 + g) * (Math.pow(1 + g, m) - 1) / g;
  const V = 100 * A(120), net = V - 0.275 * (V - 12000), real = net / Math.pow(1.02, 10);
  let k = await kpis(p);
  console.log('  ', k);
  check(k.includes('Eingezahlt 12.000 €'), 'eingezahlt 12.000 €');
  check(k.includes(`Depotwert nach 10 Jahren ${eur(V)}`), `Endwert nach der Rentenformel ${eur(V)}`);
  check(k.includes(`Nach KESt (beim Verkauf) ${eur(net)}`), `nach 27,5 % KESt auf den Gewinn ${eur(net)}`);
  check(k.includes(`In heutiger Kaufkraft ${eur(real)}`), `in heutiger Kaufkraft (2 % Inflation) ${eur(real)}`);
  check(/Tipp: Ein Ziel eintragen/.test(await txt(p, '#spOut')), 'ohne Ziel: Tipp statt Zielrechnung');

  // 2) Ziel 20.000 € nach Steuer: nötige Rate (linear in der Rate) und Monat bei 100 €
  await set(p, { goal: 20000 });
  const need = Math.ceil(20000 / (0.725 * A(120) + 0.275 * 120));
  let mGoal = 1;
  while (100 * (0.725 * A(mGoal) + 0.275 * mGoal) < 20000) mGoal++;
  const when = `${MONTHS[(10 + mGoal) % 12]} ${2026 + Math.floor((10 + mGoal) / 12)}`;
  const span = `${Math.floor(mGoal / 12)} Jahren${mGoal % 12 ? ` und ${mGoal % 12} ${mGoal % 12 === 1 ? 'Monat' : 'Monaten'}` : ''}`;
  const goalText = await txt(p, '#spOut .sp-goal');
  console.log('  ', goalText);
  check(goalText.includes(`sind ${eur(need)} im Monat nötig`), `nötige Rate ${eur(need)}`);
  check(goalText.includes(`erreichen Sie 20.000 € nach Steuer im ${when} – in ${span}`), `Ziel erreicht im ${when} (in ${span})`);
  try { await (await p.$('#sparplan')).screenshot({ path: `${out}/sparplan.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // 3) Diagramm: drei Endpunkte, Fadenkreuz zeigt das letzte Jahr, Pfeil links ein Jahr früher
  check(await p.$$eval('#spChart svg circle', c => c.length) === 3, 'Diagramm mit drei Linien-Endpunkten');
  await p.focus('#spChart .hit');
  let tip = await txt(p, '#spChart .viz-tip');
  check(tip.startsWith('2036 · in 10 Jahren') && tip.includes(`Depotwert: ${eur(V)}`) && tip.includes('Eingezahlt: 12.000 €'), `Fadenkreuz im letzten Jahr: ${tip}`);
  await p.keyboard.press('ArrowLeft');
  tip = await txt(p, '#spChart .viz-tip');
  check(tip.startsWith('2035 · in 9 Jahren') && tip.includes(`Depotwert: ${eur(100 * A(108))}`), 'Pfeil links: ein Jahr früher');
  const box = await (await p.$('#spChart .hit')).boundingBox();
  await p.mouse.move(box.x + 2, box.y + box.height / 2);
  check((await txt(p, '#spChart .viz-tip')).startsWith('heute'), 'Maus ganz links: heute');
  // Tabelle: Jahre 2027 … 2036, letzte Zeile = Kennzahlen
  const rows = await p.$$eval('#spOut .sp-t tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check(rows.length === 10 && rows[9].startsWith('2036 (10 J.) 12.000 €') && rows[9].includes(eur(V)) && rows[9].includes(eur(net)), `Tabelle Jahr für Jahr (${rows.length} Zeilen, zuletzt ${rows[9]})`);

  // 4) Dividenden jährlich versteuert – von Hand: 10.000 €, 10 %, 1 Jahr, 2 % Dividende
  //    Jahresende 11.000 €, Dividende 220 €, KESt 60,50 € → 10.939,50 €; Kaufpreis 10.159,50 €; beim Verkauf 214,50 € → 10.725 €
  await set(p, { start: 10000, rate: 0, years: 1, ret: 10, goal: '', ter: 0, fee: 0, dyn: 0, infl: 0, div: 2 });
  k = await kpis(p);
  const sum = await txt(p, '#spOut .sp-sum');
  check(k.includes('Depotwert nach 1 Jahr 10.940 €') && k.includes('Nach KESt (beim Verkauf) 10.725 €'), `Dividenden-KESt jährlich, Rest beim Verkauf: ${k}`);
  check(sum.includes('Steuer insgesamt 275 €') && sum.includes('keine Kosten'), `Steuer insgesamt 275 € = 27,5 % des Gewinns, ohne TER keine Kosten (${sum})`);

  // 5) TER 0,5 %: Kosten mit entgangenem Zinseszins
  await set(p, { years: 10, ret: 7, ter: 0.5, div: 0 });
  const cost = 10000 * Math.pow(1.07, 10) - 10000 * Math.pow(1.07 * 0.995, 10);
  check((await txt(p, '#spOut .sp-sum')).includes(`Kosten insgesamt ${eur(cost)}`), `Kosten der TER über 10 Jahre ${eur(cost)}`);

  // 6) Rate jährlich +10 %: 12 × 100 € + 12 × 110 €; 7) hohe Gebühr → Warnung
  await set(p, { start: 0, rate: 100, years: 2, ter: 0, dyn: 10 });
  check((await kpis(p)).includes('Eingezahlt 2.520 €'), 'jährliche Erhöhung: 1.200 € + 1.320 € = 2.520 € eingezahlt');
  await set(p, { rate: 25, fee: 1.5, dyn: 0 });
  check(/Die Gebühr frisst 6,0 % jeder Rate/.test(await txt(p, '#spOut')), 'Warnung bei 1,50 € Gebühr auf 25 €');
  check((await txt(p, '#spOut .sp-sum')).includes('davon Gebühren 36 €'), 'Gebühren summiert (24 × 1,50 €)');

  // 8) Ziel ohne Rendite und ohne Rate nie erreichbar; Vorgabe „Optimistisch 9 %“
  await set(p, { start: 1000, rate: 0, ret: 0, fee: 0, goal: 5000 });
  check(/nicht innerhalb von 60 Jahren/.test(await txt(p, '#spOut .sp-goal')), 'Ziel unerreichbar: klar gesagt');
  await p.click('#sparplan [data-sp-ret="9"]'); await p.waitForTimeout(150);
  check(await p.$eval('#spRet', e => e.value) === '9' && await p.$eval('#sparplan [data-sp-ret="9"]', e => e.getAttribute('aria-pressed') === 'true'), 'Vorgabe 9 % gesetzt und markiert');

  // 9) Eingaben bleiben nach dem Neuladen, Werte außerhalb der Grenzen werden begrenzt
  await set(p, { years: 80 });
  await p.click('#spRate');
  check(await p.$eval('#spYears', e => e.value) === '60', 'Laufzeit über 60 Jahre auf 60 begrenzt');
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#sparplan #spOut .kpi', { timeout: 15000 });
  check(await p.$eval('#spRet', e => e.value) === '9' && await p.$eval('#spGoal', e => e.value) === '5000' && await p.$eval('#spYears', e => e.value) === '60', 'Eingaben nach dem Neuladen noch da');

  // 10) Handy: nichts ragt seitlich hinaus
  const m = await open(360);
  const wide = await m.evaluate(() => { const t = document.querySelector('#spOut .table-wrap'); return { doc: document.documentElement.scrollWidth, card: document.getElementById('sparplan').scrollWidth, cw: document.getElementById('sparplan').clientWidth, table: t.scrollWidth, tw: t.clientWidth, cols: getComputedStyle(document.querySelector('#sparplan .sp-in')).gridTemplateColumns.split(' ').length }; });
  check(wide.doc <= 360 && wide.card <= wide.cw + 1 && wide.table <= wide.tw + 1, `Handy 360 px: nichts ragt hinaus, auch die Tabelle nicht (${JSON.stringify(wide)})`);
  check(wide.cols === 2 && await m.$eval('#sparplan [data-sp-ret="7"]', e => e.innerText.trim() === 'Ø 7 %' && e.getAttribute('aria-label') === 'Welt-Aktien Ø 7 %'), 'Handy: Eingaben in zwei Spalten, Vorgaben kurz (voller Name für Screenreader)');
  try { await (await m.$('#sparplan')).screenshot({ path: `${out}/sparplan-360.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
