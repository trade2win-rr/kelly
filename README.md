# KellyLab

KellyLab is a static GitHub Pages app with two trading tools:

1. **Goal Simulator** — uses Monte Carlo simulation to estimate the median, faster, and slower time needed to grow from a starting account value to a target value.
2. **Kelly Size Calculator** — converts win rate, payoff ratio, account equity, entry price, and stop price into a fractional-Kelly risk budget and position size.

The app uses only HTML, CSS, and JavaScript. There is no server, database, build process, API key, or external dependency.

## Version 1.1 fixes

- Currency inputs now display commas while typing.
- Removed the browser `step` mismatch that produced messages such as “nearest valid values are 99,901 and 100,001.”
- Removed the user-facing random seed.
- Removed the manual maximum-trades-per-path input.
- The simulation horizon is now selected automatically from the target, edge, risk level, trading frequency, and browser performance limit.
- The main output now emphasizes calendar time to target.
- Added 25th-percentile, median, and 75th-percentile time estimates.
- Added probabilities of reaching the target within one, three, and five years.
- Added a plain-English result summary and the actual account gain/loss assumed per trade.
- Corrected the sample-path legend so the highlighted path is actually close to the median result.

## Launch locally

Open `index.html` directly, or run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Update an existing GitHub repository

Replace the existing files in the repository root with:

- `index.html`
- `styles.css`
- `app.js`
- `README.md`

Then commit the changes. GitHub Pages should redeploy automatically.

Using Git:

```bash
git add index.html styles.css app.js README.md
git commit -m "Fix Kelly simulator inputs and goal timeline"
git push origin main
```

## Publish a new GitHub Pages site

1. Create a GitHub repository.
2. Upload the four files above to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Save.

The normal URL format is:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY-NAME/
```

## Kelly formula

```text
Payoff ratio b = average winner / average loser
Full Kelly f* = (b × p − q) / b
```

The simulator uses the smaller of fractional Kelly or the maximum account-risk input.

For example, with a 1.5-to-1 payoff ratio and 2% account risk:

```text
Average win impact  = +3.0% of account equity
Average loss impact = -2.0% of account equity
```

## Important limitation

The model assumes a stable win rate and payoff ratio, independent trades, immediate stop execution, and no fees, taxes, gaps, slippage, correlation, or strategy decay. The output is a hypothetical range, not a forecast or guarantee.
