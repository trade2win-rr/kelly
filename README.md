# KellyLab

KellyLab is a static GitHub Pages app with two trading tools:

1. **Goal Simulator** — uses Monte Carlo simulation to estimate the median, faster, and slower time needed to grow from a starting account value to a target value.
2. **Kelly Size Calculator** — converts win rate, payoff ratio, account equity, entry price, and stop price into a fractional-Kelly position size.

The app uses only HTML, CSS, and JavaScript. There is no server, database, build process, API key, or external dependency.

## Current version fixes

- All dollar inputs display comma separators, including starting capital, target capital, account equity, entry price, and stop price.
- Currency values with commas are parsed correctly by both calculators.
- Removed the browser step mismatch that produced “nearest valid values” errors.
- Removed the risk-cap option and all risk-cap logic from both calculators.
- Fractional Kelly is now the only risk adjustment: full, half, quarter, or one-tenth Kelly.
- Removed the user-facing random seed and manual maximum-trades input.
- The simulator creates a repeatable internal seed and automatic safety horizon.
- Fixed the Estimate Time to Goal button so it no longer references removed form fields.
- The goal results emphasize median time, faster/slower ranges, one/three/five-year probabilities, and drawdown risk.
- The sizing calculator reports actual risk after unit rounding rather than overstating the planned risk.

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
git commit -m "Remove risk cap and fix Kelly calculators"
git push origin main
```

## Kelly formula

```text
Payoff ratio b = average winner / average loser
Full Kelly f* = (b × p − q) / b
Applied Kelly risk = Full Kelly × selected Kelly fraction
```

There is no risk cap in this version. For example, if Full Kelly is 25%:

```text
Full Kelly       = 25.00% account risk
Half Kelly       = 12.50% account risk
Quarter Kelly    = 6.25% account risk
One-tenth Kelly  = 2.50% account risk
```

## Important limitation

The model assumes a stable win rate and payoff ratio, independent trades, immediate stop execution, and no fees, taxes, gaps, slippage, correlation, or strategy decay. Kelly can recommend extremely aggressive sizing when the estimated edge is high. The output is hypothetical, not financial advice or a guarantee.
