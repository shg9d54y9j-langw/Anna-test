// Sicherheits-Check (läuft in der Rechenkontrolle bei jeder Änderung). Prüft ohne Netz und ohne fremde Pakete:
//  1. Abläufe (.github/workflows): fremde Bausteine nur mit fester Prüfsumme, Rechte oben nie „write“, keine Auslöser von
//     außen (pull_request_target, workflow_run), keine ${{ … }}-Ausdrücke in Befehlen (Einschleusen), Zeitlimit je Job,
//     Checkout ohne gespeichertes Token (außer Jobs, die selbst pushen), Secrets nie global.
//  2. Seite: Schutzregel (CSP) ohne unsafe-inline/eval für Skripte, keine Plugins, kein fremdes <base>; keine Inline-Skripte
//     oder on…-Attribute in index.html; kein eval/new Function/document.write; Links in neuen Fenstern mit rel="noopener".
//  3. Skripte: jedes fetch mit Prüfung der Zieladresse; wer Schlüssel sendet, folgt keinen Weiterleitungen und hat ein Zeitlimit;
//     Echtgeld bleibt gesperrt; kein Protokoll von Schlüsseln, Kanal oder Push-Liste.
//  4. Keine Schlüssel im Repository: bekannte Formate (GitHub, AWS, Google, Slack, OpenAI/Anthropic, private Schlüssel) und
//     fest eingetragene Werte für unsere Secrets.
// Aufruf: node tests/security.mjs   (mit --list zeigt es zusätzlich, was geprüft wurde)
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = f => readFileSync(join(root, f), "utf8");
let fail = 0, checked = 0;
const bad = msg => { fail++; console.log(`✗ ${msg}`); };
const ok = (c, msg) => { checked++; if (!c) bad(msg); };

