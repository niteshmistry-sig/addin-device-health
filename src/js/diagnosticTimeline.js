/**
 * diagnosticTimeline.js — Canvas-based line charts for voltage and RSSI trends.
 * No external charting library — pure canvas rendering.
 */
var DHD = DHD || {};

DHD.DiagnosticTimeline = (function () {
    "use strict";

    var C = DHD.Constants;
    var PADDING = { top: 20, right: 20, bottom: 40, left: 50 };
    var COLORS = {
        line: "#1976d2",
        point: "#1565c0",
        grid: "#e0e0e0",
        text: "#616161",
        thresholdCritical: "rgba(244, 67, 54, 0.6)",
        thresholdWarning: "rgba(255, 152, 0, 0.6)",
        thresholdOk: "rgba(76, 175, 80, 0.3)"
    };

    /**
     * Render a voltage chart on a canvas element.
     * @param {string} canvasId - DOM id of the canvas
     * @param {Object[]} statusRecords - StatusData records for voltage
     */
    function renderVoltageChart(canvasId, statusRecords) {
        var thresholds = [
            { value: C.Voltage.DEAD, color: COLORS.thresholdCritical, label: "Dead (7V)" },
            { value: C.Voltage.LOW, color: COLORS.thresholdWarning, label: "Low (9V)" },
            { value: C.Voltage.WARNING, color: COLORS.thresholdWarning, label: "Warning (11V)" }
        ];
        renderChart(canvasId, statusRecords, thresholds, "Voltage (V)", 0, 16);
    }

    /**
     * Render an RSSI chart on a canvas element.
     * @param {string} canvasId - DOM id of the canvas
     * @param {Object[]} statusRecords - StatusData records for RSSI
     */
    function renderRSSIChart(canvasId, statusRecords) {
        var thresholds = [
            { value: C.RSSI.POOR, color: COLORS.thresholdWarning, label: "Poor (-95)" },
            { value: C.RSSI.FAIR, color: COLORS.thresholdOk, label: "Fair (-85)" }
        ];
        renderChart(canvasId, statusRecords, thresholds, "RSSI (dBm)", -120, -50);
    }

    /**
     * Core chart renderer.
     */
    function renderChart(canvasId, records, thresholds, yLabel, yMin, yMax) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) { return; }

        var ctx = canvas.getContext("2d");
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        var w = rect.width || 400;
        var h = 200;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.scale(dpr, dpr);

        var plotW = w - PADDING.left - PADDING.right;
        var plotH = h - PADDING.top - PADDING.bottom;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // No data
        if (!records || records.length === 0) {
            ctx.fillStyle = C.Severity ? "#9e9e9e" : "#999";
            ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("No data available", w / 2, h / 2);
            return;
        }

        // Sort by date
        var sorted = records.slice().sort(function (a, b) {
            return new Date(a.dateTime) - new Date(b.dateTime);
        });

        var tMin = new Date(sorted[0].dateTime).getTime();
        var tMax = new Date(sorted[sorted.length - 1].dateTime).getTime();
        if (tMin === tMax) { tMax = tMin + 1; }

        // Scale functions
        function xScale(t) {
            return PADDING.left + ((t - tMin) / (tMax - tMin)) * plotW;
        }
        function yScale(v) {
            return PADDING.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
        }

        // Grid lines (horizontal)
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
        var ySteps = 5;
        var yStep = (yMax - yMin) / ySteps;
        for (var yi = 0; yi <= ySteps; yi++) {
            var yv = yMin + yi * yStep;
            var yy = yScale(yv);
            ctx.beginPath();
            ctx.moveTo(PADDING.left, yy);
            ctx.lineTo(PADDING.left + plotW, yy);
            ctx.stroke();

            // Y-axis labels
            ctx.fillStyle = COLORS.text;
            ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(yv.toFixed(0), PADDING.left - 6, yy + 3);
        }

        // Threshold lines
        thresholds.forEach(function (t) {
            if (t.value >= yMin && t.value <= yMax) {
                var ty = yScale(t.value);
                ctx.strokeStyle = t.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                ctx.moveTo(PADDING.left, ty);
                ctx.lineTo(PADDING.left + plotW, ty);
                ctx.stroke();
                ctx.setLineDash([]);

                // Label
                ctx.fillStyle = t.color;
                ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
                ctx.textAlign = "left";
                ctx.fillText(t.label, PADDING.left + plotW + 2, ty + 3);
            }
        });

        // Data line
        ctx.strokeStyle = COLORS.line;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.beginPath();
        sorted.forEach(function (rec, i) {
            var x = xScale(new Date(rec.dateTime).getTime());
            var y = yScale(rec.data);
            if (i === 0) { ctx.moveTo(x, y); }
            else { ctx.lineTo(x, y); }
        });
        ctx.stroke();

        // Data points (only if < 100 points)
        if (sorted.length < 100) {
            ctx.fillStyle = COLORS.point;
            sorted.forEach(function (rec) {
                var x = xScale(new Date(rec.dateTime).getTime());
                var y = yScale(rec.data);
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // X-axis date labels (5 evenly spaced)
        ctx.fillStyle = COLORS.text;
        ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        var xSteps = Math.min(5, sorted.length);
        for (var xi = 0; xi < xSteps; xi++) {
            var ratio = xi / (xSteps - 1 || 1);
            var tVal = tMin + ratio * (tMax - tMin);
            var dt = new Date(tVal);
            var label = (dt.getMonth() + 1) + "/" + dt.getDate();
            var xPos = xScale(tVal);
            ctx.fillText(label, xPos, h - PADDING.bottom + 16);
        }

        // Y-axis title
        ctx.save();
        ctx.translate(12, PADDING.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = COLORS.text;
        ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    }

    return {
        renderVoltageChart: renderVoltageChart,
        renderRSSIChart: renderRSSIChart
    };
})();
