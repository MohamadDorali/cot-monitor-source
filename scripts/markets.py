"""Curated names and groups for well-known contracts, keyed by CFTC contract market code.

All other contracts that appear in the CFTC reports are discovered automatically (see update.py) and named/grouped by
groups.py. Use this table to fix a name or group, or to pin the display order: curated markets are listed first within
their group, in the order below.
Run `python scripts/update.py --find gold` to look up a contract code."""

OVERRIDES = {
    # Currencies
    "099741": ("EUR", "Currencies"), "097741": ("JPY", "Currencies"), "096742": ("GBP", "Currencies"),
    "092741": ("CHF", "Currencies"), "090741": ("CAD", "Currencies"), "232741": ("AUD", "Currencies"),
    "112741": ("NZD", "Currencies"), "095741": ("MXN", "Currencies"), "102741": ("BRL", "Currencies"),
    "122741": ("ZAR", "Currencies"), "098662": ("US Dollar Index", "Currencies"),
    # Crypto
    "133741": ("Bitcoin (CME)", "Crypto"), "146021": ("Ether (CME)", "Crypto"),
    # Equity indices
    "13874A": ("S&P 500", "Equity Indices"), "209742": ("Nasdaq 100", "Equity Indices"),
    "124603": ("Dow Jones", "Equity Indices"), "239742": ("Russell 2000", "Equity Indices"),
    "1170E1": ("VIX", "Equity Indices"),
    # Rates
    "042601": ("UST 2Y", "Rates"), "044601": ("UST 5Y", "Rates"), "043602": ("UST 10Y", "Rates"),
    "020601": ("UST Bond", "Rates"), "020604": ("Ultra UST Bond", "Rates"), "043607": ("Ultra UST 10Y", "Rates"),
    "045601": ("Fed Funds 30D", "Rates"), "134741": ("SOFR 3M", "Rates"),
    # Metals
    "088691": ("Gold", "Metals"), "084691": ("Silver", "Metals"), "085692": ("Copper", "Metals"),
    "076651": ("Platinum", "Metals"), "075651": ("Palladium", "Metals"),
    # Energy
    "067651": ("WTI Crude Oil", "Energy"), "06765T": ("Brent Crude", "Energy"), "023651": ("Natural Gas", "Natural Gas"),
    "022651": ("Heating Oil (ULSD)", "Energy"), "111659": ("RBOB Gasoline", "Energy"),
    # Grains
    "002602": ("Corn", "Grains"), "005602": ("Soybeans", "Grains"), "007601": ("Soybean Oil", "Grains"),
    "026603": ("Soybean Meal", "Grains"), "001602": ("Wheat SRW (Chicago)", "Grains"), "001612": ("Wheat HRW (KC)", "Grains"),
    "001626": ("Spring Wheat (MGEX)", "Grains"), "004603": ("Oats", "Grains"), "039601": ("Rough Rice", "Grains"),
    # Softs
    "083731": ("Coffee", "Softs"), "080732": ("Sugar #11", "Softs"), "033661": ("Cotton", "Softs"),
    "073732": ("Cocoa", "Softs"), "040701": ("Orange Juice", "Softs"),
    # Livestock
    "057642": ("Live Cattle", "Livestock"), "061641": ("Feeder Cattle", "Livestock"), "054642": ("Lean Hogs", "Livestock"),
}
CURATED_ORDER = {code: i for i, code in enumerate(OVERRIDES)}


# Search aliases (tickers and common names) so people can find markets the way they usually call them.
ALIASES = {
    "099741": "6e eurusd euro fx", "097741": "6j usdjpy yen", "096742": "6b gbpusd pound sterling cable",
    "092741": "6s usdchf franc swissy", "090741": "6c usdcad loonie", "232741": "6a audusd aussie",
    "112741": "6n nzdusd kiwi", "095741": "6m usdmxn peso", "102741": "6l usdbrl real", "122741": "6z usdzar rand",
    "098662": "dxy usdx dollar index", "133741": "btc bitcoin crypto", "146021": "eth ethereum ether crypto",
    "13874A": "es spx sp500 s&p e-mini", "209742": "nq ndx nasdaq100", "124603": "ym djia us30 dow",
    "239742": "rty rut russell2000 small caps", "1170E1": "vx volatility",
    "042601": "zt 2 year note treasury", "044601": "zf 5 year note treasury", "043602": "zn 10 year note treasury ten",
    "020601": "zb long bond treasury", "020604": "ub ultra bond treasury", "043607": "tn ultra 10 year treasury",
    "045601": "zq fed funds", "134741": "sr3 sofr",
    "088691": "gc xau gold", "084691": "si xag silver", "085692": "hg copper", "076651": "pl xpt platinum",
    "075651": "pa xpd palladium",
    "067651": "cl wti crude oil", "06765T": "brent crude oil", "023651": "ng nat gas henry hub",
    "022651": "ho diesel ulsd heating oil", "111659": "rb gasoline rbob",
    "002602": "zc maize corn", "005602": "zs beans soybeans", "007601": "zl bean oil soybean oil",
    "026603": "zm soybean meal", "001602": "zw chicago wheat", "001612": "ke kc wheat kansas hrw",
    "001626": "mwe spring wheat minneapolis", "004603": "zo oats", "039601": "zr rice",
    "083731": "kc arabica coffee", "080732": "sb sugar", "033661": "ct cotton", "073732": "cc cocoa",
    "040701": "oj fcoj orange juice", "057642": "le live cattle", "061641": "gf feeder cattle", "054642": "he lean hogs",
}
