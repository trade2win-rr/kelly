"use strict";

const $ = (id) => document.getElementById(id);
const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    tradesPerWeek: 10,
    simulationCount: 5000
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
let latestChartState = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function percentile(sortedValues, probability) {
  if (!sortedValues.length) return null;
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function parseNumericValue(value) {
  if (typeof value !== "string") return Number(value);
  const cleaned = value.replace(/[$,\s]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

function valueOf(id) {
  return parseNumericValue($(id).value);
}

function formatCurrencyNumber(value, maxDecimals = 0, minDecimals = 0) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals
  }).format(value);
}

function editableCurrency(raw, maxDecimals) {
  const source = String(raw ?? "");
  const hadDecimal = source.includes(".");
  const trailingDecimal = hadDecimal && source.trim().endsWith(".");
  const cleaned = source.replace(/[^\d.]/g, "");
  const pieces = cleaned.split(".");
  let integerPart = pieces.shift() || "";
  let decimalPart = pieces.join("").slice(0, maxDecimals);

  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  if (integerPart === "" && (hadDecimal || decimalPart)) integerPart = "0";
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (maxDecimals > 0 && hadDecimal) {
    return `${formattedInteger || "0"}.${decimalPart}`;
  }
  if (maxDecimals > 0 && trailingDecimal) return `${formattedInteger || "0"}.`;
  return formattedInteger;
}

function countEditableCharacters(text) {
  return (text.match(/[\d.]/g) || []).length;
}

function formatMoneyWhileTyping(input) {
  const oldValue = input.value;
  const oldCaret = input.selectionStart ?? oldValue.length;
  const significantBeforeCaret = countEditableCharacters(oldValue.slice(0, oldCaret));
  const maxDecimals = Number(input.dataset.maxDecimals || 0);
  const formatted = editableCurrency(oldValue, maxDecimals);
  input.value = formatted;

  if (document.activeElement !== input) return;
  let seen = 0;
  let newCaret = formatted.length;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/[\d.]/.test(formatted[i])) seen += 1;
    if (seen >= significantBeforeCaret) {
      newCaret = i + 1;
      break;
    }
  }
  input.setSelectionRange(newCaret, newCaret);
}

function finalizeMoneyInput(input) {
  const value = parseNumericValue(input.value);
  if (!Number.isFinite(value)) return;
  const maxDecimals = Number(input.dataset.maxDecimals || 0);
  const minDecimals = Number(input.dataset.minDecimals || 0);
  input.value = formatCurrencyNumber(value, maxDecimals, minDecimals);
}

function calculateKelly(winRatePct, avgWin, avgLoss) {
  const p = winRatePct / 100;
  const q = 1 - p;
  const payoffRatio = avgWin / avgLoss;
  const expectancy = p * payoffRatio - q;
  const rawKelly = payoffRatio > 0 ? expectancy / payoffRatio : 0;
  return {
    p,
    q,
    payoffRatio,
    expectancy,
    rawKelly,
    fullKelly: Math.max(0, rawKelly)
  };
}

function expectedLogGrowth(p, payoffRatio, riskFraction) {
  if (riskFraction <= 0 || riskFraction >= 1) return Number.NEGATIVE_INFINITY;
  return p * Math.log1p(riskFraction * payoffRatio) + (1 - p) * Math.log1p(-riskFraction);
}

function hashInputs(values) {
  const source = JSON.stringify(values);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDurationFromTrades(trades, tradesPerWeek) {
  if (!Number.isFinite(trades) || tradesPerWeek <= 0) return "—";
  const weeks = trades / tradesPerWeek;
  if (weeks < 2) return `${Math.max(1, Math.round(weeks * 7))} days`;
  if (weeks < 13) return `${weeks.toFixed(1)} weeks`;
  const months = weeks / 4.345;
  if (months < 24) return `${months.toFixed(1)} months`;
  return `${(weeks / 52.143).toFixed(1)} years`;
}

function formatCompactDurationFromTrades(trades, tradesPerWeek) {
  if (!Number.isFinite(trades) || tradesPerWeek <= 0) return "—";
  const weeks = trades / tradesPerWeek;
  if (weeks < 13) return `${Math.max(1, Math.round(weeks))} wk`;
  const years = weeks / 52.143;
  if (years < 2) return `${(weeks / 4.345).toFixed(0)} mo`;
  return `${years.toFixed(years < 10 ? 1 : 0)} yr`;
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
    if (element.classList.contains("money-input")) finalizeMoneyInput(element);
  });
}

