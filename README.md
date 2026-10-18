# COT Positioning Monitor

A small, fully automated web tool that tracks the weekly CFTC Commitments of Traders (COT) reports and shows where
current positioning sits compared with the last 2, 3 and 5 years.

**Version 2.1**

- **Two data sets, one switch**: Futures Only and Futures + Options Combined.
- **Every active contract** in the CFTC reports is included automatically (currencies, crypto, equity indices, rates,
  metals incl. lithium and cobalt, energy, natural gas, power and environmental, grains, softs, livestock, dairy, other) and grouped. New contracts appear on their own.
- **Young markets work too**: if a contract has less than 5 years of history, percentiles and charts use what exists
  (minimum 26 weeks of data).
- **Table** with Long, Short, Net, weekly change, a 5-year trend line and percentile ranks (2Y / 3Y / 5Y); group filter,
  search (names and tickers), sortable columns, collapsible groups, and quick views ("Extremes", "Biggest weekly moves").
- **Featured / All / My list**: the main markets by default, every contract on demand, and a personal watch list (saved in the browser).
- **Charts** per market and trader category (net, long, short) with extreme zones (10th/90th percentile), min/max and the
  current position marked. Optional view as % of open interest, which removes the effect of market growth over time.
- **Three reports**: Legacy (all markets), Disaggregated (commodities), TFF (financial futures).
- **Exports**: table to CSV, Excel (with colors) or a PNG image; charts to PNG, JPEG, WebP, SVG or CSV.
- **Shareable links**: the address contains the current view (data set, filters, market, chart settings); Back works.
- **Mobile friendly**: card layout for the table, collapsible filters, touch and hold for help text.
- **Hover help** on columns and buttons, plus a built-in user guide.

Developed by Mohamad Dorali (Dorali.mohamad@gmail.com).

## How it works

```
Weekly job (cron)                  site/data/*.json              Web server
  scripts/update.py   ──writes──▶  (index.json + one   ──served──▶  site/  (HTML + JS + Plotly)
  1. download CFTC data             file per market)                      │
  2. compute stats/percentiles                                            ▼
  3. write JSON                                                    Visitors' browsers
```

1. **Data** comes from the public CFTC Public Reporting API (Socrata). Six datasets are used:

   | | Legacy | Disaggregated | TFF |
   |---|---|---|---|
   | Futures Only | `6dca-aqww` | `72hh-3qpy` | `gpe5-46if` |
   | Futures + Options Combined | `jun7-fc8e` | `kh3c-gbw2` | `yw9f-hn96` |

   If a dataset id ever changes, `python scripts/update.py --datasets` lists the current ids (edit `MODES` in `scripts/update.py`).
2. **`scripts/update.py`** downloads the last ~5 years for every contract, discovers all active markets, groups and names them
   (`scripts/groups.py`, with curated names in `scripts/markets.py`), and computes for each market and trader category: long,
   short, total, net, net as % of open interest, weekly change, and the percentile rank of net position for 2, 3 and 5 year
   windows. For each data set it writes `site/data/<mode>/index.json` (table data) and `site/data/<mode>/series/<market>.json`
   (history for charts), plus `site/data/manifest.json`. Contracts with no report in the last 12 weeks are treated as discontinued.
3. **A weekly job** runs the script on Friday night, Saturday morning and Monday night (the Monday run covers US-holiday
   delays). If there is no new report it does nothing. The job can be a cron task on your own server, or the included GitHub Actions workflow.
4. **The site** (`site/`) is plain HTML/CSS/JS with Plotly (bundled in `site/vendor/`). It reads the JSON files in the
   browser, so no application server or database is needed.

### Percentile definition
The share of weeks in the window (including the current week) whose value is at or below the current value.
100 = most net long in the window, 0 = most net short. The window is counted in calendar years back from the latest report date.
The Python script and the website use the same definition.

## Repository layout

