# KellyLab V7.0

Single-file GitHub Pages app. Upload `index.html` to the repository root.

## V7.0 changes
- Kelly is enforced as a total portfolio budget across all open trades.
- Per-trade target size is derived from expected overlap: opportunities/week × average holding days ÷ 7.
- Full/Half/Quarter Kelly can no longer drift above their selected portfolio budget.
- Optional checkbox permits margin up to 150% total exposure; unchecked caps exposure at 100%.
- Added portfolio-utilization diagnostics: deployed capital, position size, open positions, funded and skipped opportunities.
- Margin interest, trade correlation, slippage, and variable win/loss magnitudes are not modeled.