function saveInputs() {
  const ids = [...Object.keys(defaults.simulator), ...Object.keys(defaults.sizer)];
  const saved = {};
  ids.forEach((id) => {
    if ($(id)) saved[id] = $(id).value;
  });
  localStorage.setItem("kellyLabInputsV2", JSON.stringify(saved));
}

function loadInputs() {
  const saved = JSON.parse(localStorage.getItem("kellyLabInputsV2") || "{}");
  Object.entries(saved).forEach(([id, value]) => {
    if ($(id)) $(id).value = value;
  });
  document.querySelectorAll(".money-input").forEach(finalizeMoneyInput);
}

function updateHeroFromSimulator() {
  const kelly = calculateKelly(valueOf("simWinRate"), valueOf("simAvgWin"), valueOf("simAvgLoss"));
  const scale = valueOf("simKellyScale");
  const cap = valueOf("simRiskCap") / 100;
  const applied = Math.min(kelly.fullKelly * scale, cap);

  $("heroKelly").textContent = Number.isFinite(kelly.fullKelly) ? `${(kelly.fullKelly * 100).toFixed(1)}%` : "—";
  $("heroRisk").textContent = Number.isFinite(applied) ? `${(applied * 100).toFixed(1)}%` : "—";
  $("heroExpectancy").textContent = Number.isFinite(kelly.expectancy) ? `${kelly.expectancy.toFixed(2)}R` : "—";
}

function chooseAutomaticHorizon(values, kelly, riskFraction) {
  const logGrowth = expectedLogGrowth(kelly.p, kelly.payoffRatio, riskFraction);
  const logGoal = Math.log(values.target / values.start);
  const roughTrades = logGrowth > 0 ? logGoal / logGrowth : Number.POSITIVE_INFINITY;
  const minimumCalendarTrades = values.tradesPerWeek * 52.143 * 10;
  const desiredTrades = Math.ceil(Math.max(500, minimumCalendarTrades, roughTrades * 10));
  const operationLimit = 65000000;
  const operationCappedTrades = Math.max(500, Math.floor(operationLimit / values.simulations));
  const maxTrades = Math.floor(clamp(desiredTrades, 500, Math.min(100000, operationCappedTrades)));

  return {
    maxTrades,
    roughTrades,
    logGrowth,
    wasOperationCapped: maxTrades < desiredTrades
  };
}

function simulatePath({ start, target, p, payoffRatio, riskFraction, maxTrades, rng, capturePath }) {
  let equity = start;
  let peak = start;
  let maxDrawdown = 0;
  let reached = start >= target;
  let tradesToTarget = reached ? 0 : null;
  let endingTrade = 0;
  let touchedHalfDrawdown = false;
  const points = capturePath ? [{ trade: 0, equity }] : null;
  const samplingStep = Math.max(1, Math.floor(maxTrades / 320));

  for (let trade = 1; trade <= maxTrades && !reached; trade += 1) {
    equity *= rng() < p ? 1 + riskFraction * payoffRatio : 1 - riskFraction;
    endingTrade = trade;

    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? 1 - equity / peak : 1;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    if (drawdown >= 0.5) touchedHalfDrawdown = true;

    if (capturePath && (trade % samplingStep === 0 || equity >= target || trade === maxTrades)) {
      points.push({ trade, equity });
    }

    if (equity >= target) {
      reached = true;
      tradesToTarget = trade;
    }

    if (!Number.isFinite(equity) || equity <= 0) {
      equity = 0;
      break;
    }
  }

  if (capturePath && points[points.length - 1].trade !== endingTrade) {
    points.push({ trade: endingTrade, equity });
  }

  return {
    reached,
    tradesToTarget,
    endingTrade,
    endingEquity: equity,
    maxDrawdown,
    touchedHalfDrawdown,
    points
  };
}

