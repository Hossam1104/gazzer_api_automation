/**
 * @file script.js
 * @description Gazzer API Testing Dashboard - Main Controller
 *
 * Features:
 * - Automatic report discovery from /reports/manifest.json
 * - Real-time JSON parsing and metric extraction
 * - Dynamic API card generation
 * - KPI aggregation across all APIs
 * - OWASP coverage calculation
 * - Language badge rendering (EN/AR)
 * - Theme toggle (Light/Dark mode)
 * - Category filtering
 *
 * Data Flow:
 * 1. Load manifest.json → list of available reports
 * 2. For each report → fetch {API}_execution.json
 * 3. Parse JSON → extract metrics using strict mapping
 * 4. Populate KPI cards (aggregated)
 * 5. Generate report cards (per-API)
 * 6. Wire up "View Report" / "View JSON" buttons
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let allReports = []; // Stores parsed report data
let manifestData = null; // Manifest from /reports/manifest.json
let isLoadingReports = false; // Flag to prevent concurrent loading

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MANIFEST_PATH: './reports/manifest.json',
  REPORTS_BASE_PATH: './reports/',
  CATEGORY_ICONS: {
    admin: 'fa-user-shield',
    customer: 'fa-users',
    vendor: 'fa-store',
    delivery: 'fa-shipping-fast'
  },
  SEVERITY_COLORS: {
    CRITICAL: '#dc3545',
    HIGH: '#fd7e14',
    MEDIUM: '#ffc107',
    LOW: '#28a745'
  },
  LANGUAGE_FLAGS: {
    en: '🇺🇸',
    ar: '🇸🇦'
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Safely parse percentage string to float.
 * @param {string} percentStr - e.g., "83.1%"
 * @returns {number} Float value (e.g., 83.1)
 */
function parsePercent(percentStr) {
  if (!percentStr) return 0;
  return parseFloat(String(percentStr).replace('%', '')) || 0;
}

/**
 * Format timestamp to human-readable date.
 * @param {string} isoDate - ISO 8601 date string
 * @returns {string} Formatted date (e.g., "Feb 8, 2026 11:10 PM")
 */
