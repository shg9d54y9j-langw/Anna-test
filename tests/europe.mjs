// Europäische Aktien (scripts/stock-universe.mjs, data/europe.json): Namen vergleichen (Umlaute, Akzente, kurze Wörter genau),
// Europa-Liste auflösen (Kürzel nur mit passendem Namen, sonst über den Namen mit bevorzugter Börse, doppelte einmal),
// Zusatznamen für die Suche, und die Liste selbst: Aufbau, Kürzel, keine Doppelten, Porr und Münchener Rück dabei.
// Aufruf: node tests/europe.mjs
import { readFileSync } from "node:fs";
import { normName, nameMatches, resolveEurope, akaOf, isEuropean, suffixOf, EU_SUFFIX } from "../scripts/stock-universe.mjs";

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log(`✗ ${msg}`); } };

// 1) Namen
ok(normName("Münchener Rück") === "muenchener rueck" && normName("Muenchener Rueckversicherungs-Gesellschaft AG") === "muenchener rueckversicherungs gesellschaft ag", `Umlaute wie ae/oe/ue (${normName("Münchener Rück")})`);
ok(normName("L'Oréal") === "l oreal" && normName("Ströer") === normName("Stroeer") && normName("K+S") === "k s" && normName("Kühne + Nagel") === "kuehne nagel", "Akzente, Sonderzeichen, ö = oe");
ok(nameMatches("Muenchener Rueckversicherungs-Gesellschaft AG", "Münchener Rück"), "Wortanfänge passen (Rück → Rueckversicherungs)");
ok(nameMatches("Deutsche Lufthansa AG", "Lufthansa") && !nameMatches("Deutsche Lufthansa AG", "Hansa"), "Wort mitten im Namen, aber nur ab Wortanfang");
ok(nameMatches("SAP SE", "SAP") && !nameMatches("Sapiens International", "SAP") && !nameMatches("Evonik Industries", "EVN") && nameMatches("EVN AG", "EVN"), "kurze Begriffe (bis 3 Zeichen) nur als ganzes Wort");
ok(!nameMatches("Bayerische Motoren Werke AG", "bayer ag") && nameMatches("Bayer AG", "bayer ag") && nameMatches("Bayerische Motoren Werke AG", "bayerische motoren"), "mehrere Wörter hintereinander");
ok(!nameMatches("Porr AG", "") && !nameMatches("", "Porr"), "leere Begriffe passen nie");
ok(isEuropean("ABS2.DE") && isEuropean("NOVO-B.CO") && isEuropean("RR.L") && !isEuropean("AAPL") && !isEuropean("BRK.B") && !isEuropean("0700.HK") && suffixOf("asml.nv") === "NV", "europäische Börsen am Kürzel");

// 2) Europa-Liste auflösen
const stocks = [   // gültige Aktien der Suche, beliebteste zuerst
  { sym: "MUV2.DE", name: "Muenchener Rueckversicherungs-Gesellschaft AG" },
  { sym: "BG.DE", name: "Bunge Global" },            // vermutetes Kürzel gehört einer anderen Firma
  { sym: "BAWAG.DE", name: "BAWAG Group AG" },
  { sym: "TBAU.DE", name: "Testbau AG" },            // beliebter, aber Xetra
  { sym: "TBAU.VI", name: "Testbau AG" },            // Wiener Börse – für Österreich bevorzugt
  { sym: "TBAU", name: "Testbau Inc" },              // US – nie über den Namen
  { sym: "ABS2.DE", name: "Porr AG" },
];
const data = { groups: {
  at: { cc: "AT", pref: ["VI", "DE"], items: [{ sym: "ABS2.DE", name: "Porr", aka: ["POS"] }, { sym: "BG.DE", name: "BAWAG Group", match: ["bawag"] }, { sym: "TB.DE", name: "Testbau" }, { sym: "GONE.DE", name: "Gibtsnicht" }] },
  de: { cc: "DE", pref: ["DE"], items: [{ sym: "MUV2.DE", name: "Münchener Rück", match: ["münchener rück", "munich re"], aka: ["Munich Re"] }] },
  eu: { cc: null, pref: [], items: [{ sym: "MUV2.DE", name: "Münchener Rück", cc: "DE" }] },   // doppelt: einmal genügt
} };
const r = resolveEurope(data, stocks);
const got = Object.fromEntries(r.found.map(f => [f.entry.name, `${f.sym}/${f.how}/${f.cc}`]));
ok(got.Porr === "ABS2.DE/Kürzel/AT" && got["Münchener Rück"] === "MUV2.DE/Kürzel/DE", `über das Kürzel (${JSON.stringify(got)})`);
ok(got["BAWAG Group"] === "BAWAG.DE/Name/AT", "falsches Kürzel (andere Firma) → über den Namen");
ok(got.Testbau === "TBAU.VI/Name/AT", "über den Namen: bevorzugte Börse der Gruppe (Wien vor Xetra), nie US");
ok(r.open.length === 1 && r.open[0].entry.name === "Gibtsnicht" && r.found.length === 4, `nicht gefunden: offen (${r.open.map(o => o.entry.name)})`);
ok(r.found.filter(f => f.sym === "MUV2.DE").length === 1, "doppelt gelistet: einmal");
ok(resolveEurope(null, stocks).found.length === 0 && resolveEurope({ groups: { x: { items: "kaputt" } } }, stocks).found.length === 0, "kaputte Liste: nichts, kein Absturz");

