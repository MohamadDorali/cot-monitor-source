"use strict";
const $ = (s) => document.querySelector(s);
const S = {
  manifest: null, mode: null, idx: null, indexes: {}, series: {}, tab: "table",
  sort: { col: null, dir: 1 }, group: "", collapsed: new Set(), scope: "featured", quick: "",
  watch: new Set(), navKeys: [], scrollY: 0, tbl: null, cur: null, chartTok: 0, applying: false,
};
const WIN = [2, 3, 5];
const COLORS = ["#1d6fe8", "#e03131", "#2f9e44", "#f08c00", "#7048e8"];
const fullWeeks = (y) => 0.9 * 52 * y;   // fewer weeks than this = "short history" for a window of y years
const isMobile = () => window.innerWidth <= 760;
const IMAGE_FOOTER_RIGHT = "Developed by Mohamad Dorali";   // text at the bottom right of exported table images ("" to hide)

// ---------- helpers
const fmt = (v, d = 0) => v == null ? "–" : (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pctTxt = (v) => v == null ? "–" : Math.round(v) + "";
const opts = (el, items, sel) => { el.innerHTML = items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(""); if (sel != null && items.some(([v]) => v === sel)) el.value = sel; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setSel = (sel, v) => { const el = $(sel); if (v != null && [...el.options].some((o) => o.value === v)) el.value = v; };

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
// colors: percentiles and shares run red (0) - white (50) - blue (100); signed numbers get a light tint
function heatInfo(v) {
  if (v == null) return null;
  const t = (v - 50) / 50, a = Math.min(1, Math.abs(t)) * 0.85;
  return { rgb: t >= 0 ? [37, 99, 235] : [220, 38, 38], a, fg: a > 0.5 ? "#fff" : null };
}
const tintInfo = (v) => v == null || v === 0 ? null : { rgb: v > 0 ? [37, 99, 235] : [220, 38, 38], a: 0.16, fg: null };
const css = (i) => i ? `background:rgba(${i.rgb.join(",")},${i.a.toFixed(2)});${i.fg ? `color:${i.fg};` : ""}` : "";
const hex = (i) => "FF" + i.rgb.map((c) => Math.round(255 * (1 - i.a) + c * i.a).toString(16).padStart(2, "0")).join("").toUpperCase();
const rgba = (i) => `rgba(${i.rgb.join(",")},${i.a.toFixed(2)})`;
const hay = (m) => m._h || (m._h = `${m.name} ${m.al || ""} ${m.group}`.toLowerCase());
const matches = (m, q) => !q || q.split(/\s+/).every((t) => hay(m).includes(t));
function download(blobOrText, name, type = "text/csv;charset=utf-8") {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- watch list (kept in this browser only)
const WKEY = "cot.watchlist";
function loadWatch() { try { return new Set(JSON.parse(localStorage.getItem(WKEY) || "[]")); } catch (e) { return new Set(); } }
function saveWatch() { try { localStorage.setItem(WKEY, JSON.stringify([...S.watch])); } catch (e) { /* storage unavailable: list lasts for this visit */ } }
function toggleWatch(key) {
  if (S.watch.has(key)) S.watch.delete(key); else S.watch.add(key);
  saveWatch(); renderScopeSeg(); renderStar();
  if (S.tab === "table") renderTable();
}

// ---------- scope, quick views, data set switches
const hasFeatured = () => S.idx.markets.some((m) => m.f);
function inScope(m, q) {
  if (q) return true;                                   // searching always covers all markets
  if (S.scope === "featured") return !!m.f;
  if (S.scope === "watch") return S.watch.has(m.key);
  return true;
}
const MODE_TIPS = { futures: "Futures positions only.", combined: "Futures plus options positions (options converted to futures equivalents)." };
function renderSeg() {
  $("#mode-seg").innerHTML = S.manifest.modes.map((m) =>
    `<button type="button" class="segbtn" data-mode="${m.key}" aria-pressed="${m.key === S.mode}" data-tip="${esc(MODE_TIPS[m.key] || m.label)}">${esc(m.label)}</button>`).join("");
  $("#databar-mode").hidden = S.manifest.modes.length < 2;
}
function renderScopeSeg() {
  const mk = S.idx.markets, feat = mk.filter((m) => m.f).length, mine = mk.filter((m) => S.watch.has(m.key)).length;
  const items = [];
  if (feat) items.push(["featured", "Featured", feat, "The main markets (currencies, indices, rates, metals, energy, grains, softs, livestock)."]);
  items.push(["all", "All", mk.length, "Every active contract in the CFTC reports."]);
  items.push(["watch", "My list", mine, "Markets you starred. Saved in this browser."]);
  if (!feat && S.scope === "featured") S.scope = "all";
  $("#scope-seg").innerHTML = items.map(([k, t, n, tip]) =>
    `<button type="button" class="segbtn" data-scope="${k}" aria-pressed="${S.scope === k}" data-tip="${esc(tip)}">${t}<span class="n">${n}</span></button>`).join("");
}
function renderQuick() {
  $("#t-quick").innerHTML = [["ext", "Extremes", "Markets where a percentile is in the top or bottom 10% (crowded positioning)."],
    ["moves", "Biggest weekly moves", "The 30 markets whose net position changed most this week, as a share of open interest."]]
    .map(([k, t, tip]) => `<button type="button" class="chip" data-q="${k}" aria-pressed="${S.quick === k}" data-tip="${esc(tip)}">${t}</button>`).join("");
}

// ---------- table view
const SORT_TIP = " Click to sort.";
const winTip = (y) => `Percentile rank of the current value within the last ${y} years (0 = lowest, 100 = highest). Calculated on net position or net % of open interest, per the 'Percentile of' selector.`;
const COLS = [
  { id: "name", label: "Market", tip: "Futures contract.", get: (r) => r.m.name },
  { id: "long", label: "Long", tip: "Contracts held long by this trader category.", get: (r) => r.row.long },
  { id: "short", label: "Short", tip: "Contracts held short by this trader category.", get: (r) => r.row.short },
  { id: "total", label: "Total", tip: "Long + Short: the category's gross positions.", get: (r) => r.row.total },
  { id: "pl", label: "% Long", tip: "Long as a share of Total. Blue = mostly long, red = mostly short.", get: (r) => r.row.pl },
  { id: "ps", label: "% Short", tip: "Short as a share of Total.", get: (r) => r.row.ps },
  { id: "net", label: "Net", cls: "sep", tip: "Long minus Short. Positive = net long, negative = net short.", get: (r) => r.row.net },
  { id: "noi", label: "Net % OI", tip: "Net position as a percent of total open interest. Removes the effect of market growth over the years.", get: (r) => r.row.noi },
  { id: "chg", label: "Δ Net (week)", tip: "Change in net position versus the previous week's report, in contracts.", get: (r) => r.row.chg },
  { id: "pchg", label: "% Chg", tip: "Weekly change in net position as a percent of last week's absolute net position.", get: (r) => r.row.pchg },
  { id: "sp", label: "Trend 5Y", nosort: true, tip: "Net position over the last 5 years, scaled to its own range. The dot is the latest value." },
  { id: "p2", label: "Pctl 2Y", cls: "sep", tip: winTip(2), get: (r) => r.p[0] },
  { id: "p3", label: "Pctl 3Y", tip: winTip(3), get: (r) => r.p[1] },
  { id: "p5", label: "Pctl 5Y", tip: winTip(5), get: (r) => r.p[2] },
];
const NCOL = COLS.length;

function spark(sp) {
  if (!sp) return "–";
  const n = sp.length, W = 84, H = 22;
  const pts = [...sp].map((c, i) => `${(2 + i * (W - 4) / Math.max(1, n - 1)).toFixed(1)},${(H - 3 - (parseInt(c, 36) / 35) * (H - 6)).toFixed(1)}`);
  const last = pts[n - 1].split(",");
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net position, last 5 years"><polyline points="${pts.join(" ")}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.2"/></svg>`;
}
function pctCell(v, i, row) {
  const n = row.pn ? row.pn[i] : null, min = S.idx.meta.min_weeks || 26;
  const short = v != null && n != null && n < fullWeeks(WIN[i]);
  let tip = "";
  if (v == null && n != null && n < min) tip = `Not enough history: only ${n} weeks of data (minimum ${min}).`;
  else if (short) tip = `Only ${n} weeks of history, so this percentile covers less than ${WIN[i]} years.`;
  return `<td class="c-p${WIN[i]}${i === 0 ? " sep" : ""}" data-label="Pctl ${WIN[i]}Y" style="${css(heatInfo(v))}"${tip ? ` data-tip="${tip}"` : ""}>${pctTxt(v)}</td>`;
}
const starBtn = (m) => { const on = S.watch.has(m.key); return `<button type="button" class="star" data-star="${m.key}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} My list" data-tip="${on ? "Remove from" : "Add to"} My list">${on ? "★" : "☆"}</button>`; };
function rowHtml({ m, row, p }, flat) {
  return `<tr data-key="${m.key}" tabindex="0"><td class="c-name">${starBtn(m)}<span class="nm">${esc(m.name)}</span>${flat ? `<span class="sub">${esc(m.group)}</span>` : ""}</td>
    <td class="c-long" data-label="Long">${fmt(row.long)}</td><td class="c-short" data-label="Short">${fmt(row.short)}</td><td class="c-total">${fmt(row.total)}</td>
    <td class="c-pl" style="${css(heatInfo(row.pl))}">${fmt(row.pl)}%</td><td class="c-ps" style="${css(heatInfo(row.ps == null ? null : 100 - row.ps))}">${fmt(row.ps)}%</td>
    <td class="c-net sep" data-label="Net" style="${css(tintInfo(row.net))}">${fmt(row.net)}</td><td class="c-noi" data-label="Net % OI">${fmt(row.noi, 1)}%</td>
    <td class="c-chg" data-label="Δ Net (week)" style="${css(tintInfo(row.chg))}">${fmt(row.chg)}</td><td class="c-pchg" style="${css(tintInfo(row.chg))}">${row.pchg == null ? "–" : fmt(row.pchg) + "%"}</td>
    <td class="c-spark" data-tip="${esc(COLS.find((c) => c.id === "sp").tip)}">${spark(row.sp)}</td>
    ${p.map((v, i) => pctCell(v, i, row)).join("")}</tr>`;
}

function renderTable() {
  if (!S.idx) return;
  const rep = $("#t-report").value, cat = $("#t-cat").value, basis = $("#t-basis").value;
  const q = $("#t-search").value.trim().toLowerCase();
  const found = [];
  for (const m of S.idx.markets) {
    const row = m.rows[rep]?.cats[cat];
    if (!row) continue;
    if (S.group && m.group !== S.group) continue;
    if (!matches(m, q) || !inScope(m, q)) continue;
    const p = basis === "net" ? row.p : row.po;
    if (S.quick === "ext" && !p.some((v) => v != null && (v >= 90 || v <= 10))) continue;
    found.push({ m, row, p });
  }
  let groups, flat = false;
  if (S.quick === "moves") {
    flat = true;
    groups = [["Biggest weekly moves (change in net as % of open interest)", found.filter((r) => r.row.coi != null)
      .sort((a, b) => Math.abs(b.row.coi) - Math.abs(a.row.coi)).slice(0, 30)]];
  } else {
    const map = new Map(S.idx.groups.map((g) => [g, []]));
    for (const r of found) map.get(r.m.group).push(r);
    if (S.sort.col) {
      const col = COLS.find((c) => c.id === S.sort.col);
      if (col && col.get) for (const items of map.values()) items.sort((x, y) => {
        const a = col.get(x), b = col.get(y);
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return S.sort.dir * (typeof a === "string" ? a.localeCompare(b) : b - a);
      });
    }
    groups = [...map].filter(([, items]) => items.length);
  }
  const all = groups.flatMap(([, items]) => items);
  S.tbl = { rep, cat, basis, flat, groups, items: all };
  S.navKeys = all.map((r) => r.m.key);
  const forceOpen = !!q || S.quick === "ext" || flat;
  const label = S.idx.meta.label;
  $("#t-count").textContent = q ? `${label} · ${all.length} results in all markets` : flat ? `${label} · top ${all.length} weekly moves`
    : `${label} · ${all.length} ${S.scope === "featured" ? "featured " : S.scope === "watch" ? "saved " : ""}markets`;
  $("#t-collapsetools").hidden = flat;
  const arrow = (id) => S.sort.col === id && !flat ? `<span class="arr">${(id === "name" ? S.sort.dir === 1 : S.sort.dir === -1) ? "▲" : "▼"}</span>` : "";
  let h = `<thead><tr>${COLS.map((c) => `<th class="${c.nosort ? "" : "sortable"} ${c.cls || ""}" ${c.nosort ? "" : `data-col="${c.id}"`} data-tip="${esc(c.tip + (c.nosort ? "" : SORT_TIP))}">${c.label}${arrow(c.id)}</th>`).join("")}</tr></thead><tbody>`;
  for (const [g, items] of groups) {
    const open = forceOpen || !S.collapsed.has(g);
    h += flat ? `<tr class="group" aria-expanded="true"><td colspan="${NCOL}">${esc(g)}<span class="gcount">${items.length}</span></td></tr>`
      : `<tr class="group" data-group="${esc(g)}" tabindex="0" aria-expanded="${open}"><td colspan="${NCOL}"><span class="chev">${open ? "▾" : "▸"}</span>${esc(g)}<span class="gcount">${items.length}</span></td></tr>`;
    if (!open) continue;
    for (const r of items) h += rowHtml(r, flat);
  }
  if (!groups.length) {
    const msg = q ? "No market matches your search."
      : S.scope === "watch" ? "Your list is empty. Click the ☆ next to a market to add it here."
      : "No market matches these filters.";
    const btn = !q && S.scope === "featured" && hasFeatured() ? `<br><button class="btn" id="show-all" type="button">Show all markets</button>` : "";
    h += `<tr><td colspan="${NCOL}" class="empty">${msg}${btn}</td></tr>`;
  }
  $("#cot").innerHTML = h + "</tbody>";
  const sa = $("#show-all"); if (sa) sa.onclick = () => { S.scope = "all"; renderScopeSeg(); renderChips(); renderTable(); };
  syncSortSelect(); updateSummaries(); syncUrl(false);
}

function fillTableControls() {
  const keepRep = $("#t-report").value || "legacy";
  opts($("#t-report"), Object.entries(S.idx.reports).filter(([k]) => S.idx.markets.some((m) => m.rows[k])).map(([k, v]) => [k, v.label]), keepRep);
  fillTableCats();
  renderChips();
  const items = [["", "Default order"], ["name:1", "Name A to Z"]];
  for (const [id, t] of [["p5", "Pctl 5Y"], ["p3", "Pctl 3Y"], ["p2", "Pctl 2Y"], ["net", "Net"], ["noi", "Net % OI"], ["chg", "Δ Net (week)"], ["pchg", "% Chg"]])
    items.push([`${id}:1`, `${t}, high to low`], [`${id}:-1`, `${t}, low to high`]);
  opts($("#t-sort"), items);
}
function syncSortSelect() { const v = S.sort.col ? `${S.sort.col}:${S.sort.dir}` : ""; const el = $("#t-sort"); if ([...el.options].some((o) => o.value === v)) el.value = v; else el.value = ""; }
function renderChips() {
  const rep = $("#t-report").value, cat = $("#t-cat").value;
  const avail = S.idx.groups.filter((g) => S.idx.markets.some((m) => m.group === g && m.rows[rep]?.cats[cat] && inScope(m, "")));
  if (S.group && !avail.includes(S.group)) S.group = "";
  $("#t-chips").innerHTML = `<span class="lbl">Group</span>` + [["", "All"], ...avail.map((g) => [g, g])]
    .map(([g, t]) => `<button type="button" class="chip" data-g="${esc(g)}" aria-pressed="${S.group === g}">${esc(t)}</button>`).join("");
}
function toggleGroup(g) { if (S.collapsed.has(g)) S.collapsed.delete(g); else S.collapsed.add(g); renderTable(); }
function fillTableCats() {
  const rep = $("#t-report").value, keep = $("#t-cat").value;
  const cats = S.idx.reports[rep].cats.filter((c) => S.idx.markets.some((m) => m.rows[rep]?.cats[c.key]));
  opts($("#t-cat"), cats.map((c) => [c.key, c.label]), keep);
}
function updateSummaries() {
  const lab = (sel) => $(sel).selectedOptions[0]?.textContent || "";
  $("#t-optsum").textContent = `${lab("#t-report")} · ${lab("#t-cat")} · ${$("#t-basis").value === "net" ? "Net" : "% of OI"}`;
  $("#c-optsum").textContent = `${lab("#c-report")} · ${lab("#c-cat")} · ${lab("#c-metric")} · ${$("#c-unit").value === "oi" ? "% of OI" : "Contracts"} · ${$("#c-win").value === "all" ? "2/3/5Y" : $("#c-win").value + "Y"}`;
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
  const k = `${S.mode}/${key}`;
  if (!S.series[k]) {
    const r = await fetch(`data/${S.mode}/series/${key}.json`);
    if (!r.ok) throw new Error(`data/${S.mode}/series/${key}.json not found`);
    S.series[k] = await r.json();
  }
  return S.series[k];
}
const market = () => S.idx.markets.find((m) => m.key === $("#c-market").value);

function fillMarkets(keepKey) {
  const f = $("#c-find").value.trim().toLowerCase();
  const list = S.idx.markets.filter((m) => matches(m, f));
  $("#c-count-wrap").textContent = f ? `Market (${list.length})` : "Market";
  if (!list.length) return false;
  $("#c-market").innerHTML = S.idx.groups.map((g) => {
    const items = list.filter((m) => m.group === g);
    return items.length ? `<optgroup label="${esc(g)}">${items.map((m) => `<option value="${m.key}">${esc(m.name)}</option>`).join("")}</optgroup>` : "";
  }).join("");
  $("#c-market").value = list.some((m) => m.key === keepKey) ? keepKey : list[0].key;
  return true;
}
function fillChartReports(keepRep, keepCat) {
  const m = market();
  const reps = ["legacy", m.special].filter((r) => r && m.rows[r]);
  opts($("#c-report"), reps.map((r) => [r, S.idx.reports[r].label]), reps.includes(keepRep) ? keepRep : (m.special && m.rows[m.special] ? m.special : reps[0]));
  fillChartCats(keepCat);
}
function fillChartCats(keepCat) {
  const m = market(), rep = $("#c-report").value;
  const cats = S.idx.reports[rep].cats.filter((c) => m.rows[rep]?.cats[c.key]);
  const items = cats.map((c) => [c.key, c.label]).concat([["__all", "All categories (net)"]]);
  opts($("#c-cat"), items, items.some(([k]) => k === keepCat) ? keepCat : items[0][0]);
}
function renderStar() {
  const m = S.idx && market(); if (!m) return;
  const on = S.watch.has(m.key), b = $("#c-star");
  b.textContent = on ? "★ In My list" : "☆ My list"; b.setAttribute("aria-pressed", on);
  b.dataset.tip = on ? "Remove this market from My list." : "Add this market to My list (saved in this browser).";
}
function stepMarket(d) {
  const cur = $("#c-market").value, keys = S.navKeys.includes(cur) ? S.navKeys : S.idx.markets.map((m) => m.key);
  const key = keys[(keys.indexOf(cur) + d + keys.length) % keys.length];
  $("#c-find").value = "";
  fillMarkets(key); fillChartReports($("#c-report").value, $("#c-cat").value);
  renderStar(); refreshCharts();
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
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function slice(R, vals, years) {
  const from = cutoff(R.dates[R.dates.length - 1], years), x = [], y = [];
  R.dates.forEach((d, i) => { if (d >= from && vals[i] != null) { x.push(d); y.push(vals[i]); } });
  return { x, y };
}

async function renderCharts() {
  if (!S.idx) return;
  const m = market(); if (!m) return;
  const rep = $("#c-report").value, cat = $("#c-cat").value;
  const metric = $("#c-metric").value, unit = $("#c-unit").value, win = $("#c-win").value;
  const wins = win === "all" ? WIN : [Number(win)];
  const tok = ++S.chartTok;
  updateSummaries(); renderStar();
  $("#panels").innerHTML = wins.map(() => `<div class="panel"><div class="skel skelpanel"></div></div>`).join("");
  const R = (await loadSeries(m.key)).reports[rep];
  if (tok !== S.chartTok) return;                       // a newer selection replaced this one while loading
  if (!R) throw new Error("This market has no data for the selected report.");
  $("#panels").innerHTML = wins.map((w) => `<div class="panel"><div class="phead"><h2 id="h${w}"></h2>${EXPORT_MENU(w)}</div><div class="stats" id="s${w}"></div><div id="p${w}"></div></div>`).join("");
  const catLabel = (k) => S.idx.reports[rep].cats.find((c) => c.key === k).label;
  const suffix = unit === "oi" ? "%" : "";
  const tf = unit === "oi" ? ",.1f" : ",.0f";
  const d1 = unit === "oi" ? 1 : 0;
  const small = isMobile();

  let lines;   // [{name, vals}]
  const single = metric !== "both" && cat !== "__all";
  if (cat === "__all") lines = Object.keys(R.cats).map((k) => ({ name: catLabel(k), vals: valuesFor(R, k, metric === "both" ? "net" : metric, unit) }));
  else if (metric === "both") lines = [{ name: "Long", vals: valuesFor(R, cat, "long", unit) }, { name: "Short", vals: valuesFor(R, cat, "short", unit) }];
  else lines = [{ name: catLabel(cat) + " " + metric, vals: valuesFor(R, cat, metric, unit) }];

  S.cur = { m, rep, cat, metric, unit, R, lines, mode: S.mode, label: S.idx.meta.label };
  const legend = lines.length > 1;
  for (const w of wins) {
    let layout_x = null;
    $(`#h${w}`).textContent = `${m.name} · ${cat === "__all" ? "all categories" : catLabel(cat)} · ${metric === "both" ? "long and short" : metric}${unit === "oi" ? " (% of OI)" : ""} · ${w}-year window`;
    const traces = lines.map((l, i) => {
      const { x, y } = slice(R, l.vals, w);
      if (x.length) {   // leave a little room after the latest point so the line does not touch the right edge
        const span = (new Date(x[x.length - 1]) - new Date(x[0])) / 864e5;
        layout_x = [x[0], addDays(x[x.length - 1], Math.max(4, Math.round(span * 0.035)))];
      }
      return { x, y, name: l.name, type: "scatter", mode: "lines", line: { width: 2, color: COLORS[i % COLORS.length] },
               hovertemplate: `%{x}<br>${l.name}: %{y:${tf}}${suffix}<extra></extra>` };
    });
    const n = Math.max(...traces.map((t) => t.x.length));
    if (n < 2) { $(`#s${w}`).innerHTML = `<span class="note">Not enough data for this market and window.</span>`; continue; }
    const layout = { margin: { l: small ? 52 : 70, r: small ? 22 : 36, t: legend ? (small ? 58 : 46) : 10, b: 36 }, height: small ? 300 : 380, hovermode: "x unified", showlegend: legend, dragmode: false,
      legend: { orientation: "h", x: 0, y: 1.0, yanchor: "bottom" }, xaxis: { gridcolor: "#eef2f9", range: layout_x },
      yaxis: { gridcolor: "#eef2f9", tickformat: tf, ticksuffix: suffix, zeroline: true, zerolinecolor: "#9aa7bd" },
      paper_bgcolor: "#fff", plot_bgcolor: "#fff", shapes: [], annotations: [] };

    let stats = "";
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
      layout.annotations.push({ x: x[x.length - 1], y: cur, text: `${fmt(cur, d1)}${suffix} · ${Math.round(pr)}th pctl`,
        showarrow: true, arrowcolor: "#14213d", ax: small ? -50 : -70, ay: cur > med ? 34 : -34, bgcolor: "#fff", bordercolor: "#14213d", font: { size: 12 } });
      stats = [["Now", fmt(cur, d1) + suffix], ["Percentile", Math.round(pr) + "th"], ["10th / 90th", `${fmt(p10, d1)} / ${fmt(p90, d1)}`],
        ["Min / Max", `${fmt(mn, d1)} / ${fmt(mx, d1)}`], ["Date", x[x.length - 1]]]
        .map(([k, v]) => `<span data-tip="${STAT_TIPS[k]}">${k} <b>${v}</b></span>`).join("");
    } else {
      stats = `<span>Extreme zones are shown when a single category and Net, Long or Short is selected.</span>`;
    }
    if (n < fullWeeks(w)) stats += `<span class="note">Only ${n} weeks of data (since ${traces[0].x.length ? traces[0].x[0] : layout_x[0]}), so this window starts where the data starts.</span>`;
    $(`#s${w}`).innerHTML = `<span class="ctx">${esc(S.idx.meta.label)}</span>` + stats;
    Plotly.newPlot(`p${w}`, traces, layout, { displayModeBar: false, responsive: true, scrollZoom: false });
  }
  syncUrl(false);
}

// ---------- URL state (so a view can be shared and Back works)
const parseHash = () => new URLSearchParams(location.hash.slice(1));
function stateParams() {
  const p = new URLSearchParams();
  if (S.tab === "chart") p.set("v", "chart");
  if (S.mode !== S.manifest.default) p.set("d", S.mode);
  if (S.scope !== "featured") p.set("sc", S.scope);
  if (S.group) p.set("g", S.group);
  p.set("tr", $("#t-report").value); p.set("tc", $("#t-cat").value);
  if ($("#t-basis").value === "oi") p.set("tb", "oi");
  const q = $("#t-search").value.trim(); if (q) p.set("q", q);
  if (S.quick) p.set("qv", S.quick);
  if (S.sort.col) p.set("so", `${S.sort.col}:${S.sort.dir}`);
  if (S.tab === "chart") {
    p.set("m", $("#c-market").value); p.set("r", $("#c-report").value); p.set("c", $("#c-cat").value);
    p.set("s", $("#c-metric").value); p.set("u", $("#c-unit").value); p.set("w", $("#c-win").value);
  }
  return p;
}
function syncUrl(push) {
  if (S.applying || !S.idx) return;
  const s = stateParams().toString();
  if (location.hash.slice(1) === s) return;
  history[push ? "pushState" : "replaceState"](null, "", s ? "#" + s : location.pathname + location.search);
}
async function applyState(st) {
  S.applying = true;
  try {
    const want = st.get("d");
    const mode = S.manifest.modes.some((m) => m.key === want) ? want : S.manifest.default;
    if (mode !== S.mode) await setMode(mode, true);
    const sc = st.get("sc");
    S.scope = sc === "all" || sc === "watch" ? sc : "featured";
    if (!hasFeatured() && S.scope === "featured") S.scope = "all";
    S.group = st.get("g") || "";
    S.quick = ["ext", "moves"].includes(st.get("qv")) ? st.get("qv") : "";
    const so = (st.get("so") || "").split(":");
    S.sort = so[0] && COLS.some((c) => c.id === so[0] && c.get) ? { col: so[0], dir: Number(so[1]) === -1 ? -1 : 1 } : { col: null, dir: 1 };
    setSel("#t-report", st.get("tr")); fillTableCats(); setSel("#t-cat", st.get("tc"));
    $("#t-basis").value = st.get("tb") === "oi" ? "oi" : "net";
    $("#t-search").value = st.get("q") || "";
    $("#c-find").value = "";
    fillMarkets(st.get("m") || $("#c-market").value);
    fillChartReports(st.get("r") || $("#c-report").value, st.get("c") || $("#c-cat").value);
    setSel("#c-metric", st.get("s")); setSel("#c-unit", st.get("u")); setSel("#c-win", st.get("w"));
    S.tab = st.get("v") === "chart" ? "chart" : "table";
  } finally { S.applying = false; }
  renderSeg(); renderScopeSeg(); renderChips(); renderQuick(); showTab();
  renderTable();
  if (S.tab === "chart") refreshCharts();
}

// ---------- mode, tabs, loading, wiring
function showFatal(e, retry) {
  console.error(e);
  const msg = `<div class="empty">Could not load the data. ${esc(e.message || e)}<br><button class="btn" type="button" id="retry">Try again</button></div>`;
  if (S.tab === "chart" && S.idx) $("#panels").innerHTML = `<div class="panel">${msg}</div>`;
  else $("#cot").innerHTML = `<tbody><tr><td colspan="${NCOL}" class="empty">Could not load the data. ${esc(e.message || e)}<br><button class="btn" type="button" id="retry">Try again</button></td></tr></tbody>`;
  const b = $("#retry"); if (b) b.onclick = retry;
}
const refreshCharts = () => renderCharts().catch((e) => showFatal(e, refreshCharts));
function setLoading(on, text) {
  for (const id of ["#view-table", "#view-chart"]) $(id).classList.toggle("loading-fade", on);
  if (on && text) $("#t-count").textContent = text;
}
function skeleton() {
  $("#cot").innerHTML = `<tbody>${Array.from({ length: 9 }, () => `<tr class="skelrow"><td colspan="${NCOL}"><div class="skel"></div></td></tr>`).join("")}</tbody>`;
  $("#t-count").textContent = "Loading…";
}
function showTab() {
  $("#view-table").hidden = S.tab !== "table"; $("#view-chart").hidden = S.tab !== "chart";
  $("#databar-scope").hidden = S.tab === "chart";
  $("#tab-table").setAttribute("aria-selected", S.tab === "table"); $("#tab-chart").setAttribute("aria-selected", S.tab === "chart");
}
function setTab(t, push = true) {
  S.tab = t; showTab();
  syncUrl(push);                       // update the address first so the previous view stays in the history
  if (t === "chart") refreshCharts(); else renderTable();
}
function openChart(key) {
  S.scrollY = window.scrollY;
  $("#c-find").value = "";
  fillMarkets(key);
  fillChartReports($("#t-report").value, $("#t-cat").value);
  $("#c-metric").value = "net"; $("#c-unit").value = $("#t-basis").value === "oi" ? "oi" : "contracts";
  setTab("chart");
  window.scrollTo(0, 0);
}

async function setMode(mode, quiet) {
  if (!S.indexes[mode]) {
    setLoading(true, `Loading ${S.manifest.modes.find((m) => m.key === mode).label}…`);
    try {
      const r = await fetch(`data/${mode}/index.json`);
      if (!r.ok) throw new Error(`data/${mode}/index.json not found`);
      S.indexes[mode] = await r.json();
    } finally { setLoading(false); }
  }
  S.mode = mode; S.idx = S.indexes[mode];
  const mt = S.idx.meta;
  $("#meta").textContent = `${mt.label} · report date ${mt.last_report_date} · data refreshed ${mt.updated_utc.slice(0, 10)}`;
  renderSeg(); renderScopeSeg(); renderQuick();
  fillTableControls();
  const keepKey = $("#c-market").value, keepRep = $("#c-report").value, keepCat = $("#c-cat").value;
  fillMarkets(keepKey); fillChartReports(keepRep, keepCat);
  if (!quiet) { renderTable(); if (S.tab === "chart") refreshCharts(); }
}

async function init() {
  skeleton();
  const r = await fetch("data/manifest.json");
  if (!r.ok) throw new Error("data/manifest.json not found. Run scripts/update.py first.");
  S.manifest = await r.json();
  await setMode(S.manifest.default, true);
  await applyState(parseHash());
}
function wire() {
  S.watch = loadWatch();
  $("#mode-seg").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b && b.dataset.mode !== S.mode) setMode(b.dataset.mode).then(() => syncUrl(false)).catch((er) => showFatal(er, () => setMode(b.dataset.mode))); };
  $("#scope-seg").onclick = (e) => { const b = e.target.closest("[data-scope]"); if (!b) return; S.scope = b.dataset.scope; renderScopeSeg(); renderChips(); renderTable(); };
  $("#t-quick").onclick = (e) => { const b = e.target.closest("[data-q]"); if (!b) return; S.quick = S.quick === b.dataset.q ? "" : b.dataset.q; renderQuick(); renderTable(); };
  $("#t-report").onchange = () => { fillTableCats(); renderChips(); renderTable(); };
  $("#t-cat").onchange = () => { renderChips(); renderTable(); };
  $("#t-basis").onchange = renderTable;
  $("#t-sort").onchange = () => { const v = $("#t-sort").value; S.sort = v ? { col: v.split(":")[0], dir: Number(v.split(":")[1]) } : { col: null, dir: 1 }; if (S.quick === "moves") { S.quick = ""; renderQuick(); } renderTable(); };
  $("#t-search").oninput = () => { renderChips(); renderTable(); };
  $("#t-chips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; S.group = b.dataset.g; renderChips(); renderTable(); };
  $("#t-collapse").onclick = () => { S.collapsed = new Set(S.idx.groups); renderTable(); };
  $("#t-expand").onclick = () => { S.collapsed.clear(); renderTable(); };
  $("#cot").onclick = (e) => {
    const star = e.target.closest(".star"); if (star) { e.stopPropagation(); return toggleWatch(star.dataset.star); }
    const th = e.target.closest("th[data-col]");
    if (th) {
      const id = th.dataset.col;
      if (S.quick === "moves") { S.quick = ""; renderQuick(); }
      if (S.sort.col !== id) S.sort = { col: id, dir: 1 };
      else if (S.sort.dir === 1) S.sort.dir = -1;
      else S.sort = { col: null, dir: 1 };
      return renderTable();
    }
    const gr = e.target.closest("tr.group[data-group]"); if (gr) return toggleGroup(gr.dataset.group);
    const tr = e.target.closest("tr[data-key]"); if (tr) openChart(tr.dataset.key);
  };
  $("#cot").onkeydown = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("button")) return;
    const gr = e.target.closest("tr.group[data-group]"); if (gr) { e.preventDefault(); return toggleGroup(gr.dataset.group); }
    const tr = e.target.closest("tr[data-key]"); if (tr && e.key === "Enter") openChart(tr.dataset.key);
  };
  $("#t-export").onchange = () => {
    const f = $("#t-export").value; $("#t-export").value = ""; if (!f) return;
    ({ csv: exportTableCsv, xlsx: exportTableXlsx, png: exportTableImage })[f]().catch((err) => alert("Export failed: " + err.message));
  };
  $("#c-find").oninput = () => { if (fillMarkets($("#c-market").value)) { fillChartReports($("#c-report").value, $("#c-cat").value); refreshCharts(); } };
  $("#c-market").onchange = () => { fillChartReports($("#c-report").value, $("#c-cat").value); refreshCharts(); };
  $("#c-report").onchange = () => { fillChartCats(); refreshCharts(); };
  for (const id of ["#c-cat", "#c-metric", "#c-unit", "#c-win"]) $(id).onchange = refreshCharts;
  $("#c-prev").onclick = () => stepMarket(-1);
  $("#c-next").onclick = () => stepMarket(1);
  $("#c-star").onclick = () => { const m = market(); if (m) toggleWatch(m.key); };
  $("#c-back").onclick = () => { setTab("table"); window.scrollTo(0, S.scrollY || 0); };
  $("#tab-table").onclick = () => setTab("table");
  $("#tab-chart").onclick = () => setTab("chart");
  for (const [btn, box] of [["#t-optbtn", "#t-fields"], ["#c-optbtn", "#c-fields"]])
    $(btn).onclick = () => { const open = $(box).classList.toggle("open"); $(btn).setAttribute("aria-expanded", open); };
  window.addEventListener("popstate", () => applyState(parseHash()).catch((e) => showFatal(e, () => applyState(parseHash()))));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S.tab === "chart" && S.idx) refreshCharts(); }, 250); });
}

