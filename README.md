# KellyLab V6.1 — cache-busted capital-aware build

This build uses versioned asset filenames so GitHub Pages/browser caches cannot silently keep running the older V5 simulation engine.

## Upload to GitHub Pages
Upload these files to the repository root:

- `index.html`
- `styles-v61.css`
- `kelly-core-v61.js`
- `app-v61.js`
- `README.md`

The older `app.js`, `kelly-core.js`, and `styles.css` can be deleted after V6.1 is working; V6.1 does not reference them.

You should visibly see **V6.1** next to the KellyLab title after deployment. If you do not see V6.1, the new `index.html` is not live yet.

## Capital-aware timing
V6.1 simulates calendar days directly. Trade opportunities arrive randomly around the average entered per week. Each funded trade keeps its capital committed until its simulated exit date, so average holding period directly affects the median calendar time.

For the diagnostic example `$100,000 → $5,000,000`, 50% win rate, +9% average winner, -4% average loser, 3 opportunities/week, 18-day average hold, half Kelly, no leverage:

- 5-year horizon: median should display **Not reached** because fewer than half the paths hit $5M within five years.
- 10–20 year horizon: median is around **9.2 years** (Monte Carlo variation is expected).

A result near **13.1 months** indicates the old V5 timing logic is still being executed (`~170 trades ÷ 3 trades/week`).

# KellyLab V6

A static GitHub Pages app that calculates Kelly allocation using actual trading returns and simulates capital-aware trade overlap.

## Inputs

Both calculators use:

- Win rate
- Average winning trade as a percentage return on the position
- Average losing trade as a positive percentage loss on the position

The goal simulator also uses:

- Average trade opportunities per week
- Average holding period in days
- Simulation horizon
- Ruin threshold

## Kelly calculation

For win probability `p`, loss probability `q`, winning position return `G`, and losing position return `L`, the unconstrained Kelly allocation is:

```text
(pG - qL) / (GL)
```

This version has no leverage mode. Any suggested allocation above 100% is limited to available equity.

## 1R definition

```text
1R = suggested bet amount × average losing trade percentage
```

A $100,000 suggested bet and a 5% average loss produces a $5,000 R.

## Capital-aware goal simulator

V6 no longer converts a fixed trade count into calendar time. It simulates calendar days directly:

1. Trade opportunities arrive randomly around the entered weekly average.
2. Each trade gets a positive holding period that varies around the entered average.
3. The Kelly allocation determines the desired capital for a new trade.
4. Open positions reserve their capital until they close.
5. A new trade can use only currently available cash; it is partially funded if necessary and skipped when no cash is available.
6. Profit or loss is realized when the trade closes.
7. The simulator tracks the actual day the target or ruin threshold is reached.

This makes average holding period materially affect time to goal.

Holding-period variation uses a gamma-shaped distribution centered on the entered average, with roughly 50% coefficient of variation. This avoids forcing every trade to last exactly the same number of days.

The simulator reports:

- Full, half, and quarter Kelly
- Suggested starting bet and starting 1R
- Median closed trades to target
- Median calendar time to target
- Probability of reaching the target within the selected horizon
- Risk of touching the ruin threshold first
- Median maximum drawdown
- Median percentage of arriving opportunities that could be funded
- Sample account paths over calendar time

Target-time quantiles are calculated across all simulation paths. If fewer than half of simulations reach the target within the selected horizon, median time is shown as **Not reached** rather than reporting a misleading median of only the successful paths.

## Model limitations

Correlation is not modeled. Trade outcomes are independent and are simplified to either the entered average winner or average loser. Real trading has a distribution of outcomes, gaps, slippage, changing win rates, changing opportunity frequency, and correlated positions.

## GitHub Pages

Upload these files together to the root of the repository:

```text
index.html
styles.css
kelly-core.js
app.js
README.md
```

Then go to **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/(root)`, and save.