function validateSimulatorInputs(values) {
  if (!Number.isFinite(values.start) || values.start <= 0) return "Enter a valid starting capital greater than $0.";
  if (!Number.isFinite(values.target) || values.target <= values.start) return "Target capital must be greater than starting capital.";
  if (!Number.isFinite(values.winRate) || values.winRate <= 0 || values.winRate >= 100) return "Win rate must be greater than 0% and below 100%.";
  if (!Number.isFinite(values.avgWin) || values.avgWin <= 0) return "Average winner must be greater than 0.";
  if (!Number.isFinite(values.avgLoss) || values.avgLoss <= 0) return "Average loser must be greater than 0.";
  if (!Number.isFinite(values.riskCap) || values.riskCap <= 0 || values.riskCap >= 100) return "Maximum account risk must be greater than 0% and below 100%.";
  if (!Number.isFinite(values.tradesPerWeek) || values.tradesPerWeek <= 0) return "Average trades per week must be greater than 0.";
  if (!Number.isFinite(values.simulations) || values.simulations < 100) return "Choose at least 100 simulations.";
  return null;
}

function probabilityWithin(results, tradeLimit) {
  return results.filter((result) => result.reached && result.tradesToTarget <= tradeLimit).length / results.length;
}

function runSimulation(event) {
  if (event) event.preventDefault();
  hideMessage($("simulatorMessage"));

  const values = {
    start: valueOf("startCapital"),
    target: valueOf("targetCapital"),
    winRate: valueOf("simWinRate"),
    avgWin: valueOf("simAvgWin"),
    avgLoss: valueOf("simAvgLoss"),
    kellyScale: valueOf("simKellyScale"),
    riskCap: valueOf("simRiskCap"),
    tradesPerWeek: valueOf("tradesPerWeek"),
    simulations: valueOf("simulationCount")
  };

  const validationError = validateSimulatorInputs(values);
  if (validationError) {
    showMessage($("simulatorMessage"), validationError);
    clearSimulationResults();
    return;
  }

  const kelly = calculateKelly(values.winRate, values.avgWin, values.avgLoss);
  if (!Number.isFinite(kelly.rawKelly) || kelly.rawKelly <= 0) {
    showMessage($("simulatorMessage"), "These assumptions do not produce a positive Kelly edge. Increase the win rate, improve the payoff ratio, or reduce the average loss.", "warning");
    clearSimulationResults();
    updateHeroFromSimulator();
    return;
  }

  const riskFraction = Math.min(kelly.fullKelly * values.kellyScale, values.riskCap / 100);
  if (!Number.isFinite(riskFraction) || riskFraction <= 0 || riskFraction >= 1) {
    showMessage($("simulatorMessage"), "The calculated account risk is invalid. Check the Kelly fraction and risk limit.");
    clearSimulationResults();
    return;
  }

  const horizon = chooseAutomaticHorizon(values, kelly, riskFraction);
  if (!Number.isFinite(horizon.logGrowth) || horizon.logGrowth <= 0) {
    showMessage($("simulatorMessage"), "These assumptions have non-positive compounded growth at the selected risk level, so a reliable time-to-goal estimate cannot be produced.", "warning");
    clearSimulationResults();
    return;
  }

  const seed = hashInputs({ ...values, riskFraction, maxTrades: horizon.maxTrades });
  const rng = mulberry32(seed);
  const results = [];
  const samplePaths = [];
  const sampleCount = Math.min(30, values.simulations);
  const sampleEvery = Math.max(1, Math.floor(values.simulations / sampleCount));

  for (let index = 0; index < values.simulations; index += 1) {
    const capturePath = index % sampleEvery === 0 && samplePaths.length < sampleCount;
    const result = simulatePath({
      start: values.start,
      target: values.target,
      p: kelly.p,
      payoffRatio: kelly.payoffRatio,
      riskFraction,
      maxTrades: horizon.maxTrades,
      rng,
      capturePath
    });
    results.push(result);
    if (result.points) samplePaths.push(result);
  }

  const successfulTrades = results
    .filter((result) => result.reached)
    .map((result) => result.tradesToTarget)
    .sort((a, b) => a - b);
  const drawdowns = results.map((result) => result.maxDrawdown).sort((a, b) => a - b);
  const reachedProbability = successfulTrades.length / results.length;
  const deepDrawdownRisk = results.filter((result) => result.touchedHalfDrawdown).length / results.length;

  const medianTrades = percentile(successfulTrades, 0.5);
  const fastTrades = percentile(successfulTrades, 0.25);
  const slowTrades = percentile(successfulTrades, 0.75);
  const oneYearTrades = values.tradesPerWeek * 52.143;
  const threeYearTrades = oneYearTrades * 3;
  const fiveYearTrades = oneYearTrades * 5;

  $("medianTime").textContent = medianTrades === null ? "Not reached" : formatDurationFromTrades(medianTrades, values.tradesPerWeek);
  $("fastTime").textContent = fastTrades === null ? "—" : formatDurationFromTrades(fastTrades, values.tradesPerWeek);
  $("slowTime").textContent = slowTrades === null ? "—" : formatDurationFromTrades(slowTrades, values.tradesPerWeek);
  $("medianTrades").textContent = medianTrades === null ? "—" : number0.format(Math.round(medianTrades));
  $("chanceOneYear").textContent = `${(probabilityWithin(results, oneYearTrades) * 100).toFixed(1)}%`;
  $("chanceThreeYears").textContent = `${(probabilityWithin(results, threeYearTrades) * 100).toFixed(1)}%`;
  $("chanceFiveYears").textContent = `${(probabilityWithin(results, fiveYearTrades) * 100).toFixed(1)}%`;
  $("reachProbability").textContent = `${(reachedProbability * 100).toFixed(1)}%`;
  $("medianDrawdown").textContent = `${(percentile(drawdowns, 0.5) * 100).toFixed(1)}%`;
  $("deepDrawdownRisk").textContent = `${(deepDrawdownRisk * 100).toFixed(1)}%`;

  const winImpact = riskFraction * kelly.payoffRatio;
  $("appliedRiskResult").textContent = `${(riskFraction * 100).toFixed(2)}%`;
  $("winImpactResult").textContent = `+${(winImpact * 100).toFixed(2)}%`;
  $("lossImpactResult").textContent = `−${(riskFraction * 100).toFixed(2)}%`;
  $("automaticHorizonResult").textContent = formatDurationFromTrades(horizon.maxTrades, values.tradesPerWeek);
  $("reachProbabilityNote").textContent = `within ${formatDurationFromTrades(horizon.maxTrades, values.tradesPerWeek)}`;

  const startText = money0.format(values.start);
  const targetText = money0.format(values.target);
  if (medianTrades !== null) {
    $("simulationSummary").innerHTML = `At <strong>${number0.format(values.tradesPerWeek)} trades per week</strong> and <strong>${(riskFraction * 100).toFixed(2)}% account risk per trade</strong>, the median simulated path grew from <strong>${startText}</strong> to <strong>${targetText}</strong> in <strong>${formatDurationFromTrades(medianTrades, values.tradesPerWeek)}</strong> (${number0.format(Math.round(medianTrades))} trades). The middle half of successful outcomes ranged from <strong>${formatDurationFromTrades(fastTrades, values.tradesPerWeek)}</strong> to <strong>${formatDurationFromTrades(slowTrades, values.tradesPerWeek)}</strong>.`;
  } else {
    $("simulationSummary").innerHTML = `None of the simulated paths reached <strong>${targetText}</strong> within the automatic horizon of <strong>${formatDurationFromTrades(horizon.maxTrades, values.tradesPerWeek)}</strong>. The edge may be too small, the target too distant, or the risk level too low for a useful estimate.`;
  }

  if (reachedProbability < 0.8) {
    showMessage($("simulatorMessage"), `Only ${(reachedProbability * 100).toFixed(1)}% of paths reached the target within the automatic ${formatDurationFromTrades(horizon.maxTrades, values.tradesPerWeek)} horizon. The displayed time range is conditional on paths that succeeded and should be treated cautiously.`, "warning");
  } else if (horizon.wasOperationCapped) {
    showMessage($("simulatorMessage"), "The automatic horizon was limited to keep the browser responsive. Increase the edge, risk level, or trading frequency if too few paths reach the goal.", "warning");
  }

  latestSimulationRows = results.map((result, index) => ({
    simulation: index + 1,
    reached_target: result.reached ? "Yes" : "No",
    trades_to_target: result.tradesToTarget ?? "",
    weeks_to_target: result.reached ? result.tradesToTarget / values.tradesPerWeek : "",
    years_to_target: result.reached ? result.tradesToTarget / values.tradesPerWeek / 52.143 : "",
    ending_capital: result.endingEquity,
    max_drawdown_pct: result.maxDrawdown * 100,
    touched_50pct_drawdown: result.touchedHalfDrawdown ? "Yes" : "No"
  }));
  $("downloadCsv").disabled = false;

  const chartMaxTrades = medianTrades === null
    ? horizon.maxTrades
    : Math.min(horizon.maxTrades, Math.max(100, Math.ceil(percentile(successfulTrades, 0.9) * 1.15)));
  const highlightIndex = findRepresentativePathIndex(samplePaths, medianTrades, percentile(results.map((result) => result.endingEquity).sort((a, b) => a - b), 0.5));
  latestChartState = {
    paths: samplePaths,
    start: values.start,
    target: values.target,
    chartMaxTrades,
    tradesPerWeek: values.tradesPerWeek,
    highlightIndex
  };
  drawPathChart(latestChartState);
  updateHeroFromSimulator();
  saveInputs();
}

