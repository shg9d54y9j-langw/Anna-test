// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Bereich Vermögen, Zahlen unabhängig nachgerechnet mit den Werten aus data/wealth.json (so bleibt der Test gültig, wenn die
// monatliche Prüfung Annahmen ändert): Aktienquote aus dem Profil (das Vorsichtigere zählt, Abschlag bei unsicherem
// Einkommen), Aufteilung des sicheren Teils nach Horizont, erwartete Rendite aus EZB-Zinsen (und ohne sie aus langfristigen
// Annahmen), Schwankung und Absturz, Bandbreite (Reihenfolge, Einzahlungen, Mitte nahe der Rechnung mit der erwarteten
// Rendite), Fadenkreuz, Übernahme in den Sparplan-Rechner, Rebalancing ohne und mit Umschichten, Forschung mit Stufen und
// https-Quellen, Zinstabelle mit realem Tagesgeldzins, Steuerpunkte, gespeichertes Profil, Handy-Breite.
// node test-wealth.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');
const W = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'wealth.json'), 'utf8'));
const de = (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pc = (v, d = 1) => `${v < 0 ? '−' : ''}${de(Math.abs(v), d)} %`;
const eur = v => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('de-DE')} €`;
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const MACRO = { updated: new Date().toISOString(), source: 'EZB Data Portal (Test)', series: {
  deposit: { label: 'EZB-Einlagezins', v: 2.0, d: '2025-06-11', hist: [['2024-06-12', 3.75], ['2025-06-11', 2.0]] },
  estr: { label: '€STR', v: 1.93, d: day(1), hist: [[day(15), 1.92], [day(1), 1.93]] },
  hicpEA: { label: 'HVPI Euroraum', v: 2.1, d: '2026-10', hist: [['2025-10', 2.2], ['2026-10', 2.1]] },
  hicpAT: { label: 'HVPI Österreich', v: 3.0, d: '2026-10', hist: [['2025-10', 3.6], ['2026-10', 3.0]] },
  y5: { label: 'AAA 5 Jahre', v: 2.35, d: day(1), hist: [[day(15), 2.3], [day(1), 2.35]] },
} };
// unabhängige Nachrechnung der Regeln
const P = W.profile, MOD = W.model;
function quota(s) {
  const caps = [[P.horizonCap[s.horizon], 'Ihren Anlagehorizont'], [Math.min(100, Math.round(s.loss / P.crashEquity * 100)), 'den Verlust, den Sie aushalten'], [P.reactionCap[s.reaction], 'Ihre Reaktion auf einen Kurssturz']];
  let lim = caps[0];
  for (const c of caps) if (c[0] < lim[0]) lim = c;
  return { q: Math.max(0, Math.min(100, Math.floor((lim[0] + (P.incomeAdj[s.income] || 0)) / 10) * 10)), why: lim[1] };
}
function alloc(q, horizon) { const safe = 100 - q, b = Math.round(safe * P.safeSplit[horizon][0] / 100); return { e: q, b, c: safe - b }; }
function expect(a, cash, bonds) { return (a.e * (cash + MOD.equityPremium) + a.b * bonds + a.c * cash) / 100 - MOD.terAvg; }
const crash = a => (a.e * MOD.crash.equity + a.b * MOD.crash.bonds + a.c * MOD.crash.cash) / 100;
const vol = a => { const e = a.e / 100 * MOD.equityVol, b = a.b / 100 * MOD.bondVol, c = a.c / 100 * MOD.cashVol; return Math.sqrt(e * e + b * b + 2 * MOD.corrEquityBonds * e * b + c * c); };
// Endwert mit Rate am Monatsanfang (Rentenformel) – zum Vergleich mit der Mitte der Bandbreite
const fv = (start, rate, years, r) => { const g = Math.pow(1 + r / 100, 1 / 12) - 1, n = years * 12; return start * Math.pow(1 + g, n) + rate * (1 + g) * (Math.pow(1 + g, n) - 1) / g; };

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function open({ width = 1280, macro = true, theme = 'dark' } = {}) {
    const ctx = await b.newContext({ viewport: { width, height: 900 }, colorScheme: theme, timezoneId: 'Europe/Vienna', locale: 'de-AT' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/wealth-data/macro.json*', r => (macro ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MACRO) }) : r.fulfill({ status: 404, body: '' })));
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data|fx-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#vermoegen`, { waitUntil: 'load' });
    await p.waitForSelector('#wPortfolioBody .kpi', { timeout: 15000 });
    await p.waitForTimeout(400);
    return p;
  }
  const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  async function profile(p, s) { for (const [k, v] of Object.entries(s)) await p.selectOption(`#w-${k}`, String(v)); await p.waitForTimeout(150); }

  const p = await open();
  // Navigation: eigener Hauptbereich nach dem Portfolio, Abschnitte in der Leiste
  const nav = await p.evaluate(() => ({ order: [...document.querySelectorAll('.tabs .tab')].map(t => t.dataset.tab).join(), sel: document.querySelector('.tab[aria-selected="true"]').dataset.tab, sub: [...document.querySelectorAll('#vermoegen > .subnav button')].map(x => x.textContent).join('|') }));
  check(nav.order.startsWith('home,portfolio,vermoegen') && nav.sel === 'vermoegen', `Reiter „Vermögen“ nach dem Portfolio, gewählt (${nav.order})`);
  check(nav.sub === 'Profil|Musterportfolio|Sparplan|Rebalancing|Forschung|Zinsen & Inflation|Steuern', `Abschnitte: ${nav.sub}`);

  // Profil → Aktienquote
  const cases = [
    [{ horizon: '10to20', loss: 30, reaction: 'hold', income: 'mid', reserve: 'yes' }, 'Standard'],
    [{ horizon: 'gt20', loss: 50, reaction: 'buy', income: 'safe' }, 'lang, mutig'],
    [{ reaction: 'sell' }, 'verkauft im Kurssturz'],
    [{ reaction: 'hold', loss: 40, income: 'unsafe' }, 'unsicheres Einkommen'],
    [{ horizon: 'lt3', income: 'mid' }, 'unter 3 Jahren'],
    [{ horizon: '5to10', loss: 30 }, 'mittlerer Horizont'],
  ];
  let s = {};
  for (const [c, name] of cases) {
    s = { ...s, ...c };
    await profile(p, c);
    const want = quota(s), a = alloc(want.q, s.horizon);
    const got = await txt(p, '#wProfilOut');
    check(got.includes(`${want.q} % Aktien, ${100 - want.q} % sicherer Teil (${a.b} % Anleihen, ${a.c} % Geldmarkt)`) && got.includes(`Begrenzt durch ${want.why}`), `${name}: ${want.q} % Aktien (${a.b} % Anleihen, ${a.c} % Geldmarkt), begrenzt durch ${want.why}`);
  }
  await profile(p, { horizon: 'lt3' });
  check(/weniger als drei Jahren brauchen, gehört aufs Tagesgeld/.test(await txt(p, '#wProfilOut')), 'unter 3 Jahren: Hinweis Tagesgeld statt Aktien');
  await profile(p, { horizon: '5to10', income: 'unsafe', reserve: 'no' });
  check(/Zuerst den Notgroschen: 6–12 Monatsausgaben/.test(await txt(p, '#wProfilOut')), 'ohne Notgroschen, unsicheres Einkommen: zuerst 6–12 Monatsausgaben');
  await profile(p, { income: 'mid', reserve: 'yes' });
  s = { ...s, horizon: '5to10', income: 'mid', reserve: 'yes' };

  // Musterportfolio mit EZB-Zinsen
  const q = quota(s).q, a = alloc(q, s.horizon), exp = expect(a, 1.93, 2.35);
  const k = await txt(p, '#wPortfolioBody .stats');
  console.log('  ', k);
  check(k.includes(`Erwartete Rendite pro Jahr ${pc(exp)}`), `erwartete Rendite ${pc(exp)} (Aktien ${pc(1.93 + MOD.equityPremium)}, Anleihen 2,35 %, Geldmarkt 1,93 %, minus Kosten)`);
  check(k.includes(`Nach Inflation (langfristig ${pc(MOD.longRun.inflation, 0)}) ${pc(exp - MOD.longRun.inflation)}`), 'nach Inflation (langfristige Annahme, nicht die aktuelle Rate)');
  check(k.includes(`Schwankung pro Jahr ${pc(vol(a), 0)}`) && k.includes(`Absturz wie 2008 −${de(crash(a), 0)} %`), `Schwankung ${pc(vol(a), 0)}, Absturz −${de(crash(a), 0)} %`);
  check(/mit den Zinsen der EZB vom/.test(await txt(p, '#wPortfolioBody')), 'Quelle der Zinsen genannt');
  const legend = await p.$$eval('#wPortfolioBody .w-alloc-legend li', l => l.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  check(legend.join('|') === [a.e ? `${a.e} % Aktien weltweit` : '', a.b ? `${a.b} % Anleihen, auf Euro abgesichert` : '', a.c ? `${a.c} % Geldmarkt / Tagesgeld` : ''].filter(Boolean).join('|'), `Aufteilung beschriftet (${legend.join(', ')})`);
  const isins = await p.$$eval('#wPortfolioBody .w-prod code', l => l.map(x => x.textContent));
  check(isins.length >= 4 && isins.every(i => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(i)), `Beispiel-ETFs mit ISIN (${isins.join(', ')})`);

  // Bandbreite: 20 Jahre, 1.000 € Start, 200 € im Monat (Vorgaben des Sparplan-Rechners)
  const rows = await p.$$eval('#wFanTable tbody tr', r => r.map(x => [...x.querySelectorAll('td')].map(td => td.innerText.trim())));
  const last = rows[rows.length - 1], num = t => Number(t.replace(/[^\d]/g, ''));
  const det = fv(1000, 200, 20, exp);
  check(rows.length === 4 && last[1] === eur(1000 + 200 * 12 * 20), `Tabelle bis Jahr 20, eingezahlt ${eur(49000)} (${last.join(' | ')})`);
  check(num(last[2]) < num(last[3]) && num(last[3]) < num(last[4]), 'ungünstig < Mitte < günstig');
  check(Math.abs(num(last[3]) / det - 1) < 0.08, `Mitte ${last[3]} nahe der Rechnung mit ${pc(exp)}: ${eur(det)}`);
  check(/Weniger als eingezahlt in \d+ % der Verläufe/.test(await txt(p, '#wFanTable')), 'Wahrscheinlichkeit für weniger als eingezahlt');
  await p.focus('#wFan .hit');
  let tip = await txt(p, '#wFan .viz-tip');
  check(tip.includes('in 20 Jahren') && tip.includes(`Mitte: ${last[3]}`), `Fadenkreuz im letzten Jahr (${tip.slice(0, 90)})`);
  await p.keyboard.press('ArrowLeft');
  check((await txt(p, '#wFan .viz-tip')).includes('in 19 Jahren'), 'Pfeil links: ein Jahr früher');
  try { await (await p.$('#wPortfolio')).screenshot({ path: `${out}/wealth-portfolio.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // Übernahme in den Sparplan-Rechner
  await p.click('[data-w-act="toSparplan"]'); await p.waitForTimeout(300);
  check(await p.$eval('#spRet', e => e.value) === String(Math.round(exp * 10) / 10), `Rendite ${pc(Math.round(exp * 10) / 10)} im Sparplan-Rechner`);

  // Rebalancing (Horizont 10–20 Jahre: 60 % Aktien, 40 % Anleihen)
  await profile(p, { horizon: '10to20', loss: 30, reaction: 'hold' });
  await p.fill('[data-w-reb="aktien"]', '26000'); await p.fill('[data-w-reb="anleihen"]', '15000'); await p.fill('[data-w-reb="add"]', '2000'); await p.waitForTimeout(150);
  let rb = await txt(p, '#wRebalOut');
  const ein = await p.$$eval('#wRebalOut tbody tr', r => r.map(x => x.querySelectorAll('td')[3].innerText.trim()));
  check(ein.join('|') === '0 €|2.000 €|0 €' && /kein Verkauf nötig/.test(rb), `kleine Abweichung: Einzahlung in Anleihen, kein Verkauf (${ein.join(', ')})`);
  await p.fill('[data-w-reb="aktien"]', '30000'); await p.fill('[data-w-reb="anleihen"]', '10000'); await p.fill('[data-w-reb="add"]', '3000'); await p.waitForTimeout(150);
  rb = await txt(p, '#wRebalOut');
  check(/weicht ein Teil um 9,8 Prozentpunkte/.test(rb) && rb.includes('−4.200 € Aktien weltweit') && rb.includes('+4.200 € Anleihen, auf Euro abgesichert'), 'große Abweichung: 9,8 Punkte, 4.200 € umschichten, Hinweis auf KESt');

  // Forschung
  const ev = await p.$$eval('#wForschung .w-ev', l => l.map(d => ({ lv: d.querySelector('.w-lv').textContent, links: [...d.querySelectorAll('a')].map(a => [a.href, a.target, a.rel]) })));
  const LV = { stark: 'Stark belegt', mittel: 'Mittel belegt', umstritten: 'Umstritten', neu: 'Neu, noch nicht begutachtet', praxis: 'Bewährte Praxis' };
  check(ev.length === W.evidence.length && ev.every((e, i) => e.lv === LV[W.evidence[i].level]), `${ev.length} Befunde mit Evidenzstufe`);
  check(ev.every(e => e.links.length && e.links.every(([h, t, r]) => h.startsWith('https://') && t === '_blank' && /noopener/.test(r))), 'jede Quelle als sicherer Link (https, neues Fenster)');
  const head = await txt(p, '#wForschung .card-head');
  check(head.includes(new Date(`${W.reviewed}T12:00:00Z`).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })), `Prüfdatum angezeigt (${head})`);

  // Zinsen und Inflation
  const mt = await p.$$eval('#wZinsen tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check(mt.length === 5 && mt.some(r => /Inflation Österreich.*3,00 %/.test(r)), `Zinstabelle (${mt.length} Reihen)`);
  check((await txt(p, '#wZinsen')).includes(`Tagesgeld nach Inflation: ${pc(1.93 - 2.1, 2)}`), 'realer Tagesgeldzins (€STR minus Inflation)');
  // Steuern
  const tax = await p.$$eval('#wSteuer .w-tax li', l => l.length);
  check(tax === W.tax.length && /27,5 %/.test(await txt(p, '#wSteuer')) && /Behaltefrist/.test(await txt(p, '#wSteuer')), `Steuerpunkte (${tax})`);

  // Profil bleibt nach dem Neuladen
  await profile(p, { horizon: 'gt20', loss: 40, reaction: 'some', income: 'safe' });
  await p.reload({ waitUntil: 'load' }); await p.waitForSelector('#wPortfolioBody .kpi', { timeout: 15000 });
  const kept = await p.evaluate(() => ['horizon', 'loss', 'reaction', 'income'].map(k => document.getElementById(`w-${k}`).value).join());
  check(kept === 'gt20,40,some,safe' && (await txt(p, '#wProfilOut')).includes(`${quota({ horizon: 'gt20', loss: 40, reaction: 'some', income: 'safe' }).q} % Aktien`), `Profil nach dem Neuladen (${kept})`);

  // ohne EZB-Daten: langfristige Annahmen
  const n = await open({ macro: false, theme: 'light' });
  const qd = quota({ horizon: '10to20', loss: 30, reaction: 'hold', income: 'mid' }).q, ad = alloc(qd, '10to20');
  check((await txt(n, '#wPortfolioBody')).includes('mit langfristigen Annahmen') && (await txt(n, '#wPortfolioBody .stats')).includes(`Erwartete Rendite pro Jahr ${pc(expect(ad, MOD.longRun.cash, MOD.longRun.bonds))}`), 'ohne EZB-Daten: langfristige Annahmen, klar gesagt');
  check(/noch nicht da/.test(await txt(n, '#wZinsen')), 'Zinskarte sagt, dass die Daten fehlen');

  // Handy
  const m = await open({ width: 360 });
  const fit = await m.evaluate(() => { const t = document.querySelector('#wZinsen .table-wrap'); return { doc: document.documentElement.scrollWidth, t: t.scrollWidth - t.clientWidth }; });
  check(fit.doc <= 360 && fit.t <= 1, `Handy 360 px: nichts ragt hinaus, auch die Zinstabelle nicht (${JSON.stringify(fit)})`);
  try { await (await m.$('#wProfil')).screenshot({ path: `${out}/wealth-profile-360.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
