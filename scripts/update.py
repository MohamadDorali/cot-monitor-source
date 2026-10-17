"""Weekly COT updater (Futures Only).

CFTC Public Reporting API -> tidy table -> percentile stats -> static JSON for the site.
Usage:
  python scripts/update.py             # normal weekly run (does nothing if no new report)
  python scripts/update.py --force     # rebuild anyway
  python scripts/update.py --demo      # synthetic data, to preview the site offline
  python scripts/update.py --inspect   # print the real column names of the 3 datasets
  python scripts/update.py --find gold # look up contract codes by market name
"""
import argparse, json, math, os, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from markets import MARKETS

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
BASE = "https://publicreporting.cftc.gov/resource/{}.json"
DATASETS = {"legacy": "6dca-aqww", "disagg": "72hh-3qpy", "tff": "gpe5-46if"}  # all Futures Only
WINDOWS = (2, 3, 5)
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


# ---------------------------------------------------------------- fetching
def _get(url, params):
    headers = {}
    if os.environ.get("SOCRATA_APP_TOKEN"):
        headers["X-App-Token"] = os.environ["SOCRATA_APP_TOKEN"]
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=90)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 4:
                raise
            print(f"  retry {attempt + 1} after error: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


def fetch_report(report, codes, since):
    url = BASE.format(DATASETS[report])
    code_list = ",".join(f"'{c}'" for c in codes)
    where = (f"cftc_contract_market_code in({code_list}) "
             f"AND report_date_as_yyyy_mm_dd >= '{since}T00:00:00.000'")
    rows, offset = [], 0
    while True:
        batch = _get(url, {"$where": where, "$limit": PAGE, "$offset": offset,
                           "$order": "report_date_as_yyyy_mm_dd,cftc_contract_market_code"})
        rows += batch
        if len(batch) < PAGE:
            break
        offset += PAGE
    return pd.DataFrame(rows)


def _norm(s):
    return s.replace("_", "").lower()


def find_col(columns, base):
    """CFTC column names are inconsistent (double underscores, optional _all suffix)."""
    lookup = {_norm(c): c for c in columns}
    for cand in (_norm(base), _norm(base) + "all"):
        if cand in lookup:
            return lookup[cand]
    raise KeyError(base)


def tidy_report(raw, report, markets):
    """Raw API rows -> long table: date, key, cat, long, short, oi."""
    if raw.empty:
        return pd.DataFrame(columns=["date", "key", "cat", "long", "short", "oi"])
    code_to_key = {m["code"]: m["key"] for m in markets}
    base = pd.DataFrame({
        "date": pd.to_datetime(raw[find_col(raw.columns, "report_date_as_yyyy_mm_dd")]).dt.normalize(),
        "key": raw[find_col(raw.columns, "cftc_contract_market_code")].map(code_to_key),
        "oi": pd.to_numeric(raw[find_col(raw.columns, "open_interest_all")], errors="coerce"),
    })
    parts = []
    for cat, (_, lcol, scol) in REPORTS[report]["cats"].items():
        try:
            lc, sc = find_col(raw.columns, lcol), find_col(raw.columns, scol)
        except KeyError as e:
            print(f"  WARNING {report}: column {e} not found, category '{cat}' skipped "
                  f"(run --inspect to see real names)", file=sys.stderr)
            continue
        p = base.copy()
        p["cat"] = cat
        p["long"] = pd.to_numeric(raw[lc], errors="coerce")
        p["short"] = pd.to_numeric(raw[sc], errors="coerce")
        parts.append(p)
    df = pd.concat(parts, ignore_index=True).dropna(subset=["key", "long", "short"])
    return df.drop_duplicates(["date", "key", "cat"]).sort_values(["key", "cat", "date"])


def demo_tidy(report, markets):
    rng = np.random.default_rng(abs(hash(report)) % 2**32)
    dates = pd.date_range(end=pd.Timestamp.today().normalize() - pd.Timedelta(days=2), periods=270, freq="W-TUE")
    parts = []
    for mk in markets:
        scale = rng.integers(20_000, 300_000)
        oi = scale * 4 * (1 + 0.15 * np.sin(np.arange(len(dates)) / 20) + np.linspace(0, 0.3, len(dates)))
        for cat in REPORTS[report]["cats"]:
            walk = np.cumsum(rng.normal(0, scale * 0.03, len(dates))) + rng.normal(0, scale * 0.1)
            base = scale * rng.uniform(0.3, 1.0)
            long_ = np.clip(base + walk + scale * 0.5, 100, None)
            short_ = np.clip(base - walk * 0.6 + scale * 0.5, 100, None)
            parts.append(pd.DataFrame({"date": dates, "key": mk["key"], "cat": cat,
                                       "long": long_.round(), "short": short_.round(), "oi": oi.round()}))
    return pd.concat(parts, ignore_index=True)


# ---------------------------------------------------------------- statistics
def num(x, nd=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, nd) if math.isfinite(x) else None


def pct_rank(s, years):
    """Share of weeks in the window (incl. current) at or below the current value, 0-100.
    The site's app.js uses the identical definition."""
    s = s.dropna()
    if s.empty:
        return None
    w = s[s.index >= s.index[-1] - pd.DateOffset(years=years)]
    if len(w) < 0.8 * 52 * years:      # not enough history for this window
        return None
    return num(100 * (w.values <= s.iloc[-1]).mean(), 1)


def row_stats(g):
    g = g.sort_values("date")
    net = pd.Series((g["long"] - g["short"]).values, index=g["date"].values)
    net_oi = pd.Series((100 * net.values / g["oi"].where(g["oi"] > 0).values), index=net.index)
    last, prev = g.iloc[-1], (g.iloc[-2] if len(g) > 1 else None)
    total = last["long"] + last["short"]
    chg = net.iloc[-1] - net.iloc[-2] if prev is not None else None
    return {
        "long": num(last["long"], 0), "short": num(last["short"], 0), "total": num(total, 0),
        "pl": num(100 * last["long"] / total, 1) if total else None,
        "ps": num(100 * last["short"] / total, 1) if total else None,
        "net": num(net.iloc[-1], 0), "chg": num(chg, 0),
        "pchg": num(100 * chg / abs(net.iloc[-2]), 1) if chg is not None and net.iloc[-2] else None,
        "noi": num(net_oi.iloc[-1], 1),
        "p": [pct_rank(net, y) for y in WINDOWS],
        "po": [pct_rank(net_oi, y) for y in WINDOWS],
    }


def build(tidy_by_report):
    index_markets, last_dates = [], []
    OUT.joinpath("series").mkdir(parents=True, exist_ok=True)
    for mk in MARKETS:
        rows, series = {}, {}
        for rep in ("legacy", mk["report"]):
            df = tidy_by_report[rep]
            df = df[df["key"] == mk["key"]]
            if df.empty:
                print(f"  no data: {mk['name']} ({mk['code']}) in {rep}", file=sys.stderr)
                continue
            cats = {c: row_stats(g) for c, g in df.groupby("cat")}
            order = [c for c in REPORTS[rep]["cats"] if c in cats]
            rows[rep] = {"date": df["date"].max().strftime("%Y-%m-%d"), "cats": {c: cats[c] for c in order}}
            last_dates.append(df["date"].max())
            dates = sorted(df["date"].unique())
            oi = df.drop_duplicates("date").set_index("date")["oi"].reindex(dates)
            s = {"dates": [pd.Timestamp(d).strftime("%Y-%m-%d") for d in dates],
                 "oi": [num(v, 0) for v in oi], "cats": {}}
            for c in order:
                gc = df[df["cat"] == c].set_index("date").reindex(dates)
                s["cats"][c] = {"long": [num(v, 0) for v in gc["long"]], "short": [num(v, 0) for v in gc["short"]]}
            series[rep] = s
        if not rows:
            continue
        index_markets.append({"key": mk["key"], "name": mk["name"], "group": mk["group"],
                              "special": mk["report"], "rows": rows})
        dump({"name": mk["name"], "reports": series}, OUT / "series" / f"{mk['key']}.json")
    if not index_markets:
        sys.exit("No data for any market. Check --inspect / --find.")
    index = {
        "meta": {"last_report_date": max(last_dates).strftime("%Y-%m-%d"),
                 "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "windows": list(WINDOWS), "futures_only": True},
        "reports": {r: {"label": c["label"], "cats": [{"key": k, "label": v[0]} for k, v in c["cats"].items()]}
                    for r, c in REPORTS.items()},
        "markets": index_markets,
    }
    dump(index, OUT / "index.json")
    print(f"Wrote {len(index_markets)} markets, report date {index['meta']['last_report_date']}")


def dump(obj, path):
    path.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False), encoding="utf-8")


