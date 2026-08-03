"use strict";

const $ = (id) => document.getElementById(id);
const money0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});
const money2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const number0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const defaults = {
  simulator: {
    startCapital: 100000,
    targetCapital: 1000000,
    simWinRate: 55,
    simAvgWin: 1.5,
    simAvgLoss: 1,
    simKellyScale: 0.25,
    tradesPerWeek: 10,
    simulationCount: 5000
  },
  sizer: {
    accountEquity: 100000,
    sizeWinRate: 55,
    sizeAvgWin: 1.5,
    sizeAvgLoss: 1,
    sizeKellyScale: 0.25,
    entryPrice: 100,
    stopPrice: 95,
    unitMultiplier: 1,
    roundingIncrement: 1
  }
};

let latestSimulationRows = [];
let lastChartData = null;

function safeStorageGet(key, fallback = null) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The calculators still work when storage is unavailable.
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseMoney(value) {
  const cleaned = String(value ?? "")
    .replace(/[$,\s]/g, "")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatMoneyInputValue(value, maxDecimals = 0, minDecimals = 0, forceMinDecimals = false) {
  const raw = String(value ?? "").replace(/[$,\s]/g, "").replace(/[^0-9.]/g, "");
  if (!raw) return "";

  const firstDot = raw.indexOf(".");
  const hasDecimal = firstDot >= 0;
  let integerPart = hasDecimal ? raw.slice(0, firstDot) : raw;
  let decimalPart = hasDecimal ? raw.slice(firstDot + 1).replace(/\./g, "") : "";

  integerPart = integerPart.replace(/^0+(?=\d)/, "") || "0";
  decimalPart = decimalPart.slice(0, maxDecimals);

  const groupedInteger = Number(integerPart).toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (maxDecimals === 0) return groupedInteger;

  if (forceMinDecimals) {
    decimalPart = decimalPart.padEnd(minDecimals, "0");
  }

  if (hasDecimal || decimalPart.length > 0 || forceMinDecimals) {
    return `${groupedInteger}.${decimalPart}`;
  }
  return groupedInteger;
}

function formatMoneyInput(element, forceMinDecimals = false) {
  const maxDecimals = Number(element.dataset.maxDecimals || 0);
  const minDecimals = Number(element.dataset.minDecimals || 0);
  element.value = formatMoneyInputValue(element.value, maxDecimals, minDecimals, forceMinDecimals);
}

function initializeMoneyInputs() {
  document.querySelectorAll(".money-input").forEach((element) => {
    formatMoneyInput(element, true);

    element.addEventListener("input", () => {
      const oldValue = element.value;
      const oldCursor = element.selectionStart ?? oldValue.length;
      const digitsRight = oldValue.slice(oldCursor).replace(/\D/g, "").length;
      formatMoneyInput(element, false);

      let cursor = element.value.length;
      let remaining = digitsRight;
      while (cursor > 0 && remaining > 0) {
        cursor -= 1;
        if (/\d/.test(element.value[cursor])) remaining -= 1;
      }
      element.setSelectionRange(cursor, cursor);
    });

    element.addEventListener("blur", () => {
      formatMoneyInput(element, true);
      saveInputs();
    });
  });
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

function formatDurationFromTrades(trades, tradesPerWeek) {
  if (!Number.isFinite(trades) || tradesPerWeek <= 0) return "—";
  const weeks = trades / tradesPerWeek;
  if (weeks < 2) return `${Math.max(1, Math.round(weeks * 7))} days`;
  if (weeks < 12) return `${weeks.toFixed(1)} weeks`;
  const months = weeks / 4.345;
  if (months < 24) return `${months.toFixed(1)} months`;
  return `${(weeks / 52.143).toFixed(1)} years`;
}

function formatAxisDuration(trades, tradesPerWeek) {
  const weeks = trades / tradesPerWeek;
  if (weeks < 12) return `${weeks.toFixed(0)}w`;
  const months = weeks / 4.345;
  if (months < 24) return `${months.toFixed(0)}mo`;
  return `${(weeks / 52.143).toFixed(1)}y`;
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

function hashInputs(values) {
  const text = JSON.stringify(values);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
    const element = $(id);
    if (!element) return;
    element.value = String(value);
    if (element.classList.contains("money-input")) formatMoneyInput(element, true);
  });
}

function saveInputs() {
  const ids = [...Object.keys(defaults.simulator), ...Object.keys(defaults.sizer)];
  const saved = {};
  ids.forEach((id) => {
    const element = $(id);
    if (element) saved[id] = element.value;
  });
  safeStorageSet("kellyLabInputs", JSON.stringify(saved));
}

function loadInputs() {
  let saved = {};
  try {
    saved = JSON.parse(safeStorageGet("kellyLabInputs", "{}") || "{}");
  } catch {
    saved = {};
  }

  Object.entries(saved).forEach(([id, value]) => {
    const element = $(id);
    if (element) element.value = value;
  });
}

function updateHeroFromSimulator() {
  const kelly = calculateKelly(
    Number($("simWinRate").value),
    Number($("simAvgWin").value),
    Number($("simAvgLoss").value)
  );
  const scale = Number($("simKellyScale").value);
  const applied = kelly.fullKelly * scale;

  $("heroKelly").textContent = Number.isFinite(kelly.fullKelly) ? `${(kelly.fullKelly * 100).toFixed(1)}%` : "—";
  $("heroRisk").textContent = Number.isFinite(applied) ? `${(applied * 100).toFixed(1)}%` : "—";
  $("heroExpectancy").textContent = Number.isFinite(kelly.expectancy) ? `${kelly.expectancy.toFixed(2)}R` : "—";
}

function estimateAutomaticHorizon(values, kelly, riskFraction) {
  const winMultiplier = 1 + riskFraction * kelly.payoffRatio;
  const lossMultiplier = 1 - riskFraction;
  const expectedLogGrowth = kelly.p * Math.log(winMultiplier) + kelly.q * Math.log(lossMultiplier);
  const goalLog = Math.log(values.target / values.start);
  const expectedTrades = expectedLogGrowth > 0 ? goalLog / expectedLogGrowth : Infinity;
  const fiveYearsOfTrades = Math.ceil(values.tradesPerWeek * 52.143 * 5);
  const desired = Math.max(500, fiveYearsOfTrades, Number.isFinite(expectedTrades) ? Math.ceil(expectedTrades * 6) : 5000);
  const operationLimit = 60000000;
  const browserCap = Math.max(500, Math.floor(operationLimit / values.simulations));
  return {
    maxTrades: clamp(desired, 500, browserCap),
    expectedTrades,
    expectedLogGrowth,
    fiveYearCoverage: browserCap >= fiveYearsOfTrades
  };
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
    equity *= rng() < p ? 1 + riskFraction * payoffRatio : 1 - riskFraction;

    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? 1 - equity / peak : 1;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    if (drawdown >= 0.5) touchedHalfDrawdown = true;

    if (capturePath && (trade % samplingStep === 0 || equity >= target || trade === maxTrades)) {
      points.push({ trade, equity });
    }

    if (equity >= target) {
      reached = true;
      trades = trade;
    }

    if (!Number.isFinite(equity) || equity <= 0.000001) {
      equity = 0;
      trades = trade;
      break;
    }
  }

  return { reached, trades, endingEquity: equity, maxDrawdown, touchedHalfDrawdown, points };
}

