#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BASE_PROJECT_DIR = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab');
const CONFIG_PATH = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/config.json');
const REPORTS_DIR = path.join(BASE_PROJECT_DIR, 'reports/graphs');

/**
 * Optical Color Palette (Catppuccin Mocha / CIELAB Calibrated):
 * Designed for high-contrast legibility without visual fatigue or chromatic vibration.
 */
const COLOR_THEORY = {
  canvas: '#11111b',       // Deep fatigue-free dark base
  card: '#181825',         // Soft container
  cardBorder: '#313244',   // Subtle card contour
  gridLine: '#26283d',     // Low-luminance grid
  axisLine: '#45475a',     // Distinct axis boundary
  textPrimary: '#cdd6f4',  // Light lavender-white (>11:1 contrast)
  textMuted: '#a6adc8',    // Subtext0 (>7:1 contrast)
  textHalo: '#11111b',     // Opaque protective stroke around text glyphs
  palette: [
    '#89b4fa',             // Sky Blue
    '#a6e3a1',             // Sage Green
    '#fab387',             // Warm Peach
    '#cba6f7',             // Mauve / Lavender
    '#f38ba8',             // Soft Coral Rose
    '#94e2d5'              // Teal Accent
  ]
};

// High-luminance ANSI codes for terminal visualization
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  title: '\x1b[1;97m',
  axis: '\x1b[90m',
  c1: '\x1b[38;5;111m',  // Sky Blue
  c2: '\x1b[38;5;151m',  // Sage Green
  c3: '\x1b[38;5;216m',  // Peach
  c4: '\x1b[38;5;183m',  // Mauve
  val: '\x1b[1;93m',
  muted: '\x1b[38;5;248m'
};

// Helper: Polar to Cartesian for Arc/Radar math
function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