function formatDate(isoDate) {
  if (!isoDate) return 'N/A';
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Calculate time ago from ISO date.
 * @param {string} isoDate - ISO 8601 date string
 * @returns {string} Human-readable time ago (e.g., "2 hours ago")
 */
function timeAgo(isoDate) {
  if (!isoDate) return 'N/A';
  const now = new Date();
  const past = new Date(isoDate);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Show toast notification.
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================================
// METRIC EXTRACTION (STRICT MAPPING FROM JSON)
// ============================================================================

/**
 * Extract all required metrics from execution JSON.
 * STRICT MAPPING - only uses data present in JSON, never infers.
 *
 * @param {Object} json - Parsed execution JSON
 * @returns {Object} Metrics object
 */
function extractMetrics(json) {
  const meta = json.meta || {};
  const testCases = json.testCases || [];
  const bugs = json.bugs || [];

  // === BASIC METRICS (direct from meta) ===
  const totalTests = meta.totalTestCases || 0;
  const passed = meta.passed || 0;
  const failed = meta.failed || 0;
  const skipped = meta.skipped || 0;
  const recovered = meta.recovered || 0;

  // === SUCCESS RATE (from meta.passRate or calculate) ===
  let successRate = 0;
  if (meta.passRate) {
    successRate = parsePercent(meta.passRate);
  } else if (totalTests > 0) {
    successRate = ((passed / totalTests) * 100).toFixed(1);
  }

  // === API BUGS (count confirmed_api_bug === true) ===
  const apiBugs = testCases.filter(tc => tc.confirmed_api_bug === true).length;

  // === RATE LIMIT INCIDENTS (from rateLimitSummary) ===
  const rateLimitSummary = meta.rateLimitSummary || {};
  const rateLimitHits = rateLimitSummary.totalEvents || 0;
  const rateLimitRecovered = rateLimitSummary.recoveredCount || 0;
  const rateLimitExhausted = rateLimitSummary.exhaustedCount || 0;

  // === LANGUAGES TESTED (extract unique languages from testCases) ===
  const languagesSet = new Set();
  testCases.forEach(tc => {
    if (tc.languages && Array.isArray(tc.languages)) {
      tc.languages.forEach(lang => languagesSet.add(lang));
    }
  });
  const languages = Array.from(languagesSet);

  // === OWASP COVERAGE (count tests with owasp_category) ===
  const testsWithOwasp = testCases.filter(tc => tc.owasp_category).length;
  const owaspCoverage = totalTests > 0
    ? ((testsWithOwasp / totalTests) * 100).toFixed(1)
    : 0;

  // === SEVERITY BREAKDOWN (from meta.bugs) ===
  const severity = meta.bugs || { critical: 0, high: 0, medium: 0, low: 0 };

  // === EXECUTION INFO ===
  const executionDate = meta.executionDate || null;
  const environment = meta.environment || 'N/A';
  const baseUrl = meta.baseUrl || 'N/A';
  const releaseReadiness = meta.releaseReadiness || 'UNKNOWN';

  return {
    // Core metrics
    totalTests,
    passed,
    failed,
    skipped,
    recovered,
    successRate,

    // Bug tracking
    apiBugs,
    severity,

    // Rate limiting
    rateLimitHits,
    rateLimitRecovered,
    rateLimitExhausted,

    // Security
    owaspCoverage,
    testsWithOwasp,

    // Localization
    languages,

    // Execution context
    executionDate,
    environment,
    baseUrl,
    releaseReadiness
  };
}

// ============================================================================
// REPORT CARD GENERATION
// ============================================================================

/**
 * Generate HTML for a single API report card.
 *
 * @param {Object} reportInfo - Report metadata from manifest
 * @param {Object} metrics - Extracted metrics from execution JSON
 * @returns {string} HTML string
 */
function generateReportCard(reportInfo, metrics) {
  const { apiName, executionFile, htmlFile, description } = reportInfo;
  const {
    totalTests,
    passed,
    failed,
    skipped,
    successRate,
    apiBugs,
    severity,
    rateLimitHits,
    rateLimitRecovered,
    rateLimitExhausted,
    owaspCoverage,
    languages,
    executionDate,
    releaseReadiness
  } = metrics;

  // === STATUS BADGE ===
  let statusClass = 'success';
  let statusText = 'READY';
  if (releaseReadiness === 'BLOCKED') {
    statusClass = 'danger';
    statusText = 'BLOCKED';
  } else if (releaseReadiness === 'WARNING') {
    statusClass = 'warning';
    statusText = 'WARNING';
  }

  // === LANGUAGE BADGES ===
  const languageBadges = languages.length > 0
    ? languages.map(lang => `
        <span class="lang-badge" title="${lang === 'en' ? 'English' : 'Arabic'}">
          ${CONFIG.LANGUAGE_FLAGS[lang] || '🌐'} ${lang.toUpperCase()}
        </span>
      `).join('')
    : '<span class="lang-badge">🌐 N/A</span>';

  // === SEVERITY SUMMARY ===
  const severityBadges = `
    ${severity.critical > 0 ? `<span class="severity-badge critical" title="Critical Bugs">🔴 ${severity.critical}</span>` : ''}
    ${severity.high > 0 ? `<span class="severity-badge high" title="High Severity">🟠 ${severity.high}</span>` : ''}
    ${severity.medium > 0 ? `<span class="severity-badge medium" title="Medium Severity">🟡 ${severity.medium}</span>` : ''}
    ${severity.low > 0 ? `<span class="severity-badge low" title="Low Severity">🟢 ${severity.low}</span>` : ''}
    ${severity.critical + severity.high + severity.medium + severity.low === 0 ? '<span class="severity-badge">✅ None</span>' : ''}
  `;

  // === RATE LIMIT WARNING ===
  const rateLimitWarning = rateLimitExhausted > 0
    ? `<div class="rate-limit-warning" title="${rateLimitExhausted} tests exhausted rate limits">
         <i class="fas fa-exclamation-triangle"></i> Rate Limit: ${rateLimitExhausted} exhausted
       </div>`
    : '';

  // === OWASP COVERAGE INDICATOR ===
  const owaspIndicator = parseFloat(owaspCoverage) > 0
    ? `<div class="owasp-coverage" title="OWASP API Security Coverage">
         <i class="fas fa-shield-alt"></i> OWASP: ${owaspCoverage}%
       </div>`
    : `<div class="owasp-coverage" title="No OWASP coverage">
         <i class="fas fa-shield-alt"></i> OWASP: Not Covered
       </div>`;

  return `
    <div class="report-card" data-api="${apiName}">
      <div class="report-card-header">
        <div class="report-title">
          <h3>${apiName}</h3>
          <p class="report-description">${description}</p>
        </div>
        <div class="status-badge ${statusClass}">${statusText}</div>
      </div>

      <div class="report-stats">
        <div class="stat-row">
          <div class="stat-item">
            <div class="stat-icon">
              <i class="fas fa-vial"></i>
            </div>
            <div class="stat-details">
              <div class="stat-value">${totalTests}</div>
              <div class="stat-label">Total Tests</div>
            </div>
          </div>

          <div class="stat-item">
            <div class="stat-icon success">
              <i class="fas fa-check-circle"></i>
            </div>
            <div class="stat-details">
              <div class="stat-value">${passed}</div>
              <div class="stat-label">Passed</div>
            </div>
          </div>

          <div class="stat-item">
            <div class="stat-icon ${failed > 0 ? 'danger' : ''}">
              <i class="fas fa-times-circle"></i>
            </div>
            <div class="stat-details">
              <div class="stat-value">${failed}</div>
              <div class="stat-label">Failed</div>
            </div>
          </div>

          <div class="stat-item">
            <div class="stat-icon">
              <i class="fas fa-minus-circle"></i>
            </div>
            <div class="stat-details">
              <div class="stat-value">${skipped}</div>
              <div class="stat-label">Skipped</div>
            </div>
          </div>
        </div>

        <div class="progress-bar-container">
          <div class="progress-label">Success Rate: ${successRate}%</div>
          <div class="progress-bar-wrapper">
            <div class="progress-bar" style="width: ${successRate}%; background: ${parseFloat(successRate) >= 90 ? '#28a745' : parseFloat(successRate) >= 70 ? '#ffc107' : '#dc3545'}"></div>
          </div>
        </div>

        <div class="report-metrics">
          <div class="metric-item" title="Confirmed API Bugs">
            <i class="fas fa-bug"></i>
            <span>Bugs: <strong>${apiBugs}</strong></span>
          </div>

          <div class="metric-item" title="Rate Limit Incidents">
            <i class="fas fa-stopwatch"></i>
            <span>Rate Limits: <strong>${rateLimitHits}</strong> (${rateLimitRecovered} recovered)</span>
          </div>
        </div>

        <div class="report-badges">
          <div class="badge-group">
            <label>Languages:</label>
            ${languageBadges}
          </div>

          <div class="badge-group">
            <label>Severity:</label>
            ${severityBadges}
          </div>
        </div>

        ${rateLimitWarning}
        ${owaspIndicator}

        <div class="report-footer">
          <div class="execution-time">
            <i class="fas fa-clock"></i>
            ${formatDate(executionDate)} <span class="time-ago">(${timeAgo(executionDate)})</span>
          </div>
        </div>
      </div>

      <div class="report-actions">
        <button class="btn-view-report" onclick="openReport('${htmlFile}')" title="Open full HTML report">
          <i class="fas fa-file-alt"></i> View Report
        </button>
        <button class="btn-view-json" onclick="openJSON('${executionFile}')" title="Open raw JSON data">
          <i class="fas fa-code"></i> View JSON
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// REPORT LOADING & PARSING
// ============================================================================

/**
 * Load manifest and all reports.
 * Main entry point for dashboard initialization.
 */
async function loadReports() {
  // Prevent concurrent loading
  if (isLoadingReports) {
    console.warn('[Dashboard] Load already in progress, skipping...');
    return;
  }

  isLoadingReports = true;

  try {
    // Step 1: Load manifest
    console.log('[Dashboard] Loading manifest...');
    const manifestRes = await fetch(CONFIG.MANIFEST_PATH);
    if (!manifestRes.ok) {
      throw new Error(`Manifest not found at ${CONFIG.MANIFEST_PATH}`);
    }

    manifestData = await manifestRes.json();
    console.log('[Dashboard] Manifest loaded:', manifestData);

    // Step 2: Load each report's execution JSON
    const reportPromises = manifestData.reports.map(async (reportInfo) => {
      const jsonPath = `${CONFIG.REPORTS_BASE_PATH}${reportInfo.executionFile}`;
      console.log(`[Dashboard] Loading ${jsonPath}...`);

      try {
        const res = await fetch(jsonPath);
        if (!res.ok) {
          console.warn(`[Dashboard] Failed to load ${jsonPath}: ${res.status}`);
          return null;
        }

        const json = await res.json();
        const metrics = extractMetrics(json);

        return {
          ...reportInfo,
          metrics,
          rawData: json
        };
      } catch (err) {
        console.error(`[Dashboard] Error loading ${jsonPath}:`, err);
        return null;
      }
    });

    allReports = (await Promise.all(reportPromises)).filter(r => r !== null);
    console.log('[Dashboard] All reports loaded:', allReports);

    // Step 3: Populate dashboard
    populateKPIs();
    populateReportGrids();
    updateCategoryCounts();

    showToast(`Loaded ${allReports.length} API report(s)`, 'success');

  } catch (err) {
    console.error('[Dashboard] Fatal error loading reports:', err);

    // Check if it's a CORS error (common when opening via file://)
    if (err.message.includes('Failed to fetch') || err.message.includes('CORS')) {
      showToast(
        `⚠️ CORS Error: Please run dashboard via http-server. Run: npx http-server . -p 8080 -o`,
        'error'
      );
      console.error('[Dashboard] CORS Error - Use http-server instead of file://');
      console.error('[Dashboard] Run: npx http-server . -p 8080 -o');
    } else {
      showToast(`Error loading reports: ${err.message}`, 'error');
    }
  } finally {
    isLoadingReports = false;
  }
}

/**
 * Populate KPI cards with aggregated metrics.
 */
function populateKPIs() {
  if (allReports.length === 0) return;

  // Aggregate metrics across all APIs
  const totals = allReports.reduce((acc, report) => {
    const m = report.metrics;
    return {
      apis: acc.apis + 1,
      tests: acc.tests + m.totalTests,
      passed: acc.passed + m.passed,
      bugs: acc.bugs + m.apiBugs
    };
  }, { apis: 0, tests: 0, passed: 0, bugs: 0 });

  const avgSuccess = totals.tests > 0
    ? ((totals.passed / totals.tests) * 100).toFixed(1)
    : 0;

  // Update KPI DOM elements
  const totalAPIsEl = document.getElementById('total-apis');
  const totalTestsEl = document.getElementById('total-tests');
  const avgSuccessEl = document.getElementById('avg-success');
  const totalBugsEl = document.getElementById('total-bugs');
  const lastScanEl = document.getElementById('last-scan');

  if (totalAPIsEl) totalAPIsEl.textContent = totals.apis;
  if (totalTestsEl) totalTestsEl.textContent = totals.tests;
  if (avgSuccessEl) avgSuccessEl.textContent = `${avgSuccess}%`;
  if (totalBugsEl) totalBugsEl.textContent = totals.bugs;
  if (lastScanEl) lastScanEl.textContent = timeAgo(new Date().toISOString());

  // Update admin panel stats
  const reportsCountEl = document.getElementById('reports-count');
  const lastUpdateEl = document.getElementById('last-update');

  if (reportsCountEl) reportsCountEl.textContent = allReports.length;
  if (lastUpdateEl) lastUpdateEl.textContent = 'Just now';
}

/**
 * Populate report grids for each category.
 */
function populateReportGrids() {
  // Group reports by category
  const byCategory = {
    admin: [],
    customer: [],
    vendor: [],
    delivery: []
  };

  allReports.forEach(report => {
    const cat = report.category || 'customer'; // Default to customer
    if (byCategory[cat]) {
      byCategory[cat].push(report);
    }
  });

  // Populate each grid
  Object.keys(byCategory).forEach(category => {
    const gridId = `${category}-grid`;
    const gridEl = document.getElementById(gridId);

    if (!gridEl) return;

    const reports = byCategory[category];

    if (reports.length === 0) {
      gridEl.innerHTML = `
        <div class="no-reports">
          <i class="fas fa-inbox"></i>
          <p>No reports found for this category</p>
          <small>Reports will appear here after test execution</small>
        </div>
      `;
    } else {
      gridEl.innerHTML = reports
        .map(report => generateReportCard(report, report.metrics))
        .join('');
    }
  });
}

/**
 * Update category card counts.
 */
function updateCategoryCounts() {
  const counts = {
    admin: 0,
    customer: 0,
    vendor: 0,
    delivery: 0
  };

  const testCounts = {
    admin: 0,
    customer: 0,
    vendor: 0,
    delivery: 0
  };

  allReports.forEach(report => {
    const cat = report.category || 'customer';
    counts[cat]++;
    testCounts[cat] += report.metrics.totalTests;
  });

  Object.keys(counts).forEach(cat => {
    const folderEl = document.getElementById(`${cat}-folder-count`);
    const testEl = document.getElementById(`${cat}-test-count`);

    if (folderEl) folderEl.textContent = counts[cat];
    if (testEl) testEl.textContent = testCounts[cat];
  });
}

// ============================================================================
// BUTTON HANDLERS
// ============================================================================

/**
 * Open full HTML report in new tab.
 * Handles both file:// and http:// protocols.
 * @param {string} htmlFile - Filename of HTML report
 */
function openReport(htmlFile) {
  let url = `${CONFIG.REPORTS_BASE_PATH}${htmlFile}`;

  // If running from file:// protocol, use absolute path
  if (window.location.protocol === 'file:') {
    const baseDir = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    url = `file://${baseDir}/reports/${htmlFile}`;
  }

  const opened = window.open(url, '_blank');
  if (!opened) {
    showToast('Please allow pop-ups to view reports', 'warning');
  }
}

/**
 * Open JSON execution file in new tab.
 * Handles both file:// and http:// protocols.
 * @param {string} jsonFile - Filename of JSON report
 */
function openJSON(jsonFile) {
  let url = `${CONFIG.REPORTS_BASE_PATH}${jsonFile}`;

  // If running from file:// protocol, use absolute path
  if (window.location.protocol === 'file:') {
    const baseDir = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    url = `file://${baseDir}/reports/${jsonFile}`;
  }

  const opened = window.open(url, '_blank');
  if (!opened) {
    showToast('Please allow pop-ups to view JSON', 'warning');
  }
}

// ============================================================================
// UI INTERACTIONS
// ============================================================================

/**
 * Initialize theme toggle functionality.
 */
function initThemeToggle() {
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;

  if (!themeToggle) return;

  // Load saved theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  body.classList.toggle('dark-mode', savedTheme === 'dark');

  themeToggle.addEventListener('click', () => {
    const isDark = body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');

    // Update icon
    const icon = themeToggle.querySelector('i');
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
  });
}

/**
 * Initialize category switching.
 */
function initCategorySwitching() {
  const categoryCards = document.querySelectorAll('.category-card');
  const reportContainers = document.querySelectorAll('.category-reports-container');

  categoryCards.forEach(card => {
    card.addEventListener('click', () => {
      // Prevent redundant updates if already active
      if (card.classList.contains('active')) return;

      const category = card.dataset.category;

      // Update active category card
      categoryCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      // Show corresponding report container
      reportContainers.forEach(container => {
        container.classList.toggle('active', container.id === `${category}-reports`);
      });
    });
  });
}

/**
 * Initialize scan buttons.
 */
function initScanButtons() {
  const scanButtons = ['scan-admin', 'scan-customer', 'scan-vendor', 'scan-delivery'];

  scanButtons.forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        showToast('Rescanning reports...', 'info');
        loadReports();
      });
    }
  });
}

/**
 * Initialize refresh and cache buttons.
 */
function initAdminControls() {
  const refreshBtn = document.getElementById('refresh-all');
  const clearCacheBtn = document.getElementById('clear-cache');
  const adminToggle = document.getElementById('admin-toggle');
  const adminPanel = document.getElementById('admin-panel');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      showToast('Refreshing dashboard...', 'info');
      loadReports();
    });
  }

  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
      allReports = [];
      manifestData = null;
      populateKPIs();
      populateReportGrids();
      showToast('Cache cleared', 'success');
    });
  }

  if (adminToggle && adminPanel) {
    adminToggle.addEventListener('click', () => {
      adminPanel.classList.toggle('open');
    });
  }
}

/**
 * Set current year in footer.
 */
function setCurrentYear() {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Main initialization on DOM ready.
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Dashboard] Initializing...');

  // Initialize UI components
  initThemeToggle();
  initCategorySwitching();
  initScanButtons();
  initAdminControls();
  setCurrentYear();

  // Load reports
  loadReports();

  console.log('[Dashboard] Initialization complete');
});

// Make functions globally available for onclick handlers
window.openReport = openReport;
window.openJSON = openJSON;
