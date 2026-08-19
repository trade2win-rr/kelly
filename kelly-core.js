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

    // No leverage in this version: one trade cannot use more than 100% of equity.
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


  function summarizeCensoredTarget(values, totalPaths) {
    if (!values.length || !(totalPaths > 0)) return { p25: null, median: null, p75: null };
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => {
      const requiredRank = Math.ceil(q * totalPaths);
      if (sorted.length < requiredRank) return null;
      return sorted[Math.max(0, requiredRank - 1)];
    };
    return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
  }

  function standardNormal(random) {
    let u1 = random();
    let u2 = random();
    if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function poisson(lambda, random) {
    if (!(lambda > 0)) return 0;
    if (lambda >= 30) {
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * standardNormal(random)));
    }
    const limit = Math.exp(-lambda);
    let product = 1;
    let k = 0;
    do {
      k += 1;
      product *= random();
    } while (product > limit);
    return k - 1;
  }

  // Gamma(shape=4) distribution with mean = averageDays and CV = 50%.
  // This keeps holding periods positive while allowing realistic variation around the average.
  function sampleHoldingDays(averageDays, random) {
    const theta = averageDays / 4;
    let sum = 0;
    for (let i = 0; i < 4; i += 1) {
      let u = random();
      if (u <= Number.EPSILON) u = Number.EPSILON;
      sum += -Math.log(u) * theta;
    }
    return Math.max(1, Math.round(sum));
  }

  function portfolioEquity(cash, openPositions) {
    let equity = cash;
    for (let i = 0; i < openPositions.length; i += 1) equity += openPositions[i].bet;
    return equity;
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
      holdingPeriodDays,
      horizonYears,
      simulations,
    } = params;

    const p = parsePercent(winRatePct);
    const gain = parsePercent(avgWinPct);
    const loss = parsePercent(avgLossPct);
    const allocation = scenario.allocationFraction;
    const maxDays = Math.max(1, Math.floor(horizonYears * 365.25));
    const dailyArrivalRate = tradesPerWeek / 7;
    const random = mulberry32(hashString(`${seedText}|${scenario.key}`));

    const targetDays = [];
    const targetClosedTrades = [];
    const maxDrawdowns = [];
    const endings = [];
    const fundedRates = [];
    const samplePaths = [];
    let targetCount = 0;
    let ruinCount = 0;
    let unresolvedCount = 0;
    let drawdown50Count = 0;
    let drawdown75Count = 0;
    let totalOpportunities = 0;
    let totalFunded = 0;
    let totalSkipped = 0;

    const sampleEveryDays = Math.max(1, Math.ceil(maxDays / 180));
    const desiredSamples = 24;

    for (let sim = 0; sim < simulations; sim += 1) {
      let cash = startCapital;
      let openPositions = [];
      let equity = startCapital;
      let peak = startCapital;
      let maxDrawdown = 0;
      let outcome = 'unresolved';
      let endingDay = maxDays;
      let opportunities = 0;
      let funded = 0;
      let skipped = 0;
      let closedTrades = 0;
      const capture = sim < desiredSamples;
      const points = capture ? [{ day: 0, equity }] : null;

      if (allocation <= 0) {
        unresolvedCount += 1;
        maxDrawdowns.push(0);
        endings.push(equity);
        fundedRates.push(0);
        if (capture) samplePaths.push(points);
        continue;
      }

      for (let day = 1; day <= maxDays; day += 1) {
        // Positions close before new opportunities arrive for the day, freeing their capital.
        if (openPositions.length) {
          const remaining = [];
          for (let i = 0; i < openPositions.length; i += 1) {
            const position = openPositions[i];
            if (position.exitDay <= day) {
              const pnl = position.bet * (position.won ? gain : -loss);
              cash += position.bet + pnl;
              closedTrades += 1;
            } else {
              remaining.push(position);
            }
          }
          openPositions = remaining;
        }

        equity = portfolioEquity(cash, openPositions);
        if (!Number.isFinite(equity) || equity < 0) equity = 0;
        if (equity > peak) peak = equity;
        const drawdown = peak > 0 ? 1 - equity / peak : 1;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        if (equity >= targetCapital) {
          outcome = 'target';
          endingDay = day;
          targetCount += 1;
          targetDays.push(day);
          targetClosedTrades.push(closedTrades);
          if (capture) points.push({ day, equity });
          break;
        }
        if (equity <= ruinCapital) {
          outcome = 'ruin';
          endingDay = day;
          ruinCount += 1;
          if (capture) points.push({ day, equity });
          break;
        }

        const arrivals = poisson(dailyArrivalRate, random);
        for (let a = 0; a < arrivals; a += 1) {
          opportunities += 1;
          equity = portfolioEquity(cash, openPositions);
          const desiredBet = equity * allocation;
          const actualBet = Math.min(desiredBet, cash);

          if (!(actualBet > 0)) {
            skipped += 1;
            continue;
          }

          cash -= actualBet;
          const holdDays = sampleHoldingDays(holdingPeriodDays, random);
          openPositions.push({
            bet: actualBet,
            won: random() < p,
            exitDay: day + holdDays,
          });
          funded += 1;
        }

        equity = portfolioEquity(cash, openPositions);
        if (capture && (day % sampleEveryDays === 0 || day === maxDays)) points.push({ day, equity });
      }

      if (outcome === 'unresolved') unresolvedCount += 1;
      if (maxDrawdown >= 0.5) drawdown50Count += 1;
      if (maxDrawdown >= 0.75) drawdown75Count += 1;
      maxDrawdowns.push(maxDrawdown);
      endings.push(equity);
      fundedRates.push(opportunities > 0 ? funded / opportunities : 0);
      totalOpportunities += opportunities;
      totalFunded += funded;
      totalSkipped += skipped;

      if (capture) {
        const last = points[points.length - 1];
        if (!last || last.day !== endingDay) points.push({ day: endingDay, equity });
        samplePaths.push(points);
      }
    }

    // Target-time quantiles are unconditional across all simulation paths. If fewer
    // than 50% of paths hit the target within the horizon, the median is "not reached".
    const targetDayStats = summarizeCensoredTarget(targetDays, simulations);
    const targetTradeStats = summarizeCensoredTarget(targetClosedTrades, simulations);
    const drawdownStats = summarize(maxDrawdowns);
    const endingStats = summarize(endings);
    const fundedRateStats = summarize(fundedRates);
    const targetWithinOneYear = targetDays.filter((day) => day <= 365.25).length;

    return {
      key: scenario.key,
      label: scenario.label,
      factor: scenario.factor,
      allocationFraction: scenario.allocationFraction,
      rawAllocationFraction: scenario.rawFraction,
      constrained: scenario.constrained,
      startingBet: startCapital * scenario.allocationFraction,
      startingR: startCapital * scenario.allocationFraction * loss,
      startingWinner: startCapital * scenario.allocationFraction * gain,
      startingLoser: startCapital * scenario.allocationFraction * loss,
      winAccountImpact: scenario.allocationFraction * gain,
      lossAccountImpact: scenario.allocationFraction * loss,
      expectedLogGrowth: scenario.expectedLogGrowth,
      simulations,
      maxDays,
      targetCount,
      ruinCount,
      unresolvedCount,
      targetProbability: targetCount / simulations,
      ruinProbability: ruinCount / simulations,
      unresolvedProbability: unresolvedCount / simulations,
      drawdown50Probability: drawdown50Count / simulations,
      drawdown75Probability: drawdown75Count / simulations,
      oneYearProbability: targetWithinOneYear / simulations,
      targetDays: targetDayStats,
      targetTrades: targetTradeStats,
      maxDrawdown: drawdownStats,
      endingCapital: endingStats,
      fundedRate: fundedRateStats,
      overallFundedRate: totalOpportunities > 0 ? totalFunded / totalOpportunities : 0,
      totalOpportunities,
      totalFunded,
      totalSkipped,
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
    sampleHoldingDays,
  };
});
