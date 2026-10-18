"""Weekly COT updater (Version 2): Futures Only and Futures + Options Combined.

CFTC Public Reporting API -> tidy tables -> percentile stats -> static JSON for the site.
Every contract found in the reports is included automatically (no hand-maintained contract list).

Usage:
  python scripts/update.py              # normal weekly run (skips a mode if it has no new report)
  python scripts/update.py --force      # rebuild anyway
  python scripts/update.py --mode futures    # only one mode (futures | combined)
  python scripts/update.py --demo       # synthetic data, to preview the site offline
  python scripts/update.py --inspect    # print real column names of every dataset
  python scripts/update.py --datasets   # list the CFTC datasets (use if a dataset id changes)
  python scripts/update.py --find gold  # look up contract codes by market name
"""
import argparse, json, math, os, re, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from groups import GROUP_ORDER, classify, clean_name, split_name
from markets import ALIASES, CURATED_ORDER, OVERRIDES

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
BASE = "https://publicreporting.cftc.gov/resource/{}.json"
MODES = {
    "futures": {"label": "Futures Only",
                "datasets": {"legacy": "6dca-aqww", "disagg": "72hh-3qpy", "tff": "gpe5-46if"}},
    "combined": {"label": "Futures + Options",
                 "datasets": {"legacy": "jun7-fc8e", "disagg": "kh3c-gbw2", "tff": "yw9f-hn96"}},
}
WINDOWS = (2, 3, 5)
MIN_WEEKS = 26        # a percentile is shown once a window has at least this many weeks of data
ACTIVE_DAYS = 84      # contracts without a report in the last 12 weeks are treated as discontinued
MIN_HISTORY = 12      # ignore contracts with fewer reports than this
PAGE = 50000

# category key -> (label, long column base name, short column base name)
REPORTS = {
    "legacy": {"label": "Legacy", "cats": {
        "noncomm": ("Non-Commercial", "noncomm_positions_long", "noncomm_positions_short"),
        "comm": ("Commercial", "comm_positions_long", "comm_positions_short"),
        "nonrept": ("Non-Reportable", "nonrept_positions_long", "nonrept_positions_short"),
    }},
    "disagg": {"label": "Disaggregated", "cats": {
        "m_money": ("Managed Money", "m_money_positions_long", "m_money_positions_short"),
        "prod_merc": ("Producer/Merchant", "prod_merc_positions_long", "prod_merc_positions_short"),
        "swap": ("Swap Dealers", "swap_positions_long", "swap_positions_short"),
        "other_rept": ("Other Reportables", "other_rept_positions_long", "other_rept_positions_short"),
        "nonrept": ("Non-Reportable", "nonrept_positions_long", "nonrept_positions_short"),
    }},
    "tff": {"label": "TFF (Financials)", "cats": {
        "lev_money": ("Leveraged Funds", "lev_money_positions_long", "lev_money_positions_short"),
        "asset_mgr": ("Asset Manager", "asset_mgr_positions_long", "asset_mgr_positions_short"),
        "dealer": ("Dealer/Intermediary", "dealer_positions_long", "dealer_positions_short"),
        "other_rept": ("Other Reportables", "other_rept_positions_long", "other_rept_positions_short"),
        "nonrept": ("Non-Reportable", "nonrept_positions_long", "nonrept_positions_short"),
    }},
}
TIDY_COLS = ["date", "code", "cat", "long", "short", "oi"]
META_COLS = ["name", "subgroup", "group"]