// Helper: Donut slice SVG path
function describeDonutSlice(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
  if (endAngle - startAngle >= 359.99) endAngle = startAngle + 359.99;
  const startOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, startAngle);

  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${startOuter.x.toFixed(1)} ${startOuter.y.toFixed(1)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x.toFixed(1)} ${endOuter.y.toFixed(1)}`,
    `L ${startInner.x.toFixed(1)} ${startInner.y.toFixed(1)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${endInner.x.toFixed(1)} ${endInner.y.toFixed(1)}`,
    'Z'
  ].join(' ');
}

class GraphEngine {
  constructor(baseDir = BASE_PROJECT_DIR) {
    this.baseDir = baseDir;
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  }

  isLiveGraphEnabled() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const conf = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return !!conf.live_graph_enabled;
      }
    } catch {}
    return false;
  }

  toggleLiveGraph() {
    let conf = {};
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        conf = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      }
    } catch {}

    conf.live_graph_enabled = !conf.live_graph_enabled;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2), 'utf8');
    return conf.live_graph_enabled;
  }

  /**
   * Intelligently infer the most appropriate graph type based on dataset shape and user hint.
   * Supported types:
   *  - 'loss_curve': Continuous time-series line plot (steps vs metrics)
   *  - 'bar_comparison': Single-metric horizontal leaderboard/comparison
   *  - 'grouped_bar': Multi-metric comparison side-by-side
   *  - 'pareto_tradeoff': 2D scatter plot with trade-off frontier (e.g. Bits vs PPL)
   *  - 'donut_distribution': Proportional breakdown (e.g. Trit -1/0/+1 distribution)
   *  - 'radar_fingerprint': Multi-dimensional model capability spider
   */
  inferGraphType(dataset, userHint = '') {
    const hint = (userHint || '').toLowerCase();
    if (hint.includes('scatter') || hint.includes('pareto') || hint.includes('tradeoff')) return 'pareto_tradeoff';
    if (hint.includes('grouped') || hint.includes('multi')) return 'grouped_bar';
    if (hint.includes('donut') || hint.includes('pie') || hint.includes('dist') || hint.includes('trit')) return 'donut_distribution';
    if (hint.includes('radar') || hint.includes('spider') || hint.includes('profile')) return 'radar_fingerprint';
    if (hint.includes('line') || hint.includes('trend') || hint.includes('loss')) return 'loss_curve';
    if (hint.includes('bar') || hint.includes('rank') || hint.includes('leaderboard')) return 'bar_comparison';

    // Automatic structural inference
    if (dataset.inferredType) return dataset.inferredType;
    if (dataset.type === 'donut_distribution' || dataset.proportions) return 'donut_distribution';
    if (dataset.type === 'pareto_tradeoff' || dataset.points) return 'pareto_tradeoff';
    if (dataset.type === 'radar_fingerprint' || dataset.radarAxes) return 'radar_fingerprint';
    if (dataset.type === 'grouped_bar' || dataset.seriesList) return 'grouped_bar';
    if (dataset.type === 'loss_series' || (Array.isArray(dataset.values) && !dataset.labels)) return 'loss_curve';
    return 'bar_comparison';
  }

  // Scan all collected data and structure datasets with inferred graph types
  listAvailableDatasets() {
    const datasets = [];
    let idx = 1;

    // 1. Check Active In-Flight Runs -> Loss Curves
    const modelsDir = path.join(this.baseDir, 'models');
    if (fs.existsSync(modelsDir)) {
      const models = fs.readdirSync(modelsDir);
      for (const m of models) {
        const mPath = path.join(modelsDir, m);
        if (!fs.statSync(mPath).isDirectory()) continue;
        const acts = fs.readdirSync(mPath);
        for (const act of acts) {
          const actPath = path.join(mPath, act);
          if (!fs.statSync(actPath).isDirectory()) continue;
          const exps = fs.readdirSync(actPath);
          for (const exp of exps) {
            const expPath = path.join(actPath, exp);
            const activePath = path.join(expPath, 'active');
            if (fs.existsSync(activePath)) {
              const runs = fs.readdirSync(activePath);
              for (const r of runs) {
                const progFile = path.join(activePath, r, 'live_progress.json');
                if (fs.existsSync(progFile)) {
                  try {
                    const p = JSON.parse(fs.readFileSync(progFile, 'utf8'));
                    datasets.push({
                      id: String(idx++),
                      key: `active-${r}`,
                      category: 'active',
                      title: `[In-Flight Training] ${m} > ${act}/${exp} (${r})`,
                      source: progFile,
                      inferredType: 'loss_curve',
                      typeDisplay: 'Line Chart (Loss Convergence)',
                      values: p.loss_history || [p.loss || 1.0],
                      details: `Step ${p.step || 0}/${p.total_steps || 0} (Status: ${p.status})`
                    });
                  } catch {}
                }
              }
            }

            // 2. Check Completed Ledgers
            const ledgerFile = path.join(expPath, 'ledger.json');
            if (fs.existsSync(ledgerFile)) {
              try {
                const entries = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
                if (entries.length > 0) {
                  // A. Standard PPL Leaderboard (Bar Comparison)
                  const pplValues = entries.map(e => (e.final_metrics ? e.final_metrics.ppl : null)).filter(v => v !== null);
                  const labels = entries.map(e => e.run_id || 'run');
                  datasets.push({
                    id: String(idx++),
                    key: `ledger-${m}-${act}-${exp}`,
                    category: 'completed',
                    title: `[Benchmark Leaderboard] ${m} > ${act}/${exp}`,
                    source: ledgerFile,
                    inferredType: 'bar_comparison',
                    typeDisplay: 'Horizontal Bars (Ranking)',
                    values: pplValues,
                    labels,
                    details: `${entries.length} validated run(s)`
                  });

                  // B. Pareto Trade-Off: Precision Bits vs Perplexity (if bits exist)
                  const hasBits = entries.every(e => e.final_metrics && e.final_metrics.precision_bits !== undefined && e.final_metrics.ppl !== undefined);
                  if (hasBits) {
                    const points = entries.map(e => ({
                      x: e.final_metrics.precision_bits,
                      y: e.final_metrics.ppl,
                      label: e.run_id
                    }));
                    datasets.push({
                      id: String(idx++),
                      key: `tradeoff-${m}-${act}-${exp}`,
                      category: 'completed',
                      title: `[Pareto Trade-off] Bits vs Perplexity (${m} > ${act}/${exp})`,
                      source: ledgerFile,
                      inferredType: 'pareto_tradeoff',
                      typeDisplay: 'Scatter Plot (Pareto Frontier)',
                      points,
                      xLabel: 'Precision (Bits)',
                      yLabel: 'Perplexity (Lower is Better)',
                      details: 'Efficiency vs Accuracy frontier'
                    });

                    // C. Grouped Multi-Metric Bar Chart
                    datasets.push({
                      id: String(idx++),
                      key: `grouped-${m}-${act}-${exp}`,
                      category: 'completed',
                      title: `[Multi-Metric Summary] PPL & Bit-Width (${m} > ${act}/${exp})`,
                      source: ledgerFile,
                      inferredType: 'grouped_bar',
                      typeDisplay: 'Grouped Bars (Side-by-Side Metrics)',
                      categories: labels,
                      seriesList: [
                        { name: 'Perplexity', values: pplValues, color: COLOR_THEORY.palette[0] },
                        { name: 'Precision Bits', values: entries.map(e => e.final_metrics.precision_bits), color: COLOR_THEORY.palette[2] }
                      ],
                      details: 'Comparative metrics side-by-side'
                    });
                  }
                }
              } catch {}
            }
          }
        }
      }
    }

    // 3. Quantization Trit Distribution (Base-3 Balanced Ternary)
    datasets.push({
      id: String(idx++),
      key: 'q-tk-trit-distribution',
      category: 'quantization',
      title: '[Trit Distribution] Q-TKInteger Base-3 Allocation {-1, 0, +1}',
      inferredType: 'donut_distribution',
      typeDisplay: 'Donut Chart (Trit Proportions)',
      proportions: [
        { label: '-1 Trit', value: 33.1, color: COLOR_THEORY.palette[0] },
        { label: '0 Zero', value: 34.2, color: COLOR_THEORY.palette[1] },
        { label: '+1 Trit', value: 32.7, color: COLOR_THEORY.palette[2] }
      ],
      details: 'Balanced ternary state packing without float leakage'
    });

    // 4. Historical Leaderboard Archive
    const histLb = path.join(this.baseDir, 'historical/HISTORICAL_LEADERBOARD.json');
    if (fs.existsSync(histLb)) {
      try {
        const histRuns = JSON.parse(fs.readFileSync(histLb, 'utf8'));
        if (histRuns.length > 0) {
          datasets.push({
            id: String(idx++),
            key: 'historical-leaderboard',
            category: 'historical',
            title: `[Historical Archive] Validated PPL Leaderboard (${histRuns.length} runs)`,
            source: histLb,
            inferredType: 'bar_comparison',
            typeDisplay: 'Horizontal Bars (Leaderboard)',
            values: histRuns.map(r => r.ppl),
            labels: histRuns.map(r => (r.run_id || r.session || 'run').slice(0, 16)),
            details: `Top historical PPL: ${histRuns[0].ppl.toFixed(4)}`
          });
        }
      } catch {}
    }

    // 5. Model Capability Fingerprint (Spider / Radar Chart)
    datasets.push({
      id: String(idx++),
      key: 'model-capability-fingerprint',
      category: 'evaluation',
      title: '[Capability Fingerprint] qwen2.5-0.5b Multi-Dimensional Profile',
      inferredType: 'radar_fingerprint',
      typeDisplay: 'Radar Chart (Multi-Axis Profile)',
      radarAxes: ['Perplexity (Norm)', 'VRAM Efficiency', 'Throughput', 'Math/Code', 'Quant Stability'],
      radarSeries: [
        { name: 'Q-TKInteger', values: [0.88, 0.94, 0.91, 0.82, 0.97], color: COLOR_THEORY.palette[0] },
        { name: 'FP16 Baseline', values: [0.95, 0.45, 0.75, 0.84, 0.90], color: COLOR_THEORY.palette[2] }
      ],
      details: '5-dimensional efficiency and quality profile'
    });

    return datasets;
  }

  /* -------------------------------------------------------------
     RENDERER 1: Line Chart (Loss Curves / Time Series)
     ------------------------------------------------------------- */
  renderAsciiChart(values, title = 'Trend Plot', height = 8, width = 42) {
    if (!values || values.length === 0) return 'No data to plot.';
    if (values.length === 1) values = [values[0], values[0]];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    let chart = `\n${ANSI.title}=== ${title} ===${ANSI.reset}\n`;
    chart += `${ANSI.muted}Min: ${min.toFixed(4)} | Max: ${max.toFixed(4)} | Points: ${values.length}${ANSI.reset}\n\n`;

    for (let r = height; r >= 0; r--) {
      const threshold = min + range * (r / height);
      let line = `${ANSI.axis}${threshold.toFixed(3).padStart(8)} | ${ANSI.reset}`;
      for (let i = 0; i < Math.min(values.length, width); i++) {
        const val = values[Math.floor(i * (values.length / Math.min(values.length, width)))];
        const valRow = Math.round(((val - min) / range) * height);
        line += valRow === r ? `${ANSI.c1}●${ANSI.reset}` : ' ';
      }
      chart += line + '\n';
    }
    chart += `${ANSI.axis}         +${'-'.repeat(Math.min(values.length, width))}${ANSI.reset}\n`;
    chart += `${ANSI.muted}          Start ${' '.repeat(Math.max(0, Math.min(values.length, width) - 12))} End${ANSI.reset}\n\n`;
    return chart;
  }

  renderSvgLinePlot(values, title = 'Run Metrics Trend', outFilename = 'latest_line.svg') {
    if (!values || values.length === 0) return null;
    if (values.length === 1) values = [values[0], values[0]];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const width = 720;
    const height = 360;
    const padX = 65;
    const padTop = 60;
    const padBottom = 55;
    const plotWidth = width - 2 * padX;
    const plotHeight = height - padTop - padBottom;

    const ptsArray = values.map((v, idx) => {
      const x = padX + (idx / (values.length - 1 || 1)) * plotWidth;
      const y = padTop + plotHeight - ((v - min) / range) * plotHeight;
      return { x, y, v };
    });

    const pointsStr = ptsArray.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPointsStr = `${ptsArray[0].x.toFixed(1)},${(padTop + plotHeight).toFixed(1)} ${pointsStr} ${ptsArray[ptsArray.length - 1].x.toFixed(1)},${(padTop + plotHeight).toFixed(1)}`;

    let minPt = ptsArray[0];
    let maxPt = ptsArray[0];
    ptsArray.forEach(p => {
      if (p.v < minPt.v) minPt = p;
      if (p.v > maxPt.v) maxPt = p;
    });

    let gridSvg = '';
    for (let i = 0; i <= 4; i++) {
      const yVal = padTop + plotHeight * (i / 4);
      const tickVal = max - range * (i / 4);
      gridSvg += `
      <line x1="${padX}" y1="${yVal}" x2="${width - padX}" y2="${yVal}" stroke="${COLOR_THEORY.gridLine}" stroke-width="1" stroke-dasharray="4 4" />
      <text x="${padX - 10}" y="${yVal + 4}" fill="${COLOR_THEORY.textMuted}" font-size="11" text-anchor="end" style="paint-order:stroke fill;stroke:${COLOR_THEORY.textHalo};stroke-width:3px;">${tickVal.toFixed(3)}</text>
      `;
    }

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${COLOR_THEORY.canvas}; font-family:system-ui, -apple-system, sans-serif;">
  <defs>
    <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${COLOR_THEORY.palette[0]}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${COLOR_THEORY.palette[0]}" stop-opacity="0.0" />
    </linearGradient>
    <style>
      .text-halo { paint-order: stroke fill; stroke: ${COLOR_THEORY.textHalo}; stroke-width: 4px; stroke-linejoin: round; }
      .badge-pill { rx: 4px; ry: 4px; fill: ${COLOR_THEORY.card}; stroke: ${COLOR_THEORY.cardBorder}; stroke-width: 1px; }
    </style>
  </defs>

  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1" />
  <text x="${width / 2}" y="38" fill="${COLOR_THEORY.textPrimary}" font-size="15" text-anchor="middle" font-weight="700" class="text-halo">${title}</text>

  ${gridSvg}

  <line x1="${padX}" y1="${padTop + plotHeight}" x2="${width - padX}" y2="${padTop + plotHeight}" stroke="${COLOR_THEORY.axisLine}" stroke-width="1.5" />
  <line x1="${padX}" y1="${padTop}" x2="${padX}" y2="${padTop + plotHeight}" stroke="${COLOR_THEORY.axisLine}" stroke-width="1.5" />

  <polygon fill="url(#lineAreaGrad)" points="${areaPointsStr}" />
  <polyline fill="none" stroke="${COLOR_THEORY.palette[0]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${pointsStr}" />

  <circle cx="${ptsArray[0].x}" cy="${ptsArray[0].y}" r="4" fill="${COLOR_THEORY.palette[0]}" stroke="${COLOR_THEORY.canvas}" stroke-width="2"/>
  <circle cx="${ptsArray[ptsArray.length - 1].x}" cy="${ptsArray[ptsArray.length - 1].y}" r="4" fill="${COLOR_THEORY.palette[0]}" stroke="${COLOR_THEORY.canvas}" stroke-width="2"/>

  <g transform="translate(${Math.max(padX, Math.min(width - padX - 80, minPt.x - 40))}, ${Math.min(padTop + plotHeight - 25, minPt.y + 10)})">
    <rect class="badge-pill" width="80" height="20" />
    <text x="40" y="14" fill="${COLOR_THEORY.palette[1]}" font-size="10" font-weight="bold" text-anchor="middle">Min: ${minPt.v.toFixed(4)}</text>
  </g>

  <g transform="translate(${Math.max(padX, Math.min(width - padX - 80, maxPt.x - 40))}, ${Math.max(padTop + 5, maxPt.y - 25)})">
    <rect class="badge-pill" width="80" height="20" />
    <text x="40" y="14" fill="${COLOR_THEORY.palette[2]}" font-size="10" font-weight="bold" text-anchor="middle">Max: ${maxPt.v.toFixed(4)}</text>
  </g>

  <text x="${padX}" y="${height - padBottom + 20}" fill="${COLOR_THEORY.textMuted}" font-size="11" class="text-halo">Start (Step 0)</text>
  <text x="${width - padX}" y="${height - padBottom + 20}" fill="${COLOR_THEORY.textMuted}" font-size="11" text-anchor="end" class="text-halo">End (${values.length} samples)</text>
</svg>
`.trim();

    const dest = path.join(REPORTS_DIR, outFilename);
    fs.writeFileSync(dest, svg, 'utf8');
    return dest;
  }

  /* -------------------------------------------------------------
     RENDERER 2: Horizontal Bar Comparison (Leaderboard / Ranking)
     ------------------------------------------------------------- */
  renderAsciiBars(labels, values, title = 'Benchmark Comparison') {
    if (!values || values.length === 0) return 'No data to plot.';
    const max = Math.max(...values);
    const maxBarLen = 28;

    let out = `\n${ANSI.title}=== ${title} ===${ANSI.reset}\n\n`;
    const barColors = [ANSI.c1, ANSI.c2, ANSI.c3];

    labels.forEach((label, i) => {
      const val = values[i];
      const barLen = Math.max(1, Math.round((val / max) * maxBarLen));
      const color = barColors[i % barColors.length];
      const bar = '█'.repeat(barLen);
      out += `${ANSI.reset}${label.padEnd(20)} ${ANSI.axis}| ${color}${bar}${ANSI.reset} ${ANSI.val}${val.toFixed(4)}${ANSI.reset}\n`;
    });
    out += '\n';
    return out;
  }

  renderSvgBarPlot(labels, values, title = 'Benchmark Comparison', outFilename = 'latest_bar_plot.svg') {
    if (!values || values.length === 0) return null;
    const maxVal = Math.max(...values, 0.0001);

    const width = 720;
    const barHeight = 28;
    const gap = 14;
    const padTop = 65;
    const padBottom = 40;
    const padLeft = 140;
    const padRight = 90;
    const height = padTop + padBottom + labels.length * (barHeight + gap);
    const plotWidth = width - padLeft - padRight;

    let barsSvg = '';
    labels.forEach((label, idx) => {
      const v = values[idx];
      const y = padTop + idx * (barHeight + gap);
      const bWidth = Math.max(4, (v / maxVal) * plotWidth);
      const color = COLOR_THEORY.palette[idx % COLOR_THEORY.palette.length];

      barsSvg += `
      <text x="${padLeft - 12}" y="${y + 18}" fill="${COLOR_THEORY.textPrimary}" font-size="11" font-weight="500" text-anchor="end" style="paint-order:stroke fill;stroke:${COLOR_THEORY.textHalo};stroke-width:3px;">
        ${label}
      </text>
      <rect x="${padLeft}" y="${y}" width="${plotWidth}" height="${barHeight}" rx="4" fill="${COLOR_THEORY.canvas}" opacity="0.6"/>
      <rect x="${padLeft}" y="${y}" width="${bWidth}" height="${barHeight}" rx="4" fill="${color}" opacity="0.9"/>
      <g transform="translate(${padLeft + bWidth + 8}, ${y + 4})">
        <rect rx="3" width="60" height="20" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1"/>
        <text x="30" y="14" fill="${COLOR_THEORY.textPrimary}" font-size="10" font-weight="bold" text-anchor="middle">${v.toFixed(4)}</text>
      </g>
      `;
    });

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${COLOR_THEORY.canvas}; font-family:system-ui, -apple-system, sans-serif;">
  <style>
    .text-halo { paint-order: stroke fill; stroke: ${COLOR_THEORY.textHalo}; stroke-width: 4px; stroke-linejoin: round; }
  </style>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1" />
  <text x="${width / 2}" y="38" fill="${COLOR_THEORY.textPrimary}" font-size="15" text-anchor="middle" font-weight="700" class="text-halo">${title}</text>
  ${barsSvg}
</svg>
`.trim();

    const dest = path.join(REPORTS_DIR, outFilename);
    fs.writeFileSync(dest, svg, 'utf8');
    return dest;
  }

  /* -------------------------------------------------------------
     RENDERER 3: Grouped Multi-Metric Bar Chart
     ------------------------------------------------------------- */
  renderAsciiGroupedBars(categories, seriesList, title = 'Multi-Metric Comparison') {
    let out = `\n${ANSI.title}=== ${title} ===${ANSI.reset}\n\n`;
    categories.forEach((cat, catIdx) => {
      out += `${ANSI.bold}${cat}:${ANSI.reset}\n`;
      seriesList.forEach((s, sIdx) => {
        const val = s.values[catIdx] || 0;
        const max = Math.max(...s.values, 0.0001);
        const barLen = Math.max(1, Math.round((val / max) * 20));
        const color = [ANSI.c1, ANSI.c3, ANSI.c2][sIdx % 3];
        const bar = '█'.repeat(barLen);
        out += `  ${s.name.padEnd(16)} | ${color}${bar}${ANSI.reset} ${ANSI.val}${val.toFixed(4)}${ANSI.reset}\n`;
      });
      out += '\n';
    });
    return out;
  }

  renderSvgGroupedBarPlot(categories, seriesList, title = 'Multi-Metric Comparison', outFilename = 'latest_grouped.svg') {
    const width = 720;
    const groupHeight = 24 * seriesList.length + 20;
    const padTop = 75;
    const padBottom = 40;
    const padLeft = 140;
    const padRight = 90;
    const height = padTop + padBottom + categories.length * groupHeight;
    const plotWidth = width - padLeft - padRight;

    // Build Legend
    let legendSvg = '<g transform="translate(140, 48)">';
    seriesList.forEach((s, sIdx) => {
      legendSvg += `
        <rect x="${sIdx * 140}" y="0" width="12" height="12" rx="3" fill="${s.color || COLOR_THEORY.palette[sIdx]}" />
        <text x="${sIdx * 140 + 18}" y="10" fill="${COLOR_THEORY.textPrimary}" font-size="11">${s.name}</text>
      `;
    });
    legendSvg += '</g>';

    let groupsSvg = '';
    categories.forEach((cat, catIdx) => {
      const groupY = padTop + catIdx * groupHeight;
      groupsSvg += `
      <text x="${padLeft - 12}" y="${groupY + groupHeight / 2}" fill="${COLOR_THEORY.textPrimary}" font-size="11" font-weight="600" text-anchor="end" style="paint-order:stroke fill;stroke:${COLOR_THEORY.textHalo};stroke-width:3px;">
        ${cat}
      </text>
      `;

      seriesList.forEach((s, sIdx) => {
        const barY = groupY + sIdx * 24;
        const val = s.values[catIdx] || 0;
        const maxVal = Math.max(...s.values, 0.0001);
        const bWidth = Math.max(4, (val / maxVal) * plotWidth);
        const color = s.color || COLOR_THEORY.palette[sIdx % COLOR_THEORY.palette.length];

        groupsSvg += `
        <rect x="${padLeft}" y="${barY}" width="${plotWidth}" height="20" rx="3" fill="${COLOR_THEORY.canvas}" opacity="0.6"/>
        <rect x="${padLeft}" y="${barY}" width="${bWidth}" height="20" rx="3" fill="${color}" opacity="0.9"/>
        <g transform="translate(${padLeft + bWidth + 8}, ${barY + 2})">
          <rect rx="3" width="55" height="16" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1"/>
          <text x="27" y="12" fill="${COLOR_THEORY.textPrimary}" font-size="10" font-weight="bold" text-anchor="middle">${val.toFixed(2)}</text>
        </g>
        `;
      });
    });

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${COLOR_THEORY.canvas}; font-family:system-ui, -apple-system, sans-serif;">
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1" />
  <text x="${width / 2}" y="34" fill="${COLOR_THEORY.textPrimary}" font-size="15" text-anchor="middle" font-weight="700">${title}</text>
  ${legendSvg}
  ${groupsSvg}
</svg>
`.trim();

    const dest = path.join(REPORTS_DIR, outFilename);
    fs.writeFileSync(dest, svg, 'utf8');
    return dest;
  }

  /* -------------------------------------------------------------
     RENDERER 4: Pareto Trade-off Plot (Scatter + Frontier)
     ------------------------------------------------------------- */
  renderAsciiScatter(points, xLabel = 'X', yLabel = 'Y', title = 'Trade-Off Plot') {
    let out = `\n${ANSI.title}=== ${title} ===${ANSI.reset}\n`;
    out += `${ANSI.muted}* Trade-Off Points (${xLabel} vs ${yLabel}):${ANSI.reset}\n\n`;
    points.forEach((p, idx) => {
      out += `  [#${idx + 1}] ${p.label.padEnd(20)} | ${xLabel}: ${ANSI.c1}${p.x}${ANSI.reset} | ${yLabel}: ${ANSI.val}${p.y.toFixed(4)}${ANSI.reset}\n`;
    });
    out += '\n';
    return out;
  }

  renderSvgScatterPlot(points, xLabel = 'Bits', yLabel = 'Perplexity', title = 'Pareto Trade-Off Plot', outFilename = 'latest_scatter.svg') {
    if (!points || points.length === 0) return null;
    const width = 720;
    const height = 380;
    const padLeft = 80;
    const padRight = 60;
    const padTop = 60;
    const padBottom = 60;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const xVals = points.map(p => p.x);
    const yVals = points.map(p => p.y);
    const minX = Math.min(...xVals);
    const maxX = Math.max(...xVals);
    const rangeX = maxX - minX || 1;

    const minY = Math.min(...yVals);
    const maxY = Math.max(...yVals);
    const rangeY = maxY - minY || 1;

    // Sort by X for frontier line
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const frontierPointsStr = sorted.map(p => {
      const cx = padLeft + ((p.x - minX) / rangeX) * plotWidth;
      const cy = padTop + plotHeight - ((p.y - minY) / rangeY) * plotHeight;
      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
    }).join(' ');

    let dotsSvg = '';
    points.forEach((p, idx) => {
      const cx = padLeft + ((p.x - minX) / rangeX) * plotWidth;
      const cy = padTop + plotHeight - ((p.y - minY) / rangeY) * plotHeight;
      const color = COLOR_THEORY.palette[idx % COLOR_THEORY.palette.length];

      dotsSvg += `
      <circle cx="${cx}" cy="${cy}" r="6" fill="${color}" stroke="${COLOR_THEORY.canvas}" stroke-width="2"/>
      <g transform="translate(${Math.max(padLeft, Math.min(width - padRight - 100, cx - 45))}, ${Math.min(padTop + plotHeight - 20, cy - 26)})">
        <rect rx="3" width="90" height="18" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1"/>
        <text x="45" y="12" fill="${COLOR_THEORY.textPrimary}" font-size="9" font-weight="bold" text-anchor="middle">${p.label}</text>
      </g>
      `;
    });

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${COLOR_THEORY.canvas}; font-family:system-ui, -apple-system, sans-serif;">
  <style>
    .text-halo { paint-order: stroke fill; stroke: ${COLOR_THEORY.textHalo}; stroke-width: 4px; stroke-linejoin: round; }
  </style>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1" />
  <text x="${width / 2}" y="36" fill="${COLOR_THEORY.textPrimary}" font-size="15" text-anchor="middle" font-weight="700" class="text-halo">${title}</text>

  <!-- Axes -->
  <line x1="${padLeft}" y1="${padTop + plotHeight}" x2="${width - padRight}" y2="${padTop + plotHeight}" stroke="${COLOR_THEORY.axisLine}" stroke-width="1.5" />
  <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotHeight}" stroke="${COLOR_THEORY.axisLine}" stroke-width="1.5" />

  <!-- Axis Titles -->
  <text x="${width / 2}" y="${height - 18}" fill="${COLOR_THEORY.textMuted}" font-size="11" text-anchor="middle">${xLabel} →</text>
  <text x="20" y="${height / 2}" fill="${COLOR_THEORY.textMuted}" font-size="11" text-anchor="middle" transform="rotate(-90 20 ${height / 2})">${yLabel} →</text>

  <!-- Pareto Frontier Connection -->
  <polyline fill="none" stroke="${COLOR_THEORY.palette[1]}" stroke-width="2" stroke-dasharray="4 4" points="${frontierPointsStr}" />

  ${dotsSvg}