function validateSimulatorInputs(values) {
  if (!Number.isFinite(values.start) || !Number.isFinite(values.target) || values.start <= 0 || values.target <= 0) {
    return "Starting and target capital must be positive dollar amounts.";
  }
  if (values.target <= values.start) return "Target capital must be greater than starting capital.";
  if (values.winRate <= 0 || values.winRate >= 100) return "Win rate must be between 0% and 100%.";
  if (values.avgWin <= 0 || values.avgLoss <= 0) return "Average winner and loser must be positive.";
  if (![1, 0.5, 0.25, 0.1].includes(values.kellyScale)) return "Select a valid Kelly fraction.";
  if (values.simulations < 1) return "Number of simulations must be positive.";
  if (values.tradesPerWeek <= 0) return "Average trades per week must be positive.";
  return null;
}

function readSimulatorValues() {
  return {
    start: parseMoney($("startCapital").value),
    target: parseMoney($("targetCapital").value),
    winRate: Number($("simWinRate").value),
    avgWin: Number($("simAvgWin").value),
    avgLoss: Number($("simAvgLoss").value),
    kellyScale: Number($("simKellyScale").value),
    simulations: Number($("simulationCount").value),
    tradesPerWeek: Number($("tradesPerWeek").value)
  };
}

function runSimulation(event) {
  if (event) event.preventDefault();
  hideMessage($("simulatorMessage"));

  const values = readSimulatorValues();
  const validationError = validateSimulatorInputs(values);
  if (validationError) {
    showMessage($("simulatorMessage"), validationError);
    return;
  }

  const kelly = calculateKelly(values.winRate, values.avgWin, values.avgLoss);
  if (kelly.rawKelly <= 0) {
    showMessage($("simulatorMessage"), "These inputs do not produce a positive Kelly edge. The Kelly allocation is 0%, so no growth simulation was run.", "warning");
    clearSimulationResults();
    updateHeroFromSimulator();
    return;
  }

  const riskFraction = kelly.fullKelly * values.kellyScale;
  if (riskFraction <= 0 || riskFraction >= 1) {
    showMessage($("simulatorMessage"), "The selected fractional-Kelly risk must be greater than 0% and below 100%.", "warning");
    clearSimulationResults();
    return;
  }

  const submitButton = $("simulatorForm").querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Running simulation…";

  window.setTimeout(() => {
    try {
      executeSimulation(values, kelly, riskFraction);
    } catch (error) {
      console.error(error);
      showMessage($("simulatorMessage"), "The simulation could not run. Refresh the page and try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }, 0);
}

function executeSimulation(values, kelly, riskFraction) {
  const horizon = estimateAutomaticHorizon(values, kelly, riskFraction);
  const seed = hashInputs({ ...values, riskFraction, maxTrades: horizon.maxTrades });
  const rng = mulberry32(seed);
  const results = [];
  const samplePaths = [];
  const sampleCount = Math.min(28, values.simulations);

  for (let i = 0; i < values.simulations; i += 1) {
    const result = simulatePath({
      start: values.start,
      target: values.target,
      p: kelly.p,
      payoffRatio: kelly.payoffRatio,
      riskFraction,
      maxTrades: horizon.maxTrades,
      rng,
      capturePath: i < sampleCount
    });
    results.push(result);
    if (result.points) samplePaths.push({ points: result.points, reached: result.reached, trades: result.trades });
  }

  const successfulTrades = results.filter((result) => result.reached).map((result) => result.trades).sort((a, b) => a - b);
  const drawdowns = results.map((result) => result.maxDrawdown).sort((a, b) => a - b);
  const reachedProbability = successfulTrades.length / results.length;
  const deepDrawdownRisk = results.filter((result) => result.touchedHalfDrawdown).length / results.length;
  const medianSuccessfulTrades = percentile(successfulTrades, 0.5);
  const fastTrades = percentile(successfulTrades, 0.25);
  const slowTrades = percentile(successfulTrades, 0.75);

  const tradesInYears = (years) => values.tradesPerWeek * 52.143 * years;
  const chanceWithin = (years) => results.filter((result) => result.reached && result.trades <= tradesInYears(years)).length / results.length;

  $("medianTime").textContent = successfulTrades.length ? formatDurationFromTrades(medianSuccessfulTrades, values.tradesPerWeek) : "Not reached";
  $("fastTime").textContent = successfulTrades.length ? formatDurationFromTrades(fastTrades, values.tradesPerWeek) : "—";
  $("slowTime").textContent = successfulTrades.length ? formatDurationFromTrades(slowTrades, values.tradesPerWeek) : "—";
  $("medianTrades").textContent = successfulTrades.length ? number0.format(Math.round(medianSuccessfulTrades)) : "—";
  $("chanceOneYear").textContent = `${(chanceWithin(1) * 100).toFixed(1)}%`;
  $("chanceThreeYears").textContent = `${(chanceWithin(3) * 100).toFixed(1)}%`;
  $("chanceFiveYears").textContent = horizon.maxTrades >= tradesInYears(5) ? `${(chanceWithin(5) * 100).toFixed(1)}%` : "Not covered";
  $("reachProbability").textContent = `${(reachedProbability * 100).toFixed(1)}%`;
  $("reachProbabilityNote").textContent = `within ${number0.format(horizon.maxTrades)} trades`;
  $("medianDrawdown").textContent = `${(percentile(drawdowns, 0.5) * 100).toFixed(1)}%`;
  $("deepDrawdownRisk").textContent = `${(deepDrawdownRisk * 100).toFixed(1)}%`;
  $("appliedRiskResult").textContent = `${(riskFraction * 100).toFixed(2)}% per trade`;
  $("winImpactResult").textContent = `+${(riskFraction * kelly.payoffRatio * 100).toFixed(2)}%`;
  $("lossImpactResult").textContent = `−${(riskFraction * 100).toFixed(2)}%`;
  $("automaticHorizonResult").textContent = `${number0.format(horizon.maxTrades)} trades / ${formatDurationFromTrades(horizon.maxTrades, values.tradesPerWeek)}`;

  if (successfulTrades.length) {
    const conditionalPhrase = reachedProbability < 0.999 ? "among paths that reached the goal" : "across the simulated paths";
    $("simulationSummary").textContent = `Using ${(riskFraction * 100).toFixed(2)}% account risk per trade, the median result ${conditionalPhrase} reached ${money0.format(values.target)} in ${formatDurationFromTrades(medianSuccessfulTrades, values.tradesPerWeek)} (${number0.format(Math.round(medianSuccessfulTrades))} trades). ${
      reachedProbability < 0.8 ? `Only ${(reachedProbability * 100).toFixed(1)}% of paths reached the target within the automatic horizon, so the time estimate is conditional and should be treated cautiously.` : ""
    }`;
  } else {
    $("simulationSummary").textContent = `None of the ${number0.format(values.simulations)} paths reached ${money0.format(values.target)} within ${number0.format(horizon.maxTrades)} trades. The target may be unrealistic under these assumptions or require a longer horizon.`;
  }

  if (riskFraction >= 0.1) {
    showMessage($("simulatorMessage"), `Your selected Kelly fraction risks ${(riskFraction * 100).toFixed(2)}% of the account on every trade. That can create very large drawdowns.`, "warning");
  }

  latestSimulationRows = results.map((result, index) => ({
    simulation: index + 1,
    reached_target: result.reached ? "Yes" : "No",
    trades_to_target_or_end: result.trades,
    estimated_weeks: result.trades / values.tradesPerWeek,
    ending_capital: result.endingEquity,
    max_drawdown_pct: result.maxDrawdown * 100,
    touched_50pct_drawdown: result.touchedHalfDrawdown ? "Yes" : "No"
  }));
  $("downloadCsv").disabled = false;

  const highlightedIndex = findMedianSampleIndex(samplePaths, medianSuccessfulTrades);
  if (highlightedIndex > 0) {
    const [highlighted] = samplePaths.splice(highlightedIndex, 1);
    samplePaths.unshift(highlighted);
  }

  lastChartData = {
    paths: samplePaths.map((sample) => sample.points),
    start: values.start,
    target: values.target,
    maxTrades: horizon.maxTrades,
    tradesPerWeek: values.tradesPerWeek
  };
  drawPathChart(lastChartData);
  updateHeroFromSimulator();
  saveInputs();
}

function findMedianSampleIndex(samples, medianTrades) {
  if (!samples.length || !Number.isFinite(medianTrades)) return 0;
  let bestIndex = 0;
  let bestDistance = Infinity;
  samples.forEach((sample, index) => {
    if (!sample.reached) return;
    const distance = Math.abs(sample.trades - medianTrades);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function clearSimulationResults() {
  [
    "medianTime", "fastTime", "slowTime", "medianTrades", "chanceOneYear", "chanceThreeYears",
    "chanceFiveYears", "reachProbability", "medianDrawdown", "deepDrawdownRisk", "appliedRiskResult",
    "winImpactResult", "lossImpactResult", "automaticHorizonResult"
  ].forEach((id) => {
    $(id).textContent = "—";
  });
  $("reachProbabilityNote").textContent = "within the automatic horizon";
  $("simulationSummary").textContent = "Enter your assumptions and run the simulator to estimate the time needed to reach your goal.";
  latestSimulationRows = [];
  lastChartData = null;
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

function drawPathChart({ paths, start, target, maxTrades, tradesPerWeek }) {
  const canvas = $("pathChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { left: 78, right: 24, top: 24, bottom: 50 };
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
    ctx.fillText(money0.format(value), padding.left - 10, y + 4);
  }

  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i += 1) {
    const trade = Math.round((maxTrades * i) / 4);
    const x = toX(trade);
    ctx.fillText(formatAxisDuration(trade, tradesPerWeek), x, height - 18);
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
    ctx.globalAlpha = index === 0 ? 1 : 0.22;
    ctx.lineWidth = index === 0 ? 3 : 1.2;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function validateSizerInputs(values) {
  if (!Number.isFinite(values.equity) || values.equity <= 0) return "Account equity must be a positive dollar amount.";
  if (values.winRate <= 0 || values.winRate >= 100) return "Win rate must be between 0% and 100%.";
  if (values.avgWin <= 0 || values.avgLoss <= 0) return "Average winner and loser must be positive.";
  if (!Number.isFinite(values.entry) || !Number.isFinite(values.stop) || values.entry <= 0 || values.stop < 0 || values.entry === values.stop) {
    return "Entry and stop prices must be valid, different dollar amounts.";
  }
  if (values.multiplier <= 0) return "The unit multiplier must be positive.";
  if (values.rounding <= 0) return "The rounding increment must be positive.";
  return null;
}

function readSizerValues() {
  return {
    equity: parseMoney($("accountEquity").value),
    winRate: Number($("sizeWinRate").value),
    avgWin: Number($("sizeAvgWin").value),
    avgLoss: Number($("sizeAvgLoss").value),
    kellyScale: Number($("sizeKellyScale").value),
    entry: parseMoney($("entryPrice").value),
    stop: parseMoney($("stopPrice").value),
    multiplier: Number($("unitMultiplier").value),
    rounding: Number($("roundingIncrement").value)
  };
}

function calculatePositionSize(event) {
  if (event) event.preventDefault();
  hideMessage($("sizerMessage"));

  const values = readSizerValues();
  const validationError = validateSizerInputs(values);
  if (validationError) {
    showMessage($("sizerMessage"), validationError);
    return;
  }

  const kelly = calculateKelly(values.winRate, values.avgWin, values.avgLoss);
  const plannedRiskFraction = kelly.fullKelly * values.kellyScale;
  const dollarRiskBudget = values.equity * plannedRiskFraction;
  const perUnitRisk = Math.abs(values.entry - values.stop) * values.multiplier;
  const rawUnits = perUnitRisk > 0 ? dollarRiskBudget / perUnitRisk : 0;
  const units = Math.max(0, Math.floor(rawUnits / values.rounding) * values.rounding);
  const actualDollarRisk = units * perUnitRisk;
  const actualRiskFraction = values.equity > 0 ? actualDollarRisk / values.equity : 0;
  const positionValue = units * values.entry * values.multiplier;
  const leverage = values.equity > 0 ? positionValue / values.equity : 0;
  const expectancyDollars = actualDollarRisk * kelly.expectancy;
  const averageWinDollars = actualDollarRisk * kelly.payoffRatio;

  $("positionUnits").textContent = number0.format(units);
  $("sizePayoffRatio").textContent = `${kelly.payoffRatio.toFixed(2)} : 1`;
  $("sizeFullKelly").textContent = `${(kelly.fullKelly * 100).toFixed(2)}%`;
  $("sizeAppliedRisk").textContent = `${(actualRiskFraction * 100).toFixed(2)}%`;
  $("sizeDollarRisk").textContent = money2.format(actualDollarRisk);
  $("riskPerUnit").textContent = money2.format(perUnitRisk);
  $("positionNotional").textContent = money0.format(positionValue);
  $("positionLeverage").textContent = `${leverage.toFixed(2)}×`;
  $("expectedValueTrade").textContent = money2.format(expectancyDollars);
  $("averageWinDollars").textContent = money2.format(averageWinDollars);

  const badge = $("edgeBadge");
  if (kelly.rawKelly > 0) {
    badge.className = "pill positive";
    badge.textContent = `Positive edge: ${kelly.expectancy.toFixed(2)}R`;
  } else {
    badge.className = "pill negative";
    badge.textContent = `No Kelly position: ${kelly.expectancy.toFixed(2)}R`;
    showMessage($("sizerMessage"), "These assumptions do not produce a positive Kelly edge. The suggested Kelly risk is 0%.", "warning");
  }

  if (units === 0 && plannedRiskFraction > 0) {
    showMessage($("sizerMessage"), "The Kelly risk budget is smaller than the loss on one unit at your selected stop. Use a tighter stop, smaller multiplier, or more account equity.", "warning");
  } else if (plannedRiskFraction >= 0.1) {
    showMessage($("sizerMessage"), `The selected Kelly fraction targets ${(plannedRiskFraction * 100).toFixed(2)}% account risk before unit rounding. This is highly aggressive.`, "warning");
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
  safeStorageSet("kellyLabTheme", theme);
  if (lastChartData) drawPathChart(lastChartData);
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
  initializeMoneyInputs();
  initializeTabs();

  const savedTheme = safeStorageGet("kellyLabTheme", "dark") || "dark";
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

  ["simWinRate", "simAvgWin", "simAvgLoss", "simKellyScale"].forEach((id) => {
    $(id).addEventListener("input", updateHeroFromSimulator);
  });

  document.querySelectorAll("input:not(.money-input), select").forEach((element) => {
    element.addEventListener("change", saveInputs);
  });

  updateHeroFromSimulator();
  drawEmptyChart();
  calculatePositionSize();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