// ---------- export
const EXPORT_MENU = (w) => `<select class="exp" data-w="${w}" aria-label="Export chart" data-tip="Download this chart as an image (PNG, JPEG, WebP, SVG) or its data as a CSV file.">
  <option value="">Export ▾</option><option value="png">PNG image</option><option value="jpeg">JPEG image</option>
  <option value="webp">WebP image</option><option value="svg">SVG (vector)</option><option value="csv">CSV data</option></select>`;

function csvText(head, rows) {
  const q = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return "\ufeff" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");   // BOM so Excel reads UTF-8
}
const tableMeta = () => {
  const t = S.tbl, r = S.idx.reports[t.rep];
  return { t, repL: r.label, catL: r.cats.find((c) => c.key === t.cat).label, pb: t.basis === "net" ? "net" : "net % OI" };
};
async function exportTableCsv() {
  const { t, repL, catL, pb } = tableMeta(); if (!t.items.length) return;
  const head = ["Data", "Group", "Market", "Report", "Category", "Report date", "Long", "Short", "Total", "% Long", "% Short", "Net", "Net % OI",
    "Net change (week)", "Net change %", "Net change % of OI", `Pctl 2Y (${pb})`, `Pctl 3Y (${pb})`, `Pctl 5Y (${pb})`, "Weeks used 2Y", "Weeks used 3Y", "Weeks used 5Y"];
  const rows = t.items.map(({ m, row, p }) => [S.idx.meta.label, m.group, m.name, repL, catL, m.rows[t.rep].date, row.long, row.short, row.total, row.pl, row.ps,
    row.net, row.noi, row.chg, row.pchg, row.coi, ...p, ...(row.pn || [null, null, null])]);
  download(csvText(head, rows), `cot_${S.mode}_${t.rep}_${t.cat}_${t.basis}_${S.idx.meta.last_report_date}.csv`);
}