# ---------------------------------------------------------------- fetching
def _get(url, params):
    headers = {}
    if os.environ.get("SOCRATA_APP_TOKEN"):
        headers["X-App-Token"] = os.environ["SOCRATA_APP_TOKEN"]
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=120)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 4:
                raise
            print(f"  retry {attempt + 1} after error: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


def _norm(s):
    return s.replace("_", "").lower()


def find_col(columns, base):
    """CFTC column names are inconsistent (double underscores, optional _all suffix)."""
    lookup = {_norm(c): c for c in columns}
    for cand in (_norm(base), _norm(base) + "all"):
        if cand in lookup:
            return lookup[cand]
    raise KeyError(base)


def find_opt(columns, base):
    try:
        return find_col(columns, base)
    except KeyError:
        return None


def fetch_report(mode, report, since):
    """Download one dataset for the last ~5 years, only the columns we need."""
    dataset = MODES[mode]["datasets"][report]
    url = BASE.format(dataset)
    try:
        sample = _get(url, {"$limit": 1})
    except requests.RequestException as e:
        raise RuntimeError(f"dataset {dataset} ({mode}/{report}) could not be read: {e}. "
                           f"Run `python scripts/update.py --datasets` to check the dataset ids.")
    if not sample:
        raise RuntimeError(f"dataset {dataset} ({mode}/{report}) returned no rows")
    cols = list(sample[0].keys())
    date_c = find_col(cols, "report_date_as_yyyy_mm_dd")
    wanted = [date_c, find_col(cols, "cftc_contract_market_code"), find_col(cols, "open_interest_all")]
    for _, lcol, scol in REPORTS[report]["cats"].values():
        wanted += [c for c in (find_opt(cols, lcol), find_opt(cols, scol)) if c]
    wanted += [c for c in (find_opt(cols, b) for b in ("market_and_exchange_names", "commodity_name",
                                                       "commodity_subgroup_name", "commodity_group_name")) if c]
    select = ",".join(dict.fromkeys(wanted))
    rows, offset = [], 0
    while True:
        batch = _get(url, {"$select": select, "$where": f"{date_c} >= '{since}T00:00:00.000'",
                           "$order": f"{date_c},{find_col(cols, 'cftc_contract_market_code')}",
                           "$limit": PAGE, "$offset": offset})
        rows += batch
        if len(batch) < PAGE:
            break
        offset += PAGE
    print(f"  {mode}/{report}: {len(rows)} rows")
    return pd.DataFrame(rows)


def tidy_report(raw, report):
    """Raw API rows -> (tidy long table, per-contract metadata)."""
    if raw.empty:
        return pd.DataFrame(columns=TIDY_COLS), pd.DataFrame(columns=META_COLS)
    cols = raw.columns
    dates = pd.to_datetime(raw[find_col(cols, "report_date_as_yyyy_mm_dd")]).dt.normalize()
    codes = raw[find_col(cols, "cftc_contract_market_code")].astype(str).str.strip()
    oi = pd.to_numeric(raw[find_col(cols, "open_interest_all")], errors="coerce")
    base = pd.DataFrame({"date": dates, "code": codes, "oi": oi})
    parts = []
    for cat, (_, lcol, scol) in REPORTS[report]["cats"].items():
        try:
            lc, sc = find_col(cols, lcol), find_col(cols, scol)
        except KeyError as e:
            print(f"  WARNING {report}: column {e} not found, category '{cat}' skipped "
                  f"(run --inspect to see real names)", file=sys.stderr)
            continue
        p = base.copy()
        p["cat"] = cat
        p["long"] = pd.to_numeric(raw[lc], errors="coerce")
        p["short"] = pd.to_numeric(raw[sc], errors="coerce")
        parts.append(p)
    tidy = pd.concat(parts, ignore_index=True).dropna(subset=["long", "short"])
    tidy = tidy.drop_duplicates(["date", "code", "cat"]).sort_values(["code", "cat", "date"])[TIDY_COLS]

    def opt(base_name):
        c = find_opt(cols, base_name)
        return raw[c].fillna("").astype(str) if c else ""
    meta = pd.DataFrame({"date": dates, "code": codes, "name": opt("market_and_exchange_names"),
                         "subgroup": opt("commodity_subgroup_name"), "group": opt("commodity_group_name")})
    meta = meta.sort_values("date").drop_duplicates("code", keep="last").set_index("code")[META_COLS]
    return tidy, meta


def keep_active(tidy, meta):
    """Drop discontinued or very young contracts."""
    if tidy.empty:
        return tidy, meta
    newest = tidy["date"].max()
    last = tidy.groupby("code")["date"].max()
    n = tidy.groupby("code")["date"].nunique()
    ok = last[(last >= newest - pd.Timedelta(days=ACTIVE_DAYS)) & (n.reindex(last.index) >= MIN_HISTORY)].index
    return tidy[tidy["code"].isin(ok)], meta[meta.index.isin(ok)]


# ---------------------------------------------------------------- demo data
_DEMO_EXTRA = [  # code, raw name, report, subgroup, weeks of history, in legacy
    ("D001", "LITHIUM HYDROXIDE CIF CJK (FASTMARKETS) - CHICAGO MERCANTILE EXCHANGE", "disagg", "METALS AND OTHER", 105, True),
    ("D002", "COBALT METAL (FASTMARKETS) - COMMODITY EXCHANGE INC.", "disagg", "METALS AND OTHER", 180, True),
    ("D003", "ALUMINUM - COMMODITY EXCHANGE INC.", "disagg", "METALS AND OTHER", 270, True),
    ("D004", "IRON ORE 62% FE CFR CHINA (TSI) - NEW YORK MERCANTILE EXCHANGE", "disagg", "METALS AND OTHER", 270, True),
    ("D005", "NATURAL GAS - ICE FUTURES ENERGY DIV", "disagg", "NATURAL GAS AND PRODUCTS", 270, True),
    ("D006", "PJM WESTERN HUB REAL TIME OFF-PEAK - ICE FUTURES ENERGY DIV", "disagg", "ELECTRICITY", 270, True),
    ("D007", "MILK, Class III - CHICAGO MERCANTILE EXCHANGE", "disagg", "AGRICULTURE", 270, True),
    ("D008", "PALM OIL - ICE FUTURES U.S.", "disagg", "AGRICULTURE", 60, True),
    ("D009", "SOMETHING ODD - FOO EXCHANGE", "disagg", "OTHER", 270, True),
    ("T001", "SOLANA - CHICAGO MERCANTILE EXCHANGE", "tff", "", 40, True),
    ("T002", "MICRO BITCOIN - CHICAGO MERCANTILE EXCHANGE", "tff", "", 150, True),
    ("T003", "EURODOLLARS-3M - CHICAGO MERCANTILE EXCHANGE", "tff", "", 270, True),
    ("T004", "EURO FX/BRITISH POUND XRATE - CHICAGO MERCANTILE EXCHANGE", "tff", "", 270, True),
    ("T005", "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE", "tff", "", 270, True),
    ("T006", "NIKKEI STOCK AVERAGE YEN DENOM - CHICAGO MERCANTILE EXCHANGE", "tff", "", 270, True),
    ("L001", "S&P GSCI COMMODITY INDEX - CHICAGO MERCANTILE EXCHANGE", "", "", 270, True),
]


def demo_data(mode):
    rng = np.random.default_rng(7 if mode == "futures" else 11)
    today = pd.Timestamp.today().normalize()
    end = today - pd.Timedelta(days=(today.weekday() - 1) % 7)       # most recent Tuesday
    all_dates = pd.date_range(end=end, periods=270, freq="7D")
    fin = {"Currencies", "Crypto", "Equity Indices", "Rates"}
    uni = [(c, f"{n.upper()} - CHICAGO MERCANTILE EXCHANGE", "tff" if g in fin else "disagg", "", 270, True)
           for c, (n, g) in OVERRIDES.items()] + _DEMO_EXTRA
    tidy = {r: [] for r in REPORTS}
    meta = {r: {} for r in REPORTS}
    for code, raw_name, special, sub, weeks, in_legacy in uni:
        dates = all_dates[-weeks:]
        scale = int(rng.integers(5_000, 300_000)) * (1.2 if mode == "combined" else 1)
        oi = scale * 4 * (1 + 0.15 * np.sin(np.arange(weeks) / 20) + np.linspace(0, 0.3, weeks))
        for rep in [r for r in ("legacy", special) if r and (r != "legacy" or in_legacy)]:
            for cat in REPORTS[rep]["cats"]:
                walk = np.cumsum(rng.normal(0, scale * 0.03, weeks)) + rng.normal(0, scale * 0.1)
                base = scale * rng.uniform(0.3, 1.0)
                tidy[rep].append(pd.DataFrame({
                    "date": dates, "code": code, "cat": cat, "oi": oi.round(),
                    "long": np.clip(base + walk + scale * 0.5, 100, None).round(),
                    "short": np.clip(base - walk * 0.6 + scale * 0.5, 100, None).round()}))
            meta[rep][code] = {"name": raw_name, "subgroup": sub, "group": ""}
    return ({r: pd.concat(t, ignore_index=True)[TIDY_COLS] for r, t in tidy.items()},
            {r: pd.DataFrame.from_dict(m, orient="index", columns=META_COLS) for r, m in meta.items()})


# ---------------------------------------------------------------- statistics
def num(x, nd=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, nd) if math.isfinite(x) else None


def pct_rank(s, years):
    """(rank, weeks used). Rank = share of weeks in the window (incl. current) at or below the current value, 0-100.
    If the history is shorter than the window, all available data is used. app.js uses the identical definition."""
    s = s.dropna()
    if s.empty:
        return None, 0
    w = s[s.index >= s.index[-1] - pd.DateOffset(years=years)]
    if len(w) < MIN_WEEKS:
        return None, len(w)
    return num(100 * (w.values <= s.iloc[-1]).mean(), 1), len(w)


_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def sparkline(net, years=5, points=60):
    """Compact trend string: net position over the last 5 years, scaled to its own range, one base-36 digit per point."""
    w = net[net.index >= net.index[-1] - pd.DateOffset(years=years)]
    n = len(w)
    if n < 8:
        return None
    idx = np.unique(np.round(np.linspace(0, n - 1, min(points, n))).astype(int))
    v = w.values[idx].astype(float)
    lo, hi = v.min(), v.max()
    if hi == lo:
        return _B36[18] * len(v)
    return "".join(_B36[int(round(x))] for x in (v - lo) / (hi - lo) * 35)


def row_stats(g):
    g = g.sort_values("date")
    net = pd.Series((g["long"] - g["short"]).values, index=g["date"].values)
    net_oi = pd.Series((100 * net.values / g["oi"].where(g["oi"] > 0).values), index=net.index)
    last, prev = g.iloc[-1], (g.iloc[-2] if len(g) > 1 else None)
    total = last["long"] + last["short"]
    chg = net.iloc[-1] - net.iloc[-2] if prev is not None else None
    pn = [pct_rank(net, y) for y in WINDOWS]
    return {
        "long": num(last["long"], 0), "short": num(last["short"], 0), "total": num(total, 0),
        "pl": num(100 * last["long"] / total, 1) if total else None,
        "ps": num(100 * last["short"] / total, 1) if total else None,
        "net": num(net.iloc[-1], 0), "chg": num(chg, 0),
        "pchg": num(100 * chg / abs(net.iloc[-2]), 1) if chg is not None and net.iloc[-2] else None,
        "noi": num(net_oi.iloc[-1], 1),
        "coi": num(100 * chg / last["oi"], 2) if chg is not None and last["oi"] and last["oi"] > 0 else None,
        "sp": sparkline(net),
        "p": [r for r, _ in pn], "pn": [n for _, n in pn],
        "po": [pct_rank(net_oi, y)[0] for y in WINDOWS],
    }


# ---------------------------------------------------------------- building the site data
def make_markets(tidy, meta):
    """Combine the three reports into one list of markets with names and groups."""
    codes = set()
    for t in tidy.values():
        codes |= set(t["code"])
    out = []
    for code in codes:
        special = "disagg" if code in set(tidy["disagg"]["code"]) else "tff" if code in set(tidy["tff"]["code"]) else None
        mrow = next((meta[r].loc[code] for r in (special, "legacy") if r and code in meta[r].index), None)
        raw = mrow["name"] if mrow is not None else code
        base, exch = split_name(raw)
        ov = OVERRIDES.get(code)
        group = ov[1] if ov else classify(base, mrow["subgroup"] if mrow is not None else "",
                                           mrow["group"] if mrow is not None else "")
        out.append({"code": code, "key": re.sub(r"[^a-z0-9]", "", code.lower()), "special": special,
                    "name": ov[0] if ov else clean_name(base), "exch": exch, "group": group, "curated": ov is not None,
                    "aliases": ALIASES.get(code, "")})
    counts = pd.Series([m["name"].lower() for m in out]).value_counts()
    for m in out:                      # disambiguate identical names (e.g. the same product on two exchanges)
        if counts[m["name"].lower()] > 1 and not m["curated"] and m["exch"]:
            m["name"] += f" ({m['exch']})"
    counts = pd.Series([m["name"].lower() for m in out]).value_counts()
    for m in out:
        if counts[m["name"].lower()] > 1 and not m["curated"]:
            m["name"] += f" [{m['code']}]"
    out.sort(key=lambda m: (GROUP_ORDER.index(m["group"]), CURATED_ORDER.get(m["code"], 10_000), m["name"].lower()))
    return out


def dump(obj, path):
    path.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def build_mode(mode, tidy, meta):
    out = OUT / mode
    (out / "series").mkdir(parents=True, exist_ok=True)
    for f in (out / "series").glob("*.json"):          # remove files of contracts that no longer exist
        f.unlink()
    by_code = {r: dict(iter(t.groupby("code"))) for r, t in tidy.items()}
    index_markets, last_dates = [], []
    for mk in make_markets(tidy, meta):
        rows, series = {}, {}
        for rep in ("legacy", mk["special"]):
            df = by_code.get(rep, {}).get(mk["code"]) if rep else None
            if df is None or df.empty:
                continue
            cats = {c: row_stats(g) for c, g in df.groupby("cat")}
            order = [c for c in REPORTS[rep]["cats"] if c in cats]
            rows[rep] = {"date": df["date"].max().strftime("%Y-%m-%d"), "cats": {c: cats[c] for c in order}}
            last_dates.append(df["date"].max())
            dates = sorted(df["date"].unique())
            oi = df.drop_duplicates("date").set_index("date")["oi"].reindex(dates)
            s = {"dates": [pd.Timestamp(d).strftime("%Y-%m-%d") for d in dates], "oi": [num(v, 0) for v in oi], "cats": {}}
            for c in order:
                gc = df[df["cat"] == c].set_index("date").reindex(dates)
                s["cats"][c] = {"long": [num(v, 0) for v in gc["long"]], "short": [num(v, 0) for v in gc["short"]]}
            series[rep] = s
        if not rows:
            continue
        entry = {"key": mk["key"], "name": mk["name"], "group": mk["group"], "special": mk["special"],
                 "exch": mk["exch"], "rows": rows}
        if mk["curated"]:
            entry["f"] = 1                      # featured (main) market
        if mk["aliases"]:
            entry["al"] = mk["aliases"]
        index_markets.append(entry)
        dump({"name": mk["name"], "reports": series}, out / "series" / f"{mk['key']}.json")
    if not index_markets:
        raise RuntimeError("no markets with data")
    groups = [g for g in GROUP_ORDER if any(m["group"] == g for m in index_markets)]
    index = {
        "meta": {"mode": mode, "label": MODES[mode]["label"], "last_report_date": max(last_dates).strftime("%Y-%m-%d"),
                 "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "windows": list(WINDOWS), "min_weeks": MIN_WEEKS},
        "reports": {r: {"label": c["label"], "cats": [{"key": k, "label": v[0]} for k, v in c["cats"].items()]}
                    for r, c in REPORTS.items()},
        "groups": groups, "markets": index_markets,
    }
    dump(index, out / "index.json")
    lines = []
    for g in groups:
        lines.append(f"\n== {g} ==")
        lines += [f"{m['key']:<10} {m['name']}  [{m['exch']}]" for m in index_markets if m["group"] == g]
    (ROOT / f"markets_{mode}.txt").write_text("\n".join(lines), encoding="utf-8")    # full list for review
    other = [m["name"] for m in index_markets if m["group"] == "Other"]
    print(f"{mode}: wrote {len(index_markets)} markets, report date {index['meta']['last_report_date']}")
    print(f"  groups: " + ", ".join(f"{g} {sum(m['group'] == g for m in index_markets)}" for g in groups))
    if other:
        shown = ", ".join(other[:40]) + (f" ... (+{len(other) - 40} more)" if len(other) > 40 else "")
        print(f"  in 'Other' (move them in scripts/markets.py if wanted): {shown}")
    print(f"  full market list: markets_{mode}.txt")


def write_manifest():
    for old in (OUT / "index.json", OUT / "series"):      # leftovers of the Version 1 data layout
        if old.is_file():
            old.unlink()
        elif old.is_dir():
            for f in old.glob("*.json"):
                f.unlink()
            try:
                old.rmdir()
            except OSError:
                pass
    modes = [{"key": k, "label": v["label"]} for k, v in MODES.items() if (OUT / k / "index.json").exists()]
    if modes:
        dump({"modes": modes, "default": modes[0]["key"]}, OUT / "manifest.json")


# ---------------------------------------------------------------- helpers / CLI
def inspect():
    for mode, cfg in MODES.items():
        for rep, ds in cfg["datasets"].items():
            rows = _get(BASE.format(ds), {"$limit": 1})
            print(f"\n== {mode} / {rep} ({ds}) ==")
            print(", ".join(sorted(rows[0].keys())) if rows else "no rows")


def datasets():
    res = _get("https://api.us.socrata.com/api/catalog/v1",
               {"domains": "publicreporting.cftc.gov", "only": "datasets", "limit": 100})
    for r in res.get("results", []):
        print(r["resource"]["id"], "|", r["resource"]["name"])


def find(text):
    for mode, cfg in MODES.items():
        for rep, ds in cfg["datasets"].items():
            rows = _get(BASE.format(ds), {
                "$select": "cftc_contract_market_code,market_and_exchange_names",
                "$group": "cftc_contract_market_code,market_and_exchange_names",
                "$where": f"upper(market_and_exchange_names) like '%{text.upper()}%'", "$limit": 50})
            print(f"\n== {mode} / {rep} ==")
            for r in rows:
                print(r["cftc_contract_market_code"], "|", r["market_and_exchange_names"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--datasets", action="store_true")
    ap.add_argument("--find")
    ap.add_argument("--mode", choices=list(MODES))
    a = ap.parse_args()
    if a.inspect:
        return inspect()
    if a.datasets:
        return datasets()
    if a.find:
        return find(a.find)

    since = (date.today() - timedelta(days=5 * 366 + 21)).isoformat()
    failed = []
    for mode in ([a.mode] if a.mode else MODES):
        print(f"\n== {MODES[mode]['label']} ==")
        try:
            if a.demo:
                tidy, meta = demo_data(mode)
            else:
                tidy, meta = {}, {}
                for rep in REPORTS:
                    tidy[rep], meta[rep] = tidy_report(fetch_report(mode, rep, since), rep)
            for rep in REPORTS:
                tidy[rep], meta[rep] = keep_active(tidy[rep], meta[rep])
            newest = max(t["date"].max() for t in tidy.values() if not t.empty).strftime("%Y-%m-%d")
            idx_path = OUT / mode / "index.json"
            if idx_path.exists() and not (a.force or a.demo):
                old = json.loads(idx_path.read_text(encoding="utf-8"))["meta"]["last_report_date"]
                if old == newest:
                    print(f"No new report (still {old}). Nothing to do.")
                    continue
            build_mode(mode, tidy, meta)
        except Exception as e:  # keep going with the other mode, but fail the run at the end
            print(f"ERROR in mode '{mode}': {e}", file=sys.stderr)
            failed.append(mode)
    write_manifest()
    if failed:
        sys.exit(f"Failed modes: {', '.join(failed)}")


if __name__ == "__main__":
    main()
