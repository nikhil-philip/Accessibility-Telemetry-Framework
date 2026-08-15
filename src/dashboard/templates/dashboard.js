/*
 * Engineering Quality Dashboard renderer (ARCHITECTURE.md Layer 7).
 *
 * Presentation layer ONLY. Every number drawn on this page is read
 * directly off data.json (produced by scripts/generate-dashboard.ts from
 * the unmodified L4/L5/L6 engines). This file never computes a control
 * limit, evaluates a WECO/Nelson rule, derives a defect score, or applies
 * a gate policy -- it only reads already-computed fields (chart.uclX,
 * chart.lclX, chart.centerLine, rule.triggered, rule.involvedIndices,
 * regressionSpike.detected, gateVerdict.status, capability.cpu, ...) and
 * turns them into DOM/SVG.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // --- generic helpers ----------------------------------------------------

  function fmt(n, digits) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    if (typeof digits === 'number') return n.toFixed(digits);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    applyAttrs(node, attrs);
    appendChildren(node, children);
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    applyAttrs(node, attrs);
    return node;
  }

  function applyAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.setAttribute('class', v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
  }

  function appendChildren(node, children) {
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      var isNode = typeof c === 'object' && typeof c.nodeType === 'number';
      node.appendChild(isNode ? c : document.createTextNode(String(c)));
    });
  }

  function statusBadge(kind, label) {
    return el('span', { class: 'badge badge-' + kind }, [el('span', { class: 'dot' }), label]);
  }

  function gateKind(status) {
    if (status === 'PASS') return 'good';
    if (status === 'WARN') return 'warning';
    return 'critical';
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    var magnitude = Math.pow(10, Math.floor(Math.log10(v)));
    var residual = v / magnitude;
    var niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
    return niceResidual * magnitude;
  }

  function buildYTicks(maxDomain, count) {
    var raw = niceMax(maxDomain / count);
    var step = raw <= 0 ? 1 : raw;
    var ticks = [];
    for (var t = 0; t <= maxDomain + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
    return ticks;
  }

  // --- per-point out-of-control classification -----------------------------
  // Reads already-computed fields only; derives no new statistic.

  /** For a single already-computed SpcReport covering the whole series (production). */
  function productionPointStatuses(spcReport) {
    var individuals = spcReport.chart.individuals;
    var involved = {};
    spcReport.westernElectric.concat(spcReport.nelson).forEach(function (rule) {
      if (!rule.triggered) return;
      rule.involvedIndices.forEach(function (i) {
        involved[i] = true;
      });
    });
    var lastIndex = individuals.length - 1;
    return individuals.map(function (p, i) {
      var beyondLimits = p.value > spcReport.chart.uclX || p.value < spcReport.chart.lclX;
      var isRegression = i === lastIndex && spcReport.regressionSpike.detected;
      var status = isRegression ? 'regression' : beyondLimits || involved[i] ? 'flagged' : 'normal';
      return { status: status, beyondLimits: beyondLimits, ruleTriggered: !!involved[i] };
    });
  }

  /** For a walk-forward BuildAnalysisResult[] (Experiment A / B): each build's own re-evaluated SpcReport already tells us its own status. */
  function walkForwardPointStatuses(results) {
    return results.map(function (r) {
      var chart = r.spcReport.chart;
      var lastIndex = chart.individuals.length - 1;
      var ruleTriggered = r.spcReport.westernElectric.concat(r.spcReport.nelson).some(function (rule) {
        return rule.triggered && rule.triggeredAtIndex === lastIndex;
      });
      var isRegression = r.spcReport.regressionSpike.detected;
      var status = isRegression ? 'regression' : r.spcReport.uclViolation || ruleTriggered ? 'flagged' : 'normal';
      return { status: status, beyondLimits: r.spcReport.uclViolation, ruleTriggered: ruleTriggered, gateStatus: r.gateVerdict.status };
    });
  }

  // --- chart rendering -------------------------------------------------------

  var chartInstanceId = 0;

  /**
   * points: [{ x: 1-based build number, label, value, status, timestamp, mr, extra }]
   * Draws a single-series I-chart: value line + points, dashed UCL/LCL, solid center line,
   * optional dashed USL line, optional phase bands.
   */
  function buildChartSvg(opts) {
    var width = 880;
    var height = 300;
    var margin = { top: 20, right: 96, bottom: 26, left: 46 };
    var plotW = width - margin.left - margin.right;
    var plotH = height - margin.top - margin.bottom;
    var n = opts.points.length;

    var candidateMax = opts.points.reduce(function (m, p) {
      return Math.max(m, p.value);
    }, 0);
    candidateMax = Math.max(candidateMax, opts.uclX, opts.uslLine || 0);
    var maxDomain = niceMax(candidateMax * 1.12) || 10;
    var ticks = buildYTicks(maxDomain, 5);
    maxDomain = ticks[ticks.length - 1];

    function xScale(buildNumber) {
      if (n <= 1) return margin.left + plotW / 2;
      return margin.left + ((buildNumber - opts.points[0].x) / (opts.points[n - 1].x - opts.points[0].x)) * plotW;
    }
    function yScale(v) {
      return margin.top + plotH - (v / maxDomain) * plotH;
    }

    var svg = svgEl('svg', {
      class: 'chart',
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': opts.ariaLabel || 'Control chart',
    });

    // phase bands
    if (opts.phases && opts.phases.length) {
      var halfStep = n > 1 ? (xScale(opts.points[1].x) - xScale(opts.points[0].x)) / 2 : plotW / 2;
      opts.phases.forEach(function (phase, idx) {
        var x0 = Math.max(margin.left, xScale(phase.firstBuild) - halfStep);
        var x1 = Math.min(margin.left + plotW, xScale(phase.lastBuild) + halfStep);
        svg.appendChild(
          svgEl('rect', {
            x: x0,
            y: margin.top,
            width: Math.max(0, x1 - x0),
            height: plotH,
            fill: idx % 2 === 0 ? 'var(--phase-band-a)' : 'var(--phase-band-b)',
          }),
        );
        var label = svgEl('text', { class: 'phase-label', x: (x0 + x1) / 2, y: margin.top - 6, 'text-anchor': 'middle' });
        label.textContent = phase.phase;
        svg.appendChild(label);
      });
    }

    // gridlines + y ticks
    ticks.forEach(function (t) {
      var y = yScale(t);
      svg.appendChild(svgEl('line', { class: 'gridline', x1: margin.left, x2: margin.left + plotW, y1: y, y2: y }));
      var label = svgEl('text', { x: margin.left - 8, y: y + 3, 'text-anchor': 'end' });
      label.textContent = fmt(t);
      svg.appendChild(label);
    });

    // x axis baseline
    svg.appendChild(
      svgEl('line', { class: 'axis-line', x1: margin.left, x2: margin.left + plotW, y1: margin.top + plotH, y2: margin.top + plotH }),
    );

    // x tick labels (thin out if many points)
    var everyN = n <= 12 ? 1 : n <= 24 ? 2 : 5;
    opts.points.forEach(function (p, i) {
      if (i % everyN !== 0 && i !== n - 1) return;
      var label = svgEl('text', { x: xScale(p.x), y: margin.top + plotH + 16, 'text-anchor': 'middle' });
      label.textContent = String(p.x);
      svg.appendChild(label);
    });

    // reference lines: UCL / LCL (dashed), center line (solid), USL (optional, dashed violet)
    function refLine(y, className, labelText) {
      svg.appendChild(svgEl('line', { class: className, x1: margin.left, x2: margin.left + plotW, y1: y, y2: y }));
      var label = svgEl('text', { class: className + '-label', x: margin.left + plotW + 6, y: y + 3 });
      label.textContent = labelText;
      svg.appendChild(label);
    }
    refLine(yScale(opts.uclX), 'refline', 'UCL ' + fmt(opts.uclX, 2));
    refLine(yScale(opts.lclX), 'refline', 'LCL ' + fmt(opts.lclX, 2));
    refLine(yScale(opts.centerLine), 'centerline', 'X̄ ' + fmt(opts.centerLine, 2));
    if (typeof opts.uslLine === 'number') {
      refLine(yScale(opts.uslLine), 'usl-line', 'USL ' + fmt(opts.uslLine, 2));
    }

    // series line
    var pathD = opts.points
      .map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + xScale(p.x).toFixed(2) + ',' + yScale(p.value).toFixed(2);
      })
      .join(' ');
    svg.appendChild(svgEl('path', { class: 'series-line', d: pathD }));

    // points
    var pointEls = [];
    opts.points.forEach(function (p) {
      var cls = p.status === 'regression' ? 'point-regression' : p.status === 'flagged' ? 'point-flagged' : 'point-normal';
      var circle = svgEl('circle', {
        class: 'point ' + cls,
        cx: xScale(p.x),
        cy: yScale(p.value),
        r: 4,
        tabindex: '-1',
      });
      var title = svgEl('title', {});
      title.textContent = p.label + ': ' + fmt(p.value) + (p.status !== 'normal' ? ' (' + p.status + ')' : '');
      circle.appendChild(title);
      circle.__point = p;
      pointEls.push(circle);
      svg.appendChild(circle);
    });

    return { svg: svg, pointEls: pointEls, xScale: xScale, yScale: yScale };
  }

  function attachTooltip(wrapEl, pointEls, describe) {
    var tooltip = el('div', { class: 'chart-tooltip', role: 'status' });
    wrapEl.style.position = 'relative';
    wrapEl.appendChild(tooltip);

    function show(evt, point) {
      tooltip.innerHTML = describe(point);
      tooltip.style.visibility = 'visible';
      var rect = wrapEl.getBoundingClientRect();
      var left = evt.clientX - rect.left + 14;
      var top = evt.clientY - rect.top - 10;
      tooltip.style.left = Math.min(left, rect.width - 220) + 'px';
      tooltip.style.top = Math.max(top, 0) + 'px';
    }
    function hide() {
      tooltip.style.visibility = 'hidden';
    }

    pointEls.forEach(function (circle) {
      circle.addEventListener('mouseenter', function (e) {
        show(e, circle.__point);
      });
      circle.addEventListener('mousemove', function (e) {
        show(e, circle.__point);
      });
      circle.addEventListener('mouseleave', hide);
    });
  }

  function chartLegend(items) {
    var legend = el('div', { class: 'chart-legend' });
    items.forEach(function (item) {
      legend.appendChild(
        el('span', { class: 'key' }, [el('span', { class: 'swatch ' + (item.line ? 'line' : ''), style: 'background:' + item.color }), item.label]),
      );
    });
    return legend;
  }

  /**
   * Renders a full chart block: toolbar (chart/table toggle), the SVG,
   * legend, and a hidden data table (the accessibility-required alternative
   * view). Returns the container element.
   */
  function renderChartBlock(config) {
    chartInstanceId += 1;
    var uid = 'chart-' + chartInstanceId;
    var container = el('div', { class: 'chart-block' });

    var toolbar = el('div', { class: 'chart-toolbar' });
    var toggleBtn = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': uid + '-table' }, ['View as table']);
    toolbar.appendChild(toggleBtn);
    container.appendChild(toolbar);

    var svgWrap = el('div', { class: 'chart-svg-wrap', id: uid + '-svg' });
    var built = buildChartSvg(config);
    svgWrap.appendChild(built.svg);
    container.appendChild(svgWrap);
    attachTooltip(svgWrap, built.pointEls, config.describePoint);

    container.appendChild(chartLegend(config.legendItems));

    var tableWrap = el('div', { class: 'table-scroll hidden', id: uid + '-table' });
    tableWrap.appendChild(config.buildTable());
    container.appendChild(tableWrap);

    toggleBtn.addEventListener('click', function () {
      var showingTable = !tableWrap.classList.contains('hidden');
      tableWrap.classList.toggle('hidden', showingTable);
      svgWrap.classList.toggle('hidden', !showingTable);
      toggleBtn.textContent = showingTable ? 'View as table' : 'View as chart';
      toggleBtn.setAttribute('aria-expanded', String(!showingTable));
    });

    return container;
  }

  function dataTable(caption, columns, rows) {
    var table = el('table', { class: 'data-table' });
    table.appendChild(el('caption', {}, [caption]));
    var thead = el('thead', {}, [el('tr', {}, columns.map(function (c) {
      return el('th', { class: c.textCol ? 'text-col' : '' }, [c.label]);
    }))]);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (row) {
      tbody.appendChild(
        el(
          'tr',
          {},
          columns.map(function (c) {
            return el('td', { class: c.textCol ? 'text-col' : '' }, [row[c.key]]);
          }),
        ),
      );
    });
    table.appendChild(tbody);
    return table;
  }

  // --- section: production --------------------------------------------------

  function renderProduction(prod) {
    var section = el('section', { class: 'panel', 'aria-labelledby': 'production-heading' });
    section.appendChild(el('h2', { id: 'production-heading' }, ['Production Process — telemetry/history']));
    section.appendChild(
      el('p', { class: 'lede' }, [
        'The framework’s live build history (' + prod.history.length + ' builds). Every value below is read verbatim from computeSpcReport() and evaluateLatestBuild() (L5/L6), never recomputed here.',
      ]),
    );

    var latest = prod.history[prod.history.length - 1];
    var v = prod.gateVerdict;

    var gateCard = el('div', { class: 'gate-card' });
    gateCard.appendChild(statusBadge(gateKind(v.status), 'Gate: ' + v.status));
    gateCard.appendChild(statusBadge(v.spcProcessState === 'IN_CONTROL' ? 'good' : v.spcProcessState === 'OUT_OF_CONTROL' ? 'critical' : 'warning', v.spcProcessState.replace(/_/g, ' ')));
    gateCard.appendChild(statusBadge(v.spcStabilityStatus === 'STABLE' ? 'good' : v.spcStabilityStatus === 'REGRESSED' || v.spcStabilityStatus === 'OUT_OF_CONTROL' ? 'critical' : 'warning', v.spcStabilityStatus.replace(/_/g, ' ')));
    section.appendChild(gateCard);

    if (v.reasons.length) {
      var list = el('ul', { class: 'gate-reasons' });
      v.reasons.forEach(function (r) {
        list.appendChild(
          el('li', {}, [el('code', {}, [r.ruleId]), el('span', {}, [r.message + ' (actual ' + fmt(r.actual, 2) + ', threshold ' + fmt(r.threshold, 2) + ')'])]),
        );
      });
      section.appendChild(list);
    }

    var tiles = el('div', { class: 'tile-row' });
    tiles.appendChild(statTile('Latest defect score', fmt(v.defectScore), 'build ' + v.buildId));
    tiles.appendChild(statTile('Center line (X̄)', fmt(prod.spcReport.chart.centerLine, 2), 'over ' + prod.spcReport.sampleSize + ' builds'));
    tiles.appendChild(statTile('Control limits', fmt(prod.spcReport.chart.lclX, 2) + ' – ' + fmt(prod.spcReport.chart.uclX, 2), 'UCL = X̄ + 2.66·MR̄'));
    tiles.appendChild(
      statTile(
        'Capability',
        prod.spcReport.capability.cpu === null ? 'Not configured' : fmt(prod.spcReport.capability.cpu, 3),
        prod.spcReport.capability.usl === null ? 'no USL set for this stream' : prod.spcReport.capability.capable ? 'capable' : 'not capable',
      ),
    );
    section.appendChild(tiles);

    section.appendChild(el('h3', { class: 'subhead' }, ['Latest build: violations by severity']));
    section.appendChild(severityBreakdown(latest.violationsBySeverity));

    section.appendChild(el('h3', { class: 'subhead' }, ['Individuals (I) chart — weighted defect score per build']));
    var statuses = productionPointStatuses(prod.spcReport);
    var points = prod.spcReport.chart.individuals.map(function (p, i) {
      return { x: i + 1, label: p.buildId, value: p.value, status: statuses[i].status, timestamp: p.timestamp, extra: statuses[i] };
    });
    section.appendChild(
      renderChartBlock({
        points: points,
        uclX: prod.spcReport.chart.uclX,
        lclX: prod.spcReport.chart.lclX,
        centerLine: prod.spcReport.chart.centerLine,
        ariaLabel: 'Individuals control chart of weighted defect score across production builds',
        legendItems: pointLegendItems(),
        describePoint: describeProductionPoint,
        buildTable: function () {
          return dataTable(
            'Production build history: defect score against control limits',
            [
              { key: 'build', label: 'Build', textCol: true },
              { key: 'timestamp', label: 'Timestamp', textCol: true },
              { key: 'value', label: 'Defect score' },
              { key: 'ucl', label: 'UCL' },
              { key: 'lcl', label: 'LCL' },
              { key: 'signal', label: 'Signal', textCol: true },
            ],
            points.map(function (p) {
              return {
                build: p.label,
                timestamp: p.timestamp,
                value: fmt(p.value),
                ucl: fmt(prod.spcReport.chart.uclX, 2),
                lcl: fmt(prod.spcReport.chart.lclX, 2),
                signal: p.status === 'normal' ? 'In control' : p.status === 'regression' ? 'Regression spike' : 'Rule/limit violation',
              };
            }),
          );
        },
      }),
    );

    section.appendChild(
      el('p', { class: 'severity-legend' }, [
        'Severity weighting (single source of truth, ARCHITECTURE.md §8.2): defectScore = 10×critical + 5×serious + 2×moderate + 1×minor.',
      ]),
    );

    return section;
  }

  function describeProductionPoint(p) {
    var lines = ['<strong>' + p.label + '</strong>', 'defect score: ' + fmt(p.value)];
    if (p.status !== 'normal') lines.push('<span class="tt-muted">' + (p.status === 'regression' ? 'Regression spike detected' : 'Beyond control limit or rule triggered') + '</span>');
    return lines.join('<br>');
  }

  function pointLegendItems() {
    return [
      { color: 'var(--series-1)', label: 'In control' },
      { color: 'var(--status-critical)', label: 'Rule / control-limit violation' },
      { color: 'var(--status-serious)', label: 'Regression spike' },
      { color: 'var(--text-muted)', label: 'UCL / LCL (dashed)', line: true },
      { color: 'var(--text-secondary)', label: 'Center line X̄', line: true },
    ];
  }

  function severityBreakdown(v) {
    var wrap = el('div', { class: 'tile-row' });
    var weights = { critical: 10, serious: 5, moderate: 2, minor: 1 };
    var kinds = { critical: 'critical', serious: 'serious', moderate: 'warning', minor: 'good' };
    ['critical', 'serious', 'moderate', 'minor'].forEach(function (sev) {
      var tile = el('div', { class: 'tile' });
      tile.appendChild(el('div', { class: 'tile-label' }, [sev.charAt(0).toUpperCase() + sev.slice(1) + ' (weight ' + weights[sev] + ')']));
      tile.appendChild(el('div', { class: 'tile-value' }, [String(v[sev])]));
      wrap.appendChild(tile);
    });
    return wrap;
  }

  function statTile(label, value, sub) {
    var tile = el('div', { class: 'tile' });
    tile.appendChild(el('div', { class: 'tile-label' }, [label]));
    tile.appendChild(el('div', { class: 'tile-value' }, [value]));
    if (sub) tile.appendChild(el('div', { class: 'tile-sub' }, [sub]));
    return tile;
  }

  // --- section: experiment A --------------------------------------------------

  function renderExperimentA(expA) {
    var section = el('section', { class: 'panel', 'aria-labelledby': 'expa-heading' });
    section.appendChild(el('h2', { id: 'expa-heading' }, ['Experiment A — SPC Baseline Methodology (30-build, 5-phase cohort)']));
    section.appendChild(
      el('p', { class: 'lede' }, [
        'A deliberately non-stationary cohort comparing two baseline-selection methods against the same 30 builds. Capability (Cpk) is intentionally not evaluated here — see Experiment B.',
      ]),
    );

    var notes = el('div', { class: 'methodology-note' });
    [expA.methodNotes.EXPANDING_HISTORY, expA.methodNotes.TRAILING_WINDOW].forEach(function (m) {
      var block = el('div', {});
      block.appendChild(el('div', {}, [el('strong', {}, [m.label])]));
      block.appendChild(el('ul', {}, m.notes.map(function (n) {
        return el('li', {}, [n]);
      })));
      notes.appendChild(block);
    });
    section.appendChild(notes);

    var cols = el('div', { class: 'two-col' });
    cols.appendChild(experimentMethodColumn(expA.expandingHistory, expA.phases));
    cols.appendChild(experimentMethodColumn(expA.trailingWindow, expA.phases));
    section.appendChild(cols);

    section.appendChild(observationsList(expA));

    return section;
  }

  function experimentMethodColumn(methodResult, phases) {
    var wrap = el('div', {});
    var label = methodResult.method === 'EXPANDING_HISTORY' ? 'Expanding history' : 'Trailing window (15 builds)';
    wrap.appendChild(el('h3', { class: 'subhead' }, [label]));

    var s = methodResult.summary;
    var tiles = el('div', { class: 'tile-row' });
    tiles.appendChild(statTile('Gate outcomes', s.passCount + ' / ' + s.warnCount + ' / ' + s.failCount, 'PASS / WARN / FAIL'));
    tiles.appendChild(statTile('Regression spikes', String(s.regressionDetections), 'of ' + s.totalBuilds + ' builds'));
    tiles.appendChild(statTile('Trend / drift', s.trendDetections + ' / ' + s.driftDetections, 'detections'));
    wrap.appendChild(tiles);

    var statuses = walkForwardPointStatuses(methodResult.results);
    var points = methodResult.results.map(function (r, i) {
      return { x: r.buildNumber, label: r.buildId, value: r.spcReport.chart.individuals[r.spcReport.chart.individuals.length - 1].value, status: statuses[i].status, timestamp: r.spcReport.generatedAt, extra: statuses[i] };
    });
    var lastReport = methodResult.results[methodResult.results.length - 1].spcReport;

    wrap.appendChild(
      renderChartBlock({
        points: points,
        uclX: lastReport.chart.uclX,
        lclX: lastReport.chart.lclX,
        centerLine: lastReport.chart.centerLine,
        phases: phases,
        ariaLabel: label + ' walk-forward control chart',
        legendItems: pointLegendItems(),
        describePoint: function (p) {
          var extra = p.extra;
          var lines = ['<strong>Build ' + p.x + '</strong> (' + p.label + ')', 'defect score: ' + fmt(p.value), 'gate: ' + extra.gateStatus];
          if (extra.ruleTriggered) lines.push('<span class="tt-muted">WECO/Nelson rule triggered</span>');
          if (p.status === 'regression') lines.push('<span class="tt-muted">Regression spike detected</span>');
          return lines.join('<br>');
        },
        buildTable: function () {
          return dataTable(
            label + ': per-build walk-forward result',
            [
              { key: 'build', label: 'Build' },
              { key: 'buildId', label: 'Build ID', textCol: true },
              { key: 'value', label: 'Defect score' },
              { key: 'window', label: 'Window size' },
              { key: 'gate', label: 'Gate', textCol: true },
              { key: 'signal', label: 'Signal', textCol: true },
            ],
            methodResult.results.map(function (r, i) {
              return {
                build: r.buildNumber,
                buildId: r.buildId,
                value: fmt(points[i].value),
                window: r.windowLength,
                gate: r.gateVerdict.status,
                signal: statuses[i].status === 'normal' ? 'In control' : statuses[i].status === 'regression' ? 'Regression spike' : 'Rule/limit violation',
              };
            }),
          );
        },
      }),
    );

    return wrap;
  }

  function observationsList(expA) {
    var expanding = expA.expandingHistory.results;
    var trailing = expA.trailingWindow.results;

    function rule1AtBuild30(results) {
      var last = results[results.length - 1];
      var idx = last.spcReport.chart.individuals.length - 1;
      var rule = last.spcReport.westernElectric.find(function (r) {
        return r.rule === 1;
      });
      return !!(rule && rule.triggered && rule.involvedIndices.indexOf(idx) !== -1);
    }
    function regressionBuilds(results) {
      return results.filter(function (r) {
        return r.spcReport.regressionSpike.detected;
      }).map(function (r) {
        return r.buildNumber;
      });
    }

    var items = [];
    items.push('Regression spike detected at build(s) ' + regressionBuilds(expanding).join(', ') + ' under EXPANDING_HISTORY, and build(s) ' + regressionBuilds(trailing).join(', ') + ' under TRAILING_WINDOW.');
    items.push('Rule 1 (beyond 3σ) at build 30: ' + (rule1AtBuild30(expanding) ? 'still triggered' : 'clear') + ' under expanding history, ' + (rule1AtBuild30(trailing) ? 'still triggered' : 'clear') + ' under trailing window.');

    var list = el('ul', { class: 'observations' });
    items.forEach(function (t) {
      list.appendChild(el('li', {}, [t]));
    });
    return list;
  }

  // --- section: experiment B --------------------------------------------------

  function renderExperimentB(expB) {
    var section = el('section', { class: 'panel', 'aria-labelledby': 'expb-heading' });
    section.appendChild(el('h2', { id: 'expb-heading' }, ['Experiment B — Process Capability (30-build stable cohort)']));
    section.appendChild(
      el('p', { class: 'lede' }, [
        'A stable, in-control cohort generated specifically to evaluate Cpk against USL = ' + expB.usl + '. Cpk is evaluated only here, not in Experiment A, because that cohort is deliberately non-stationary.',
      ]),
    );

    var cap = expB.spcReport.capability;
    var tiles = el('div', { class: 'tile-row' });
    tiles.appendChild(statTile('Cpu', cap.cpu === null ? '—' : fmt(cap.cpu, 4), 'USL = ' + expB.usl));
    tiles.appendChild(el('div', { class: 'tile' }, [el('div', { class: 'tile-label' }, ['Capable (Cpu ≥ 1.33)']), statusBadge(cap.capable ? 'good' : 'critical', cap.capable ? 'Capable' : 'Not capable')]));
    tiles.appendChild(statTile('Center line (X̄)', fmt(expB.spcReport.chart.centerLine, 2)));
    tiles.appendChild(el('div', { class: 'tile' }, [el('div', { class: 'tile-label' }, ['Quality gate (latest build)']), statusBadge(gateKind(expB.gateVerdict.status), expB.gateVerdict.status)]));
    section.appendChild(tiles);

    var statuses = productionPointStatuses(expB.spcReport);
    var points = expB.spcReport.chart.individuals.map(function (p, i) {
      return { x: i + 1, label: p.buildId, value: p.value, status: statuses[i].status, timestamp: p.timestamp };
    });

    section.appendChild(
      renderChartBlock({
        points: points,
        uclX: expB.spcReport.chart.uclX,
        lclX: expB.spcReport.chart.lclX,
        centerLine: expB.spcReport.chart.centerLine,
        uslLine: expB.usl,
        ariaLabel: 'Stable-cohort individuals control chart with upper specification limit',
        legendItems: pointLegendItems().concat([{ color: 'var(--series-usl)', label: 'USL', line: true }]),
        describePoint: describeProductionPoint,
        buildTable: function () {
          return dataTable(
            'Stable capability cohort: defect score against control limits and USL',
            [
              { key: 'build', label: 'Build', textCol: true },
              { key: 'value', label: 'Defect score' },
              { key: 'ucl', label: 'UCL' },
              { key: 'lcl', label: 'LCL' },
              { key: 'usl', label: 'USL' },
              { key: 'signal', label: 'Signal', textCol: true },
            ],
            points.map(function (p) {
              return {
                build: p.label,
                value: fmt(p.value),
                ucl: fmt(expB.spcReport.chart.uclX, 2),
                lcl: fmt(expB.spcReport.chart.lclX, 2),
                usl: fmt(expB.usl),
                signal: p.status === 'normal' ? 'In control' : p.status === 'regression' ? 'Regression spike' : 'Rule/limit violation',
              };
            }),
          );
        },
      }),
    );

    return section;
  }

  // --- boot --------------------------------------------------------------

  function render(data) {
    document.getElementById('generated-at').textContent =
      'Generated ' + new Date(data.generatedAt).toLocaleString() + ' — production n=' + data.production.history.length + ', experiment A n=' + data.experimentA.expandingHistory.results.length + ', experiment B n=' + data.experimentB.history.length + '.';

    var app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(renderProduction(data.production));
    app.appendChild(renderExperimentA(data.experimentA));
    app.appendChild(renderExperimentB(data.experimentB));
  }

  function boot() {
    fetch('data.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        document.getElementById('app').innerHTML = '';
        document.getElementById('app').appendChild(
          el('div', { class: 'load-error' }, ['Failed to load data.json: ' + err.message + '. Run "npm run generate:dashboard" first.']),
        );
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
