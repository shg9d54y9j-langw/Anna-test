// Browser-Test (Playwright) – läuft in der Rechenkontrolle über tests/browser/run.sh
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8811/?sw=1#home', { waitUntil: 'load' });
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(1500);
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'commit', timeout: 15000 });
  await p.waitForFunction(() => document.readyState === 'complete', null, { timeout: 15000 }).catch(() => errs.push('nicht fertig geladen'));
  await p.waitForTimeout(1500);
  const off = await p.evaluate(() => ({ tabs: document.querySelectorAll('.tabs .tab').length, bar: !document.querySelector('.offline-bar').hidden, bg: getComputedStyle(document.body).backgroundColor, js: typeof window.DTD.openStock, controlled: !!navigator.serviceWorker.controller }));
  console.log(JSON.stringify({ off, errs: errs.slice(0, 5) }));
  const ok = off.tabs === 6 && off.bar && off.controlled && off.js === 'function' && !errs.length;
  console.log(ok ? 'ALLES OK' : 'FEHLER: ohne Netz nicht alles da');
  process.exitCode = ok ? 0 : 1;
  await b.close();
})();
