(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const core = window.KellyCore;
  let latestSimulation = null;

  const defaults = {
    goal: {
      startCapital: '100,000', targetCapital: '5,000,000', ruinCapital: '10,000',
      goalWinRate: '60', goalAvgWin: '10', goalAvgLoss: '5', tradesPerWeek: '10',
      horizonYears: '5', simulationCount: '1000',
    },
    size: {
      accountEquity: '100,000', sizeWinRate: '60', sizeAvgWin: '10', sizeAvgLoss: '5',
      entryPrice: '100.00', unitMultiplier: '1', roundingIncrement: '1',
    },
  };

  function parseMoney(value) {
    const cleaned = String(value ?? '').replace(/[$,\s]/g, '');
    return cleaned === '' ? NaN : Number(cleaned);
  }

  function formatMoney(value, decimals = 0) {
    if (!Number.isFinite(value)) return '—';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function currency(value, decimals = 0) {
    return Number.isFinite(value) ? `$${formatMoney(value, decimals)}` : '—';
  }

  function percent(value, decimals = 1) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(decimals)}%` : '—';
  }

  function formatDuration(trades, tradesPerWeek) {
    if (!Number.isFinite(trades)) return 'Not reached';
    const weeks = trades / tradesPerWeek;
    if (weeks < 2) return `${weeks.toFixed(1)} weeks`;
    if (weeks < 13) return `${weeks.toFixed(1)} weeks`;
    const months = weeks / 4.345;
    if (months < 24) return `${months.toFixed(1)} months`;
    return `${(weeks / 52).toFixed(1)} years`;
  }

  function formatTradeCount(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'Not reached';
  }

  function formatMoneyInput(input) {
    const decimals = Number(input.dataset.decimals || 0);
    let raw = input.value.replace(/[^0-9.]/g, '');
    const firstDot = raw.indexOf('.');
    if (firstDot !== -1) raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');

    const hadDot = raw.includes('.');
    let [integer = '', fraction = ''] = raw.split('.');
    integer = integer.replace(/^0+(?=\d)/, '');
    if (integer === '') integer = '0';
    fraction = fraction.slice(0, decimals);
    const grouped = Number(integer).toLocaleString('en-US');
    input.value = decimals > 0 && hadDot ? `${grouped}.${fraction}` : grouped;
  }

  function normalizeMoneyInput(input) {
    const decimals = Number(input.dataset.decimals || 0);
    const value = parseMoney(input.value);
    if (Number.isFinite(value)) input.value = formatMoney(value, decimals);
  }

  document.querySelectorAll('.money-input').forEach((input) => {
    input.addEventListener('input', () => formatMoneyInput(input));
    input.addEventListener('blur', () => normalizeMoneyInput(input));
  });

  function showError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function clearError(element) {
    element.textContent = '';
    element.classList.add('hidden');
  }

  function validateStats(winRate, avgWin, avgLoss) {
    if (!(winRate > 0 && winRate < 100)) return 'Win rate must be greater than 0% and less than 100%.';
    if (!(avgWin > 0)) return 'Average winning trade must be greater than 0%.';
    if (!(avgLoss > 0 && avgLoss < 100)) return 'Average losing trade must be greater than 0% and less than 100%.';
    return '';
  }

  function updateHero(winRate = Number($('goalWinRate').value), avgWin = Number($('goalAvgWin').value), avgLoss = Number($('goalAvgLoss').value)) {
    const scenarios = core.createScenarioSet(winRate, avgWin, avgLoss);
    const map = Object.fromEntries(scenarios.map((item) => [item.key, item]));
    $('heroFull').textContent = percent(map.full.allocationFraction, 1);
    $('heroHalf').textContent = percent(map.half.allocationFraction, 1);
    $('heroQuarter').textContent = percent(map.quarter.allocationFraction, 1);
  }

  ['goalWinRate', 'goalAvgWin', 'goalAvgLoss'].forEach((id) => $(id).addEventListener('input', () => updateHero()));
  updateHero();

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.panel));
    });
  });

  $('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    if (latestSimulation) drawChart($('chartScenario').value);
  });

  function readGoalInputs() {
    return {
      startCapital: parseMoney($('startCapital').value),
      targetCapital: parseMoney($('targetCapital').value),
      ruinCapital: parseMoney($('ruinCapital').value),
      winRatePct: Number($('goalWinRate').value),
      avgWinPct: Number($('goalAvgWin').value),
      avgLossPct: Number($('goalAvgLoss').value),
      tradesPerWeek: Number($('tradesPerWeek').value),
      horizonYears: Number($('horizonYears').value),
      simulations: Number($('simulationCount').value),
    };
  }

  function validateGoal(params) {
    if (!(params.startCapital > 0)) return 'Starting capital must be greater than $0.';
    if (!(params.targetCapital > params.startCapital)) return 'Target capital must be greater than starting capital.';
    if (!(params.ruinCapital >= 0 && params.ruinCapital < params.startCapital)) return 'Ruin threshold must be below starting capital.';
    const statsError = validateStats(params.winRatePct, params.avgWinPct, params.avgLossPct);
    if (statsError) return statsError;
    if (!(params.tradesPerWeek > 0)) return 'Average trades per week must be greater than 0.';
    return '';
  }

  function renderKellyCards(results) {
    $('goalKellyCards').classList.remove('placeholder-grid');
    $('goalKellyCards').innerHTML = results.map((result) => `
      <article class="kelly-card">
        <h4>${result.label}</h4>
        <div class="allocation">${percent(result.allocationFraction, 1)}</div>
        <dl>
          <dt>Starting bet</dt><dd>${currency(result.startingBet)}</dd>
          <dt>Starting 1R</dt><dd>${currency(result.startingR)}</dd>
          <dt>Average winner</dt><dd>${currency(result.startingWinner)}</dd>
          <dt>Average loser</dt><dd>-${currency(result.startingLoser)}</dd>
        </dl>
      </article>`).join('');

    const constrained = results.filter((result) => result.constrained);
    if (constrained.length) {
      $('allocationNote').innerHTML = `<strong>Available-equity limit applied:</strong> ${constrained.map((x) => x.label).join(', ')} mathematically calls for more than 100% of equity. Because this app has no leverage mode, the suggested allocation is shown as 100%.`;
      $('allocationNote').classList.remove('hidden');
    } else {
      $('allocationNote').classList.add('hidden');
    }
  }

  function renderGoalTable(results, tradesPerWeek) {
    $('goalResultsBody').innerHTML = results.map((result) => `
      <tr>
        <td><strong>${result.label}</strong></td>
        <td>${percent(result.allocationFraction, 1)}</td>
        <td>${currency(result.startingR)}</td>
        <td>${formatTradeCount(result.targetTrades.median)}</td>
        <td>${formatDuration(result.targetTrades.median, tradesPerWeek)}</td>
        <td>${percent(result.targetProbability, 1)}</td>
        <td>${percent(result.ruinProbability, 2)}</td>
        <td>${percent(result.maxDrawdown.median, 1)}</td>
      </tr>`).join('');
  }

  function renderGoalSummary(results, params) {
    const full = results.find((result) => result.key === 'full');
    const constrainedText = full.constrained ? 'The no-leverage rule limits Full Kelly to the available account balance. ' : '';
    $('goalSummary').textContent = `${constrainedText}At ${percent(full.allocationFraction, 1)} allocation, an average winning trade changes the account by +${percent(full.winAccountImpact, 1)} and an average losing trade changes it by -${percent(full.lossAccountImpact, 1)}. The median result is based on ${params.simulations.toLocaleString('en-US')} independent-trade simulations, not on every trade being a winner.`;
  }

  $('goalForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const params = readGoalInputs();
    const error = validateGoal(params);
    if (error) {
      showError($('goalError'), error);
      return;
    }
    clearError($('goalError'));

    const button = event.submitter;
    if (button) { button.disabled = true; button.textContent = 'Running…'; }
    window.setTimeout(() => {
      try {
        latestSimulation = { params, results: core.runSimulation(params) };
        renderKellyCards(latestSimulation.results);
        renderGoalTable(latestSimulation.results, params.tradesPerWeek);
        renderGoalSummary(latestSimulation.results, params);
        $('chartScenario').disabled = false;
        $('downloadCsv').disabled = false;
        drawChart($('chartScenario').value);
      } catch (err) {
        console.error(err);
        showError($('goalError'), 'The simulation could not run. Please check the inputs and try again.');
      } finally {
        if (button) { button.disabled = false; button.textContent = 'Estimate time to goal'; }
      }
    }, 20);
  });

  function drawChart(key) {
    if (!latestSimulation) return;
    const result = latestSimulation.results.find((item) => item.key === key) || latestSimulation.results[0];
    const { params } = latestSimulation;
    $('chartTitle').textContent = `${result.label} sample paths`;

    const canvas = $('pathChart');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(600, Math.floor(rect.width * dpr));
    canvas.height = Math.max(310, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.clearRect(0, 0, width, height);

    const css = getComputedStyle(document.body);
    const border = css.getPropertyValue('--border').trim();
    const muted = css.getPropertyValue('--muted').trim();
    const accent = css.getPropertyValue('--accent').trim();
    const danger = css.getPropertyValue('--danger').trim();
    const positive = css.getPropertyValue('--positive').trim();
    const surface = css.getPropertyValue('--surface-2').trim();
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, width, height);

    const pad = { left: 70, right: 24, top: 24, bottom: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxTrade = result.maxTrades;
    const minValue = Math.max(1, Math.min(params.ruinCapital || 1, params.startCapital));
    const maxValue = Math.max(params.targetCapital, ...result.samplePaths.flatMap((path) => path.map((point) => point.equity)));
    const minLog = Math.log(minValue);
    const maxLog = Math.log(maxValue);
    const x = (trade) => pad.left + (trade / maxTrade) * plotW;
    const y = (value) => pad.top + (1 - (Math.log(Math.max(value, 1)) - minLog) / Math.max(1e-9, maxLog - minLog)) * plotH;

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.font = '12px system-ui';
    for (let i = 0; i <= 5; i += 1) {
      const fraction = i / 5;
      const trade = Math.round(maxTrade * fraction);
      const xp = x(trade);
      ctx.beginPath(); ctx.moveTo(xp, pad.top); ctx.lineTo(xp, pad.top + plotH); ctx.stroke();
      ctx.fillText(`${(trade / params.tradesPerWeek).toFixed(0)}w`, xp - 10, height - 16);
    }

    const guide = (value, color, label) => {
      const yp = y(value);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(pad.left, yp); ctx.lineTo(pad.left + plotW, yp); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, 8, yp + 4);
    };
    guide(params.targetCapital, positive, 'Target');
    if (params.ruinCapital > 0) guide(params.ruinCapital, danger, 'Ruin');

    result.samplePaths.forEach((path, index) => {
      ctx.strokeStyle = index === 0 ? accent : `${accent}44`;
      ctx.lineWidth = index === 0 ? 2.5 : 1;
      ctx.beginPath();
      path.forEach((point, pointIndex) => {
        if (pointIndex === 0) ctx.moveTo(x(point.trade), y(point.equity));
        else ctx.lineTo(x(point.trade), y(point.equity));
      });
      ctx.stroke();
    });
  }

  $('chartScenario').addEventListener('change', () => drawChart($('chartScenario').value));
  window.addEventListener('resize', () => { if (latestSimulation) drawChart($('chartScenario').value); });

  $('downloadCsv').addEventListener('click', () => {
    if (!latestSimulation) return;
    const rows = [['Kelly level', 'Allocation', 'Starting bet', 'Starting 1R', 'Median trades', 'Median weeks', 'Target probability', 'Risk of ruin', 'Median max drawdown']];
    latestSimulation.results.forEach((result) => rows.push([
      result.label,
      result.allocationFraction,
      result.startingBet,
      result.startingR,
      result.targetTrades.median ?? '',
      result.targetTrades.median ? result.targetTrades.median / latestSimulation.params.tradesPerWeek : '',
      result.targetProbability,
      result.ruinProbability,
      result.maxDrawdown.median,
    ]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kellylab-results.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  });

  function readSizeInputs() {
    return {
      accountEquity: parseMoney($('accountEquity').value),
      winRatePct: Number($('sizeWinRate').value),
      avgWinPct: Number($('sizeAvgWin').value),
      avgLossPct: Number($('sizeAvgLoss').value),
      entryPrice: parseMoney($('entryPrice').value),
      multiplier: Number($('unitMultiplier').value),
      roundingIncrement: Number($('roundingIncrement').value),
    };
  }

  function validateSize(params) {
    if (!(params.accountEquity > 0)) return 'Account equity must be greater than $0.';
    const statsError = validateStats(params.winRatePct, params.avgWinPct, params.avgLossPct);
    if (statsError) return statsError;
    if (!(params.entryPrice > 0)) return 'Entry price must be greater than $0.';
    if (!(params.multiplier > 0)) return 'Share or contract multiplier must be greater than 0.';
    if (!(params.roundingIncrement > 0)) return 'Rounding increment must be greater than 0.';
    return '';
  }

  $('sizeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const params = readSizeInputs();
    const error = validateSize(params);
    if (error) {
      showError($('sizeError'), error);
      return;
    }
    clearError($('sizeError'));
    const rows = core.calculatePositionRows(params);
    $('sizeResultsBody').innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${row.label}</strong>${row.constrained ? '<br><small>limited to equity</small>' : ''}</td>
        <td>${percent(row.allocationFraction, 1)}</td>
        <td>${currency(row.suggestedBet)}</td>
        <td>${row.units.toLocaleString('en-US')}</td>
        <td>${currency(row.actualBet)}</td>
        <td>${currency(row.oneR)}</td>
        <td>${currency(row.averageWinner)}</td>
      </tr>`).join('');
    const full = rows.find((row) => row.key === 'full');
    $('sizeExplanation').textContent = `${full.label} suggests placing ${currency(full.suggestedBet)} into the trade. Based on a ${params.avgLossPct}% average losing trade, 1R is ${currency(full.oneR)} after unit rounding; an average ${params.avgWinPct}% winner is ${currency(full.averageWinner)}.`;
  });

  function resetGroup(group) {
    Object.entries(defaults[group]).forEach(([id, value]) => { $(id).value = value; });
    document.querySelectorAll(`#${group === 'goal' ? 'goalForm' : 'sizeForm'} .money-input`).forEach(normalizeMoneyInput);
    updateHero();
  }

  $('resetGoal').addEventListener('click', () => {
    resetGroup('goal');
    latestSimulation = null;
    $('goalKellyCards').className = 'kelly-card-grid placeholder-grid';
    $('goalKellyCards').innerHTML = '<p>Run the simulator to calculate full, half, and quarter Kelly.</p>';
    $('goalResultsBody').innerHTML = '<tr><td colspan="8" class="empty-cell">Run the simulator to see results.</td></tr>';
    $('goalSummary').textContent = 'The result will explain exactly how much each average win and loss changes the account.';
    $('allocationNote').classList.add('hidden');
    $('chartScenario').disabled = true;
    $('downloadCsv').disabled = true;
    const canvas = $('pathChart');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  });

  $('resetSize').addEventListener('click', () => {
    resetGroup('size');
    $('sizeResultsBody').innerHTML = '<tr><td colspan="7" class="empty-cell">Calculate a position to see results.</td></tr>';
    $('sizeExplanation').textContent = 'Kelly determines the capital allocation. Your average losing-trade percentage determines the dollar value of 1R.';
  });
})();
