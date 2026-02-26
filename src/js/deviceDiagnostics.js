/**
 * deviceDiagnostics.js — Single-device drill-down panel.
 * Shows health score, root causes, charts, fault history, device info.
 */
var DHD = DHD || {};

DHD.DeviceDiagnostics = (function () {
    "use strict";

    var C = DHD.Constants;

    /**
     * Render the drill-down view for a single device.
     * @param {Object} device - Device from cache
     * @param {Object} statusInfo - DeviceStatusInfo
     * @param {Object} analysis - result from rootCauseEngine.analyzeDevice()
     * @param {Object} drillData - raw drill-down data (statusData, faults)
     * @param {Function} onBack - callback to return to fleet view
     */
    function render(device, statusInfo, analysis, drillData, onBack) {
        renderHeader(device, onBack);
        renderHealthScore(analysis.healthScore);
        renderActiveIssues(analysis.issues);
        renderRootCauses(analysis.rootCauses);
        renderCharts(drillData.statusData);
        renderFaultHistory(drillData.faults);
        renderDeviceInfo(device, statusInfo);
    }

    // ── Header ─────────────────────────────────────────────────────────

    function renderHeader(device, onBack) {
        var el = document.getElementById("dhdDrillHeader");
        if (!el) { return; }

        el.innerHTML =
            '<button class="dhd-btn dhd-btn--back" id="dhdBackBtn">&larr; Back to Fleet</button>' +
            '<div class="dhd-drill-title">' +
                '<h2>' + escHtml(device.name) + '</h2>' +
                '<span class="dhd-drill-serial">S/N: ' + escHtml(device.serialNumber || "N/A") +
                ' &middot; Firmware: ' + escHtml(formatFirmware(device)) + '</span>' +
            '</div>';

        document.getElementById("dhdBackBtn").addEventListener("click", function () {
            if (onBack) { onBack(); }
        });
    }

    // ── Health Score ───────────────────────────────────────────────────

    function renderHealthScore(score) {
        var el = document.getElementById("dhdHealthScore");
        if (!el) { return; }

        var colorClass = "dhd-score--healthy";
        if (score < 40) { colorClass = "dhd-score--critical"; }
        else if (score < 70) { colorClass = "dhd-score--warning"; }

        el.innerHTML =
            '<div class="dhd-score ' + colorClass + '">' +
                '<div class="dhd-score__value">' + score + '</div>' +
                '<div class="dhd-score__label">Health Score</div>' +
            '</div>';
    }

    // ── Active Issues ──────────────────────────────────────────────────

    function renderActiveIssues(issues) {
        var el = document.getElementById("dhdActiveIssues");
        if (!el) { return; }

        if (issues.length === 0) {
            el.innerHTML = '<div class="dhd-badge dhd-severity--healthy">No Active Issues</div>';
            return;
        }

        var html = "";
        issues.forEach(function (issue) {
            html += '<span class="dhd-badge dhd-severity--' + issue.severity + '">' +
                escHtml(issue.label) + '</span> ';
        });
        el.innerHTML = html;
    }

    // ── Root Cause Analysis ────────────────────────────────────────────

    function renderRootCauses(rootCauses) {
        var el = document.getElementById("dhdRootCauses");
        if (!el) { return; }

        if (rootCauses.length === 0) {
            el.innerHTML = '<div class="dhd-empty-state">No issues detected. This device appears healthy.</div>';
            return;
        }

        var html = "";
        rootCauses.forEach(function (rc) {
            html += '<div class="dhd-root-cause dhd-root-cause--' + rc.severity + '">' +
                '<div class="dhd-root-cause__header">' +
                    '<span class="dhd-root-cause__rank">#' + rc.rank + '</span>' +
                    '<span class="dhd-root-cause__category">' + capitalize(rc.category) + '</span>' +
                    '<span class="dhd-root-cause__confidence">' + rc.confidence + '% confidence</span>' +
                    '<span class="dhd-badge dhd-severity--' + rc.severity + '">' + capitalize(rc.severity) + '</span>' +
                '</div>' +
                '<div class="dhd-root-cause__explanation">' + escHtml(rc.explanation) + '</div>' +
                '<div class="dhd-root-cause__actions">' +
                    '<strong>Recommended Actions:</strong><ul>';
            rc.actions.forEach(function (action) {
                html += '<li>' + escHtml(action) + '</li>';
            });
            html += '</ul></div></div>';
        });

        el.innerHTML = html;
    }

    // ── Charts ─────────────────────────────────────────────────────────

    function renderCharts(statusData) {
        // Slight delay so canvas elements are in the DOM
        setTimeout(function () {
            DHD.DiagnosticTimeline.renderVoltageChart("dhdVoltageChart",
                statusData[C.Diagnostics.VOLTAGE]);
            DHD.DiagnosticTimeline.renderRSSIChart("dhdRSSIChart",
                statusData[C.Diagnostics.CELLULAR_RSSI]);
        }, 50);
    }

    // ── Fault History ──────────────────────────────────────────────────

    function renderFaultHistory(faults) {
        var el = document.getElementById("dhdFaultHistory");
        if (!el) { return; }

        if (!faults || faults.length === 0) {
            el.innerHTML = '<div class="dhd-empty-state">No faults recorded in the last 30 days.</div>';
            return;
        }

        // Sort by date descending, take last 50
        var sorted = faults.slice().sort(function (a, b) {
            return new Date(b.dateTime) - new Date(a.dateTime);
        }).slice(0, 50);

        var html = '<table class="dhd-table dhd-table--faults">' +
            '<thead><tr>' +
            '<th>Date</th><th>Code</th><th>Description</th><th>Severity</th><th>State</th>' +
            '</tr></thead><tbody>';

        sorted.forEach(function (f) {
            var dt = f.dateTime ? formatDate(f.dateTime) : "N/A";
            var code = f.diagnostic ? (f.diagnostic.id || "—") : "—";
            var desc = f.diagnostic ? (f.diagnostic.name || code) : "—";
            var sev = classifyFaultSeverity(f);
            var state = f.failureModeState === 1 ? "Active" : "Inactive";

            html += '<tr>' +
                '<td>' + dt + '</td>' +
                '<td>' + escHtml(String(code)) + '</td>' +
                '<td>' + escHtml(desc) + '</td>' +
                '<td><span class="dhd-badge dhd-severity--' + sev + '">' + capitalize(sev) + '</span></td>' +
                '<td>' + state + '</td>' +
                '</tr>';
        });

        html += '</tbody></table>';
        el.innerHTML = html;
    }

    // ── Device Info ────────────────────────────────────────────────────

    function renderDeviceInfo(device, statusInfo) {
        var el = document.getElementById("dhdDeviceInfo");
        if (!el) { return; }

        var fwPending = device.parameterVersion != null && device.parameterVersionOnDevice != null &&
                        device.parameterVersion !== device.parameterVersionOnDevice;

        var html = '<div class="dhd-info-grid">' +
            infoItem("Serial Number", device.serialNumber || "N/A") +
            infoItem("Product", device.productId ? "GO" + device.productId : "N/A") +
            infoItem("Firmware", formatFirmware(device)) +
            infoItem("Config Version", (device.parameterVersion || "N/A") +
                (fwPending ? ' <span class="dhd-badge dhd-severity--info">Update Pending</span>' : "")) +
            infoItem("On-Device Config", device.parameterVersionOnDevice || "N/A") +
            infoItem("Communicating", statusInfo.isDeviceCommunicating ? "Yes" : "No") +
            infoItem("Last Communication", statusInfo.dateTime ? formatDate(statusInfo.dateTime) : "N/A") +
            infoItem("Position", statusInfo.latitude != null ?
                statusInfo.latitude.toFixed(4) + ", " + statusInfo.longitude.toFixed(4) : "N/A") +
            '</div>';

        el.innerHTML = html;
    }

    // ── Utilities ──────────────────────────────────────────────────────

    function infoItem(label, value) {
        return '<div class="dhd-info-item"><span class="dhd-info-item__label">' +
            escHtml(label) + '</span><span class="dhd-info-item__value">' + value + '</span></div>';
    }

    function classifyFaultSeverity(fault) {
        if (!fault.diagnostic) { return C.Severity.INFO; }
        var id = parseInt(fault.diagnostic.id, 10);
        if (C.HARDWARE_FAULT_CODES.indexOf(id) !== -1) { return C.Severity.CRITICAL; }
        if (id === 135 || id === 287) { return C.Severity.WARNING; }
        return C.Severity.INFO;
    }

    function formatFirmware(device) {
        if (device.majorVersion != null) {
            return device.majorVersion + "." + (device.minorVersion || 0);
        }
        return "N/A";
    }

    function formatDate(dateStr) {
        if (!dateStr) { return "N/A"; }
        var d = new Date(dateStr);
        return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear() + " " +
            pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function pad(n) { return n < 10 ? "0" + n : String(n); }

    function escHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str || ""));
        return div.innerHTML;
    }

    function capitalize(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    }

    return {
        render: render
    };
})();
