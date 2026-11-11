// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Sicherheit: präparierte Texte – HTML-Tags und Anführungszeichen – in allen Datenquellen (Aktien-Daten, Kennzahlen,
// Swing-Planer, Theorie-Firmen, Vermögen, Nachrichten, Datenstand, Tagesempfehlung) und im Browser-Speicher (Portfolio,
// Journal, Kursalarme, Merkliste, Einstellungen) dürfen nirgends als HTML wirken: kein eingeschleustes Element, kein
// eingeschleustes Attribut, kein javascript:-Link – in allen Bereichen, im Aktien-Check, in den Vorschlägen und im Datenstand.
// Dazu: Die Schutzregel (Content Security Policy) blockt eingeschleuste Skripte, selbst wenn doch einmal HTML durchrutschte.
// node test-xss.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const fixture = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const repo = n => JSON.parse(fs.readFileSync(path.join(root, 'data', n), 'utf8'));

// Präparierter Text: wirkt er als HTML, entstehen ein <img>/<b> mit data-xss oder ein Attribut data-xss
const BAD = '<img src="x" class="xss-canary" data-xss="1">"\'><b data-xss="2">x</b>';
// Schlüssel, deren Werte Kürzel, Daten, Adressen oder feste Begriffe sind – die bleiben, damit die Seite normal rechnet
const KEEP = new Set(['sym', 'tv', 'id', 'u', 'url', 'href', 'd', 'date', 'asOf', 'updated', 'at', 'period', 'cc', 'type', 'tone', 'state',
  'mode', 'kind', 'dir', 'cur', 'level', 'health', 'icon', 'k', 'key', 'rel', 'peers', 'syms', 'isin', 'base', 'created', 'reviewed',
  'nextReview', 'file', 'conclusion', 'firstAt', 'since', 'until', 'dates', 'side', 'status', 'cadence', 'term', 'v']);
const poison = (v, key = '') => {
  if (typeof v === 'string') return KEEP.has(key) || v.length < 2 || /^[A-Z0-9.\-_:^]{1,16}$/.test(v) || /^\d{4}-\d\d/.test(v) || /^https?:/.test(v) ? v : v + BAD;
  if (Array.isArray(v)) return v.map(x => poison(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, poison(x, k)]));
  return v;
};
const stocks = poison(fixture('stocks.json'));
stocks.items.slice(0, 40).forEach(x => { x.aka = `Zusatzname${BAD}`; x.cc = x.cc || 'AT'; });
const fund = poison(fixture('fund.json')), swing = poison(fixture('swing.json'));
const firms = poison(repo('firms.json')), wealth = poison(repo('wealth.json')), ranking = poison(repo('ranking.json'));
const N = (i, extra = {}) => ({ id: `n${i}`, t: `Schlagzeile ${i}${BAD}`, s: `Quelle${BAD}`, u: 'javascript:alert(1)', d: Math.floor(Date.now() / 1000) - i * 600, sum: `Zusammenfassung${BAD}`, type: 'general', tone: 'neutral', rel: ['NVDA'], m: 1, ...extra });
const news = { updated: new Date().toISOString(), source: `Quelle${BAD}`, days: 3, count: 1, syms: ['NVDA'], errors: [], market: [N(1), N(2, { u: 'https://example.com/ok' })], hot: [N(3)] };
const coNews = { sym: 'NVDA', items: [N(4), N(5, { u: ' JavaScript:alert(2)' })] };
const status = { updated: new Date().toISOString(), problems: [], alerts: { new: [], resolved: [] },
  sources: [{ id: 'stocks', label: `Aktien${BAD}`, updated: new Date(Date.now() - 864e5 * 3).toISOString(), mode: 'work', warn: 20, stale: 30, cadence: `oft${BAD}` }],
  workflows: [{ file: 'x.yml', name: `Lauf${BAD}`, conclusion: 'failure', at: new Date().toISOString(), url: 'javascript:alert(3)' }] };
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

