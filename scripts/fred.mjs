// Daten der Federal Reserve Bank of St. Louis (FRED) – ohne Schlüssel, Anfragen gehen nur an fred.stlouisfed.org.
// Genutzt für die Finanzlage (NFCI) im Trend-Bot und den Euro-Kurs (DEXUSEU), mit dem beide Bots ihr Euro-Budget
// in Dollar umrechnen (eToro rechnet in Dollar).
const FRED = (process.env.FRED_BASE || "https://fred.stlouisfed.org/graph/fredgraph.csv").replace(/\/$/, "");
if (!["fred.stlouisfed.org", "localhost", "127.0.0.1"].includes(new URL(FRED).hostname)) throw new Error(`Unzulässige FRED-Adresse ${new URL(FRED).hostname}`);

export async function fredSeries(id, from) {
  const res = await fetch(`${FRED}?id=${encodeURIComponent(id)}&cosd=${from}`, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  const rows = (await res.text()).trim().split(/\r?\n/).slice(1).map(l => l.split(",")).map(([d, v]) => ({ d, v: Number(v) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number.isFinite(r.v)).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!rows.length) throw new Error(`FRED ${id}: keine Werte`);
  return rows;
}

// Euro in Dollar: Referenzkurs der US-Notenbank (werktäglich, mit einigen Tagen Verzögerung veröffentlicht)
export const EURUSD_FALLBACK = 1.1;
export async function eurUsd() {
  const rows = await fredSeries("DEXUSEU", new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10));
  const last = rows[rows.length - 1];
  if (!(last.v > 0.5 && last.v < 2.5)) throw new Error(`FRED DEXUSEU: unplausibler Kurs ${last.v}`);
  return { value: last.v, asOf: last.d };
}
// Kurs höchstens alle 12 Stunden neu holen; ohne Verbindung der letzte bekannte, sonst ein vorsichtiger Ersatzwert
export async function eurUsdCached(prev, now = new Date(), onError = () => {}) {
  if (prev && prev.value > 0 && prev.at && now - new Date(prev.at) < 12 * 36e5) return prev;
  try { return { ...(await eurUsd()), at: now.toISOString() }; }
  catch (e) { onError(e); return prev && prev.value > 0 ? prev : { value: EURUSD_FALLBACK, asOf: null, at: now.toISOString(), fallback: true }; }
}
// Budget in Euro aus einer Repository-Variable („1000“, „1.000“ oder „1000,50“); leer oder unsinnig = Standard
export function budgetEur(raw, fallback) {
  const s = String(raw ?? "").trim().replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const x = Number(s);
  return s && Number.isFinite(x) && x >= 1 && x <= 10_000_000 ? x : fallback;
}