// columns shared by the PNG and Excel exports: heat = share/percentile colors, tint = sign colors
const XCOLS = [
  { label: "Market", get: (r) => r.m.name, w: 230, xw: 30, left: true },
  { label: "Long", get: (r) => r.row.long, w: 96, xw: 12, f: (v) => fmt(v), nf: "#,##0" },
  { label: "Short", get: (r) => r.row.short, w: 96, xw: 12, f: (v) => fmt(v), nf: "#,##0" },
  { label: "Total", get: (r) => r.row.total, w: 96, xw: 12, f: (v) => fmt(v), nf: "#,##0" },
  { label: "% Long", get: (r) => r.row.pl, w: 70, xw: 9, f: (v) => fmt(v) + "%", nf: '0"%"', color: (v) => heatInfo(v) },
  { label: "% Short", get: (r) => r.row.ps, w: 70, xw: 9, f: (v) => fmt(v) + "%", nf: '0"%"', color: (v) => heatInfo(v == null ? null : 100 - v) },
  { label: "Net", get: (r) => r.row.net, w: 100, xw: 12, f: (v) => fmt(v), nf: "#,##0", color: tintInfo, sep: true },
  { label: "Net % OI", get: (r) => r.row.noi, w: 80, xw: 10, f: (v) => fmt(v, 1) + "%", nf: '0.0"%"' },
  { label: "Δ Net (week)", get: (r) => r.row.chg, w: 100, xw: 13, f: (v) => fmt(v), nf: "#,##0", color: tintInfo },
  { label: "% Chg", get: (r) => r.row.pchg, w: 72, xw: 9, f: (v) => v == null ? "–" : fmt(v) + "%", nf: '0"%"', color: null, tintFrom: (r) => r.row.chg },
  { label: "Pctl 2Y", get: (r) => r.p[0], w: 66, xw: 9, f: pctTxt, nf: "0", color: heatInfo, sep: true },
  { label: "Pctl 3Y", get: (r) => r.p[1], w: 66, xw: 9, f: pctTxt, nf: "0", color: heatInfo },
  { label: "Pctl 5Y", get: (r) => r.p[2], w: 66, xw: 9, f: pctTxt, nf: "0", color: heatInfo },
];
const xcolor = (c, r, v) => c.color ? c.color(v) : c.tintFrom ? tintInfo(c.tintFrom(r)) : null;

