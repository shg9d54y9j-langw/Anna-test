// ---------- Liniendiagramm für Verläufe in % (Depot-Verlauf): Gitter, Nulllinie, Endwerte, Fadenkreuz mit Werten ----------
// window.DTD.lineChart(host, { dates, series: [{ name, short, color, width, dash, values }], label, unit })
// Gleiche Gestaltung wie die übrigen Diagramme der Seite (Farben aus PAL in app.js, Bedienung auch mit den Pfeiltasten).
(() => {
  const fin = Number.isFinite;
  const pct = v => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmt(Math.abs(v), 1)} %` : "–");
  const dShort = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const dLong = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  function niceTicks(min, max, count) {
    const span = max - min || 1, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6));
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }
  function lineChart(host, { dates, series, label = "Verlauf" }) {
    if (!host || !host.clientWidth || !dates || dates.length < 2) return;
    const S = series.filter(s => s.values.some(fin));
    const W = Math.max(240, host.clientWidth), H = W < 520 ? 220 : 260, m = { l: 52, r: W < 520 ? 12 : 136, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, N = dates.length - 1;
    const all = S.flatMap(s => s.values).filter(fin);
    const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = i => m.l + (i / N) * pw, Y = v => m.t + (y1 - v) / (y1 - y0 || 1) * ph;
    // Lücken (fehlende Werte) unterbrechen die Linie
    const path = vals => vals.map((v, i) => (fin(v) ? `${i && fin(vals[i - 1]) ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}` : "")).join("");
    const last = s => { for (let i = N; i >= 0; i--) if (fin(s.values[i])) return { i, v: s.values[i] }; return null; };
    const labels = W < 520 ? "" : S.map(s => ({ s, e: last(s) })).filter(o => o.e).map(o => ({ ...o, y: Y(o.e.v) })).sort((a, b) => a.y - b.y)
      .map((o, k, arr) => { if (k && o.y - arr[k - 1].y < 15) o.y = arr[k - 1].y + 15; return o; })
      .map(o => `<text class="dlabel" x="${m.l + pw + 8}" y="${o.y + 4}">${pct(o.e.v)} · ${o.s.short}</text>`).join("");
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${label}: ${S.map(s => { const e = last(s); return `${s.name} ${e ? pct(e.v) : "–"}`; }).join(", ")}">
      ${ticks.map(t => `<line class="${t === 0 ? "base" : "grid"}" x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${t > 0 ? "+" : ""}${fmt(t, Math.abs(y1 - y0) < 4 ? 1 : 0)} %</text>`).join("")}
      ${S.slice().reverse().map(s => `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-dasharray="${s.dash || ""}" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
      ${S.map(s => { const e = last(s); return e ? `<circle cx="${X(e.i)}" cy="${Y(e.v)}" r="4" fill="${s.color}" stroke="${PAL.surface}" stroke-width="2"/>` : ""; }).join("")}
      ${labels}
      <text class="tick" x="${m.l}" y="${H - 6}">${dShort(dates[0])}</text>
      <text class="tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${dShort(dates[N])}</text>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="${N}" aria-valuenow="${N}" aria-label="Werte je Tag anzeigen (Pfeiltasten)"/>
    </svg>`;
    const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), hit = svg.querySelector(".hit");
    let tip = host.querySelector(".viz-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; tip.hidden = true; host.append(tip); }
    let idx = N;
    const show = i => {
      idx = Math.max(0, Math.min(N, i));
      const x = X(idx);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="tip-head">${dLong(dates[idx])}</div>` + S.map(s => `<div class="tip-row"><span class="lkey${s.dash ? (s.dash.startsWith("1") ? " dot" : " dash") : ""}" style="${s.dash ? `color:${s.color}` : `background:${s.color}`}"></span>${s.name}: <strong>${pct(s.values[idx])}</strong></div>`).join("");
      tip.hidden = false;
      hit.setAttribute("aria-valuenow", String(idx)); hit.setAttribute("aria-valuetext", tip.textContent.replace(/\s+/g, " ").trim());
      const wTip = tip.offsetWidth;
      tip.style.left = `${x + 12 + wTip > host.clientWidth ? Math.max(8, x - wTip - 12) : x + 12}px`;
      tip.style.top = "8px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const fromEvent = e => { const r = svg.getBoundingClientRect(); return Math.round(((e.clientX - r.left) * (W / r.width) - m.l) / pw * N); };
    hit.addEventListener("pointermove", e => show(fromEvent(e)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(idx));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); } if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); } });
  }
  window.DTD.lineChart = lineChart;
})();