| Path | Purpose |
|---|---|
| `scripts/update.py` | Fetches CFTC data, computes statistics, writes JSON |
| `scripts/markets.py` | Curated names/groups for well-known contracts (everything else is discovered automatically) |
| `scripts/groups.py` | Rules that classify new contracts into groups and clean their names |
| `site/index.html`, `style.css`, `app.js` | The website |
| `site/data/` | Generated JSON: `futures/`, `combined/` and `manifest.json` (created by the update script) |
| `site/vendor/` | Bundled Plotly library (MIT license) |
| `.github/workflows/weekly.yml` | Optional weekly automation on GitHub |
| `vercel.json` | Optional Vercel settings (serve the `site` folder) |
| `requirements.txt` | Python dependencies (pandas, numpy, requests) |

## Deployment on your own server and domain (recommended)

The site is a folder of static files (`site/`), and the data update is one Python script. Nothing else runs on the server:
no database, no application server. GitHub and third-party hosting are optional.

Requirements: any web server (nginx, Apache, IIS...), Python 3.10 or newer, and outbound HTTPS access from the server to
`publicreporting.cftc.gov`. Plotly is bundled in `site/vendor/`, so visitors' browsers load nothing from third-party CDNs.

### 1. Copy the project and install dependencies
```bash
sudo mkdir -p /opt/cot-monitor && sudo chown $USER /opt/cot-monitor
# copy or git-clone the project into /opt/cot-monitor
cd /opt/cot-monitor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 2. Load the data for the first time
```bash
.venv/bin/python scripts/update.py --force
```
This downloads about five years of data and writes `site/data/`. It takes a minute or two. You should see
`Wrote 53 markets, report date YYYY-MM-DD`. If a market prints `no data`, see Troubleshooting.

### 3. Serve the `site` folder (nginx example)
```nginx
server {
    listen 80;
    server_name cot.yourdomain.com;

    root /opt/cot-monitor/site;
    index index.html;

    location / { try_files $uri $uri/ =404; }
    location /data/ { add_header Cache-Control "no-cache"; }   # browsers revalidate data after each update

    # Optional: keep the site out of search engines
    add_header X-Robots-Tag "noindex" always;

    # Optional: password protection
    # auth_basic "COT Monitor";
    # auth_basic_user_file /etc/nginx/.htpasswd;
}
```
Point the DNS record of your domain (A record) to the server, reload nginx, then enable HTTPS, for example with
`sudo certbot --nginx -d cot.yourdomain.com`. With Apache or IIS, simply set the document root to the `site` folder.

### 4. Schedule the weekly update
The CFTC publishes on Fridays at 3:30 pm New York time. The script does nothing if there is no new report, so it is safe to
run it more than once. Add to `crontab -e` (server time is assumed to be UTC; adjust if not):
```cron
30 22 * * 5   cd /opt/cot-monitor && .venv/bin/python scripts/update.py >> update.log 2>&1
0  8  * * 6   cd /opt/cot-monitor && .venv/bin/python scripts/update.py >> update.log 2>&1
30 22 * * 1   cd /opt/cot-monitor && .venv/bin/python scripts/update.py >> update.log 2>&1
```
The Monday run covers weeks when a US holiday delays the release. Check `update.log` if the site ever looks stale.
On Windows, create a Task Scheduler task that runs `python scripts\update.py` in the project folder at the same times.

### Alternative: GitHub Actions or a static host
If you prefer not to run the update on your own server, the repository also contains `.github/workflows/weekly.yml`, which does
the weekly update on GitHub and commits the new data. Then either:
- let a static host (Vercel, Cloudflare Pages) deploy the `site` folder from the repository (`vercel.json` is included), or
- keep your own server and refresh it with `git pull` on a cron job after the workflow commits.

For this route: create the GitHub repository, set **Settings → Actions → General → Workflow permissions** to
**Read and write**, and run **Actions → Weekly COT update → Run workflow** once with **force** ticked. Vercel's free Hobby
plan is for non-commercial use only. If you host on your own server with the cron job above, delete the `.github` folder.

## Running locally

```bash
pip install -r requirements.txt
python scripts/update.py             # fetch real data and rebuild site/data (skips if there is no new report)
python scripts/update.py --force     # rebuild even if there is no new report
python scripts/update.py --mode futures   # only one data set (futures or combined)
python -m http.server -d site 8000   # then open http://localhost:8000
```

Helper commands:

```bash
python scripts/update.py --find gold   # search CFTC contract codes by market name
python scripts/update.py --datasets    # list CFTC dataset ids
python scripts/update.py --inspect     # print the real column names of the three datasets
python scripts/update.py --demo        # synthetic data for offline preview (do not publish it)
```

Optional: a free Socrata app token raises API rate limits. Add it as a repository secret named `SOCRATA_APP_TOKEN`
(or an environment variable when running locally). It is not required for one weekly run.

## Customising

- **Featured markets and search aliases**: the curated markets in `scripts/markets.py` (`OVERRIDES`) are the "Featured" set.
  Add or remove entries there. `ALIASES` holds tickers and nicknames used by the search box.
- **Names and groups**: markets are discovered automatically. To rename a market, move it to another group, or pin its
  position, edit `scripts/markets.py` (`OVERRIDES`, keyed by CFTC contract code; use `--find` to get codes). The run log lists
  anything that landed in the "Other" group. Classification rules for new contracts are in `scripts/groups.py`.
- **Hide a market**: not needed in most cases (sorting, search and group filters keep the table usable). To drop a contract
  completely, skip its code in `make_markets()` in `scripts/update.py`.
- **Change windows** (2, 3, 5 years): `WINDOWS` in `scripts/update.py`, `WIN` in `site/app.js`, and the window options and
  table headers in `site/index.html` / `app.js`.
- **Minimum history for a percentile** (default 26 weeks): `MIN_WEEKS` in `scripts/update.py`.
- **Branding**: title and footer in `site/index.html`, colors in the `:root` block of `site/style.css`.
- **Schedule**: the `cron` lines in `.github/workflows/weekly.yml` or your own cron job (times are UTC).
  The CFTC publishes Fridays at 3:30 pm New York time.

## Size and performance

With every contract and both data sets, `site/data` is roughly 15 to 30 MB of small JSON files. The browser loads only the
index of the selected data set (a few hundred KB) and one small file per chart, so the site stays fast. Enable gzip on the web
server (nginx: `gzip on; gzip_types application/json;`). If the files are committed to Git, the repository grows by a few MB per week.

## Troubleshooting

- **Site says it could not load data**: the data files do not exist yet. Run `python scripts/update.py --force` (step 2).
- **"dataset ... could not be read" for the combined data**: CFTC dataset ids can change. Run `python scripts/update.py --datasets`
  and update `MODES` in `scripts/update.py`. The Futures Only data still updates while the other mode fails.
- **A market is in the wrong group**: add it to `OVERRIDES` in `scripts/markets.py`.
- **Site is stale after a Friday**: check `update.log`. US holidays delay the release; the Saturday and Monday runs pick it up.
- **A market shows no data / a column is missing**: CFTC occasionally renames contracts or columns. Use `--find` and
  `--inspect`, then adjust `scripts/markets.py` or the column names in `scripts/update.py`. Warnings are printed in the log.
- **Browser shows old data**: make sure the `Cache-Control: no-cache` rule for `/data/` is active (nginx example above), or hard-refresh.
- **GitHub Actions route: workflow fails on push**: check Settings → Actions → General → Workflow permissions. If the repository
  is a fork, enable workflows in the Actions tab first.

## Privacy

Anyone who can reach the URL can see the site. Restrict access on your server (basic auth, VPN, IP allow-list, SSO proxy) if
needed, and keep `X-Robots-Tag: noindex` (nginx example) so search engines do not list it.

## Third-party components

Plotly.js (basic bundle) and ExcelJS (used only for the Excel export, loaded on demand), both MIT licensed, are included in
`site/vendor/`. Data comes from the public CFTC reporting API.

## Data source

CFTC Commitments of Traders, Futures Only: https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
Positions are as of Tuesday and published on Friday afternoon (New York time). This tool is for information only and is not investment advice.