async function exportTableImage() {
  const { t, repL, catL, pb } = tableMeta(); if (!t.items.length) return;
  const sc = 2, padX = 20, titleH = 74, headH = 34, rowH = 28, grpH = 28, footH = 38;
  const W = padX * 2 + XCOLS.reduce((a, c) => a + c.w, 0);
  const H = titleH + headH + t.groups.reduce((a, [, items]) => a + grpH + items.length * rowH, 0) + footH + 6;
  const cv = document.createElement("canvas"); cv.width = W * sc; cv.height = H * sc;
  const g = cv.getContext("2d"); g.scale(sc, sc);
  const F = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, "#0f3f91"); grad.addColorStop(1, "#1d6fe8");
  g.fillStyle = grad; g.fillRect(0, 0, W, titleH - 6);
  g.fillStyle = "#fff"; g.textBaseline = "middle"; g.textAlign = "left";
  g.font = `bold 21px ${F}`; g.fillText("Commitments of Traders", padX, 28);
  g.font = `13px ${F}`; g.fillStyle = "rgba(255,255,255,.88)";
  g.fillText(`${S.idx.meta.label} · ${repL} · ${catL} · percentiles on ${pb}`, padX, 51);
  g.textAlign = "right"; g.font = `600 14px ${F}`; g.fillStyle = "#fff"; g.fillText(`Report date ${S.idx.meta.last_report_date}`, W - padX, 28);
  let y = titleH;
  const xs = []; let x0 = padX; for (const c of XCOLS) { xs.push(x0); x0 += c.w; }
  g.fillStyle = "#e6f0fd"; g.fillRect(padX, y, W - 2 * padX, headH);
  g.font = `600 13px ${F}`; g.fillStyle = "#0f3f91";
  XCOLS.forEach((c, i) => { g.textAlign = c.left ? "left" : "center"; g.fillText(c.label, c.left ? xs[i] + 10 : xs[i] + c.w / 2, y + headH / 2); });
  y += headH;
  const vline = (yy, hh) => XCOLS.forEach((c, i) => { if (c.sep) { g.fillStyle = "#d8e0ee"; g.fillRect(xs[i], yy, 2, hh); } });
  for (const [name, items] of t.groups) {
    g.fillStyle = "#e6f0fd"; g.fillRect(padX, y, W - 2 * padX, grpH);
    g.font = `bold 13px ${F}`; g.fillStyle = "#0f3f91"; g.textAlign = "left"; g.fillText(`${name}`, padX + 10, y + grpH / 2);
    y += grpH;
    for (const r of items) {
      XCOLS.forEach((c, i) => {
        const v = c.get(r), col = xcolor(c, r, v);
        if (col) { g.fillStyle = rgba(col); g.fillRect(xs[i], y, c.w, rowH); }
        g.font = c.left ? `600 13px ${F}` : `13px ${F}`;
        g.fillStyle = col && col.fg ? col.fg : "#14213d"; g.textAlign = c.left ? "left" : "center";
        g.fillText(c.left ? String(v) : (c.f ? c.f(v) : v), c.left ? xs[i] + 10 : xs[i] + c.w / 2, y + rowH / 2 + 1);
      });
      g.fillStyle = "#eef2f9"; g.fillRect(padX, y + rowH - 1, W - 2 * padX, 1);
      vline(y, rowH);
      y += rowH;
    }
  }
  g.font = `12px ${F}`; g.fillStyle = "#5b6b86"; g.textAlign = "left"; g.textBaseline = "middle";
  g.fillText(`Source: CFTC Commitments of Traders (${S.idx.meta.label}). Positions as of Tuesday.`, padX, y + 22);
  if (IMAGE_FOOTER_RIGHT) { g.textAlign = "right"; g.fillText(IMAGE_FOOTER_RIGHT, W - padX, y + 22); }
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  download(blob, `cot_${S.mode}_${t.rep}_${t.cat}_${S.idx.meta.last_report_date}.png`);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}
async function exportTableXlsx() {
  const { t, repL, catL, pb } = tableMeta(); if (!t.items.length) return;
  if (!window.ExcelJS) await loadScript("vendor/exceljs.min.js");
  const wb = new ExcelJS.Workbook(); wb.creator = "COT Monitor"; wb.created = new Date();
  const ws = wb.addWorksheet("COT", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  const n = XCOLS.length, fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  ws.columns = XCOLS.map((c) => ({ width: c.xw }));
  ws.mergeCells(1, 1, 1, n); Object.assign(ws.getCell(1, 1), { value: "Commitments of Traders" });
  ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FF0F3F91" } };
  ws.mergeCells(2, 1, 2, n); ws.getCell(2, 1).value = `${S.idx.meta.label} · ${repL} · ${catL} · percentiles on ${pb} · report date ${S.idx.meta.last_report_date}`;
  ws.getCell(2, 1).font = { size: 11, color: { argb: "FF5B6B86" } };
  const hr = ws.getRow(3); hr.height = 22;
  XCOLS.forEach((c, i) => {
    const cell = hr.getCell(i + 1); cell.value = c.label; cell.fill = fill("FFE6F0FD");
    cell.font = { bold: true, color: { argb: "FF0F3F91" } }; cell.alignment = { horizontal: c.left ? "left" : "center", vertical: "middle" };
  });
  let rowNo = 4;
  for (const [name, items] of t.groups) {
    ws.mergeCells(rowNo, 1, rowNo, n);
    const gc = ws.getCell(rowNo, 1); gc.value = `${name} (${items.length})`; gc.fill = fill("FFE6F0FD"); gc.font = { bold: true, color: { argb: "FF0F3F91" } };
    rowNo++;
    for (const r of items) {
      const row = ws.getRow(rowNo);
      XCOLS.forEach((c, i) => {
        const v = c.get(r), cell = row.getCell(i + 1);
        cell.value = v == null ? null : v;
        if (c.nf) cell.numFmt = c.nf;
        cell.alignment = { horizontal: c.left ? "left" : "center" };
        const col = xcolor(c, r, v);
        if (c.left) cell.font = { bold: true };
        if (col) { cell.fill = fill(hex(col)); if (col.fg) cell.font = { color: { argb: "FFFFFFFF" } }; }
        cell.border = { bottom: { style: "thin", color: { argb: "FFEEF2F9" } } };
      });
      rowNo++;
    }
  }
  rowNo++;
  ws.mergeCells(rowNo, 1, rowNo, n); ws.getCell(rowNo, 1).value = `Source: CFTC Commitments of Traders (${S.idx.meta.label}). Positions as of Tuesday.`;
  ws.getCell(rowNo, 1).font = { size: 10, color: { argb: "FF5B6B86" } };
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `cot_${S.mode}_${t.rep}_${t.cat}_${S.idx.meta.last_report_date}.xlsx`);
}

