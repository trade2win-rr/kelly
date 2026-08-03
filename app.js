"use strict";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const defaults = {
  simulator: {
    startCapital: 100000,
    targetCapital: 1000000,
    simWinRate: 55,
    simAvgWin: 1.5,
    simAvgLoss: 1,
    simKellyScale: 0.25,
    simRiskCap: 2,
    simulationCount: 5000,
    maxTrades: 5000,
    tradesPerWeek: 10,
    randomSeed: 42
  },
  sizer: {
    accountEquity: 100000,
    sizeWinRate: 55,
    sizeAvgWin: 1.5,
    sizeAvgLoss: 1,
    sizeKellyScale: 0.25,
    sizeRiskCap: 1,
    entryPrice: 100,
    stopPrice: 95,
    unitMultiplier: 1,
    roundingIncrement: 1
  }
};

let latestSimulationRows = [];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function median(values) {
  if (!values.length) return null;
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

function formatDurationFromTrades(trades, tradesPerWeek) {
  if (!Number.isFinite(trades) || tradesPerWeek <= 0) return "—";
  const weeks = trades / tradesPerWeek;
  if (weeks < 2) return `${Math.max(1, Math.round(weeks * 7))} days`;
  if (weeks < 12) return `${weeks.toFixed(1)} weeks`;
  const months = weeks / 4.345;
  if (months < 24) return `${months.toFixed(1)} months`;
  return `${(weeks / 52.143).toFixed(1)} years`;
}

function calculateKelly(winRatePct, avgWin, avgLoss) {
  const p = winRatePct / 100;
  const q = 1 - p;
  const payoffRatio = avgWin / avgLoss;
  const expectancy = p * payoffRatio - q;
  const rawKelly = payoffRatio > 0 ? (payoffRatio * p - q) / payoffRatio : 0;
  return {
    p,
    q,
    payoffRatio,
    expectancy,
    fullKelly: Math.max(0, rawKelly),
    rawKelly
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function showMessage(element, text, type = "error") {
  element.textContent = text;
  element.className = `message ${type}`;
}

function hideMessage(element) {
  element.textContent = "";
  element.className = "message hidden";
}

function setFormValues(group) {
  Object.entries(defaults[group]).forEach(([id, value]) => {
    if ($(id)) $(id).value = String(value);
  });
}

function saveInputs() {
  const ids = [
    ...Object.keys(defaults.simulator),
    ...Object.keys(defaults.sizer)
  ];
  const saved = {};
  ids.forEach((id) => {
    if ($(id)) saved[id] = $(id).value;
  });
  localStorage.setItem("kellyLabInputs", JSON.stringify(saved));
}

function loadInputs() {
  const saved = JSON.parse(localStorage.getItem("kellyLabInputs") || "{}");
  Object.entries(saved).forEach(([id, value]) => {
    if ($(id)) $(id).value = value;
  });
}

function updateHeroFromSimulator() {
  const kelly = calculateKelly(
    Number($("simWinRate").value),
    Number($("simAvgWin").value),
    Number($("simAvgLoss").value)
  );
  const scale = Number($("simKellyScale").value);
  const cap = Number($("simRiskCap").value) / 100;
  const applied = Math.min(kelly.fullKelly * scale, cap);

  $("heroKelly").textContent = Number.isFinite(kelly.fullKelly) ? `${(kelly.fullKelly * 100).toFixed(1)}%` : "—";
  $("heroRisk").textContent = Number.isFinite(applied) ? `${(applied * 100).toFixed(1)}%` : "—";
  $("heroExpectancy").textContent = Number.isFinite(kelly.expectancy) ? `${kelly.expectancy.toFixed(2)}R` : "—";
}

function simulatePath({ start, target, p, payoffRatio, riskFraction, maxTrades, rng, capturePath }) {
  let equity = start;
  let peak = start;
  let maxDrawdown = 0;
  let reached = start >= target;
  let trades = reached ? 0 : maxTrades;
  let touchedHalfDrawdown = false;
  const points = capturePath ? [{ trade: 0, equity }] : null;
  const samplingStep = Math.max(1, Math.floor(maxTrades / 250));

  for (let trade = 1; trade <= maxTrades && !reached; trade += 1) {
    if (rng() < p) {
      equity *= 1 + riskFraction * payoffRatio;
    } else {
      equity *= 1 - riskFraction;
    }

    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? 1 - equity / peak : 1;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    if (drawdown >= 0.5) touchedHalfDrawdown = true;

    if (capturePath && (trade % samplingStep === 0 || equity >= target || trade === maxTrades)) {
      points.push({ trade, equity });
    }

    if (equity >= target) {
      reached = true;
      trades = trade;
    }

    if (!Number.isFinite(equity) || equity <= 0) {
      equity = 0;
      trades = trade;
      break;
    }
  }

  return { reached, trades, endingEquity: equity, maxDrawdown, touchedHalfDrawdown, points };
}

function validateSimulatorInputs(values) {
  if (values.start <= 0 || values.target <= 0) return "Starting and target capital must be positive.";
  if (values.target <= values.start) return "Target capital should be greater than starting capital.";
  if (values.winRate <= 0 || values.winRate >= 100) return "Win rate must be between 0% and 100%.";
  if (values.avgWin <= 0 || values.avgLoss <= 0) return "Average winner and loser must be positive.";
  if (values.riskCap < 0 || values.riskCap >= 100) return "Risk cap must be at least 0% and below 100%.";
  if (values.maxTrades < 1 || values.simulations < 1) return "Simulation count and maximum trades must be positive.";
  if (values.tradesPerWeek <= 0) return "Average trades per week must be positive.";
  if (values.maxTrades * values.simulations > 75000000) return "This setup could require more than 75 million simulated trades. Reduce the number of simulations or maximum trades per path.";
  return null;
}

function runSimulation(event) {
  if (event) event.preventDefault();
  hideMessage($("simulatorMessage"));

  const values = {
    start: Number($("startCapital").value),
    target: Number($("targetCapital").value),
    winRate: Number($("simWinRate").value),
    avgWin: Number($("simAvgWin").value),
    avgLoss: Number($("simAvgLoss").value),
    kellyScale: Number($("simKellyScale").value),
    riskCap: Number($("simRiskCap").value),
    simulations: Number($("simulationCount").value),
    maxTrades: Number($("maxTrades").value),
    tradesPerWeek: Number($("tradesPerWeek").value),
    seed: Number($("randomSeed").value)
  };

  const validationError = validateSimulatorInputs(values);
  if (validationError) {
    showMessage($("simulatorMessage"), validationError);
    return;
  }

  const kelly = calculateKelly(values.winRate, values.avgWin, values.avgLoss);
  if (kelly.rawKelly <= 0) {
    showMessage($("simulatorMessage"), "These inputs do not produce a positive Kelly edge. The mathematically optimal Kelly allocation is 0%, so no growth simulation was run.", "warning");
    clearSimulationResults();
    updateHeroFromSimulator();
    return;
  }

  const riskFraction = Math.min(kelly.fullKelly * values.kellyScale, values.riskCap / 100);
  if (riskFraction <= 0) {
    showMessage($("simulatorMessage"), "Applied risk is 0%. Increase the hard risk cap or Kelly fraction to run the simulation.", "warning");
    clearSimulationResults();
    return;
  }

  const rng = mulberry32(Math.trunc(values.seed));
  const results = [];
  const samplePaths = [];
  const sampleCount = Math.min(24, values.simulations);

  for (let i = 0; i < values.simulations; i += 1) {
    const result = simulatePath({
      start: values.start,
      target: values.target,
      p: kelly.p,
      payoffRatio: kelly.payoffRatio,
      riskFraction,
      maxTrades: values.maxTrades,
      rng,
      capturePath: i < sampleCount
    });
    results.push(result);
    if (result.points) samplePaths.push(result.points);
  }

  const successfulTrades = results.filter((r) => r.reached).map((r) => r.trades).sort((a, b) => a - b);
  const drawdowns = results.map((r) => r.maxDrawdown).sort((a, b) => a - b);
  const endings = results.map((r) => r.endingEquity).sort((a, b) => a - b);
  const reachedProbability = successfulTrades.length / results.length;
  const deepDrawdownRisk = results.filter((r) => r.touchedHalfDrawdown).length / results.length;

  $("reachProbability").textContent = `${(reachedProbability * 100).toFixed(1)}%`;
  const medianSuccessfulTrades = successfulTrades.length ? percentile(successfulTrades, 0.5) : null;
  $("medianTrades").textContent = successfulTrades.length ? number0.format(Math.round(medianSuccessfulTrades)) : "Not reached";
  $("medianTime").textContent = successfulTrades.length ? formatDurationFromTrades(medianSuccessfulTrades, values.tradesPerWeek) : "—";
  $("tradeRange").textContent = successfulTrades.length
    ? `${number0.format(Math.round(percentile(successfulTrades, 0.25)))}–${number0.format(Math.round(percentile(successfulTrades, 0.75)))}`
    : "—";
  $("medianDrawdown").textContent = `${(percentile(drawdowns, 0.5) * 100).toFixed(1)}%`;
  $("deepDrawdownRisk").textContent = `${(deepDrawdownRisk * 100).toFixed(1)}%`;
  $("medianEndingCapital").textContent = money.format(percentile(endings, 0.5));

  latestSimulationRows = results.map((r, index) => ({
    simulation: index + 1,
    reached_target: r.reached ? "Yes" : "No",
    trades: r.trades,
    ending_capital: r.endingEquity,
    max_drawdown_pct: r.maxDrawdown * 100,
    touched_50pct_drawdown: r.touchedHalfDrawdown ? "Yes" : "No"
  }));
  $("downloadCsv").disabled = false;

  drawPathChart(samplePaths, values.start, values.target, values.maxTrades);
  updateHeroFromSimulator();
  saveInputs();
}

function clearSimulationResults() {
  ["reachProbability", "medianTrades", "medianTime", "tradeRange", "medianDrawdown", "deepDrawdownRisk", "medianEndingCapital"].forEach((id) => {
    $(id).textContent = "—";
  });
  latestSimulationRows = [];
  $("downloadCsv").disabled = true;
  drawEmptyChart();
}

function getCssVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawEmptyChart() {
  const canvas = $("pathChart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getCssVariable("--bg-secondary");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getCssVariable("--muted");
  ctx.font = "16px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Run a simulation to draw sample account paths.", canvas.width / 2, canvas.height / 2);
}

function drawPathChart(paths, start, target, maxTrades) {
  const canvas = $("pathChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { left: 72, right: 24, top: 24, bottom: 46 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getCssVariable("--bg-secondary");
  ctx.fillRect(0, 0, width, height);

  const allEquities = paths.flatMap((path) => path.map((point) => point.equity)).filter((value) => value > 0 && Number.isFinite(value));
  const minEquity = Math.max(1, Math.min(start * 0.25, ...allEquities));
  const maxEquity = Math.max(target * 1.2, ...allEquities);
  const minLog = Math.log10(minEquity);
  const maxLog = Math.log10(maxEquity);
  const toX = (trade) => padding.left + (trade / maxTrades) * chartWidth;
  const toY = (equity) => padding.top + (1 - (Math.log10(Math.max(equity, minEquity)) - minLog) / (maxLog - minLog || 1)) * chartHeight;

  ctx.strokeStyle = getCssVariable("--line");
  ctx.lineWidth = 1;
  ctx.fillStyle = getCssVariable("--muted");
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "right";

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const logValue = minLog + (maxLog - minLog) * ratio;
    const value = 10 ** logValue;
    const y = padding.top + chartHeight - ratio * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(money.format(value), padding.left - 10, y + 4);
  }

  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i += 1) {
    const trade = Math.round(maxTrades * i / 4);
    const x = toX(trade);
    ctx.fillText(number0.format(trade), x, height - 18);
  }

  ctx.strokeStyle = getCssVariable("--warning");
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(padding.left, toY(target));
  ctx.lineTo(width - padding.right, toY(target));
  ctx.stroke();
  ctx.setLineDash([]);

  const pathColor = getCssVariable("--muted");
  paths.forEach((path, index) => {
    ctx.beginPath();
    path.forEach((point, pointIndex) => {
      const x = toX(point.trade);
      const y = toY(point.equity);
      if (pointIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = index === 0 ? getCssVariable("--accent") : pathColor;
    ctx.globalAlpha = index === 0 ? 1 : 0.24;
    ctx.lineWidth = index === 0 ? 3 : 1.2;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function validateSizerInputs(values) {
  if (values.equity <= 0) return "Account equity must be positive.";
  if (values.winRate <= 0 || values.winRate >= 100) return "Win rate must be between 0% and 100%.";
  if (values.avgWin <= 0 || values.avgLoss <= 0) return "Average winner and loser must be positive.";
  if (values.entry <= 0 || values.stop < 0 || values.entry === values.stop) return "Entry and stop prices must be different, and entry must be positive.";
  if (values.multiplier <= 0) return "The unit multiplier must be positive.";
  if (values.riskCap < 0 || values.riskCap >= 100) return "Risk cap must be at least 0% and below 100%.";
  return null;
}

function calculatePositionSize(event) {
  if (event) event.preventDefault();
  hideMessage($("sizerMessage"));

  const values = {
    equity: Number($("accountEquity").value),
    winRate: Number($("sizeWinRate").value),
    avgWin: Number($("sizeAvgWin").value),
    avgLoss: Number($("sizeAvgLoss").value),
    kellyScale: Number($("sizeKellyScale").value),
    riskCap: Number($("sizeRiskCap").value),
    entry: Number($("entryPrice").value),
    stop: Number($("stopPrice").value),
    multiplier: Number($("unitMultiplier").value),
    rounding: Number($("roundingIncrement").value)
  };

  const validationError = validateSizerInputs(values);
  if (validationError) {
    showMessage($("sizerMessage"), validationError);
    return;
  }

  const kelly = calculateKelly(values.winRate, values.avgWin, values.avgLoss);
  const appliedRisk = Math.min(kelly.fullKelly * values.kellyScale, values.riskCap / 100);
  const dollarRiskBudget = values.equity * appliedRisk;
  const perUnitRisk = Math.abs(values.entry - values.stop) * values.multiplier;
  const rawUnits = perUnitRisk > 0 ? dollarRiskBudget / perUnitRisk : 0;
  const units = Math.max(0, Math.floor(rawUnits / values.rounding) * values.rounding);
  const actualDollarRisk = units * perUnitRisk;
  const notional = units * values.entry * values.multiplier;
  const leverage = values.equity > 0 ? notional / values.equity : 0;
  const expectancyDollars = actualDollarRisk * kelly.expectancy;
  const averageWinDollars = actualDollarRisk * kelly.payoffRatio;

  $("positionUnits").textContent = number0.format(units);
  $("sizePayoffRatio").textContent = `${kelly.payoffRatio.toFixed(2)} : 1`;
  $("sizeFullKelly").textContent = `${(kelly.fullKelly * 100).toFixed(2)}%`;
  $("sizeAppliedRisk").textContent = `${(appliedRisk * 100).toFixed(2)}%`;
  $("sizeDollarRisk").textContent = money2.format(actualDollarRisk);
  $("riskPerUnit").textContent = money2.format(perUnitRisk);
  $("positionNotional").textContent = money.format(notional);
  $("positionLeverage").textContent = `${leverage.toFixed(2)}×`;
  $("expectedValueTrade").textContent = money2.format(expectancyDollars);
  $("averageWinDollars").textContent = money2.format(averageWinDollars);

  const badge = $("edgeBadge");
  if (kelly.rawKelly > 0) {
    badge.className = "pill positive";
    badge.textContent = `Positive edge: ${kelly.expectancy.toFixed(2)}R`;
  } else {
    badge.className = "pill negative";
    badge.textContent = `No Kelly bet: ${kelly.expectancy.toFixed(2)}R`;
    showMessage($("sizerMessage"), "These assumptions do not produce a positive Kelly edge. The suggested Kelly risk is 0%.", "warning");
  }

  if (units === 0 && appliedRisk > 0) {
    showMessage($("sizerMessage"), "The risk budget is smaller than the loss on one unit at your chosen stop. Use a tighter stop, smaller multiplier, or a larger risk budget.", "warning");
  }

  saveInputs();
}

function downloadSimulationCsv() {
  if (!latestSimulationRows.length) return;
  const headers = Object.keys(latestSimulationRows[0]);
  const csv = [headers.join(",")]
    .concat(latestSimulationRows.map((row) => headers.map((header) => {
      const value = String(row[header]).replaceAll('"', '""');
      return `"${value}"`;
    }).join(",")))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kelly-simulation-results.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("kellyLabTheme", theme);
  if (latestSimulationRows.length) runSimulation();
  else drawEmptyChart();
}

function initializeTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      $(button.dataset.tab).classList.add("active");
    });
  });
}

function initialize() {
  loadInputs();
  initializeTabs();

  const savedTheme = localStorage.getItem("kellyLabTheme") || "dark";
  document.documentElement.dataset.theme = savedTheme;

  $("simulatorForm").addEventListener("submit", runSimulation);
  $("sizerForm").addEventListener("submit", calculatePositionSize);
  $("downloadCsv").addEventListener("click", downloadSimulationCsv);

  $("resetSimulator").addEventListener("click", () => {
    setFormValues("simulator");
    hideMessage($("simulatorMessage"));
    clearSimulationResults();
    updateHeroFromSimulator();
    saveInputs();
  });

  $("resetSizer").addEventListener("click", () => {
    setFormValues("sizer");
    hideMessage($("sizerMessage"));
    calculatePositionSize();
  });

  $("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "dark" ? "light" : "dark");
  });

  ["simWinRate", "simAvgWin", "simAvgLoss", "simKellyScale", "simRiskCap"].forEach((id) => {
    $(id).addEventListener("input", updateHeroFromSimulator);
  });

  document.querySelectorAll("input, select").forEach((element) => {
    element.addEventListener("change", saveInputs);
  });

  updateHeroFromSimulator();
  drawEmptyChart();
  calculatePositionSize();
  runSimulation();
}

window.addEventListener("DOMContentLoaded", initialize);