// ---------- 1. Abläufe ----------
const WF = readdirSync(join(root, ".github/workflows")).filter(f => /\.ya?ml$/.test(f));
// Jobs, die selbst ins Repository pushen und dafür das Token des Checkouts brauchen
const PUSHING_CHECKOUT = new Set(["daily-ranking.yml:save"]);
for (const f of WF) {
  const src = read(`.github/workflows/${f}`), lines = src.split("\n");
  // fremde Bausteine nur mit 40-stelliger Prüfsumme (lokale Abläufe ./ erlaubt)
  for (const m of src.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    const u = m[1];
    ok(u.startsWith("./") || /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(u), `${f}: Baustein ohne feste Prüfsumme: ${u}`);
  }
  // Auslöser, die fremden Code mit Rechten laufen lassen könnten
  ok(!/^\s*(pull_request_target|workflow_run)\s*:/m.test(src), `${f}: gefährlicher Auslöser (pull_request_target/workflow_run)`);
  // oberste Rechte: vorhanden und nie „write“
  const top = lines.findIndex(l => /^permissions:/.test(l));
  ok(top >= 0, `${f}: keine obersten Rechte (permissions) festgelegt`);
  if (top >= 0) {
    const block = [lines[top]]; for (let i = top + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) block.push(lines[i]);
    ok(!/write/.test(block.join("\n")), `${f}: oberste Rechte erlauben Schreiben – Schreibrechte nur im Job, der sie braucht`);
  }
  // Secrets nie im globalen env
  const env = lines.findIndex(l => /^env:/.test(l));
  if (env >= 0) { for (let i = env + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) ok(!/secrets\./.test(lines[i]), `${f}: Secret im globalen env`); }
  // ${{ … }} nie in run-Befehlen (Werte gehören in env: und werden als "$VAR" gelesen)
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const ind = m[1].length + (m[2] ? m[2].length : 0), body = [m[3]];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > ind); j++) body.push(lines[j]);
    ok(!/\$\{\{/.test(body.join("\n")), `${f}:${i + 1}: \${{ … }} in einem Befehl – über env: übergeben`);
  }
  // Jobs: Zeitlimit (außer Aufrufe wiederverwendbarer Abläufe), Checkout ohne gespeichertes Token
  const jobs = lines.findIndex(l => /^jobs:/.test(l));
  const starts = [];
  for (let i = jobs + 1; i < lines.length; i++) if (/^ {2}[\w-]+:\s*$/.test(lines[i])) starts.push(i);
  starts.forEach((s, k) => {
    const name = lines[s].trim().replace(/:$/, ""), body = lines.slice(s, starts[k + 1] || lines.length).join("\n");
    ok(/^\s{4}uses:\s*\.\//m.test(body) || /^\s{4}timeout-minutes:\s*\d+/m.test(body), `${f}:${name}: kein Zeitlimit (timeout-minutes)`);
    for (const m of body.matchAll(/uses:\s*actions\/checkout@[^\n]*\n((?:\s{8,}.*\n?)*)/g)) {
      ok(/persist-credentials:\s*false/.test(m[1]) || PUSHING_CHECKOUT.has(`${f}:${name}`), `${f}:${name}: Checkout behält das Token (persist-credentials: false fehlt)`);
    }
  });
}

// ---------- 2. Seite ----------
const html = read("index.html");
const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1] || "";
const dir = n => ((csp.split(";").map(s => s.trim()).find(s => s.startsWith(`${n} `)) || "").slice(n.length + 1));
ok(csp && /'self'/.test(dir("script-src")) && !/unsafe-inline|unsafe-eval|\*(?!\.)|data:|http:/.test(dir("script-src")), `Schutzregel: script-src zu offen (${dir("script-src")})`);
ok(dir("object-src") === "'none'" && dir("base-uri") === "'none'" && dir("default-src") === "'self'", "Schutzregel: object-src/base-uri 'none' und default-src 'self' nötig");
ok(!/unsafe-eval/.test(csp) && !/(^|\s)\*(\s|;|$)/.test(csp), "Schutzregel: kein unsafe-eval und kein * als Quelle");
ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "index.html: Inline-Skript ohne src");
ok(!/\son[a-z]+\s*=\s*["']/i.test(html), "index.html: on…-Attribut (Inline-Ereignis-Code)");
const pageJs = readdirSync(root).filter(f => f.endsWith(".js"));
for (const f of pageJs) {
  const src = read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  ok(!/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/.test(src), `${f}: eval/new Function/document.write/Zeichenketten-Timer`);
  for (const m of src.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) ok(/rel="[^"]*noopener/.test(m[0]), `${f}: Link in neuem Fenster ohne rel="noopener": ${m[0].slice(0, 80)}`);
  for (const m of src.matchAll(/\.target\s*=\s*["']_blank["']/g)) ok(/\.rel\s*=\s*["'][^"']*noopener/.test(src), `${f}: target=_blank per Skript ohne rel=noopener`);
}
for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) ok(/rel="[^"]*noopener/.test(m[0]), `index.html: Link in neuem Fenster ohne rel="noopener"`);

// ---------- 3. Skripte ----------
const scripts = readdirSync(join(root, "scripts")).filter(f => f.endsWith(".mjs"));
for (const f of scripts) {
  const src = read(`scripts/${f}`);
  if (!/\bfetch\s*\(/.test(src)) continue;
  ok(/Unzulässige|\.hostname/.test(src), `scripts/${f}: fetch ohne Prüfung der Zieladresse`);
  const sendsKey = /process\.env\.[A-Z_]*(KEY|TOKEN)\b/.test(src) && !/NTFY_TOPIC/.test(src.match(/process\.env\.[A-Z_]*(KEY|TOKEN)\b/)[0]);
  if (sendsKey) ok(/redirect:\s*"error"/.test(src) && /AbortSignal\.timeout/.test(src), `scripts/${f}: sendet Schlüssel, aber ohne redirect: "error" oder Zeitlimit`);
}
for (const f of ["copy-bot.mjs", "trend-bot.mjs"]) ok(/^export const REAL_MONEY_UNLOCKED = false;$/m.test(read(`scripts/${f}`)), `scripts/${f}: Echtgeld nicht gesperrt`);
for (const f of scripts) {
  const src = read(`scripts/${f}`);
  for (const line of src.split("\n")) {
    if (!/\b(log|warn|fail|console\.(log|error|warn))\s*\(/.test(line)) continue;
    ok(!/process\.env\.(ETORO_[A-Z_]*KEY|FINNHUB_API_KEY|FRED_API_KEY|NTFY_TOPIC|PUSH_WATCH|GITHUB_TOKEN|GH_TOKEN)\b/.test(line) && !/\$\{\s*(KEY|TOKEN|TOPIC)\s*\}/.test(line), `scripts/${f}: Protokollzeile mit Schlüssel, Kanal oder Push-Liste: ${line.trim().slice(0, 90)}`);
  }
}

// ---------- 4a. Anmeldung (login.js, data/login.json) ----------
// Nur die öffentliche Projektadresse und der öffentliche Schlüssel (anon bzw. sb_publishable_) – nie der geheime;
// Zugangsdaten nie in der Sicherungsdatei; Anfragen mit Zugang nur an die eingerichtete Adresse und ohne Weiterleitungen.
{
  const L = JSON.parse(read("data/login.json")), url = String(L.url || ""), k = String(L.anonKey || "");
  ok((!url && !k) || /^https:\/\/[a-z0-9-]{6,40}\.supabase\.co$/.test(url), `data/login.json: Adresse muss https://<projekt>.supabase.co sein (${url})`);
  ok(!/^sb_secret_/.test(k), "data/login.json: GEHEIMER Schlüssel (sb_secret_) eingetragen – sofort in Supabase widerrufen und den öffentlichen nehmen");
  if (k && k.split(".").length === 3) {
    let role = "?"; try { role = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role; } catch { /* unten gemeldet */ }
    ok(role === "anon", `data/login.json: Schlüssel mit Rolle „${role}“ – nur der öffentliche anon-Schlüssel ist erlaubt (service_role sofort widerrufen)`);
  } else if (k) ok(/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k), "data/login.json: unbekannter Schlüssel – nur anon (JWT) oder sb_publishable_…");
  const skip = /BK_SKIP = new Set\(\[([^\]]*)\]\)/.exec(read("portfolio.js"));
  ok(skip && ["dtd-auth", "dtd-auth-pending", "dtd-auth-req", "dtd-sync", "dtd-login"].every(x => skip[1].includes(`"${x}"`)), "Sicherungsdatei: Anmeldedaten (dtd-auth …) müssen ausgenommen sein");
  const lj = read("login.js");
  for (const m of lj.matchAll(/fetch\(([^;]*)/g)) if (/cfg\.url/.test(m[1])) ok(/redirect: "error"/.test(m[1]), "login.js: Anfrage an Supabase ohne redirect: \"error\"");
  ok(/create_user: false/.test(lj), "login.js: Anmeldung muss create_user: false senden (nur auf Einladung)");
  ok(!/\/auth\/v1\/signup/.test(lj), "login.js: keine Selbst-Registrierung (/auth/v1/signup) – nur auf Einladung");
  ok(/asked \|\| confirm\(/.test(lj), "login.js: Anmelde-Link ohne eigene Anforderung nur nach Rückfrage (untergeschobenes Konto)");
  ok(!/console\.(log|info|debug)\([^)]*(token|pass|key)/i.test(lj), "login.js: Protokoll mit Zugang, Passwort oder Schlüssel");
  const connect = dir("connect-src").split(/\s+/).filter(Boolean);
  ok(connect.every(s => ["'self'", "https://raw.githubusercontent.com", "https://*.tradingview.com", "https://*.supabase.co"].includes(s)), `Schutzregel: unerwartete Verbindung in connect-src (${connect.join(" ")})`);
}

// ---------- 4. Keine Schlüssel im Repository ----------
const SECRET_PATTERNS = [
  [/gh[pousr]_[A-Za-z0-9]{36,}/, "GitHub-Token"], [/github_pat_[A-Za-z0-9_]{22,}/, "GitHub-Token"], [/AKIA[0-9A-Z]{16}/, "AWS-Schlüssel"],
  [/AIza[0-9A-Za-z\-_]{35}/, "Google-Schlüssel"], [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack-Token"], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "privater Schlüssel"],
  [/sk-ant-[A-Za-z0-9\-_]{20,}/, "Anthropic-Schlüssel"], [/\bsk-[A-Za-z0-9]{32,}\b/, "OpenAI-Schlüssel"], [/sk_live_[0-9a-zA-Z]{24,}/, "Stripe-Schlüssel"],
  // fest eingetragene Werte für unsere Secrets (Testwerte wie test-…-0000 sind erlaubt)
  [/\b(ETORO_[A-Z_]*KEY|FINNHUB_API_KEY|FRED_API_KEY|NTFY_TOPIC)\s*[:=]\s*["']?(?!test-|\$|\{|<|"?\s*$)[A-Za-z0-9_\-]{12,}/, "fest eingetragener Secret-Wert"],
  [/[?&](token|apikey|api_key)=(?!test)[A-Za-z0-9]{16,}/i, "Schlüssel in einer Adresse"],
  [/ntfy\.sh\/(?!["'`$\s])[A-Za-z0-9_-]{8,}/, "fest eingetragener ntfy-Kanal"],
];
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(f => f && !/\.(png|woff2|ico|jpg|svg)$/.test(f));
for (const f of files) {
  let src; try { src = read(f); } catch { continue; }
  for (const [re, what] of SECRET_PATTERNS) {
    const m = re.exec(src);
    ok(!m, `${f}: ${what} gefunden („${m && m[0].slice(0, 12)}…“) – sofort widerrufen und als GitHub-Secret anlegen`);
  }
}

if (process.argv.includes("--list")) console.log(`geprüft: ${WF.length} Abläufe, ${pageJs.length} Seiten-Skripte, ${scripts.length} Skripte, ${files.length} Dateien auf Schlüssel`);
if (fail) { console.log(`::error::Sicherheits-Check: ${fail} Fund(e)`); process.exit(1); }
console.log(`Sicherheits-Check bestanden: ${checked} Prüfungen – Abläufe (feste Bausteine, knappe Rechte, kein Einschleusen, Zeitlimits), Seite (Schutzregel, kein eval, sichere Links), Skripte (Zieladressen, Echtgeld gesperrt, nichts Geheimes im Protokoll), keine Schlüssel im Repository.`);
