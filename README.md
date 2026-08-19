# KellyLab V5

A static GitHub Pages app that calculates Kelly allocation using actual trading returns.

## Inputs

Both calculators use:

- Win rate
- Average winning trade as a percentage return on the position
- Average losing trade as a positive percentage loss on the position

Example:

- Win rate: 60%
- Average winner: 10%
- Average loser: 5%

The app does **not** interpret this as a 2R winner that doubles the account. It treats a fully funded position as +10% on a winner and -5% on a loser.

## Kelly calculation

For win probability `p`, loss probability `q`, winning position return `G`, and losing position return `L`, the unconstrained Kelly allocation is:

```text
(pG - qL) / (GL)
```

This app has no leverage mode. Any suggested allocation above 100% is limited to the available account equity. It does not show leverage ratios or borrowed-capital scenarios.

## 1R definition

In this app:

```text
1R = suggested bet amount × average losing trade percentage
```

A $100,000 suggested bet and a 5% average loss produces a $5,000 R.

## Goal simulator

The goal simulator automatically models full, half, and quarter Kelly and reports:

- Suggested allocation and starting dollar bet
- Starting 1R
- Median trades and calendar time to target
- Probability of reaching the target within the selected horizon
- Risk of touching the chosen ruin threshold first
- Median maximum drawdown
- Average trades per week for calendar-time conversion
- Average holding period in days for trade-duration context
- Sample account paths

The simulation assumes independent trades and two possible outcomes: the entered average winner or the entered average loser. Correlation is not modeled.

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


## Trading cadence

The goal simulator asks for both **average trades per week** and **average holding period in days**. Trades per week is used to convert median trades-to-target into weeks/months/years. Average holding period is reported alongside the result to show how long capital is typically tied up. V5 does not yet model overlapping positions or correlation from the holding-period input.
