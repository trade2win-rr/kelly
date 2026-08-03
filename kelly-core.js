(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KellyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FACTORS = {
    full: { label: 'Full Kelly', factor: 1 },
    half: { label: 'Half Kelly', factor: 0.5 },
    quarter: { label: 'Quarter Kelly', factor: 0.25 },
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function parsePercent(value) {
    return Number(value) / 100;
  }

  function calculateKelly(winRatePct, avgWinPct, avgLossPct, factor = 1) {
    const p = parsePercent(winRatePct);
    const q = 1 - p;
    const gain = parsePercent(avgWinPct);
    const loss = parsePercent(avgLossPct);

    if (!(p > 0 && p < 1) || !(gain > 0) || !(loss > 0 && loss < 1)) {
      return {
        valid: false,
        rawFullFraction: 0,
        rawFraction: 0,
        allocationFraction: 0,
        constrained: false,
        expectancyPosition: 0,
        expectedLogGrowth: Number.NEGATIVE_INFINITY,
      };
    }

    // Maximizes p*ln(1+f*gain) + q*ln(1-f*loss).
    const rawFullFraction = (p * gain - q * loss) / (gain * loss);
    const rawFraction = Math.max(0, rawFullFraction * factor);

    // This app intentionally has no leverage mode. Allocation cannot exceed equity.
    const allocationFraction = clamp(rawFraction, 0, 1);
    const constrained = rawFraction > 1;
    const expectancyPosition = p * gain - q * loss;
    const expectedLogGrowth = allocationFraction === 0
      ? 0
      : p * Math.log1p(allocationFraction * gain)
        + q * Math.log1p(-allocationFraction * loss);

    return {
      valid: true,
      rawFullFraction,
      rawFraction,
      allocationFraction,
      constrained,
      expectancyPosition,
      expectedLogGrowth,
    };
  }

  function createScenarioSet(winRatePct, avgWinPct, avgLossPct) {
    return Object.entries(FACTORS).map(([key, item]) => ({
      key,
      label: item.label,
      factor: item.factor,
      ...calculateKelly(winRatePct, avgWinPct, avgLossPct, item.factor),
    }));
  }

  function hashString(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
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

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function summarize(values) {
    if (!values.length) return { p25: null, median: null, p75: null };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      p25: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
    };
  }

  function simulateScenario(params, scenario, seedText) {
    const {
      startCapital,
      targetCapital,
      ruinCapital,
      winRatePct,
      avgWinPct,
      avgLossPct,
      tradesPerWeek,
      horizonYears,
      simulations,
    } = params;

    const p = parsePercent(winRatePct);
    const gain = parsePercent(avgWinPct);
    const loss = parsePercent(avgLossPct);
    const allocation = scenario.allocationFraction;
    const maxTrades = Math.max(1, Math.floor(tradesPerWeek * 52 * horizonYears));
    const random = mulberry32(hashString(`${seedText}|${scenario.key}`));

    const targetTrades = [];
    const maxDrawdowns = [];
    const endings = [];
    const samplePaths = [];
    let targetCount = 0;
    let ruinCount = 0;
    let unresolvedCount = 0;
    let drawdown50Count = 0;
    let drawdown75Count = 0;

    const sampleEvery = Math.max(1, Math.ceil(maxTrades / 160));
    const desiredSamples = 24;

    for (let sim = 0; sim < simulations; sim += 1) {
      let equity = startCapital;
      let peak = startCapital;
      let maxDrawdown = 0;
      let outcome = 'unresolved';
      let endingTrade = maxTrades;
      const capture = sim < desiredSamples;
      const points = capture ? [{ trade: 0, equity }] : null;

      if (allocation <= 0) {
        unresolvedCount += 1;
        maxDrawdowns.push(0);
        endings.push(equity);
        if (capture) samplePaths.push(points);
        continue;
      }

      for (let trade = 1; trade <= maxTrades; trade += 1) {
        const won = random() < p;
        const accountReturn = allocation * (won ? gain : -loss);
        equity *= 1 + accountReturn;

        if (!Number.isFinite(equity) || equity < 0) equity = 0;
        if (equity > peak) peak = equity;
        const drawdown = peak > 0 ? 1 - equity / peak : 1;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        if (capture && (trade % sampleEvery === 0 || equity >= targetCapital || equity <= ruinCapital)) {
          points.push({ trade, equity });
        }

        if (equity >= targetCapital) {
          outcome = 'target';
          endingTrade = trade;
          targetCount += 1;
          targetTrades.push(trade);
          break;
        }

        if (equity <= ruinCapital) {
          outcome = 'ruin';
          endingTrade = trade;
          ruinCount += 1;
          break;
        }
      }

      if (outcome === 'unresolved') unresolvedCount += 1;
      if (maxDrawdown >= 0.5) drawdown50Count += 1;
      if (maxDrawdown >= 0.75) drawdown75Count += 1;
      maxDrawdowns.push(maxDrawdown);
      endings.push(equity);

      if (capture) {
        const last = points[points.length - 1];
        if (!last || last.trade !== endingTrade) points.push({ trade: endingTrade, equity });
        samplePaths.push(points);
      }
    }

    const targetStats = summarize(targetTrades);
    const drawdownStats = summarize(maxDrawdowns);
    const endingStats = summarize(endings);
    const oneYearTrades = tradesPerWeek * 52;
    const targetWithinOneYear = targetTrades.filter((trade) => trade <= oneYearTrades).length;

    return {
      key: scenario.key,
      label: scenario.label,
      factor: scenario.factor,
      allocationFraction: scenario.allocationFraction,
      constrained: scenario.constrained,
      startingBet: startCapital * scenario.allocationFraction,
      startingR: startCapital * scenario.allocationFraction * loss,
      startingWinner: startCapital * scenario.allocationFraction * gain,
      startingLoser: startCapital * scenario.allocationFraction * loss,
      winAccountImpact: scenario.allocationFraction * gain,
      lossAccountImpact: scenario.allocationFraction * loss,
      expectedLogGrowth: scenario.expectedLogGrowth,
      simulations,
      maxTrades,
      targetCount,
      ruinCount,
      unresolvedCount,
      targetProbability: targetCount / simulations,
      ruinProbability: ruinCount / simulations,
      unresolvedProbability: unresolvedCount / simulations,
      drawdown50Probability: drawdown50Count / simulations,
      drawdown75Probability: drawdown75Count / simulations,
      oneYearProbability: targetWithinOneYear / simulations,
      targetTrades: targetStats,
      maxDrawdown: drawdownStats,
      endingCapital: endingStats,
      samplePaths,
    };
  }

  function runSimulation(params) {
    const scenarios = createScenarioSet(params.winRatePct, params.avgWinPct, params.avgLossPct);
    const seedText = JSON.stringify(params);
    return scenarios.map((scenario) => simulateScenario(params, scenario, seedText));
  }

  function calculatePositionRows(params) {
    const {
      accountEquity,
      winRatePct,
      avgWinPct,
      avgLossPct,
      entryPrice,
      multiplier,
      roundingIncrement,
    } = params;

    const gain = parsePercent(avgWinPct);
    const loss = parsePercent(avgLossPct);
    const unitCost = entryPrice * multiplier;

    return createScenarioSet(winRatePct, avgWinPct, avgLossPct).map((scenario) => {
      const suggestedBet = accountEquity * scenario.allocationFraction;
      const rawUnits = unitCost > 0 ? suggestedBet / unitCost : 0;
      const units = Math.max(0, Math.floor(rawUnits / roundingIncrement) * roundingIncrement);
      const actualBet = units * unitCost;
      const oneR = actualBet * loss;
      const averageWinner = actualBet * gain;
      const averageLoser = oneR;

      return {
        ...scenario,
        suggestedBet,
        units,
        actualBet,
        oneR,
        averageWinner,
        averageLoser,
      };
    });
  }

  return {
    FACTORS,
    calculateKelly,
    createScenarioSet,
    runSimulation,
    calculatePositionRows,
  };
});