async function exportChart(w, fmtName) {
  const c = S.cur, gd = $(`#p${w}`), title = $(`#h${w}`).textContent;
  const name = `cot_${c.mode}_${c.m.key}_${c.rep}_${c.cat}_${c.metric}_${c.unit}_${w}y`;
  if (fmtName === "csv") {
    const from = cutoff(c.R.dates[c.R.dates.length - 1], w);
    const idx = c.R.dates.map((d, i) => i).filter((i) => c.R.dates[i] >= from);
    const sfx = c.unit === "oi" ? " (% of OI)" : "";
    const head = ["Date", ...c.lines.map((l) => l.name + sfx), "Open interest"];
    download(csvText(head, idx.map((i) => [c.R.dates[i], ...c.lines.map((l) => l.vals[i] == null ? null : Math.round(l.vals[i] * 100) / 100), c.R.oi[i]])), name + ".csv");
    return;
  }
  const sub = `Source: CFTC Commitments of Traders (${c.label}) · report date ${S.idx.meta.last_report_date}`;
  const m0 = gd.layout.margin, orig = { l: m0.l, r: m0.r, t: m0.t, b: m0.b };
  const W = 1400, H = 700, top = gd.layout.showlegend ? 128 : 112;   // room for padding, title, subtitle (and legend)
  await Plotly.relayout(gd, { "title.text": `<b>${esc(title)}</b><br><sup>${esc(sub)}</sup>`, "title.xref": "container", "title.x": 48 / W, "title.xanchor": "left",
    "title.yref": "container", "title.y": 1 - 40 / H, "title.yanchor": "top",
    "margin.l": 100, "margin.r": 80, "margin.b": 70, "margin.t": top });
  try { await Plotly.downloadImage(gd, { format: fmtName, filename: name, width: W, height: H, scale: 2 }); }
  finally { await Plotly.relayout(gd, { "title.text": "", "margin.l": orig.l, "margin.r": orig.r, "margin.t": orig.t, "margin.b": orig.b }); }
}