// 3) Zusatznamen
ok(akaOf({ name: "Münchener Rück", aka: ["Munich Re", "Münchner Rück"] }, "Muenchener Rueckversicherungs-Gesellschaft AG") === "Munich Re · Münchner Rück", "eToro-Name enthält den Namen: nur die weiteren");
ok(akaOf({ name: "Porr", aka: ["POS"] }, "Porr AG") === "POS" && akaOf({ name: "DHL Group", aka: ["Deutsche Post"] }, "Deutsche Post AG") === "DHL Group", "Wiener Kürzel; gebräuchlicher Name, wenn eToro anders heißt");
ok(akaOf({ name: "OMV" }, "OMV AG") === null, "nichts Neues: kein Zusatzname");

// 4) Die Liste selbst
const raw = readFileSync(new URL("../data/europe.json", import.meta.url), "utf8"), d = JSON.parse(raw);
ok(d.version === 1 && /^\d{4}-\d\d-\d\d$/.test(d.reviewed) && raw.length < 40000, `Aufbau und Größe (${raw.length} Bytes)`);
const groups = Object.entries(d.groups || {});
ok(["at", "de", "ch", "eu"].every(g => d.groups[g]), "Gruppen Österreich, Deutschland, Schweiz, Europa");
const all = [];
for (const [gid, g] of groups) {
  ok(typeof g.label === "string" && (g.cc === null || /^[A-Z]{2}$/.test(g.cc)) && Array.isArray(g.pref) && g.pref.every(s => EU_SUFFIX.includes(s)), `${gid}: Bezeichnung, Land, bevorzugte Börsen`);
  for (const e of g.items) {
    all.push(e);
    const where = `${gid}/${e.sym}`;
    ok(/^[A-Z0-9][A-Z0-9-]{0,11}\.[A-Z]{1,3}$/.test(e.sym) && isEuropean(e.sym), `${where}: Kürzel mit europäischer Börse`);
    ok(typeof e.name === "string" && e.name.length > 1 && e.name.length <= 40 && normName(e.name), `${where}: Name`);
    ok(e.match === undefined || (Array.isArray(e.match) && e.match.length && e.match.every(m => normName(m).length >= 2)), `${where}: Suchbegriffe`);
    ok(e.aka === undefined || (Array.isArray(e.aka) && e.aka.every(a => typeof a === "string" && a && a.length <= 30)), `${where}: Zusatznamen`);
    ok(e.cc === undefined || /^[A-Z]{2}$/.test(e.cc), `${where}: Land`);
    ok(Object.keys(e).every(k => ["sym", "name", "match", "aka", "cc"].includes(k)), `${where}: nur bekannte Felder`);
  }
}
const syms = all.map(e => e.sym), names = all.map(e => normName(e.name));
ok(new Set(syms).size === syms.length && new Set(names).size === names.length, "keine doppelten Kürzel oder Namen");
const porr = all.find(e => e.name === "Porr"), muv = all.find(e => e.name === "Münchener Rück");
ok(porr && porr.sym === "ABS2.DE" && d.groups.at.items.includes(porr) && muv && muv.sym === "MUV2.DE" && d.groups.de.items.includes(muv), "Porr (Österreich) und Münchener Rück (Deutschland) dabei");
ok(d.groups.at.items.length >= 25 && d.groups.de.items.length >= 80 && all.length >= 200, `genug Werte (${all.length})`);

if (fail) { console.log(`::error::Europäische Aktien: ${fail} Fehler`); process.exit(1); }
console.log(`Europäische Aktien: Namen, Auflösung über Kürzel und Namen, Zusatznamen und die Liste (${all.length} Werte) stimmen.`);
