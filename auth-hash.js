// ---------- Anmelde- und Einladungslinks (Supabase): Zugangsdaten aus der Adresse holen, bevor die Seite sie als Bereich liest ----------
// Ein Link aus der E-Mail öffnet die Seite mit #access_token=…&refresh_token=… (oder #error=… bei abgelaufenem Link). Die Werte
// wandern sofort in den Speicher dieses Geräts (dtd-auth-pending) und verschwinden aus Adresse und Verlauf; login.js schließt
// die Anmeldung ab. Läuft im Kopf der Seite, vor allen anderen Skripten.
(() => {
  const h = location.hash || "";
  if (!/(^#|&)(access_token|error)=/.test(h)) return;
  const p = new URLSearchParams(h.slice(1));
  let pending = null;
  if (p.get("access_token") && p.get("refresh_token")) {
    pending = { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: Number(p.get("expires_in")) || 3600, at: Date.now() };
  } else if (p.get("error")) {
    pending = { error: String(p.get("error_description") || p.get("error")).slice(0, 200), at: Date.now() };
  }
  try { if (pending) localStorage.setItem("dtd-auth-pending", JSON.stringify(pending)); } catch { /* ohne Speicher keine Anmeldung */ }
  history.replaceState(null, "", `${location.pathname}${location.search}#home`);
})();
