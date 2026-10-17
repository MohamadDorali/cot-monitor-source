"use strict";
const $ = (s) => document.querySelector(s);
const S = { idx: null, series: {}, tab: "table" };
const WIN = [2, 3, 5];
const COLORS = ["#1d6fe8", "#e03131", "#2f9e44", "#f08c00", "#7048e8"];

// ---------- helpers
const fmt = (v, d = 0) => v == null ? "–" : (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pctTxt = (v) => v == null ? "–" : Math.round(v) + "";
const opts = (el, items, sel) => { el.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join(""); if (sel != null) el.value = sel; };

// Same definitions as scripts/update.py: percentile rank incl. current value, window by calendar years.
function pctRank(arr, cur) { let c = 0; for (const v of arr) if (v <= cur) c++; return 100 * c / arr.length; }
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function cutoff(lastISO, years) {
  const d = new Date(lastISO + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}
function heat(v) {            // 0 = red, 50 = white, 100 = blue
  if (v == null) return "";
  const t = (v - 50) / 50, a = Math.min(1, Math.abs(t)) * 0.85;
  const rgb = t >= 0 ? "37,99,235" : "220,38,38";
  return `background:rgba(${rgb},${a.toFixed(2)});${a > 0.5 ? "color:#fff;" : ""}`;
}
const tint = (v) => v == null || v === 0 ? "" : `background:rgba(${v > 0 ? "37,99,235" : "220,38,38"},.16)`;

// ---------- table view
function renderTable() {
  const rep = $("#t-report").value, cat = $("#t-cat").value, basis = $("#t-basis").value, ext = $("#t-ext").checked;
  const groups = new Map();
  for (const m of S.idx.markets) {
    const row = m.rows[rep]?.cats[cat];
    if (!row) continue;
    const p = basis === "net" ? row.p : row.po;
    if (ext && !p.some((v) => v != null && (v >= 90 || v <= 10))) continue;
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push({ m, row, p, date: m.rows[rep].date });
  }
  S.tbl = { rep, cat, basis, items: [...groups.values()].flat() };
  const T = (t, tip, cls = "") => `<th class="${cls}" data-tip="${tip}">${t}</th>`;
  const win = (y) => `Percentile rank of the current value within the last ${y} years (0 = lowest, 100 = highest). Calculated on net position or net % of open interest, per the 'Percentile of' selector.`;
  let h = `<thead><tr>${T("Market", "Futures contract.")}${T("Long", "Contracts held long by this trader category.")}
    ${T("Short", "Contracts held short by this trader category.")}${T("Total", "Long + Short: the category's gross positions.")}
    ${T("% Long", "Long as a share of Total. Blue = mostly long, red = mostly short.")}${T("% Short", "Short as a share of Total.")}
    ${T("Net", "Long minus Short. Positive = net long, negative = net short.", "sep")}
    ${T("Net % OI", "Net position as a percent of total open interest. Removes the effect of market growth over the years.")}
    ${T("Δ Net (week)", "Change in net position versus the previous week's report, in contracts.")}
    ${T("% Chg", "Weekly change in net position as a percent of last week's absolute net position.")}
    ${T("Pctl 2Y", win(2), "sep")}${T("Pctl 3Y", win(3))}${T("Pctl 5Y", win(5))}</tr></thead><tbody>`;
  for (const [g, items] of groups) {
    h += `<tr class="group"><td colspan="13">${g}</td></tr>`;
    for (const { m, row, p } of items) {
      h += `<tr data-key="${m.key}" tabindex="0"><td>${m.name}</td>
        <td>${fmt(row.long)}</td><td>${fmt(row.short)}</td><td>${fmt(row.total)}</td>
        <td style="${heat(row.pl)}">${fmt(row.pl)}%</td><td style="${heat(row.ps == null ? null : 100 - row.ps)}">${fmt(row.ps)}%</td>
        <td class="sep" style="${tint(row.net)}">${fmt(row.net)}</td><td>${fmt(row.noi, 1)}%</td>
        <td style="${tint(row.chg)}">${fmt(row.chg)}</td><td style="${tint(row.chg)}">${row.pchg == null ? "–" : fmt(row.pchg) + "%"}</td>
        ${p.map((v, i) => `<td class="${i === 0 ? "sep" : ""}" style="${heat(v)}">${pctTxt(v)}</td>`).join("")}</tr>`;
    }
  }
  if (!groups.size) h += `<tr><td colspan="13" class="empty">No market matches these filters.</td></tr>`;
  $("#cot").innerHTML = h + "</tbody>";
}

function fillTableCats() {
  const rep = $("#t-report").value;
  const cats = S.idx.reports[rep].cats.filter((c) => S.idx.markets.some((m) => m.rows[rep]?.cats[c.key]));
  opts($("#t-cat"), cats.map((c) => [c.key, c.label]));
}

// ---------- chart view
const STAT_TIPS = {
  "Now": "Latest value in the chart.",
  "Percentile": "Rank of the latest value within this window (100 = highest, 0 = lowest).",
  "10th / 90th": "Extreme-zone boundaries: 10% of weeks were below the 10th value and 10% above the 90th.",
  "Min / Max": "Lowest and highest values in this window.",
  "Date": "Date of the latest report shown."
};
async function loadSeries(key) {
  if (!S.series[key]) S.series[key] = await (await fetch(`data/series/${key}.json`)).json();
  return S.series[key];
}
const market = () => S.idx.markets.find((m) => m.key === $("#c-market").value);

function fillChartReports(keepRep) {
  const m = market();
  const reps = ["legacy", m.special].filter((r) => m.rows[r]);
  opts($("#c-report"), reps.map((r) => [r, S.idx.reports[r].label]), reps.includes(keepRep) ? keepRep : m.special in m.rows ? m.special : "legacy");
  fillChartCats();
}
function fillChartCats(keepCat) {
  const m = market(), rep = $("#c-report").value;
  const cats = S.idx.reports[rep].cats.filter((c) => m.rows[rep]?.cats[c.key]);
  const items = cats.map((c) => [c.key, c.label]).concat([["__all", "All categories (net)"]]);
  opts($("#c-cat"), items, items.some(([k]) => k === keepCat) ? keepCat : items[0][0]);
}

function valuesFor(R, cat, metric, unit) {
  const c = R.cats[cat];
  return R.dates.map((_, i) => {
    const l = c.long[i], s = c.short[i];
    if (l == null || s == null) return null;
    let v = metric === "long" ? l : metric === "short" ? s : l - s;
    if (unit === "oi") v = R.oi[i] ? 100 * v / R.oi[i] : null;
    return v;
  });
}
function slice(R, vals, years) {
  const from = cutoff(R.dates[R.dates.length - 1], years), x = [], y = [];
  R.dates.forEach((d, i) => { if (d >= from && vals[i] != null) { x.push(d); y.push(vals[i]); } });
  return { x, y };
}

async function renderCharts() {
  const m = market(), rep = $("#c-report").value, cat = $("#c-cat").value;
  const metric = $("#c-metric").value, unit = $("#c-unit").value, win = $("#c-win").value;
  const R = (await loadSeries(m.key)).reports[rep];
  const wins = win === "all" ? WIN : [Number(win)];
  const box = $("#panels");
  box.innerHTML = wins.map((w) => `<div class="panel"><div class="phead"><h2 id="h${w}"></h2>${EXPORT_MENU(w)}</div><div class="stats" id="s${w}"></div><div id="p${w}"></div></div>`).join("");
  const catLabel = (k) => S.idx.reports[rep].cats.find((c) => c.key === k).label;
  const suffix = unit === "oi" ? "%" : "";
  const tf = unit === "oi" ? ",.1f" : ",.0f";

  // which lines to draw
  let lines;   // [{name, vals}]
  const single = metric !== "both" && cat !== "__all";
  if (cat === "__all") lines = Object.keys(R.cats).map((k) => ({ name: catLabel(k), vals: valuesFor(R, k, metric === "both" ? "net" : metric, unit) }));
  else if (metric === "both") lines = [{ name: "Long", vals: valuesFor(R, cat, "long", unit) }, { name: "Short", vals: valuesFor(R, cat, "short", unit) }];
  else lines = [{ name: catLabel(cat) + " " + metric, vals: valuesFor(R, cat, metric, unit) }];

  S.cur = { m, rep, cat, metric, unit, R, lines, catLabel };
  for (const w of wins) {
    let layout_x = null;
    const title = `${m.name} · ${cat === "__all" ? "all categories" : catLabel(cat)} · ${metric === "both" ? "long and short" : metric}${unit === "oi" ? " (% of OI)" : ""} · ${w}-year window`;
    $(`#h${w}`).textContent = title;
    const traces = lines.map((l, i) => {
      const { x, y } = slice(R, l.vals, w);
      if (x.length) layout_x = [x[0], x[x.length - 1]];
      return { x, y, name: l.name, type: "scatter", mode: "lines", line: { width: 2, color: COLORS[i % COLORS.length] },
               hovertemplate: `%{x}<br>${l.name}: %{y:${tf}}${suffix}<extra></extra>` };
    });
    const layout = { margin: { l: 70, r: 20, t: 10, b: 36 }, height: 380, hovermode: "x unified", showlegend: lines.length > 1,
      legend: { orientation: "h", y: 1.1 }, xaxis: { gridcolor: "#eef2f9" },
      yaxis: { gridcolor: "#eef2f9", tickformat: tf, ticksuffix: suffix, zeroline: true, zerolinecolor: "#9aa7bd" },
      paper_bgcolor: "#fff", plot_bgcolor: "#fff", shapes: [], annotations: [] };
    layout.xaxis.range = layout_x;

    if (single) {
      const { x, y } = traces[0];
      const sorted = [...y].sort((a, b) => a - b), cur = y[y.length - 1];
      const mn = sorted[0], mx = sorted[sorted.length - 1], p10 = quantile(sorted, .1), p90 = quantile(sorted, .9), med = quantile(sorted, .5);
      const pad = (mx - mn) * 0.1 || 1, top = mx + pad, bot = mn - pad;
      layout.yaxis.range = [bot, top];
      const zone = (y0, y1, rgb) => ({ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0, y1, fillcolor: `rgba(${rgb},.10)`, line: { width: 0 }, layer: "below" });
      const ln = (v, dash, col) => ({ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: v, y1: v, line: { color: col, width: 1, dash } });
      layout.shapes.push(zone(p90, top, "37,99,235"), zone(bot, p10, "220,38,38"),
        ln(mx, "dot", "#2563eb"), ln(mn, "dot", "#dc2626"), ln(p90, "dash", "#7a9bd6"), ln(p10, "dash", "#d68a8a"), ln(med, "dot", "#9aa7bd"));
      const lab = (v, t, col) => ({ xref: "paper", x: 0.005, xanchor: "left", y: v, yanchor: "bottom", text: t, showarrow: false, font: { size: 10.5, color: col } });
      layout.annotations.push(lab(mx, "max", "#2563eb"), lab(mn, "min", "#dc2626"), lab(p90, "90th pctl", "#5577b3"), lab(p10, "10th pctl", "#b36060"));
      const pr = pctRank(y, cur);
      traces.push({ x: [x[x.length - 1]], y: [cur], mode: "markers", showlegend: false, hoverinfo: "skip",
                    marker: { size: 11, color: "#14213d", line: { color: "#fff", width: 2 } } });
      layout.annotations.push({ x: x[x.length - 1], y: cur, text: `${fmt(cur, unit === "oi" ? 1 : 0)}${suffix} · ${Math.round(pr)}th pctl`,
        showarrow: true, arrowcolor: "#14213d", ax: -70, ay: cur > med ? 34 : -34, bgcolor: "#fff", bordercolor: "#14213d", font: { size: 12 } });
      $(`#s${w}`).innerHTML = [["Now", fmt(cur, unit === "oi" ? 1 : 0) + suffix], ["Percentile", Math.round(pr) + "th"],
        ["10th / 90th", `${fmt(p10, unit === "oi" ? 1 : 0)} / ${fmt(p90, unit === "oi" ? 1 : 0)}`],
        ["Min / Max", `${fmt(mn, unit === "oi" ? 1 : 0)} / ${fmt(mx, unit === "oi" ? 1 : 0)}`], ["Date", x[x.length - 1]]]
        .map(([k, v]) => `<span data-tip="${STAT_TIPS[k]}">${k} <b>${v}</b></span>`).join("");
    } else {
      $(`#s${w}`).innerHTML = `<span>Extreme zones are shown when a single category and Net, Long or Short is selected.</span>`;
    }
    Plotly.newPlot(`p${w}`, traces, layout, { displayModeBar: false, responsive: true });
  }
}

// ---------- wiring
function setTab(t) {
  S.tab = t;
  $("#view-table").hidden = t !== "table"; $("#view-chart").hidden = t !== "chart";
  $("#tab-table").setAttribute("aria-selected", t === "table"); $("#tab-chart").setAttribute("aria-selected", t === "chart");
  if (t === "chart") renderCharts().catch(showError);
}
function openChart(key) {
  $("#c-market").value = key;
  fillChartReports($("#t-report").value);
  const cat = $("#t-cat").value;
  if ([...$("#c-cat").options].some((o) => o.value === cat)) $("#c-cat").value = cat;
  $("#c-metric").value = "net"; $("#c-unit").value = $("#t-basis").value === "oi" ? "oi" : "contracts";
  setTab("chart");
}
function showError(e) { console.error(e); $("#panels").innerHTML = `<div class="panel empty">Could not load chart data. ${e.message}</div>`; }

async function init() {
  S.idx = await (await fetch("data/index.json")).json();
  const mt = S.idx.meta;
  $("#meta").textContent = `Futures only · report date ${mt.last_report_date} · data refreshed ${mt.updated_utc.slice(0, 10)}`;

  opts($("#t-report"), Object.entries(S.idx.reports).map(([k, v]) => [k, v.label]), "legacy");
  fillTableCats(); renderTable();
  const groups = [...new Set(S.idx.markets.map((m) => m.group))];
  $("#c-market").innerHTML = groups.map((g) => `<optgroup label="${g}">${S.idx.markets.filter((m) => m.group === g).map((m) => `<option value="${m.key}">${m.name}</option>`).join("")}</optgroup>`).join("");
  fillChartReports("legacy");

  $("#t-report").onchange = () => { fillTableCats(); renderTable(); };
  for (const id of ["#t-cat", "#t-basis", "#t-ext"]) $(id).onchange = renderTable;
  $("#cot").onclick = (e) => { const tr = e.target.closest("tr[data-key]"); if (tr) openChart(tr.dataset.key); };
  $("#cot").onkeydown = (e) => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-key]"); if (tr) openChart(tr.dataset.key); } };
  $("#c-market").onchange = () => { fillChartReports($("#c-report").value); renderCharts().catch(showError); };
  $("#c-report").onchange = () => { fillChartCats(); renderCharts().catch(showError); };
  for (const id of ["#c-cat", "#c-metric", "#c-unit", "#c-win"]) $(id).onchange = () => renderCharts().catch(showError);
  $("#tab-table").onclick = () => setTab("table");
  $("#tab-chart").onclick = () => setTab("chart");
}
// ---------- export
const EXPORT_MENU = (w) => `<select class="exp" data-w="${w}" aria-label="Export chart" data-tip="Download this chart as an image (PNG, JPEG, WebP, SVG) or its data as a CSV file.">
  <option value="">Export ▾</option><option value="png">PNG image</option><option value="jpeg">JPEG image</option>
  <option value="webp">WebP image</option><option value="svg">SVG (vector)</option><option value="csv">CSV data</option></select>`;

function csvText(head, rows) {
  const q = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return "\ufeff" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");   // BOM so Excel reads UTF-8
}
function download(blobOrText, name, type = "text/csv;charset=utf-8") {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportTableCsv() {
  const t = S.tbl; if (!t || !t.items.length) return;
  const r = S.idx.reports[t.rep], catL = r.cats.find((c) => c.key === t.cat).label, pb = t.basis === "net" ? "net" : "net % OI";
  const head = ["Group", "Market", "Report", "Category", "Report date", "Long", "Short", "Total", "% Long", "% Short", "Net", "Net % OI",
    "Net change (week)", "Net change %", `Pctl 2Y (${pb})`, `Pctl 3Y (${pb})`, `Pctl 5Y (${pb})`];
  const rows = t.items.map(({ m, row, p, date }) => [m.group, m.name, r.label, catL, date, row.long, row.short, row.total, row.pl, row.ps,
    row.net, row.noi, row.chg, row.pchg, ...p]);
  download(csvText(head, rows), `cot_${t.rep}_${t.cat}_${t.basis}_${S.idx.meta.last_report_date}.csv`);
}
async function exportChart(w, fmt) {
  const c = S.cur, gd = $(`#p${w}`), title = $(`#h${w}`).textContent;
  const name = `cot_${c.m.key}_${c.rep}_${c.cat}_${c.metric}_${c.unit}_${w}y`;
  if (fmt === "csv") {
    const from = cutoff(c.R.dates[c.R.dates.length - 1], w);
    const idx = c.R.dates.map((d, i) => i).filter((i) => c.R.dates[i] >= from);
    const sfx = c.unit === "oi" ? " (% of OI)" : "";
    const head = ["Date", ...c.lines.map((l) => l.name + sfx), "Open interest"];
    download(csvText(head, idx.map((i) => [c.R.dates[i], ...c.lines.map((l) => l.vals[i] == null ? null : Math.round(l.vals[i] * 100) / 100), c.R.oi[i]])), name + ".csv");
    return;
  }
  const sub = `Source: CFTC Commitments of Traders (Futures Only) · report date ${S.idx.meta.last_report_date}`;
  await Plotly.relayout(gd, { "title.text": `<b>${title}</b><br><sup>${sub}</sup>`, "title.x": 0.01, "title.xanchor": "left", "margin.t": 78 });
  try { await Plotly.downloadImage(gd, { format: fmt, filename: name, width: 1400, height: 650, scale: 2 }); }
  finally { await Plotly.relayout(gd, { "title.text": "", "margin.t": 10 }); }
}

// ---------- tooltips and guide
const tip = $("#tip");
function showTip(el) {
  tip.textContent = el.dataset.tip; tip.classList.add("on");
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let top = r.bottom + 8; if (top + h > window.innerHeight - 8) top = r.top - h - 8;
  tip.style.left = left + "px"; tip.style.top = Math.max(8, top) + "px";
}
document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el); else tip.classList.remove("on"); });
document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el); });
for (const ev of ["focusout", "scroll", "click"]) document.addEventListener(ev, () => tip.classList.remove("on"), true);
document.querySelectorAll("[data-open-guide]").forEach((b) => b.addEventListener("click", () => $("#guide").showModal()));
$("#t-export").onclick = exportTableCsv;
$("#panels").addEventListener("change", (e) => {
  const sel = e.target.closest("select.exp"); if (!sel || !sel.value) return;
  const f = sel.value; sel.value = "";
  exportChart(Number(sel.dataset.w), f).catch((err) => alert("Export failed: " + err.message));
});
$("#guide-close").onclick = () => $("#guide").close();
$("#guide").addEventListener("click", (e) => { if (e.target.id === "guide") e.target.close(); });

init().catch((e) => { $("#meta").textContent = "Could not load data/index.json — " + e.message; });
