// Accessibility Telemetry Framework — Project Guide
// Shared behavior: active-nav highlighting, collapsible <details> (native),
// and a small client-side search index. No build step, no dependencies.

(function () {
  'use strict';

  // ---- active sidebar link ----
  function highlightActiveNav() {
    var here = location.pathname.split('/').pop() || 'index.html';
    var links = document.querySelectorAll('.sidebar nav a');
    links.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var hrefFile = href.split('#')[0];
      if (hrefFile === here) {
        a.classList.add('active');
      }
    });
  }

  // ---- search index ----
  // Each entry: { title, page, anchor (optional), keywords (optional) }
  var SEARCH_INDEX = [
    // Home
    { title: 'What did you build? (30/60/3-min answers)', page: 'index.html', anchor: 'what-did-you-build', keywords: 'summary elevator pitch' },
    { title: 'Why this project exists', page: 'index.html', anchor: 'purpose', keywords: 'motivation research gap static threshold' },
    { title: 'The big picture pipeline diagram', page: 'index.html', anchor: '', keywords: 'diagram overview pipeline' },

    // Architecture
    { title: 'Layer diagram (L1–L7)', page: 'architecture.html', anchor: 'big-picture', keywords: 'layers architecture svg' },
    { title: 'Layer responsibility table', page: 'architecture.html', anchor: 'l1-l7-table', keywords: 'L1 L2 L3 L4 L5 L6 L7 files' },
    { title: 'Who calculates vs. who only displays', page: 'architecture.html', anchor: 'layers-vs-display', keywords: 'dashboard presentation only calculation' },
    { title: 'One build, file by file (data flow)', page: 'architecture.html', anchor: 'data-flow', keywords: 'reporter collector writer spcEngine gate ciAdapter' },
    { title: 'Where the code differs from ARCHITECTURE.md', page: 'architecture.html', anchor: 'discrepancies', keywords: 'discrepancy drift spc.config.ts window nelson western electric' },

    // Telemetry
    { title: 'What is telemetry?', page: 'telemetry.html', anchor: 'what-is-telemetry', keywords: 'measurement history' },
    { title: 'What is a build record?', page: 'telemetry.html', anchor: 'build-record', keywords: 'TelemetryRecord schema JSON example' },
    { title: 'Why do we store telemetry?', page: 'telemetry.html', anchor: 'why-store-telemetry', keywords: 'history over time' },
    { title: 'What is defectScore?', page: 'telemetry.html', anchor: 'defect-score', keywords: 'weighted 10 5 2 1 critical serious moderate minor formula' },
    { title: 'Production history vs. experiments', page: 'telemetry.html', anchor: 'history-vs-experiments', keywords: 'telemetry/history telemetry/experiments synthetic' },
    { title: 'Why CI telemetry is artifact-only', page: 'telemetry.html', anchor: 'artifact-only', keywords: 'permissions contents read upload-artifact never committed' },

    // SPC
    { title: 'The basics: process, variation, mean, sigma', page: 'spc.html', anchor: 'spc-basics', keywords: 'standard deviation mean average' },
    { title: 'Control limits: UCL, LCL, I-MR chart', page: 'spc.html', anchor: 'control-limits', keywords: 'UCL LCL centerLine mrBar formula moving range' },
    { title: 'Common cause vs. special cause', page: 'spc.html', anchor: 'common-vs-special-cause', keywords: 'stable unstable in control out of control' },
    { title: 'Every detector this project runs', page: 'spc.html', anchor: 'techniques', keywords: 'rules detectors overview' },
    { title: 'Western Electric Rule 1', page: 'spc.html', anchor: 'weco-rule1', keywords: 'WECO beyond 3 sigma' },
    { title: 'Nelson Rule 1 and the 8-rule set', page: 'spc.html', anchor: 'nelson-rule1', keywords: 'nelson rules 1984' },
    { title: 'Nelson Rule 3 / trend detection', page: 'spc.html', anchor: 'nelson-rule3-trend', keywords: 'trend regression correlation OLS' },
    { title: 'Control-limit violations', page: 'spc.html', anchor: 'control-limit-violation', keywords: 'uclViolation direct comparison' },
    { title: 'Regression spike detection', page: 'spc.html', anchor: 'regression-spike', keywords: 'moving range spike worsened' },
    { title: 'CUSUM / drift detection', page: 'spc.html', anchor: 'cusum-drift', keywords: 'cumulative sum k h sigma worsening improving' },
    { title: 'Capability: Cpu / Cpk', page: 'spc.html', anchor: 'capability-cpu-cpk', keywords: 'USL capable 1.33 1.0' },
    { title: 'Expanding history vs. trailing window', page: 'spc.html', anchor: 'window-diagram', keywords: '15 build window comparison diagram' },

    // Experiments
    { title: 'Experiment A — SPC baseline methodology', page: 'experiments.html', anchor: 'experiment-a', keywords: '30 build cohort spc-validation-cohort' },
    { title: 'The five phases', page: 'experiments.html', anchor: 'experiment-a-phases', keywords: 'phase A B C D E unstable improving stable regression recovery' },
    { title: 'Expanding vs. trailing window — the results', page: 'experiments.html', anchor: 'expanding-vs-trailing', keywords: 'pass warn fail counts 1 3 26 1 5 24' },
    { title: 'Why Rule 1 became stuck', page: 'experiments.html', anchor: 'rule1-stuck', keywords: 'stale outlier build 1 expanding history' },
    { title: 'Regression spike at build 23', page: 'experiments.html', anchor: 'regression-spike-build23', keywords: '7 to 46 deliberate regression' },
    { title: 'Experiment B — process capability', page: 'experiments.html', anchor: 'experiment-b', keywords: 'stable-capability-cohort Cpu 2.9811 USL 40' },
    { title: 'Why Cpk was excluded from Experiment A', page: 'experiments.html', anchor: 'cpk-excluded', keywords: 'non-stationary stable regime capability assumption' },

    // Gates
    { title: 'PASS, WARN, FAIL — exact conditions', page: 'gates.html', anchor: 'pass-warn-fail', keywords: 'gatePolicies DEFAULT_GATE_POLICY thresholds' },
    { title: 'Exit codes: 0 and 1', page: 'gates.html', anchor: 'gate-pipeline', keywords: 'evaluateQualityGate GateVerdict formatGateVerdictForCi exit code' },
    { title: "Why WARN doesn't block CI", page: 'gates.html', anchor: 'why-warn-doesnt-block', keywords: 'policy soft signal' },
    { title: 'Why ciAdapter.ts has no policy', page: 'gates.html', anchor: 'why-ciadapter-no-policy', keywords: 'separation of concerns pure formatting' },

    // CI/CD
    { title: 'Workflow triggers', page: 'cicd.html', anchor: 'workflow-triggers', keywords: 'push pull_request workflow_dispatch concurrency permissions' },
    { title: 'The pipeline, step by step', page: 'cicd.html', anchor: 'pipeline-steps', keywords: '18 steps verify test:a11y gate:ci' },
    { title: 'What happens when the gate FAILS', page: 'cicd.html', anchor: 'gate-failure-behavior', keywords: 'blocked build evidence' },
    { title: 'if: always() in simple English', page: 'cicd.html', anchor: 'always-explained', keywords: 'continue-on-error downstream steps' },
    { title: 'Artifact-only evidence', page: 'cicd.html', anchor: 'artifact-only-telemetry', keywords: 'upload-artifact 30 day retention never committed' },

    // Dashboard
    { title: 'What the dashboard displays', page: 'dashboard.html', anchor: 'what-dashboard-shows', keywords: 'production panel experiment A experiment B' },
    { title: 'Where its data comes from', page: 'dashboard.html', anchor: 'data-source', keywords: 'buildDashboardData loadTelemetryHistory computeSpcReport' },
    { title: "Why it doesn't duplicate calculations", page: 'dashboard.html', anchor: 'no-duplicate-calc', keywords: 'presentation only verify-dashboard byte-identical' },
    { title: 'Browser smoke tests', page: 'dashboard.html', anchor: 'browser-tests', keywords: 'dashboard.smoke.spec.ts playwright' },
    { title: 'Keyboard accessibility', page: 'dashboard.html', anchor: 'keyboard', keywords: 'tab enter view as table' },
    { title: 'Dashboard accessibility (axe-core)', page: 'dashboard.html', anchor: 'a11y-of-dashboard', keywords: 'light dark mode zero violations dogfooding' },

    // Commands / testing
    { title: 'Command table', page: 'testing.html', anchor: 'command-table', keywords: 'npm run verify test generate serve gate:ci' },

    // Demo
    { title: 'Before the review', page: 'demo.html', anchor: 'before-review', keywords: 'npm ci install verify' },
    { title: 'Starting the review', page: 'demo.html', anchor: 'starting-review', keywords: 'what to say opening' },
    { title: 'Showing the project', page: 'demo.html', anchor: 'showing-project', keywords: 'architecture diagram' },
    { title: 'Running accessibility tests (demo)', page: 'demo.html', anchor: 'running-a11y', keywords: 'test:a11y command' },
    { title: 'Showing telemetry (demo)', page: 'demo.html', anchor: 'showing-telemetry', keywords: 'open json file' },
    { title: 'Showing SPC (demo)', page: 'demo.html', anchor: 'showing-spc', keywords: 'verify:spc' },
    { title: 'Showing the quality gate (demo)', page: 'demo.html', anchor: 'showing-gate', keywords: 'gate:ci' },
    { title: 'Showing the dashboard (demo)', page: 'demo.html', anchor: 'showing-dashboard', keywords: 'serve:dashboard localhost 4310' },
    { title: 'Showing CI/CD (demo)', page: 'demo.html', anchor: 'showing-cicd', keywords: 'github actions workflow_dispatch' },
    { title: 'Showing the experiments (demo)', page: 'demo.html', anchor: 'showing-experiments', keywords: 'verify:experiment verify:stable-cohort' },
    { title: 'Ending the demo', page: 'demo.html', anchor: 'ending-demo', keywords: 'closing summary' },

    // Cheat sheet
    { title: 'Cheat sheet — one page summary', page: 'cheatsheet.html', anchor: '', keywords: 'key numbers formulas quick reference' },

    // Reviewer Q&A categories
    { title: 'Reviewer Q&A — Basic', page: 'questions.html', anchor: 'cat-basic', keywords: 'what did you build problem solved' },
    { title: 'Reviewer Q&A — Architecture', page: 'questions.html', anchor: 'cat-architecture', keywords: 'layers file boundaries' },
    { title: 'Reviewer Q&A — Accessibility', page: 'questions.html', anchor: 'cat-accessibility', keywords: 'WCAG axe-core pages scanned' },
    { title: 'Reviewer Q&A — Telemetry', page: 'questions.html', anchor: 'cat-telemetry', keywords: 'defectScore append-only artifact-only' },
    { title: 'Reviewer Q&A — SPC', page: 'questions.html', anchor: 'cat-spc', keywords: 'I-MR chart WECO Nelson CUSUM' },
    { title: 'Reviewer Q&A — Experiments', page: 'questions.html', anchor: 'cat-experiments', keywords: 'experiment A experiment B build 23' },
    { title: 'Reviewer Q&A — Quality Gates', page: 'questions.html', anchor: 'cat-gates', keywords: 'PASS WARN FAIL policy' },
    { title: 'Reviewer Q&A — CI/CD', page: 'questions.html', anchor: 'cat-cicd', keywords: 'workflow triggers always()' },
    { title: 'Reviewer Q&A — Dashboard', page: 'questions.html', anchor: 'cat-dashboard', keywords: 'presentation Chromium axe' },
    { title: 'Reviewer Q&A — Research Methodology', page: 'questions.html', anchor: 'cat-methodology', keywords: 'RQ1 RQ2 RQ3 contribution' },
    { title: 'Reviewer Q&A — Security', page: 'questions.html', anchor: 'cat-security', keywords: 'permissions credentials real data' },
    { title: 'Reviewer Q&A — Reproducibility', page: 'questions.html', anchor: 'cat-reproducibility', keywords: 'seed byte-identical OS' },
    { title: 'Reviewer Q&A — Limitations', page: 'questions.html', anchor: 'cat-limitations', keywords: '4 builds 30 builds' },
    { title: 'Reviewer Q&A — Difficult', page: 'questions.html', anchor: 'cat-difficult', keywords: 'gaming the score WCAG rules change' },

    // Tough questions
    { title: 'Tough questions (T1–T18)', page: 'tough-questions.html', anchor: '', keywords: 'why SPC why not thresholds why synthetic data why USL 40 false positives original contribution weakest part' },

    // Limitations
    { title: 'Limitations — full list', page: 'limitations.html', anchor: 'limitations-list', keywords: 'synthetic data 30 builds trailing window USL CUSUM chromium' },

    // Glossary
    { title: 'Glossary — all terms', page: 'glossary.html', anchor: 'glossary-list', keywords: 'WECO Nelson CUSUM Cpk USL UCL LCL sigma mean common cause special cause' }
  ];

  function renderResults(container, items, query) {
    container.innerHTML = '';
    if (!query) return;
    if (items.length === 0) {
      var hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'No matches.';
      container.appendChild(hint);
      return;
    }
    items.slice(0, 8).forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.anchor ? (item.page + '#' + item.anchor) : item.page;
      a.textContent = item.title;
      container.appendChild(a);
    });
  }

  function initSearch() {
    var box = document.getElementById('search-box');
    var results = document.getElementById('search-results');
    if (!box || !results) return;

    box.addEventListener('input', function () {
      var q = box.value.trim().toLowerCase();
      if (!q) {
        results.innerHTML = '';
        return;
      }
      var matches = SEARCH_INDEX.filter(function (item) {
        var haystack = (item.title + ' ' + (item.keywords || '') + ' ' + item.page).toLowerCase();
        return haystack.indexOf(q) !== -1;
      });
      renderResults(results, matches, q);
    });

    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = results.querySelector('a');
        if (first) {
          window.location.href = first.getAttribute('href');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    highlightActiveNav();
    initSearch();
  });
})();