# ---------------------------------------------------------------- helpers / CLI
def inspect():
    for rep, ds in DATASETS.items():
        rows = _get(BASE.format(ds), {"$limit": 1})
        print(f"\n== {rep} ({ds}) ==")
        print(", ".join(sorted(rows[0].keys())))


def find(text):
    for rep, ds in DATASETS.items():
        rows = _get(BASE.format(ds), {
            "$select": "cftc_contract_market_code,market_and_exchange_names",
            "$group": "cftc_contract_market_code,market_and_exchange_names",
            "$where": f"upper(market_and_exchange_names) like '%{text.upper()}%'", "$limit": 50})
        print(f"\n== {rep} ==")
        for r in rows:
            print(r["cftc_contract_market_code"], "|", r["market_and_exchange_names"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--find")
    a = ap.parse_args()
    if a.inspect:
        return inspect()
    if a.find:
        return find(a.find)

    since = (date.today() - timedelta(days=5 * 366 + 21)).isoformat()
    tidy = {}
    for rep in REPORTS:
        mk = [m for m in MARKETS if rep == "legacy" or m["report"] == rep]
        print(f"{rep}: {len(mk)} markets")
        tidy[rep] = demo_tidy(rep, mk) if a.demo else tidy_report(fetch_report(rep, [m["code"] for m in mk], since), rep, mk)

    newest = max(df["date"].max() for df in tidy.values() if not df.empty).strftime("%Y-%m-%d")
    idx_path = OUT / "index.json"
    if idx_path.exists() and not (a.force or a.demo):
        old = json.loads(idx_path.read_text(encoding="utf-8"))["meta"]["last_report_date"]
        if old == newest:
            print(f"No new report (still {old}). Nothing to do.")
            return
    build(tidy)


if __name__ == "__main__":
    main()
