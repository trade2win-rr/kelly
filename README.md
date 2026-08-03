# KellyLab

KellyLab is a static web app for traders with two tools:

1. **Kelly Goal Simulator** — runs Monte Carlo simulations to estimate the probability, number of trades, and approximate calendar time needed to grow from a starting balance to a target balance.
2. **Kelly Size Calculator** — converts win rate, average win/loss, account size, entry, and stop into a fractional-Kelly risk budget and position size.

The app uses only HTML, CSS, and JavaScript. It has no server, database, build step, or external dependency, so it can be hosted free with GitHub Pages.

## Launch locally

Open `index.html` in a browser, or serve the folder with a basic local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

### New repository

1. Create a new GitHub repository, such as `kelly-simulator`.
2. Upload `index.html`, `styles.css`, `app.js`, and `README.md` to the repository root.
3. Open the repository's **Settings**.
4. Select **Pages** in the left menu.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the `main` branch and `/ (root)` folder, then save.
7. GitHub will provide the public Pages URL after deployment.

### Existing repository using Git

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
# Copy the KellyLab files into this folder
git add .
git commit -m "Add KellyLab simulator"
git push origin main
```

Then enable GitHub Pages in the repository settings as described above.

## Kelly formula

The calculator uses:

```text
Payoff ratio b = average winner / average loser
Full Kelly f* = (b × p − q) / b
```

Where:

- `p` is the probability of a winning trade.
- `q` is `1 − p`.
- `b` is the average winner divided by the average loser.

Negative Kelly values are treated as 0%, meaning the assumptions do not describe a positive edge.

## Simulator mechanics

For each simulated trade:

```text
Winning trade: equity × (1 + applied risk × payoff ratio)
Losing trade:  equity × (1 − applied risk)
```

Applied risk is the smaller of:

- Full Kelly multiplied by the chosen fraction; or
- The hard risk cap entered by the user.

The time estimate converts the median successful trade count using the user's entered average trades per week.

## Important limitation

The model assumes a stable win rate and payoff ratio, independent trades, immediate stop execution, and no fees, taxes, gaps, slippage, correlation, or strategy decay. It is an educational model and not financial advice.