function findRepresentativePathIndex(paths, medianTrades, medianEndingEquity) {
  if (!paths.length) return -1;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  paths.forEach((path, index) => {
    const distance = medianTrades !== null && path.reached
      ? Math.abs(path.tradesToTarget - medianTrades)
      : Math.abs(Math.log(Math.max(path.endingEquity, 1)) - Math.log(Math.max(medianEndingEquity, 1)));
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
  latestChartState = null;
  $("downloadCsv").disabled = true;
  drawEmptyChart();
}

function getCssVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawEmptyChart() {
  const canvas = $("pathChart");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = getCssVariable("--bg-secondary");
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = getCssVariable("--muted");
  context.font = "16px Inter, sans-serif";
  context.textAlign = "center";
  context.fillText("Run the simulator to draw sample account paths.", canvas.width / 2, canvas.height / 2);
}

function drawPathChart(state) {
  const { paths, start, target, chartMaxTrades, tradesPerWeek, highlightIndex } = state;
  const canvas = $("pathChart");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { left: 78, right: 24, top: 24, bottom: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  context.clearRect(0, 0, width, height);
  context.fillStyle = getCssVariable("--bg-secondary");
  context.fillRect(0, 0, width, height);

  const visiblePoints = paths.flatMap((path) => path.points.filter((point) => point.trade <= chartMaxTrades));
  const allEquities = visiblePoints.map((point) => point.equity).filter((value) => value > 0 && Number.isFinite(value));
  const minEquity = Math.max(1, Math.min(start * 0.35, ...allEquities));
  const maxEquity = Math.max(target * 1.15, ...allEquities);
  const minLog = Math.log10(minEquity);
  const maxLog = Math.log10(maxEquity);
  const toX = (trade) => padding.left + (Math.min(trade, chartMaxTrades) / chartMaxTrades) * chartWidth;
  const toY = (equity) => padding.top + (1 - (Math.log10(Math.max(equity, minEquity)) - minLog) / (maxLog - minLog || 1)) * chartHeight;

  context.strokeStyle = getCssVariable("--line");
  context.lineWidth = 1;
  context.fillStyle = getCssVariable("--muted");
  context.font = "12px Inter, sans-serif";
  context.textAlign = "right";

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const value = 10 ** (minLog + (maxLog - minLog) * ratio);
    const y = padding.top + chartHeight - ratio * chartHeight;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(money0.format(value), padding.left - 10, y + 4);
  }

  context.textAlign = "center";
  for (let index = 0; index <= 4; index += 1) {
    const trade = chartMaxTrades * index / 4;
    const x = toX(trade);
    context.fillText(formatCompactDurationFromTrades(trade, tradesPerWeek), x, height - 18);
  }

  context.strokeStyle = getCssVariable("--warning");
  context.lineWidth = 2;
  context.setLineDash([7, 6]);
  context.beginPath();
  context.moveTo(padding.left, toY(target));
  context.lineTo(width - padding.right, toY(target));
  context.stroke();
  context.setLineDash([]);

  paths.forEach((path, pathIndex) => {
    const points = path.points.filter((point) => point.trade <= chartMaxTrades);
    if (points.length < 2) return;
    context.beginPath();
    points.forEach((point, pointIndex) => {
      const x = toX(point.trade);
      const y = toY(point.equity);
      if (pointIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    const highlighted = pathIndex === highlightIndex;
    context.strokeStyle = highlighted ? getCssVariable("--accent") : getCssVariable("--muted");
    context.globalAlpha = highlighted ? 1 : 0.23;
    context.lineWidth = highlighted ? 3 : 1.2;
    context.stroke();
  });
  context.globalAlpha = 1;
}

function validateSizerInputs(values) {
  if (!Number.isFinite(values.equity) || values.equity <= 0) return "Enter valid account equity greater than $0.";
  if (!Number.isFinite(values.winRate) || values.winRate <= 0 || values.winRate >= 100) return "Win rate must be greater than 0% and below 100%.";
  if (!Number.isFinite(values.avgWin) || values.avgWin <= 0) return "Average winner must be greater than 0.";
  if (!Number.isFinite(values.avgLoss) || values.avgLoss <= 0) return "Average loser must be greater than 0.";
  if (!Number.isFinite(values.entry) || values.entry <= 0) return "Entry price must be greater than $0.";
  if (!Number.isFinite(values.stop) || values.stop < 0 || values.entry === values.stop) return "Entry and stop prices must be different, and stop price cannot be negative.";
  if (!Number.isFinite(values.multiplier) || values.multiplier <= 0) return "Contract or share multiplier must be greater than 0.";
  if (!Number.isFinite(values.riskCap) || values.riskCap <= 0 || values.riskCap >= 100) return "Maximum account risk must be greater than 0% and below 100%.";
  return null;
}

function clearSizerResults() {
  [
    "positionUnits", "sizePayoffRatio", "sizeFullKelly", "sizeAppliedRisk", "sizeDollarRisk",
    "riskPerUnit", "positionNotional", "positionLeverage", "expectedValueTrade", "averageWinDollars"
  ].forEach((id) => {
    $(id).textContent = "—";
  });
  $("edgeBadge").className = "pill neutral";
  $("edgeBadge").textContent = "Waiting for valid inputs";
}

function calculatePositionSize(event) {
  if (event) event.preventDefault();
  hideMessage($("sizerMessage"));

  const values = {
    equity: valueOf("accountEquity"),
    winRate: valueOf("sizeWinRate"),
    avgWin: valueOf("sizeAvgWin"),
    avgLoss: valueOf("sizeAvgLoss"),
    kellyScale: valueOf("sizeKellyScale"),
    riskCap: valueOf("sizeRiskCap"),
    entry: valueOf("entryPrice"),
    stop: valueOf("stopPrice"),
    multiplier: valueOf("unitMultiplier"),
    rounding: valueOf("roundingIncrement")
  };

  const validationError = validateSizerInputs(values);
  if (validationError) {
    showMessage($("sizerMessage"), validationError);
    clearSizerResults();
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
  $("positionNotional").textContent = money0.format(notional);
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
    showMessage($("sizerMessage"), "These assumptions do not produce a positive Kelly edge, so the suggested risk is 0%.", "warning");
  }

  if (units === 0 && appliedRisk > 0) {
    showMessage($("sizerMessage"), "The risk budget is smaller than the loss on one unit at the chosen stop. Use a tighter stop, smaller multiplier, or higher permitted risk.", "warning");
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
  link.download = "kelly-goal-simulation.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("kellyLabTheme", theme);
  if (latestChartState) drawPathChart(latestChartState);
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

function initializeMoneyInputs() {
  document.querySelectorAll(".money-input").forEach((input) => {
    input.addEventListener("input", () => formatMoneyWhileTyping(input));
    input.addEventListener("blur", () => {
      finalizeMoneyInput(input);
      saveInputs();
    });
    finalizeMoneyInput(input);
  });
}

function initialize() {
  loadInputs();
  initializeTabs();
  initializeMoneyInputs();

  document.documentElement.dataset.theme = localStorage.getItem("kellyLabTheme") || "dark";

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

  document.querySelectorAll("input:not(.money-input), select").forEach((element) => {
    element.addEventListener("change", saveInputs);
  });

  updateHeroFromSimulator();
  drawEmptyChart();
  calculatePositionSize();
  runSimulation();
}

window.addEventListener("DOMContentLoaded", initialize);
