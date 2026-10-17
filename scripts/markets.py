"""Market list. 'code' is the CFTC contract market code (stable, unlike market names).
'report' says which specialised report covers the market: disagg (commodities) or tff (financials).
Run `python scripts/update.py --find gold` to look up or verify a code."""

def m(key, name, code, group, report):
    return {"key": key, "name": name, "code": code, "group": group, "report": report}

MARKETS = [
    # Currencies (TFF)
    m("eur", "EUR", "099741", "Currencies", "tff"),
    m("jpy", "JPY", "097741", "Currencies", "tff"),
    m("gbp", "GBP", "096742", "Currencies", "tff"),
    m("chf", "CHF", "092741", "Currencies", "tff"),
    m("cad", "CAD", "090741", "Currencies", "tff"),
    m("aud", "AUD", "232741", "Currencies", "tff"),
    m("nzd", "NZD", "112741", "Currencies", "tff"),
    m("mxn", "MXN", "095741", "Currencies", "tff"),
    m("brl", "BRL", "102741", "Currencies", "tff"),
    m("zar", "ZAR", "122741", "Currencies", "tff"),
    m("dxy", "US Dollar Index", "098662", "Currencies", "tff"),
    # Crypto (TFF)
    m("btc", "Bitcoin (CME)", "133741", "Crypto", "tff"),
    m("eth", "Ether (CME)", "146021", "Crypto", "tff"),
    # Equity indices (TFF)
    m("sp500", "S&P 500", "13874A", "Equity Indices", "tff"),
    m("nasdaq", "Nasdaq 100", "209742", "Equity Indices", "tff"),
    m("dow", "Dow Jones", "124603", "Equity Indices", "tff"),
    m("russell", "Russell 2000", "239742", "Equity Indices", "tff"),
    m("vix", "VIX", "1170E1", "Equity Indices", "tff"),
    # Rates (TFF)
    m("ust2", "UST 2Y", "042601", "Rates", "tff"),
    m("ust5", "UST 5Y", "044601", "Rates", "tff"),
    m("ust10", "UST 10Y", "043602", "Rates", "tff"),
    m("ustbond", "UST Bond", "020601", "Rates", "tff"),
    m("ultra", "Ultra UST Bond", "020604", "Rates", "tff"),
    m("ultra10", "Ultra UST 10Y", "043607", "Rates", "tff"),
    m("fedfunds", "Fed Funds 30D", "045601", "Rates", "tff"),
    m("sofr3m", "SOFR 3M", "134741", "Rates", "tff"),
    # Metals (Disaggregated)
    m("gold", "Gold", "088691", "Metals", "disagg"),
    m("silver", "Silver", "084691", "Metals", "disagg"),
    m("copper", "Copper", "085692", "Metals", "disagg"),
    m("platinum", "Platinum", "076651", "Metals", "disagg"),
    m("palladium", "Palladium", "075651", "Metals", "disagg"),
    # Energy
    m("wti", "WTI Crude Oil", "067651", "Energy", "disagg"),
    m("brent", "Brent Crude", "06765T", "Energy", "disagg"),
    m("natgas", "Natural Gas", "023651", "Energy", "disagg"),
    m("heatoil", "Heating Oil (ULSD)", "022651", "Energy", "disagg"),
    m("rbob", "RBOB Gasoline", "111659", "Energy", "disagg"),
    # Grains & oilseeds
    m("corn", "Corn", "002602", "Grains", "disagg"),
    m("soy", "Soybeans", "005602", "Grains", "disagg"),
    m("soyoil", "Soybean Oil", "007601", "Grains", "disagg"),
    m("soymeal", "Soybean Meal", "026603", "Grains", "disagg"),
    m("wheat", "Wheat SRW (Chicago)", "001602", "Grains", "disagg"),
    m("hrw", "Wheat HRW (KC)", "001612", "Grains", "disagg"),
    m("spring", "Spring Wheat (MGEX)", "001626", "Grains", "disagg"),
    m("oats", "Oats", "004603", "Grains", "disagg"),
    m("rice", "Rough Rice", "039601", "Grains", "disagg"),
    # Softs
    m("coffee", "Coffee", "083731", "Softs", "disagg"),
    m("sugar", "Sugar #11", "080732", "Softs", "disagg"),
    m("cotton", "Cotton", "033661", "Softs", "disagg"),
    m("cocoa", "Cocoa", "073732", "Softs", "disagg"),
    m("oj", "Orange Juice", "040701", "Softs", "disagg"),
    # Livestock
    m("cattle", "Live Cattle", "057642", "Livestock", "disagg"),
    m("feeder", "Feeder Cattle", "061641", "Livestock", "disagg"),
    m("hogs", "Lean Hogs", "054642", "Livestock", "disagg"),
]
