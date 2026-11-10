// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
// Meldungen aufs Handy (ntfy): Einrichtung im Portfolio – Kanalname, Push-Liste (passt zu scripts/notify.mjs), Hinweis bei
// geänderter Liste, Ersatzfeld ohne Zwischenablage; Kanalname und Liste verlassen den Browser nicht. node test-push.js <port> <ausgabe>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const stocks = fs.readFileSync(path.join(__dirname, 'fixtures', 'stocks.json'), 'utf8');

(async () => {
  const [port, out] = process.argv.slice(2);
  const { parseWatch } = await import(path.join(__dirname, '..', '..', 'scripts', 'notify.mjs'));
  const b = await chromium.launch(), errs = [], fails = [], requests = [];
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
  async function page({ clipboard = true } = {}) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    if (clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${port}` });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('request', r => requests.push(r.url() + ' ' + (r.postData() || '')));
    p.on('dialog', d => d.accept());
    await p.addInitScript(noClip => {
      if (noClip) Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('kein Zugriff')) } });
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('dtd-portfolio', JSON.stringify([{ id: 'p1', sym: 'NVDA', buy: 150, qty: 10, stop: 100 }, { id: 'p2', sym: 'AAPL', buy: 200 }]));
      localStorage.setItem('dtd-watch', JSON.stringify(['MSFT', 'NVDA', 'XETR:SAP']));
      localStorage.setItem('dtd-alarms', JSON.stringify([{ id: 'a1', sym: 'TSLA', price: 150, dir: 'down' }, { id: 'a2', sym: 'AAPL', price: 250, dir: 'up' }]));
    }, !clipboard);
    await p.route('**/stock-data/stocks.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: stocks }));
    await p.route(/tradingview|finnhub\.io|news-data|fund-data|note-|swing\.json|live-data/, r => r.abort());
    await p.goto(`http://localhost:${port}/#pfPush`, { waitUntil: 'load' });
    await p.waitForSelector('#pfPush', { timeout: 15000 });
    return p;
  }
  const text = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, " ")).catch(() => "");   // innerText folgt text-transform: Vergleiche ohne Groß/klein

  const p = await page();
  const card = await text(p, '#pfPush');
  check(/Aufs Handy mit der App ntfy/.test(card) && /Wochenbericht/.test(card), 'Karte nennt ntfy und Wochenbericht');
  await p.click('#pfPushSetup > summary');
  check(/So richten Sie es ein/i.test(card) && /2 im Depot, 1 auf der Merkliste, 2 Kursalarme, 1 Stop/.test(await text(p, '#pfPushSetup')), `Anleitung mit Zahlen: ${(await text(p, '#pfPushSetup')).match(/\d im Depot[^.]*Stops?/)}`);
  const links = await p.$$eval('#pfPushSetup a', l => l.map(a => a.href));
  check(links.some(h => h.endsWith('/settings/secrets/actions/new')) && links.some(h => h.endsWith('/actions/workflows/weekly-push.yml')) && links.some(h => /apps\.apple\.com/.test(h)), 'Links zu Secrets, Probe-Ablauf und App');

  // Kanalname
  await p.click('[data-act="ntfy-topic"]');
  await p.waitForSelector('#pfTopic');
  const topic = await p.inputValue('#pfTopic');
  check(/^rojko-[A-Za-z0-9_-]{22}$/.test(topic) && topic === JSON.parse(await p.evaluate(() => localStorage.getItem('dtd-ntfy-topic'))), `Kanalname erzeugt und gemerkt (${topic.length} Zeichen)`);
  check(await p.$eval('#pfPushSetup', d => d.open), 'Anleitung bleibt nach dem Neuzeichnen offen');
  await p.click('[data-act="ntfy-copy"]'); await p.waitForTimeout(200);
  check(await p.evaluate(() => navigator.clipboard.readText()) === topic, 'Kanalname in der Zwischenablage');
  await p.click('[data-act="ntfy-topic"]'); await p.waitForTimeout(200);
  const topic2 = await p.inputValue('#pfTopic');
  check(topic2 !== topic && /^rojko-/.test(topic2), 'Neuer Kanalname nach Rückfrage');

  // Push-Liste
  check(await p.$eval('#pfPushText', e => getComputedStyle(e).display === 'none'), 'Ersatzfeld bleibt verborgen, solange die Zwischenablage geht');
  await p.click('[data-act="ntfy-list"]'); await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  const cfg = parseWatch(clip);
  console.log('  Push-Liste:', clip);
  check(cfg && cfg.d.join() === 'NVDA,AAPL' && cfg.w.join() === 'MSFT' && JSON.stringify(cfg.a) === '[{"sym":"TSLA","dir":"<","p":150},{"sym":"AAPL","dir":">","p":250}]' && JSON.stringify(cfg.s) === '{"NVDA":100}', 'Push-Liste passt zum Meldungs-Skript (Depot, Merkliste ohne Doppelte und fremde Kürzel, Alarme, Stops)');
  check(!/Liste geändert/i.test(await text(p, '#pfPush')) && /Einrichtung und Push-Liste/i.test(await text(p, '#pfPushSetup > summary')), 'nach dem Kopieren kein Hinweis');
  await p.evaluate(() => { localStorage.setItem('dtd-watch', JSON.stringify(['MSFT', 'AMD'])); window.dispatchEvent(new Event('dtd:watch')); });
  await p.goto(`http://localhost:${port}/#home`); await p.goto(`http://localhost:${port}/#pfPush`); await p.waitForTimeout(500);
  check(/Liste geändert – neu kopieren und PUSH_WATCH ersetzen/i.test(await text(p, '#pfPush')), 'geänderte Merkliste: Hinweis zum neuen Kopieren');
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(w[0] <= w[1], `Handy: nichts zu breit (${w})`);
  try { await (await p.$('#pfPush')).screenshot({ path: `${out}/push-card.png` }); } catch { /* Bildschirmfoto nur zur Ansicht */ }

  // Was ist neu
  await p.goto(`http://localhost:${port}/#home`); await p.waitForTimeout(600);
  check(await p.$('a[href="#pfPush"]') !== null, '„Neu in RojkoMoney“ führt zur Einrichtung');

  // ohne Zwischenablage: Feld zum Markieren
  const q = await page({ clipboard: false });
  await q.click('#pfPushSetup > summary');
  await q.click('[data-act="ntfy-list"]'); await q.waitForTimeout(300);
  const field = await q.$eval('#pfPushText', e => ({ hidden: e.hidden, v: e.value })).catch(() => ({ hidden: true, v: '' }));
  check(await q.$eval('#pfPushText', e => getComputedStyle(e).display !== 'none'), 'Ersatzfeld sichtbar');
  check(!field.hidden && parseWatch(field.v) && parseWatch(field.v).d.length === 2, 'ohne Zwischenablage: Liste im Feld zum Markieren');

  check(!requests.some(r => r.includes(topic) || r.includes(topic2) || /"d":\["NVDA"/.test(r)), 'Kanalname und Push-Liste verlassen den Browser nicht');
  check(!errs.length, `Keine Skriptfehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
  process.exit(fails.length ? 1 : 0);
})();