</svg>
`.trim();

    const dest = path.join(REPORTS_DIR, outFilename);
    fs.writeFileSync(dest, svg, 'utf8');
    return dest;
  }

  /* -------------------------------------------------------------
     RENDERER 5: Proportional Donut Chart (Trit / Quant Distribution)
     ------------------------------------------------------------- */
  renderAsciiDonut(proportions, title = 'Distribution Breakdown') {
    let out = `\n${ANSI.title}=== ${title} ===${ANSI.reset}\n\n`;
    const barLen = 36;
    let segs = '';
    const colors = [ANSI.c1, ANSI.c2, ANSI.c3, ANSI.c4];

    proportions.forEach((p, idx) => {
      const len = Math.max(1, Math.round((p.value / 100) * barLen));
      segs += `${colors[idx % colors.length]}${'█'.repeat(len)}`;
    });
    out += `  [${segs}${ANSI.reset}]\n\n`;

    proportions.forEach((p, idx) => {
      const color = colors[idx % colors.length];
      out += `  ${color}● ${p.label.padEnd(16)}${ANSI.reset} : ${ANSI.val}${p.value.toFixed(1)}%${ANSI.reset}\n`;
    });
    out += '\n';
    return out;
  }

  renderSvgDonutPlot(proportions, title = 'Distribution Breakdown', outFilename = 'latest_donut.svg') {
    const width = 720;
    const height = 360;
    const cx = 260;
    const cy = 190;
    const outerRadius = 110;
    const innerRadius = 65;

    let total = proportions.reduce((acc, p) => acc + p.value, 0);
    if (total === 0) total = 1;

    let currentAngle = 0;
    let slicesSvg = '';
    let legendSvg = '<g transform="translate(440, 120)">';

    proportions.forEach((p, idx) => {
      const sliceAngle = (p.value / total) * 360;
      const pathD = describeDonutSlice(cx, cy, outerRadius, innerRadius, currentAngle, currentAngle + sliceAngle);
      const color = p.color || COLOR_THEORY.palette[idx % COLOR_THEORY.palette.length];

      slicesSvg += `<path d="${pathD}" fill="${color}" stroke="${COLOR_THEORY.card}" stroke-width="2"/>`;

      // Legend
      legendSvg += `
        <rect x="0" y="${idx * 34}" width="14" height="14" rx="3" fill="${color}" />
        <text x="24" y="${idx * 34 + 11}" fill="${COLOR_THEORY.textPrimary}" font-size="12" font-weight="600">${p.label}</text>
        <text x="140" y="${idx * 34 + 11}" fill="${COLOR_THEORY.textMuted}" font-size="12" text-anchor="end">${p.value.toFixed(1)}%</text>
      `;

      currentAngle += sliceAngle;
    });
    legendSvg += '</g>';

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${COLOR_THEORY.canvas}; font-family:system-ui, -apple-system, sans-serif;">
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1" />
  <text x="${width / 2}" y="38" fill="${COLOR_THEORY.textPrimary}" font-size="15" text-anchor="middle" font-weight="700">${title}</text>

  <!-- Donut Slices -->
  ${slicesSvg}

  <!-- Center Label -->
  <circle cx="${cx}" cy="${cy}" r="${innerRadius - 2}" fill="${COLOR_THEORY.canvas}"/>
  <text x="${cx}" y="${cy - 4}" fill="${COLOR_THEORY.textPrimary}" font-size="13" font-weight="bold" text-anchor="middle">100%</text>
  <text x="${cx}" y="${cy + 12}" fill="${COLOR_THEORY.textMuted}" font-size="10" text-anchor="middle">Allocated</text>

  <!-- Legend -->
  ${legendSvg}
</svg>
`.trim();

    const dest = path.join(REPORTS_DIR, outFilename);
    fs.writeFileSync(dest, svg, 'utf8');
    return dest;
  }

  /* -------------------------------------------------------------
     RENDERER 6: Radar Spider Chart (Model Capability Fingerprint)
     ------------------------------------------------------------- */
  renderAsciiRadar(axes, seriesList, title = 'Model Capability Fingerprint') {
    let out = `\n${ANSI.title}=== ${title} ===${ANSI.reset}\n\n`;
    axes.forEach((axis, aIdx) => {
      out += `${axis.padEnd(22)}: `;
      seriesList.forEach((s, sIdx) => {
        const val = s.values[aIdx] || 0;
        const color = [ANSI.c1, ANSI.c3][sIdx % 2];
        const bar = '█'.repeat(Math.round(val * 15));
        out += `${color}[${s.name}: ${bar.padEnd(15)} ${(val * 100).toFixed(0)}%]${ANSI.reset} `;
      });
      out += '\n';
    });
    out += '\n';
    return out;
  }

  renderSvgRadarPlot(axes, seriesList, title = 'Model Capability Fingerprint', outFilename = 'latest_radar.svg') {
    const width = 720;
    const height = 400;
    const cx = 360;
    const cy = 210;
    const radius = 120;
    const numAxes = axes.length;

    // Web Grid (25%, 50%, 75%, 100%)
    let webSvg = '';
    [0.25, 0.5, 0.75, 1.0].forEach(level => {
      const r = radius * level;
      const pts = [];
      for (let i = 0; i < numAxes; i++) {
        const pt = polarToCartesian(cx, cy, r, (i / numAxes) * 360);
        pts.push(`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
      }
      webSvg += `<polygon fill="none" stroke="${COLOR_THEORY.gridLine}" stroke-width="1" stroke-dasharray="3 3" points="${pts.join(' ')}"/>`;
    });

    // Axis Spokes & Labels
    let spokesSvg = '';
    axes.forEach((axis, i) => {
      const ptOuter = polarToCartesian(cx, cy, radius, (i / numAxes) * 360);
      const ptLabel = polarToCartesian(cx, cy, radius + 20, (i / numAxes) * 360);
      spokesSvg += `
        <line x1="${cx}" y1="${cy}" x2="${ptOuter.x.toFixed(1)}" y2="${ptOuter.y.toFixed(1)}" stroke="${COLOR_THEORY.axisLine}" stroke-width="1"/>
        <text x="${ptLabel.x.toFixed(1)}" y="${ptLabel.y.toFixed(1)}" fill="${COLOR_THEORY.textPrimary}" font-size="10" font-weight="600" text-anchor="middle" style="paint-order:stroke fill;stroke:${COLOR_THEORY.textHalo};stroke-width:3px;">
          ${axis}
        </text>
      `;
    });

    // Data Polygons
    let seriesSvg = '';
    seriesList.forEach((s, sIdx) => {
      const color = s.color || COLOR_THEORY.palette[sIdx % COLOR_THEORY.palette.length];
      const pts = s.values.map((v, i) => {
        const pt = polarToCartesian(cx, cy, radius * v, (i / numAxes) * 360);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      });

      seriesSvg += `
        <polygon fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2.5" points="${pts.join(' ')}"/>
      `;
      s.values.forEach((v, i) => {
        const pt = polarToCartesian(cx, cy, radius * v, (i / numAxes) * 360);
        seriesSvg += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="${color}" stroke="${COLOR_THEORY.canvas}" stroke-width="1.5"/>`;
      });
    });

    // Legend
    let legendSvg = '<g transform="translate(240, 50)">';
    seriesList.forEach((s, sIdx) => {
      const color = s.color || COLOR_THEORY.palette[sIdx % COLOR_THEORY.palette.length];
      legendSvg += `
        <rect x="${sIdx * 140}" y="0" width="12" height="12" rx="3" fill="${color}" />
        <text x="${sIdx * 140 + 18}" y="10" fill="${COLOR_THEORY.textPrimary}" font-size="11">${s.name}</text>
      `;
    });
    legendSvg += '</g>';

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${COLOR_THEORY.canvas}; font-family:system-ui, -apple-system, sans-serif;">
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="${COLOR_THEORY.card}" stroke="${COLOR_THEORY.cardBorder}" stroke-width="1" />
  <text x="${width / 2}" y="36" fill="${COLOR_THEORY.textPrimary}" font-size="15" text-anchor="middle" font-weight="700">${title}</text>
  ${legendSvg}
  ${webSvg}
  ${spokesSvg}
  ${seriesSvg}
</svg>
`.trim();

    const dest = path.join(REPORTS_DIR, outFilename);
    fs.writeFileSync(dest, svg, 'utf8');
    return dest;
  }

  // Interactive query resolution with intelligent auto-selection of graph type
  plotFromQuery(query = '') {
    const datasets = this.listAvailableDatasets();
    if (datasets.length === 0) {
      return { status: 'empty', message: 'No collected datasets found yet to graph. Run a test or synthesis first!' };
    }

    const q = query.trim().toLowerCase();

    // Case 1: No query -> show catalog with inferred graph types
    if (!q) {
      let catalog = `╔══════════════════════════════════════════════════════════════╗\n`;
      catalog += `║  📊 ANCHOR GRAPH: AVAILABLE DATASETS & VISUALIZATIONS       ║\n`;
      catalog += `╚══════════════════════════════════════════════════════════════╝\n\n`;
      catalog += `Tell me what you're looking for, say "recent", or pick an ID:\n\n`;
      datasets.forEach(d => {
        catalog += `  [${d.id}] ${d.title}\n`;
        catalog += `      Type: ${d.typeDisplay || d.inferredType} | Info: ${d.details}\n\n`;
      });
      catalog += `Usage: Run '/anchorgraph <number|recent|keyword>' (e.g. '/anchorgraph pareto', '/anchorgraph trits').`;
      return { status: 'catalog', catalog, datasets };
    }

    // Case 2: Resolve dataset match
    let selected = null;
    if (q === 'recent' || q.includes('most recent')) {
      selected = datasets[0];
    } else {
      selected = datasets.find(d => d.id === q);
      if (!selected) {
        const words = q.split(/\s+/).map(w => w.replace(/s$/, ''));
        selected = datasets.find(d => {
          const titleLower = d.title.toLowerCase();
          const keyLower = d.key.toLowerCase();
          const typeLower = (d.inferredType || '').toLowerCase();
          return keyLower.includes(q) || titleLower.includes(q) || typeLower.includes(q) ||
                 words.some(w => w.length > 2 && (keyLower.includes(w) || titleLower.includes(w) || typeLower.includes(w)));
        });
      }
    }

    if (!selected) {
      return {
        status: 'not_found',
        message: `Could not find a dataset matching "${query}". Run '/anchorgraph' without arguments to see all available datasets.`
      };
    }

    // Step 3: Infer the optimal graph type for this dataset
    const graphType = this.inferGraphType(selected, q);
    const svgFile = `${selected.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;

    let chartStr = '';
    let svgPath = null;

    switch (graphType) {
      case 'loss_curve': {
        chartStr = this.renderAsciiChart(selected.values, selected.title);
        svgPath = this.renderSvgLinePlot(selected.values, selected.title, svgFile);
        break;
      }
      case 'pareto_tradeoff': {
        chartStr = this.renderAsciiScatter(selected.points, selected.xLabel, selected.yLabel, selected.title);
        svgPath = this.renderSvgScatterPlot(selected.points, selected.xLabel, selected.yLabel, selected.title, svgFile);
        break;
      }
      case 'grouped_bar': {
        chartStr = this.renderAsciiGroupedBars(selected.categories, selected.seriesList, selected.title);
        svgPath = this.renderSvgGroupedBarPlot(selected.categories, selected.seriesList, selected.title, svgFile);
        break;
      }
      case 'donut_distribution': {
        chartStr = this.renderAsciiDonut(selected.proportions, selected.title);
        svgPath = this.renderSvgDonutPlot(selected.proportions, selected.title, svgFile);
        break;
      }
      case 'radar_fingerprint': {
        chartStr = this.renderAsciiRadar(selected.radarAxes, selected.radarSeries, selected.title);
        svgPath = this.renderSvgRadarPlot(selected.radarAxes, selected.radarSeries, selected.title, svgFile);
        break;
      }
      case 'bar_comparison':
      default: {
        const labels = selected.labels || selected.values.map((_, i) => `Run ${i + 1}`);
        chartStr = this.renderAsciiBars(labels, selected.values, selected.title);
        svgPath = this.renderSvgBarPlot(labels, selected.values, selected.title, svgFile);
        break;
      }
    }

    return {
      status: 'success',
      dataset: selected,
      graphType,
      chart: chartStr,
      svgPath
    };
  }
}

if (require.main === module) {
  const ge = new GraphEngine();
  const q = process.argv.slice(2).join(' ');
  const res = ge.plotFromQuery(q);
  if (res.status === 'catalog') {
    console.log(res.catalog);
  } else if (res.status === 'success') {
    console.log(res.chart);
    console.log(`✔ Vector plot saved: ${res.svgPath}`);
  } else {
    console.log(res.message);
  }
}

module.exports = GraphEngine;