(async () => {
  const [port, out] = process.argv.slice(2);
  const b = await chromium.launch(), errs = [], fails = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  // Browser-Speicher: eigene Einträge mit präpariertem Text (wie aus einer manipulierten Sicherungsdatei)
  await p.addInitScript(bad => {
    if (sessionStorage.getItem('xss-seeded')) return;
    sessionStorage.setItem('xss-seeded', '1');
    const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('dtd-portfolio', [{ id: 'a', sym: 'NVDA', buy: 150, qty: 10, note: `Notiz${bad}` }, { id: 'b', sym: 'AAPL', buy: 100, qty: 5, note: bad, date: '2026-01-02' }]);
    set('daytrade-journal-v1', [{ id: 'j1', ts: '2026-11-03T10:00:00Z', sym: 'NVDA', dir: 'Long', in: 100, out: 110, qty: 5, note: `Trade${bad}`, setup: bad }, { id: `j2${bad}`, ts: '2026-11-04T15:40:00Z', sym: `<b data-xss="5">`, dir: 'Short', in: 50, out: 45, qty: 2, note: bad }]);
    set('dtd-alarms', [{ id: 'al1', sym: 'NVDA', dir: 'up', price: 9999, note: `Alarm${bad}`, created: '2026-11-01' }]);
    set('dtd-watch', ['NVDA', 'AAPL', `<b data-xss="6">`]);
    set('dtd-stock-recent', ['NVDA', `<b data-xss="7">`]);
    set('dtd-layout', { hide: [`<b data-xss="8">`], dash: [`x${bad}`] });
    set('dtd-swipe-hint', true);
  }, BAD);
  // GitHub-Daten: alles abweisen, was nicht präpariert geliefert wird; die präparierten zuletzt (gelten zuerst)
  await p.route(/raw\.githubusercontent\.com/, r => r.fulfill({ status: 404, body: '' }));
  await p.route(/tradingview|finnhub\.io/, r => r.abort());
  await p.route('**/stock-data/stocks.json*', r => r.fulfill(json(stocks)));
  await p.route('**/fund-data/fund.json*', r => r.fulfill(json(fund)));
  await p.route('**/stock-data/swing.json*', r => r.fulfill(json(swing)));
  await p.route('**/news-data/news.json*', r => r.fulfill(json(news)));
  await p.route('**/news-data/co/*.json*', r => r.fulfill(json(coNews)));
  await p.route('**/status/status.json*', r => r.fulfill(json(status)));
  await p.route(/\/data\/firms\.json/, r => r.fulfill(json(firms)));
  await p.route(/\/data\/wealth\.json/, r => r.fulfill(json(wealth)));
  await p.route(/\/data\/ranking\.json/, r => r.fulfill(json(ranking)));

  // Funde: eingeschleuste Elemente/Attribute und Links mit javascript:
  const scan = async where => {
    const r = await p.evaluate(() => {
      const hits = [...document.querySelectorAll('.xss-canary, [data-xss]')].map(e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} in ${(e.closest('[id]') || {}).id || '?'}`);
      const js = [...document.querySelectorAll('a[href], area[href], form[action], iframe[src]')].filter(e => { try { return new URL(e.getAttribute('href') || e.getAttribute('action') || e.getAttribute('src'), location.href).protocol === 'javascript:'; } catch { return false; } })
        .map(e => `${e.tagName.toLowerCase()} in ${(e.closest('[id]') || {}).id || '?'}`);
      return { hits: [...new Set(hits)].slice(0, 6), js: [...new Set(js)].slice(0, 6), shown: document.body.innerText.includes('<b data-xss') || document.body.innerText.includes('Zusatzname<img') };
    });
    check(!r.hits.length && !r.js.length, `${where}: nichts eingeschleust${r.hits.length ? ` – Elemente: ${r.hits.join(', ')}` : ''}${r.js.length ? ` – javascript:-Links: ${r.js.join(', ')}` : ''}`);
    return r;
  };

  await p.goto(`http://localhost:${port}/#home`, { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  let seen = false;
  for (const v of ['home', 'portfolio', 'vermoegen', 'aktie', 'setup', 'markt', 'tools', 'hot', 'swing', 'ideen', 'theorie', 'bot', 'daily']) {
    await p.evaluate(id => { location.hash = id; }, v);
    await p.waitForTimeout(v === 'home' ? 600 : 1500);
    if (v === 'aktie') { await p.evaluate(() => window.DTD.openStock('NVDA')); await p.waitForTimeout(2500); }
    if (v === 'markt') {   // Nachrichten (#news lädt sie): Markt, bewegte Aktien und eigene Aktien, je eine Meldung öffnen
      await p.evaluate(() => { location.hash = 'news'; });
      check(await p.waitForSelector('#newsBody [data-news-tab]', { timeout: 10000 }).then(() => true).catch(() => false), 'Nachrichten geladen');
      for (const k of ['market', 'hot', 'mine']) {
        await p.click(`#newsBody [data-news-tab="${k}"]`, { timeout: 3000 }).catch(() => null); await p.waitForTimeout(300); await scan(`Nachrichten: ${k}`);
        // erste Meldung öffnen: Fenster mit Quelle, Kurzfassung und (nur bei http/https) dem Link zum Artikel
        const item = await p.$('#newsBody [data-news]');
        if (item) {
          await item.click(); await p.waitForTimeout(400); await scan(`Nachricht geöffnet (${k})`);
          if (k === 'market') check(!(await p.$('#drawer a[href^="javascript" i]')) && !(await p.$$eval('#drawer a', l => l.some(a => /Artikel lesen/.test(a.textContent)))), 'Nachricht mit javascript:-Adresse: kein Link zum Artikel');
          await p.keyboard.press('Escape'); await p.waitForTimeout(200);
        }
      }
    }
    const r = await scan(`Bereich ${v}`);
    seen = seen || r.shown;
  }
  check(seen, 'präparierte Texte erscheinen als harmloser Text (also wirklich geprüft)');
  // Vorschläge (Aktien-Check und Schnellsuche) und das Datenstand-Fenster
  await p.evaluate(() => { location.hash = 'aktie'; }); await p.waitForTimeout(500);
  await p.fill('#stockInput', ''); await p.type('#stockInput', 'Zusatz', { delay: 5 }); await p.waitForTimeout(300); await scan('Vorschläge im Aktien-Check');
  await p.fill('#stockInput', ''); await p.focus('#stockInput'); await p.waitForTimeout(300); await scan('zuletzt angesehene Werte');
  await p.click('#qsInput').catch(() => null); await p.type('#qsInput', 'NV', { delay: 5 }).catch(() => null); await p.waitForTimeout(300); await scan('Schnellsuche');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { location.hash = 'datenstand'; }); await p.waitForTimeout(1200);
  if (await p.$eval('#drawer', e => e.hidden).catch(() => true)) await p.evaluate(() => window.DTD.openDataStatus && window.DTD.openDataStatus());
  await p.waitForTimeout(500); await scan('Datenstand-Fenster');
  try { await p.screenshot({ path: `${out}/xss-home.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // Zweite Verteidigungslinie: Selbst eingeschleustes HTML mit Ereignis-Code oder Skript führt die Schutzregel nicht aus
  const csp = await p.evaluate(async () => {
    window.__xss = 0;
    document.body.insertAdjacentHTML('beforeend', '<img src="data:," onerror="window.__xss=1"><div id="csp-test" onclick="window.__xss=2"></div>');
    document.getElementById('csp-test').click();
    const s = document.createElement('script'); s.textContent = 'window.__xss = 3'; document.body.append(s);
    const a = document.createElement('a'); a.href = 'javascript:window.__xss=4'; document.body.append(a); a.click();
    await new Promise(r => setTimeout(r, 300));
    return window.__xss;
  });
  check(csp === 0, `Schutzregel blockt Ereignis-Code, eingeschleuste Skripte und javascript:-Links (Ergebnis ${csp})`);
  const meta = await p.$eval('meta[http-equiv="Content-Security-Policy"]', e => e.content).catch(() => '');
  check(/script-src 'self'/.test(meta) && !/unsafe-inline[^;]*;?\s*$/.test(meta.split('script-src')[1].split(';')[0]) && !/unsafe-eval/.test(meta) && /object-src 'none'/.test(meta) && /base-uri 'none'/.test(meta), 'Schutzregel: Skripte nur von der Seite selbst und TradingView, kein unsafe-inline/eval, keine Plugins, kein fremdes base');

  console.log(errs.length ? `   (Hinweis: ${errs.length} Skriptfehler durch absichtlich verdrehte Daten: ${[...new Set(errs)].slice(0, 3).join(' | ')})` : '   keine Skriptfehler');
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