// ---------- tooltips (hover on desktop, touch and hold on phones) and guide
const tip = $("#tip");
let lpTimer = null, lpFired = false;
function showTip(el) {
  tip.textContent = el.dataset.tip; tip.classList.add("on");
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let top = r.bottom + 8; if (top + h > window.innerHeight - 8) top = r.top - h - 8;
  tip.style.left = left + "px"; tip.style.top = Math.max(8, top) + "px";
}
const canHover = () => window.matchMedia("(hover: hover)").matches;
document.addEventListener("mouseover", (e) => { if (!canHover()) return; const el = e.target.closest("[data-tip]"); if (el) showTip(el); else tip.classList.remove("on"); });
document.addEventListener("focusin", (e) => { if (!canHover()) return; const el = e.target.closest("[data-tip]"); if (el) showTip(el); });
document.addEventListener("touchstart", (e) => {
  const el = e.target.closest("[data-tip]"); if (!el) return;
  lpFired = false; clearTimeout(lpTimer);
  lpTimer = setTimeout(() => { lpFired = true; showTip(el); setTimeout(() => tip.classList.remove("on"), 3000); }, 450);
}, { passive: true });
for (const ev of ["touchend", "touchmove", "touchcancel"]) document.addEventListener(ev, () => clearTimeout(lpTimer), { passive: true });
document.addEventListener("click", (e) => { if (lpFired) { e.preventDefault(); e.stopImmediatePropagation(); lpFired = false; } }, true);
for (const ev of ["focusout", "scroll", "click"]) document.addEventListener(ev, () => { if (!lpFired) tip.classList.remove("on"); }, true);
document.querySelectorAll("[data-open-guide]").forEach((b) => b.addEventListener("click", () => $("#guide").showModal()));
$("#panels").addEventListener("change", (e) => {
  const sel = e.target.closest("select.exp"); if (!sel || !sel.value) return;
  const f = sel.value; sel.value = "";
  exportChart(Number(sel.dataset.w), f).catch((err) => alert("Export failed: " + err.message));
});
$("#guide-close").onclick = () => $("#guide").close();
$("#guide").addEventListener("click", (e) => { if (e.target.id === "guide") e.target.close(); });

wire();
init().catch((e) => { $("#meta").textContent = "Could not load data"; showFatal(e, () => init().catch((er) => showFatal(er, () => location.reload()))); });
