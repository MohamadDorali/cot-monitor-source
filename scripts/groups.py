"""Market classification and display names for contracts discovered in the CFTC data.

New contracts (for example lithium or cobalt) are picked up automatically; this module decides which group they belong to
and how their name is shown. If a contract lands in the wrong group, fix it in markets.py (OVERRIDES)."""
import re

GROUP_ORDER = ["Currencies", "Crypto", "Equity Indices", "Rates", "Metals", "Energy", "Natural Gas",
               "Power & Environmental", "Grains", "Softs", "Livestock", "Dairy", "Other"]

# First match wins, so order matters (specific commodity words first, financial words last).
_RULES = [
    ("Other", r"GSCI|BLOOMBERG COMMODITY|BBG COMMODITY|COMMODITY INDEX"),
    ("Crypto", r"BITCOIN|\bBTC\b|\bETHER\b|\bETH\b|SOLANA|\bSOL\b|\bXRP\b|CRYPTO|LITECOIN|CARDANO|CARDONA|DOGE|AVALANCHE|\bAVAX\b|"
               r"PERP\b|SHIB|CHAINLINK|HEDERA|POLKADOT|STELLAR|\bSUI\b|ZCASH|\bNEAR\b|\bONDO\b|\bLINK\b"),
    ("Livestock", r"CATTLE|\bHOGS?\b|\bPORK\b|\bBELL(Y|IES)\b|\bLAMB\b"),
    ("Dairy", r"\bMILK\b|BUTTER|CHEESE|\bWHEY\b|CLASS III|CLASS IV|NONFAT"),
    ("Grains", r"\bCORN\b|WHEAT|SOYBEAN|\bSOY\b|\bOATS?\b|\bRICE\b|CANOLA|SORGHUM|BARLEY|\bMILO\b|RAPESEED"),
    ("Softs", r"COFFEE|SUGAR|COTTON|COCOA|ORANGE JUICE|\bFCOJ\b|LUMBER|PALM OIL|\bPULP\b|RUBBER"),
    ("Metals", r"\bGOLD\b|SILVER|COPPER|PLATINUM|PALLADIUM|ALUMIN|\bZINC\b|\bLEAD\b|NICKEL|\bTIN\b|COBALT|LITHIUM|"
               r"IRON ORE|\bSTEEL\b|\bHRC\b|MOLYBDENUM|URANIUM|RHODIUM|MANGANESE|\bSCRAP\b"),
    ("Natural Gas", r"NATURAL GAS|NAT GAS|HENRY HUB|\bLNG\b|\bNGL\b|PROPANE|ETHANE|BUTANE|\bGAS\b(?!OLINE)"),
    ("Power & Environmental", r"\bS?RECS?\b|\bAECS?\b|ENERGY CREDIT|COMPLIANCE|\bRINS?\b|CARBON|EMISSION|ALLOWANCE|\bRGGI\b|"
                              r"ELECTRIC|\bPOWER\b|\bPJM\b|ERCOT|\bMISO\b|NYISO|CAISO|\bISO\b|\bSPP\b|MID-C|PEAK|\bMWH?\b|\bHUB\b|"
                              r"\bCCA\b|\bEUA\b"),
    ("Energy", r"CRUDE|\bWTI\b|BRENT|GASOLINE|RBOB|HEATING OIL|DIESEL|ULSD|SULFUR|FUEL OIL|NAPHTHA|\bJET\b|KEROSENE|"
               r"ETHANOL|\bCOAL\b|GASOIL|BUNKER|MARINE FUEL|\bOIL\b"),
    ("Rates", r"TREASURY|T-NOTE|T-BOND|\bUST\b|\bULTRA\b|FED FUNDS|FEDERAL FUNDS|SOFR|EURODOLLAR|\bSWAP\b|\bERIS\b|"
              r"\bNOTES?\b|\bBONDS?\b|\bSONIA\b|EURIBOR|\bBUND\b|INTEREST RATE|\bLIBOR\b|\bBBSW\b|\bCORRA\b|STERLING|"
              r"\bGILT\b|\bJGB\b|\bOAT\b|\bBTP\b|YIELD|SHORT TERM RATE|\bESTR\b|CREDIT"),
    ("Equity Indices", r"S&P|\bSP 500\b|NASDAQ|DOW JONES|DJIA|RUSSELL|NIKKEI|MSCI|\bVIX\b|VOLATILITY|FTSE|\bDAX\b|"
                       r"STOCK INDEX|E-MINI|MIDCAP|SMALLCAP|\bTOPIX\b|STOXX|\bCAC\b|DIVIDEND"),
    ("Currencies", r"EURO FX|\bFX\b|YEN|\bPOUND\b|FRANC|DOLLAR|PESO|\bREAL\b|\bRAND\b|RUBLE|KRONE|KRONA|SHEKEL|"
                   r"LIRA|RENMINBI|\bRMB\b|RUPEE|ZLOTY|FORINT|KORUNA|\bWON\b|\bUSD\b|\bEUR\b|\bJPY\b|\bGBP\b|\bCHF\b"),
]
_COMPILED = [(g, re.compile(rx)) for g, rx in _RULES]

EXCHANGES = {
    "CHICAGO MERCANTILE EXCHANGE": "CME", "CHICAGO BOARD OF TRADE": "CBOT", "NEW YORK MERCANTILE EXCHANGE": "NYMEX",
    "COMMODITY EXCHANGE INC.": "COMEX", "ICE FUTURES U.S.": "ICE US", "ICE FUTURES EUROPE": "ICE EU",
    "ICE FUTURES ENERGY DIV": "ICE Energy", "MINNEAPOLIS GRAIN EXCHANGE": "MGEX", "CBOE FUTURES EXCHANGE": "CFE",
    "NODAL EXCHANGE": "Nodal", "MIAX FUTURES EXCHANGE": "MIAX", "ICE FUTURES ABU DHABI": "ICE AD",
}
_ACRONYMS = {"UST", "NY", "WTI", "RBOB", "ULSD", "SOFR", "CIF", "CJK", "FX", "USD", "EUR", "JPY", "GBP", "CHF", "CAD",
             "AUD", "NZD", "US", "MSCI", "VIX", "DJIA", "NGL", "PJM", "ERCOT", "MISO", "HRC", "LNG", "FE", "CFR", "TSI",
             "GSCI", "SRW", "HRW", "III", "IV", "LME", "ERIS", "FOB", "NAP", "LLS", "WCS", "RIN", "RGGI", "CME", "NYMEX", "ICE", "MGEX", "XRP"}


def split_name(full):
    """'GOLD - COMMODITY EXCHANGE INC.' -> ('GOLD', 'COMEX')"""
    full = (full or "").strip()
    base, sep, exch = full.rpartition(" - ")
    if not sep:
        return full, ""
    return base.strip(), EXCHANGES.get(exch.strip().upper(), exch.strip().title())


def clean_name(base):
    def fix(m):
        w = m.group(0)
        return w.upper() if w.upper() in _ACRONYMS else w
    return re.sub(r"[A-Za-z]+", fix, base.title()).replace("'S", "'s")


def classify(name, subgroup="", group_name=""):
    text = (name or "").upper()
    for group, rx in _COMPILED:
        if rx.search(text):
            return group
    sub = (subgroup or "").upper()
    if "ELECTRIC" in sub:
        return "Power & Environmental"
    if "NATURAL GAS" in sub:
        return "Natural Gas"
    if "PETROLEUM" in sub:
        return "Energy"
    return "Other"
