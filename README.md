# COT Positioning Monitor

A small, fully automated web tool that tracks the weekly CFTC Commitments of Traders (COT) reports and shows where
current positioning sits compared with the last 2, 3 and 5 years. Futures Only data.

- **Table** for ~53 markets (currencies, crypto, equity indices, rates, metals, energy, grains, softs, livestock) with
  Long, Short, Net, weekly change and percentile ranks (2Y / 3Y / 5Y).
- **Charts** per market and trader category (net, long, short) with extreme zones (10th/90th percentile), min/max and the
  current position marked. Optional view as % of open interest, which removes the effect of market growth over time.
- **Three reports**: Legacy (all markets), Disaggregated (commodities), TFF (financial futures).
- **Exports**: table to CSV; charts to PNG, JPEG, WebP, SVG or CSV.
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

1. **Data** comes from the public CFTC Public Reporting API (Socrata). Three datasets are used, all Futures Only:
   Legacy `6dca-aqww`, Disaggregated `72hh-3qpy`, TFF `gpe5-46if`. Markets are selected by CFTC contract code.
2. **`scripts/update.py`** downloads the last ~5 years for every market, builds a tidy table per report, and computes for
   each market and trader category: long, short, total, net, net as % of open interest, weekly change, and the
   percentile rank of net position for 2, 3 and 5 year windows. It writes `site/data/index.json` (table data) and
   `site/data/series/<market>.json` (history for charts).
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
| `scripts/markets.py` | List of markets (name, CFTC contract code, group, specialised report) |
| `site/index.html`, `style.css`, `app.js` | The website |
| `site/data/` | Generated JSON (created by the update script) |
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
python -m http.server -d site 8000   # then open http://localhost:8000
```

Helper commands:

```bash
python scripts/update.py --find gold   # search CFTC contract codes by market name
python scripts/update.py --inspect     # print the real column names of the three datasets
python scripts/update.py --demo        # synthetic data for offline preview (do not publish it)
```

Optional: a free Socrata app token raises API rate limits. Add it as a repository secret named `SOCRATA_APP_TOKEN`
(or an environment variable when running locally). It is not required for one weekly run.

## Customising

- **Add or remove a market**: edit `scripts/markets.py`. Use `--find` to get the contract code. `report` is `tff` for
  financial futures or `disagg` for commodities. Legacy data is always included.
- **Change windows** (2, 3, 5 years): `WINDOWS` in `scripts/update.py`, `WIN` in `site/app.js`, and the window options and
  table headers in `site/index.html` / `app.js`.
- **Branding**: title and footer in `site/index.html`, colors in the `:root` block of `site/style.css`.
- **Schedule**: the `cron` lines in `.github/workflows/weekly.yml` (times are UTC). The CFTC publishes Fridays at 3:30 pm New York time.

## Troubleshooting

- **Site says it could not load data**: the data files do not exist yet. Run `python scripts/update.py --force` (step 2).
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

Plotly.js (basic bundle, MIT license) is included in `site/vendor/`. Data comes from the public CFTC reporting API.

## Data source

CFTC Commitments of Traders, Futures Only: https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
Positions are as of Tuesday and published on Friday afternoon (New York time). This tool is for information only and is not investment advice.
