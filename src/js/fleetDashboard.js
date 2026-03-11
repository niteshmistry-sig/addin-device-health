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

        var html = "";
        cards.forEach(function (c) {
            html += '<div class="dhd-kpi-card ' + c.accent + '">' +
                '<div class="dhd-kpi-card__value">' + c.value + '</div>' +
                '<div class="dhd-kpi-card__label">' + c.label + '</div>' +
                '</div>';
        });

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
            centerEl.innerHTML = '<span class="dhd-donut-center__count">' + formatNum(metrics.totalDevices) + '</span>' +
                '<span class="dhd-donut-center__label">Devices</span>';
        }

        // Legend
        if (legendEl) {
            var lhtml = "";
            HEALTH_LEVELS.forEach(function (level) {
                var count = metrics.statusCounts[level.key] || 0;
                lhtml += '<span class="dhd-donut-legend__item">' +
                    '<span class="dhd-donut-legend__dot" style="background:' + level.color + '"></span>' +
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

        var html = "";
        sorted.forEach(function (item) {
            var color = severityColors[item.severity] || "#9e9e9e";
            var barPct = Math.round((item.count / maxCount) * 100);
            html += '<div class="dhd-issue-item">' +
                '<span class="dhd-issue-item__indicator" style="background:' + color + '"></span>' +
                '<span class="dhd-issue-item__label">' + escHtml(item.label) + '</span>' +
                '<span class="dhd-issue-item__count">' + item.count + '</span>' +
                '<span class="dhd-issue-item__suffix">devices</span>' +
                '<div class="dhd-issue-item__bar-wrap"><div class="dhd-issue-item__bar" style="width:' + barPct + '%;background:' + color + '"></div></div>' +
                '</div>';
        });

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

        var html = "";
        withIssues.forEach(function (item, i) {
            var score = item.classification.healthScore;
            var color = getScoreColor(score);
            var issueLabel = item.classification.issues.length > 0 ? item.classification.issues[0].label : "";
            html += '<div class="dhd-performer-item" data-device-id="' + item.device.id + '">' +
                '<span class="dhd-performer-rank">' + (i + 1) + '.</span>' +
                '<span class="dhd-performer-name">' + escHtml(item.device.name) + '</span>' +
                '<span class="dhd-performer-score" style="color:' + color + '">' + score + '</span>' +
                '</div>';
        });

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
        return '<div class="dhd-score-bar">' +
            '<div class="dhd-score-bar__track"><div class="dhd-score-bar__fill" style="width:' + score + '%;background:' + color + '"></div></div>' +
            '<span class="dhd-score-bar__text" style="color:' + color + '">' + score + countStr + '</span>' +
            '</div>';
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
