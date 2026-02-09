# Dashboard Reference Guide

Quick reference for the Gazzer API Testing Dashboard. For general project documentation, see [README.md](README.md).

---

## Strict Metric Mapping

Dashboard metrics are mapped directly from JSON — no inference, no hardcoding. Missing data shows "N/A".

| Dashboard Metric | JSON Source | Mapping Logic |
|:-----------------|:------------|:--------------|
| Total Tests | `meta.totalTestCases` | Direct value |
| Passed | `meta.passed` | Direct value |
| Failed | `meta.failed` | Direct value |
| Skipped | `meta.skipped` | Direct value |
| Success Rate | `meta.passRate` | Parse percentage or calculate |
| API Bugs | `testCases[].confirmed_api_bug === true` | Count matching tests |
| Rate Limit Hits | `meta.rateLimitSummary.totalEvents` | Direct value or 0 |
| Rate Limit Recovered | `meta.rateLimitSummary.recoveredCount` | Direct value or 0 |
| Rate Limit Exhausted | `meta.rateLimitSummary.exhaustedCount` | Direct value or 0 |
| OWASP Coverage | `testCases[].owasp_category` | Calculate % with category |
| Languages | `testCases[].languages[]` | Extract unique languages |
| Execution Date | `meta.executionDate` | Format ISO 8601 date |
| Environment | `meta.environment` | Direct value or "N/A" |
| Release Readiness | `meta.releaseReadiness` | Direct value or "UNKNOWN" |
| Severity Breakdown | `meta.bugs.{critical,high,medium,low}` | Direct object |

---

## Adding New API Reports

### Step 1: Generate Report Files
Run your test suite to produce:
- `{APIName}_execution.json`
- `{APIName}_report.html`

Place both in the `/reports` directory.

### Step 2: Update Manifest
Edit `reports/manifest.json`:

```json
{
  "id": "new-api-name",
  "apiName": "New API Name",
  "category": "customer",
  "executionFile": "NewAPI_execution.json",
  "htmlFile": "NewAPI_report.html",
  "description": "Brief description"
}
```

### Step 3: Refresh Dashboard
Reload `index.html` or click "Scan Reports". The new API card appears automatically.

---

## Verification Checklist

### Basic Functionality
- [ ] Dashboard loads with zero console errors
- [ ] All API reports from `/reports` appear automatically
- [ ] Metrics match values inside JSON exactly
- [ ] "View Report" opens correct HTML in new tab
- [ ] "View JSON" opens correct JSON file in new tab

### Data Accuracy
- [ ] Total Tests = `meta.totalTestCases`
- [ ] Passed = `meta.passed`
- [ ] Failed = `meta.failed`
- [ ] Success Rate = `meta.passRate` (or calculated)
- [ ] API Bugs = count of `confirmed_api_bug === true`
- [ ] Rate Limit Hits = `meta.rateLimitSummary.totalEvents`
- [ ] OWASP Coverage calculated correctly
- [ ] Languages extracted from `testCases[].languages[]`

### Edge Cases
- [ ] Missing JSON files handled gracefully (toast error)
- [ ] Corrupted JSON files show error (not crash)
- [ ] Empty report arrays show "No reports found"
- [ ] Missing OWASP data shows "Not Covered"

---

## Troubleshooting

| Symptom | Cause | Fix |
|:--------|:------|:----|
| Dashboard shows "0 APIs" | Manifest not found or empty | Check `reports/manifest.json` exists and has valid JSON |
| All metrics show "N/A" | JSON file not found or corrupted | Verify `{API}_execution.json` exists and is valid JSON |
| "View Report" does nothing | HTML file path incorrect in manifest | Verify `htmlFile` in manifest matches actual filename |
| CORS error on load | Opening via `file://` protocol | Use `serve-dashboard.bat` or `npx http-server . -p 8080 -o` |
| Theme toggle doesn't persist | localStorage blocked | Enable localStorage in browser settings |
