// Einordnung der Nachrichten nach Typ: typische echte Schlagzeilen (nur für die automatischen Tests)
// Aufruf: node tests/news-classify.mjs
import { classify, prepare, mentions } from "../scripts/news-data.mjs";

const CASES = [
  ["Nvidia beats estimates on data center demand, shares rise after hours", "earnings_beat"],
  ["Apple tops quarterly revenue expectations as iPhone sales grow", "earnings_beat"],
  ["Target misses profit estimates as shoppers pull back", "earnings_miss"],
  ["Intel shares fall after revenue falls short of expectations", "earnings_miss"],
  ["Walmart raises full-year outlook after strong holiday quarter", "guidance_up"],
  ["Nike cuts revenue forecast, citing weak demand in China", "guidance_down"],
  ["Starbucks withdraws 2026 guidance amid turnaround", "guidance_down"],
  ["Morgan Stanley upgrades Tesla to overweight", "upgrade"],
  ["AMD downgraded to neutral at Bank of America on valuation", "downgrade"],
  ["Goldman cut to sell by analyst citing slowing growth", "downgrade"],
  ["Pfizer to acquire Seagen in $43 billion deal", "merger"],
  ["Microsoft completes acquisition of Activision", "merger"],
  ["Apple announces record $110 billion share buyback", "buyback"],
  ["Coca-Cola raises quarterly dividend for 62nd straight year", "dividend"],
  ["Intel suspends dividend to fund turnaround", "dividend"],
  ["Rivian prices $1.5 billion convertible notes offering", "offering"],
  ["Meta faces EU antitrust probe over ads", "legal"],
  ["Boeing agrees to settlement with families", "legal"],
  ["FDA approves Eli Lilly's Alzheimer's drug", "approval"],
  ["FDA issues complete response letter for Novavax shot", "rejection"],
  ["Biotech fails late-stage trial, stock plunges", "rejection"],
  ["Google parent announces layoffs of 12,000 jobs", "layoffs"],
  ["Disney CEO steps down; board names successor", "management"],
  ["Analyst raises price target on Palantir to $200", "price_target"],
  ["Lockheed wins $2 billion Pentagon contract", "contract"],
  ["Apple unveils new iPad lineup", "product"],
  ["Fed holds rates steady, signals two cuts this year", "macro_rates"],
  ["Hotter-than-expected CPI print reignites inflation worries", "macro_inflation"],
  ["Jobless claims rise to three-month high", "macro_jobs"],
  ["White House announces new tariffs on European cars", "tariffs"],
  ["Oil prices slide as OPEC+ boosts output", "oil"],
  ["Bitcoin tops $120,000 as ETF inflows surge", "crypto"],
  ["Stocks to watch this week", "general"],
  // aus dem ersten echten Lauf: frühere Fehlgriffe
  ["Block To Rally Over 19%? Here Are 10 Top Analyst Forecasts For Monday", "general"],
  ["2 AgriTech and Food Innovation Stocks to Buy for a Stable Portfolio", "general"],
  ["Aurora Cannabis Inc. (ACB) Q2 Earnings and Revenues Top Estimates", "earnings_beat"],
  ["Boeing to cut 5% of commercial airplane workforce as production increases", "layoffs"],
  ["Children's Place files for bankruptcy protection, seeks buyer", "bankruptcy"],
  ["Samsung Fire & Marine Insurance to Acquire Outstanding Stake in Canopius", "merger"],
  ["Will AeroVironment (AVAV) Beat Estimates Again in Its Next Earnings Report?", "earnings"],
  ["Buy, Sell, or Hold? Monday's Top Upgrades and Downgrades: Advanced Micro Devices, Airbnb", "general"],
  ["October inflation expected to reinforce Fed rate hike outlook, Bank of America says", "macro_rates"],
];
let fail = 0;
for (const [h, want] of CASES) {
  const got = classify(h, "", ["macro_rates", "macro_inflation", "macro_jobs", "tariffs", "oil", "crypto"].includes(want)).type;
  if (got !== want) { fail++; console.log(`✗ ${want.padEnd(16)} bekam ${got.padEnd(16)} ${h}`); }
}
// Ton bei Kursziel und Dividende
const tone = h => classify(h).tone;
if (tone("Coca-Cola raises quarterly dividend") !== "pos" || tone("Intel suspends dividend") !== "neg" || tone("Analyst cuts price target on Nike") !== "neg") { fail++; console.log("✗ Ton bei Dividende/Kursziel"); }
// Aufbereitung: HTML weg, nur http(s), Doppelte weg, neueste zuerst, höchstens 6
const t = 1_800_000_000;
const rows = [
  { datetime: t - 10, headline: "A beats estimates", summary: "<b>x</b> &amp; y", url: "https://a.example/1", source: "R", related: "AAA" },
  { datetime: t - 20, headline: "A beats estimates", summary: "dup", url: "https://a.example/2", source: "R" },
  { datetime: t - 5, headline: "B bad link", summary: "", url: "javascript:alert(1)", source: "R" },
  { datetime: t - 99999999, headline: "too old", summary: "", url: "https://a.example/3", source: "R" },
  ...Array.from({ length: 8 }, (_, i) => ({ datetime: t - 100 - i, headline: `Item ${i}`, summary: "", url: `https://a.example/i${i}`, source: "R" })),
];
const p = prepare(rows, { from: t - 86400, to: t, sym: "AAA" });
if (p.length !== 6 || p[0].t !== "A beats estimates" || p[0].sum !== "x & y" || p.some(n => !/^https:/.test(n.u)) || p.filter(n => n.t === "A beats estimates").length !== 1 || p[0].rel[0] !== "AAA") { fail++; console.log("✗ Aufbereitung", JSON.stringify(p.map(n => n.t))); }
// Bezug zur Firma: Kürzel als eigenes Wort oder erstes Wort des Namens; Meldungen über die Firma zuerst
if (!mentions("Bank of America beats estimates", "BAC", "Bank of America Corporation") || mentions("Banks rally on rate hopes", "BAC", "Bank of America Corporation") || !mentions("Advanced Micro Devices unveils chip", "AMD", "Advanced Micro Devices Inc") || mentions("Advanced AI chips in demand", "MU", "Micron Technology")) { fail++; console.log("✗ Bezug bei allgemeinen Namen"); }
if (!mentions("Nvidia beats estimates", "NVDA", "NVIDIA Corporation") || !mentions("AMD jumps on upgrade", "AMD", "Advanced Micro Devices Inc") || mentions("Tech stocks rally on Fed hopes", "NVDA", "NVIDIA Corporation") || mentions("Ladies and gentlemen", "AMD", "Advanced Micro Devices Inc")) { fail++; console.log("✗ Bezug zur Firma"); }
const q = prepare([
  { datetime: t - 1, headline: "Market wrap: stocks rise", summary: "", url: "https://a.example/w", source: "R" },
  { datetime: t - 50, headline: "Nvidia downgraded to hold", summary: "", url: "https://a.example/n", source: "R" },
], { from: t - 86400, to: t, sym: "NVDA", name: "NVIDIA Corporation" });
if (q[0].t !== "Nvidia downgraded to hold" || q[0].m !== 1 || q[1].m !== 0) { fail++; console.log("✗ Reihenfolge nach Bezug", JSON.stringify(q.map(n => [n.t, n.m]))); }
if (fail) { console.log(`::error::Einordnung der Nachrichten: ${fail} Fehler`); process.exit(1); }
console.log(`Einordnung der Nachrichten: ${CASES.length} Schlagzeilen richtig erkannt, Aufbereitung stimmt.`);
