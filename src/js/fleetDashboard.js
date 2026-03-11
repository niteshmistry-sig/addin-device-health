/**
 * fleetDashboard.js — Scorecard-style fleet dashboard with KPI cards,
 * health distribution donut, top/bottom devices, and per-category score table.
 */
var DHD = DHD || {};

DHD.FleetDashboard = (function () {
    "use strict";

    var C = DHD.Constants;
    var _classifications = [];
    var _searchText = "";
    var _sortCol = "score";
    var _sortAsc = false;
    var _onDeviceClick = null;
    var _eventsBound = false;

    // ── Health status levels (maps to severity system) ──────────────

    var HEALTH_LEVELS = [
        { key: "healthy",  label: "Healthy",  severity: C.Severity.HEALTHY,  color: "#4caf50", bg: "#e8f5e9" },
        { key: "info",     label: "Info",     severity: C.Severity.INFO,     color: "#0288d1", bg: "#e1f5fe" },
        { key: "warning",  label: "Warning",  severity: C.Severity.WARNING,  color: "#ff9800", bg: "#fff3e0" },
        { key: "critical", label: "Critical", severity: C.Severity.CRITICAL, color: "#f44336", bg: "#ffebee" }
    ];

    // Issue categories shown as table columns
    var CATEGORY_COLS = [
        { key: "power",        label: "Power",    categories: [C.Category.POWER] },
        { key: "gps",          label: "GPS",      categories: [C.Category.GPS] },
        { key: "cellular",     label: "Cellular", categories: [C.Category.CELLULAR, C.Category.OFFLINE] },
        { key: "installation", label: "Install",  categories: [C.Category.INSTALLATION] },
        { key: "hardware",     label: "Hardware", categories: [C.Category.HARDWARE, C.Category.UNPLUGGED] }
    ];

    function getHealthLevel(severity) {
        for (var i = 0; i < HEALTH_LEVELS.length; i++) {
            if (HEALTH_LEVELS[i].severity === severity) {
                return HEALTH_LEVELS[i];
            }
        }
        return HEALTH_LEVELS[0]; // default healthy
    }

    function getScoreColor(score) {
        if (score >= 80) { return "#4caf50"; }
        if (score >= 60) { return "#ff9800"; }
        if (score >= 40) { return "#f57c00"; }
        return "#f44336";
    }

    // ── Entry point ─────────────────────────────────────────────────

    function render(classifications, onDeviceClick) {
        _classifications = classifications;
        _onDeviceClick = onDeviceClick;
        _searchText = "";

        var metrics = computeFleetMetrics();
        renderKPICards(metrics);
        renderHealthDistribution(metrics);
        renderTopIssues();
        renderNeedAttention();
        renderTableHeader();
        renderTable();
        bindEvents();
    }

    // ── Compute fleet metrics ───────────────────────────────────────

    function computeFleetMetrics() {
        var total = _classifications.length;
        var totalScore = 0;
        var healthyCount = 0;
        var issueCount = 0;
        var offlineCount = 0;
        var statusCounts = { healthy: 0, info: 0, warning: 0, critical: 0 };

        _classifications.forEach(function (item) {
            var cls = item.classification;
            totalScore += cls.healthScore;

            // Count by severity
            var level = getHealthLevel(cls.severity);
            statusCounts[level.key]++;

            if (cls.severity === C.Severity.HEALTHY) {
                healthyCount++;
            } else {
                issueCount++;
            }

            // Count offline devices
            if (cls.issues.some(function (issue) { return issue.category === C.Category.OFFLINE; })) {
                offlineCount++;
            }
        });

        return {
            fleetScore: total > 0 ? (totalScore / total) : 0,
            totalDevices: total,
            healthyCount: healthyCount,
            issueCount: issueCount,
            offlineCount: offlineCount,
            statusCounts: statusCounts
        };
    }

    // ── KPI Cards ───────────────────────────────────────────────────

    function renderKPICards(metrics) {
        var container = document.getElementById("dhdKpiRow");
        if (!container) { return; }

        var cards = [
            { value: metrics.fleetScore.toFixed(1), label: "Fleet Health", accent: "dhd-kpi-card--success" },
            { value: formatNum(metrics.totalDevices), label: "Total Devices", accent: "" },
            { value: formatNum(metrics.healthyCount), label: "Healthy", accent: "dhd-kpi-card--success" },
            { value: formatNum(metrics.issueCount), label: "Issues Detected", accent: metrics.issueCount > 0 ? "dhd-kpi-card--error" : "" }
        ];

        var accentColors = { "dhd-kpi-card--success": "#2e7d32", "dhd-kpi-card--error": "#d32f2f", "": "#1976d2" };
        var html = '<table style="width:100%;border-collapse:separate;border-spacing:16px 0;table-layout:fixed;margin-bottom:24px;"><tr>';
        cards.forEach(function (c) {
            var topColor = accentColors[c.accent] || "#1976d2";
            html += '<td style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px 16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.12);border-top:4px solid ' + topColor + ';vertical-align:top;">' +
                '<div style="font-size:36px;font-weight:700;line-height:1.1;margin-bottom:4px;">' + c.value + '</div>' +
                '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#616161;">' + c.label + '</div>' +
                '</td>';
        });
        html += '</tr></table>';

        container.innerHTML = html;
    }

    // ── Donut Chart ─────────────────────────────────────────────────

    function renderHealthDistribution(metrics) {
        var canvas = document.getElementById("dhdDonutChart");
        var centerEl = document.getElementById("dhdDonutCenter");
        var legendEl = document.getElementById("dhdDonutLegend");
        if (!canvas || !canvas.getContext) { return; }

        var ctx = canvas.getContext("2d");
        var dpr = window.devicePixelRatio || 1;
        var size = 180;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = size + "px";
        canvas.style.height = size + "px";
        ctx.scale(dpr, dpr);

        var cx = size / 2;
        var cy = size / 2;
        var outerR = 80;
        var innerR = 55;
        var total = metrics.totalDevices || 1;

        var segments = [];
        HEALTH_LEVELS.forEach(function (level) {
            var count = metrics.statusCounts[level.key] || 0;
            if (count > 0) {
                segments.push({ label: level.label, count: count, color: level.color });
            }
        });

        if (segments.length === 0) {
            segments.push({ label: "No Data", count: 1, color: "#e0e0e0" });
        }

        // Draw arcs
        var startAngle = -Math.PI / 2;
        segments.forEach(function (seg) {
            var sweep = (seg.count / total) * 2 * Math.PI;
            var endAngle = startAngle + sweep;

            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, endAngle);
            ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = seg.color;
            ctx.fill();

            startAngle = endAngle;
        });

        // Center text
        if (centerEl) {
            centerEl.innerHTML = '<span style="font-size:28px;font-weight:700;line-height:1.1;display:block;">' + formatNum(metrics.totalDevices) + '</span>' +
                '<span style="font-size:11px;color:#616161;text-transform:uppercase;letter-spacing:0.5px;">Devices</span>';
        }

        // Legend
        if (legendEl) {
            var lhtml = "";
            HEALTH_LEVELS.forEach(function (level) {
                var count = metrics.statusCounts[level.key] || 0;
                lhtml += '<span style="display:inline-block;margin:0 8px 4px 0;font-size:11px;color:#616161;white-space:nowrap;">' +
                    '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + level.color + ';vertical-align:middle;margin-right:4px;"></span>' +
                    level.label + ' (' + count + ')' +
                    '</span>';
            });
            legendEl.innerHTML = lhtml;
        }
    }

    // ── Top Issues ──────────────────────────────────────────────────

    function renderTopIssues() {
        var container = document.getElementById("dhdTopIssues");
        if (!container) { return; }

        // Aggregate issues by label across all devices
        var issueCounts = {};
        var issueSeverity = {};
        _classifications.forEach(function (item) {
            item.classification.issues.forEach(function (issue) {
                var lbl = issue.label || "Unknown";
                issueCounts[lbl] = (issueCounts[lbl] || 0) + 1;
                // Keep the worst severity seen for this issue type
                if (!issueSeverity[lbl] || severityRank(issue.severity) < severityRank(issueSeverity[lbl])) {
                    issueSeverity[lbl] = issue.severity;
                }
            });
        });

        // Sort by count descending, take top 5
        var sorted = Object.keys(issueCounts).map(function (lbl) {
            return { label: lbl, count: issueCounts[lbl], severity: issueSeverity[lbl] };
        }).sort(function (a, b) {
            return b.count - a.count;
        }).slice(0, 5);

        if (sorted.length === 0) {
            container.innerHTML = '<div class="dhd-empty-state">No issues detected</div>';
            return;
        }

        var maxCount = sorted[0].count;
        var severityColors = {};
        severityColors[C.Severity.CRITICAL] = "#f44336";
        severityColors[C.Severity.WARNING] = "#ff9800";
        severityColors[C.Severity.INFO] = "#0288d1";
        severityColors[C.Severity.HEALTHY] = "#4caf50";

        var html = '<table style="width:100%;border-collapse:collapse;">';
        sorted.forEach(function (item) {
            var color = severityColors[item.severity] || "#9e9e9e";
            var barPct = Math.round((item.count / maxCount) * 100);
            html += '<tr style="border-bottom:1px solid #e0e0e0;">' +
                '<td style="width:12px;padding:8px 4px 8px 0;vertical-align:middle;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span></td>' +
                '<td style="padding:8px 4px;font-size:13px;font-weight:500;vertical-align:middle;">' + escHtml(item.label) + '</td>' +
                '<td style="width:30px;padding:8px 4px;font-size:13px;font-weight:700;text-align:right;vertical-align:middle;">' + item.count + '</td>' +
                '<td style="width:50px;padding:8px 4px;font-size:11px;color:#9e9e9e;vertical-align:middle;">devices</td>' +
                '<td style="width:60px;padding:8px 0;vertical-align:middle;"><div style="width:100%;height:6px;background:#f5f5f5;border-radius:3px;overflow:hidden;"><div style="width:' + barPct + '%;height:100%;background:' + color + ';border-radius:3px;"></div></div></td>' +
                '</tr>';
        });
        html += '</table>';

        container.innerHTML = html;
    }

    // ── Devices Needing Attention ────────────────────────────────────

    function renderNeedAttention() {
        var container = document.getElementById("dhdNeedAttention");
        if (!container) { return; }

        // Filter to devices that have issues, sort by health score ascending
        var withIssues = _classifications.filter(function (item) {
            return item.classification.severity !== C.Severity.HEALTHY;
        }).sort(function (a, b) {
            return a.classification.healthScore - b.classification.healthScore;
        }).slice(0, 5);

        if (withIssues.length === 0) {
            container.innerHTML = '<div class="dhd-empty-state">All devices healthy</div>';
            return;
        }

        var html = '<table style="width:100%;border-collapse:collapse;">';
        withIssues.forEach(function (item, i) {
            var score = item.classification.healthScore;
            var color = getScoreColor(score);
            html += '<tr data-device-id="' + item.device.id + '" style="cursor:pointer;border-bottom:1px solid #e0e0e0;">' +
                '<td style="width:24px;padding:8px 4px 8px 0;font-size:13px;font-weight:700;color:#9e9e9e;vertical-align:middle;">' + (i + 1) + '.</td>' +
                '<td style="padding:8px 4px;font-size:13px;color:#1976d2;font-weight:500;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;">' + escHtml(item.device.name) + '</td>' +
                '<td style="width:40px;padding:8px 0 8px 4px;font-size:14px;font-weight:700;text-align:right;color:' + color + ';vertical-align:middle;">' + score + '</td>' +
                '</tr>';
        });
        html += '</table>';

        container.innerHTML = html;
    }

    // ── Table Header ────────────────────────────────────────────────

    function renderTableHeader() {
        var countEl = document.getElementById("dhdTableCount");
        if (countEl) {
            var filtered = getFilteredData();
            countEl.textContent = "All Devices (" + filtered.length + ")";
        }
    }

    // ── Table ───────────────────────────────────────────────────────

    function renderTable() {
        var tbody = document.getElementById("dhdTableBody");
        if (!tbody) { return; }

        var filtered = getFilteredData();
        filtered = sortData(filtered);

        // Update count
        var countEl = document.getElementById("dhdTableCount");
        if (countEl) {
            countEl.textContent = "All Devices (" + filtered.length + ")";
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="dhd-empty">No devices match the current filters.</td></tr>';
            return;
        }

        var html = "";
        filtered.forEach(function (item) {
            var cls = item.classification;
            var device = item.device;
            var score = cls.healthScore;
            var level = getHealthLevel(cls.severity);

            // Compute per-category scores
            var catScores = computeCategoryScores(cls);

            html += '<tr class="dhd-table__row" data-device-id="' + device.id + '">';

            // Name
            html += '<td class="dhd-table__cell">' + escHtml(device.name) + '</td>';

            // Health Score
            html += '<td class="dhd-table__cell">' + renderScoreBar(score) + '</td>';

            // Status badge
            html += '<td class="dhd-table__cell"><span class="dhd-badge dhd-status-badge--' + level.key + '">' + level.label + '</span></td>';

            // Category columns
            CATEGORY_COLS.forEach(function (col) {
                var cs = catScores[col.key];
                html += '<td class="dhd-table__cell">' + renderScoreBar(cs.score, cs.count) + '</td>';
            });

            html += '</tr>';
        });

        tbody.innerHTML = html;
    }

    function computeCategoryScores(classification) {
        var scores = {};
        CATEGORY_COLS.forEach(function (col) {
            var count = 0;
            var deduction = 0;
            classification.issues.forEach(function (issue) {
                if (col.categories.indexOf(issue.category) !== -1) {
                    count++;
                    deduction += (C.ScoreDeductions[issue.severity] || 0);
                }
            });
            scores[col.key] = {
                score: Math.max(0, 100 - deduction),
                count: count
            };
        });
        return scores;
    }

    function renderScoreBar(score, eventCount) {
        var color = getScoreColor(score);
        var countStr = typeof eventCount === "number" ? ' <span style="color:#9e9e9e">(' + eventCount + ')</span>' : '';
        return '<table style="width:100%;min-width:100px;border-collapse:collapse;"><tr>' +
            '<td style="padding:0 6px 0 0;vertical-align:middle;"><div style="height:8px;background:#f5f5f5;border-radius:4px;overflow:hidden;min-width:40px;"><div style="width:' + score + '%;height:100%;background:' + color + ';border-radius:4px;"></div></div></td>' +
            '<td style="padding:0;width:60px;font-size:12px;font-weight:600;white-space:nowrap;color:' + color + ';vertical-align:middle;">' + score + countStr + '</td>' +
            '</tr></table>';
    }

    // ── Filtering ───────────────────────────────────────────────────

    function getFilteredData() {
        var data = _classifications;

        if (_searchText) {
            var terms = _searchText.toLowerCase().trim().split(/\s+/).filter(function (t) { return t.length > 0; });
            if (terms.length > 0) {
                data = data.filter(function (item) {
                    var searchable = buildSearchString(item);
                    return terms.every(function (term) {
                        return searchable.indexOf(term) !== -1;
                    });
                });
            }
        }

        return data;
    }

    function buildSearchString(item) {
        var device = item.device;
        var cls = item.classification;
        var level = getHealthLevel(cls.severity);
        var parts = [
            device.name || "",
            device.serialNumber || "",
            device.vehicleIdentificationNumber || "",
            device.comment || "",
            device.licensePlate || "",
            device.productId ? "GO" + device.productId : "",
            device.deviceType || "",
            level.label || "",
            cls.severity || "",
            cls.primaryIssue || ""
        ];

        if (device.groups && device.groups.length > 0) {
            device.groups.forEach(function (g) {
                parts.push(DHD.DeviceCache.getGroupName(g.id));
            });
        }

        if (cls.issues) {
            cls.issues.forEach(function (issue) {
                parts.push(issue.label || "");
                parts.push(issue.category || "");
            });
        }

        return parts.join(" ").toLowerCase();
    }

    // ── Sorting ─────────────────────────────────────────────────────

    function severityRank(s) {
        switch (s) {
            case C.Severity.CRITICAL: return 0;
            case C.Severity.WARNING: return 1;
            case C.Severity.INFO: return 2;
            case C.Severity.HEALTHY: return 3;
            default: return 4;
        }
    }

    function sortData(data) {
        var col = _sortCol;
        var asc = _sortAsc;

        data.sort(function (a, b) {
            var va, vb;
            switch (col) {
                case "name":
                    va = (a.device.name || "").toLowerCase();
                    vb = (b.device.name || "").toLowerCase();
                    break;
                case "score":
                    va = a.classification.healthScore;
                    vb = b.classification.healthScore;
                    break;
                case "status":
                    va = severityRank(a.classification.severity);
                    vb = severityRank(b.classification.severity);
                    break;
                case "power":
                case "gps":
                case "cellular":
                case "installation":
                case "hardware":
                    var aCat = computeCategoryScores(a.classification);
                    var bCat = computeCategoryScores(b.classification);
                    va = aCat[col].score;
                    vb = bCat[col].score;
                    break;
                default:
                    va = 0; vb = 0;
            }
            if (va < vb) { return asc ? -1 : 1; }
            if (va > vb) { return asc ? 1 : -1; }
            return 0;
        });

        return data;
    }

    // ── Events ──────────────────────────────────────────────────────

    function bindEvents() {
        if (_eventsBound) { return; }
        _eventsBound = true;

        // Table row clicks
        var tbody = document.getElementById("dhdTableBody");
        if (tbody) {
            tbody.addEventListener("click", function (e) {
                var row = e.target.closest("[data-device-id]");
                if (row && _onDeviceClick) {
                    _onDeviceClick(row.getAttribute("data-device-id"));
                }
            });
        }

        // Attention list clicks
        var attentionEl = document.getElementById("dhdNeedAttention");
        if (attentionEl) {
            attentionEl.addEventListener("click", function (e) {
                var item = e.target.closest("[data-device-id]");
                if (item && _onDeviceClick) {
                    _onDeviceClick(item.getAttribute("data-device-id"));
                }
            });
        }

        // Search
        var searchInput = document.getElementById("dhdSearch");
        if (searchInput) {
            searchInput.addEventListener("input", function () {
                _searchText = searchInput.value;
                renderTable();
            });
        }

        // Column sort
        var headers = document.querySelectorAll("#dhdFleetView [data-sort]");
        headers.forEach(function (header) {
            header.addEventListener("click", function () {
                var col = header.getAttribute("data-sort");
                if (_sortCol === col) {
                    _sortAsc = !_sortAsc;
                } else {
                    _sortCol = col;
                    _sortAsc = true;
                }
                updateSortIndicators();
                renderTable();
            });
        });

        // CSV export
        var csvBtn = document.getElementById("dhdCsvBtn");
        if (csvBtn) {
            csvBtn.addEventListener("click", exportCSV);
        }

        // Print
        var printBtn = document.getElementById("dhdPrintBtn");
        if (printBtn) {
            printBtn.addEventListener("click", function () {
                window.print();
            });
        }
    }

    function updateSortIndicators() {
        var headers = document.querySelectorAll("#dhdFleetView [data-sort]");
        headers.forEach(function (h) {
            h.classList.remove("dhd-sort--asc", "dhd-sort--desc");
            if (h.getAttribute("data-sort") === _sortCol) {
                h.classList.add(_sortAsc ? "dhd-sort--asc" : "dhd-sort--desc");
            }
        });
    }

    // ── CSV Export ───────────────────────────────────────────────────

    function exportCSV() {
        var filtered = getFilteredData();
        filtered = sortData(filtered);

        var headers = ["Device Name", "Health Score", "Status", "Power", "GPS", "Cellular", "Installation", "Hardware"];
        var rows = [headers.join(",")];

        filtered.forEach(function (item) {
            var cls = item.classification;
            var catScores = computeCategoryScores(cls);
            var level = getHealthLevel(cls.severity);

            var row = [
                '"' + (item.device.name || "").replace(/"/g, '""') + '"',
                cls.healthScore,
                '"' + level.label + '"',
                catScores.power.score + " (" + catScores.power.count + ")",
                catScores.gps.score + " (" + catScores.gps.count + ")",
                catScores.cellular.score + " (" + catScores.cellular.count + ")",
                catScores.installation.score + " (" + catScores.installation.count + ")",
                catScores.hardware.score + " (" + catScores.hardware.count + ")"
            ];
            rows.push(row.join(","));
        });

        var csv = rows.join("\n");
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "device-health-scorecard.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ── Utilities ───────────────────────────────────────────────────

    function escHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str || ""));
        return div.innerHTML;
    }

    function formatNum(n) {
        if (n == null) { return "0"; }
        return n.toLocaleString ? n.toLocaleString() : String(n);
    }

    return {
        render: render
    };
})();
