/**
 * fleetDashboard.js — Summary tiles + sortable/filterable device table.
 */
var DHD = DHD || {};

DHD.FleetDashboard = (function () {
    "use strict";

    var C = DHD.Constants;
    var _classifications = [];  // cached fleet results
    var _activeFilter = null;   // tile filter
    var _searchText = "";
    var _sortCol = "severity";
    var _sortAsc = true;
    var _onDeviceClick = null;

    // ── Tile definitions ───────────────────────────────────────────────

    var TILES = [
        { key: "total",     label: "Total",            icon: "devices",     filterFn: function () { return true; } },
        { key: "healthy",   label: "Healthy",          icon: "check",       filterFn: function (c) { return c.severity === C.Severity.HEALTHY; } },
        { key: "offline",   label: "Offline",          icon: "cloud_off",   filterFn: function (c) { return c.issues.some(function (i) { return i.category === C.Category.OFFLINE; }); } },
        { key: "battery",   label: "Low Battery",      icon: "battery_alert", filterFn: function (c) { return c.primaryIssue === C.Category.POWER; } },
        { key: "install",   label: "Loose Install",    icon: "build",       filterFn: function (c) { return c.primaryIssue === C.Category.INSTALLATION; } },
        { key: "gps",       label: "GPS Issues",       icon: "gps_off",     filterFn: function (c) { return c.primaryIssue === C.Category.GPS; } },
        { key: "hardware",  label: "Hardware Failure",  icon: "error",       filterFn: function (c) { return c.primaryIssue === C.Category.HARDWARE; } },
        { key: "unplugged", label: "Unplugged",         icon: "power_off",   filterFn: function (c) { return c.primaryIssue === C.Category.UNPLUGGED; } }
    ];

    /**
     * Render the fleet dashboard with the given classified data.
     * @param {Object[]} classifications - Array of { device, statusInfo, classification }
     * @param {Function} onDeviceClick - callback(deviceId)
     */
    function render(classifications, onDeviceClick) {
        _classifications = classifications;
        _onDeviceClick = onDeviceClick;
        _activeFilter = null;
        _searchText = "";

        renderTiles();
        renderTable();
        bindEvents();
    }

    // ── Tiles ──────────────────────────────────────────────────────────

    function renderTiles() {
        var container = document.getElementById("dhdTiles");
        if (!container) { return; }

        var html = "";
        TILES.forEach(function (tile) {
            var count = _classifications.filter(tile.filterFn).length;
            var colorClass = "dhd-tile";
            if (tile.key === "healthy") { colorClass += " dhd-tile--healthy"; }
            else if (tile.key === "total") { colorClass += " dhd-tile--total"; }
            else if (count > 0) { colorClass += " dhd-tile--issue"; }

            var activeClass = (_activeFilter === tile.key) ? " dhd-tile--active" : "";

            html += '<div class="' + colorClass + activeClass + '" data-tile="' + tile.key + '">' +
                '<div class="dhd-tile__count">' + count + '</div>' +
                '<div class="dhd-tile__label">' + tile.label + '</div>' +
                '</div>';
        });

        container.innerHTML = html;
    }

    // ── Table ──────────────────────────────────────────────────────────

    function renderTable() {
        var tbody = document.getElementById("dhdTableBody");
        if (!tbody) { return; }

        var filtered = getFilteredData();
        filtered = sortData(filtered);

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="dhd-empty">No devices match the current filters.</td></tr>';
            return;
        }

        var html = "";
        filtered.forEach(function (item) {
            var cls = item.classification;
            var device = item.device;
            var si = item.statusInfo;
            var sevClass = "dhd-severity--" + cls.severity;
            var barWidth = cls.healthScore + "%";
            var barClass = "dhd-health-bar__fill";
            if (cls.healthScore < 40) { barClass += " dhd-health-bar__fill--critical"; }
            else if (cls.healthScore < 70) { barClass += " dhd-health-bar__fill--warning"; }

            var lastComm = si.dateTime ? formatDate(si.dateTime) : "N/A";
            var issueLbl = cls.primaryIssue === C.Category.HEALTHY ? "Healthy" : (cls.issues.length > 0 ? cls.issues[0].label : "Unknown");

            html += '<tr class="dhd-table__row" data-device-id="' + device.id + '">' +
                '<td class="dhd-table__cell">' + escHtml(device.name) + '</td>' +
                '<td class="dhd-table__cell">' + escHtml(device.serialNumber || "—") + '</td>' +
                '<td class="dhd-table__cell"><span class="dhd-badge ' + sevClass + '">' + capitalize(cls.severity) + '</span></td>' +
                '<td class="dhd-table__cell">' + escHtml(issueLbl) + '</td>' +
                '<td class="dhd-table__cell"><div class="dhd-health-bar"><div class="' + barClass + '" style="width:' + barWidth + '"></div><span class="dhd-health-bar__text">' + cls.healthScore + '</span></div></td>' +
                '<td class="dhd-table__cell">' + lastComm + '</td>' +
                '<td class="dhd-table__cell"><button class="dhd-btn dhd-btn--small dhd-btn--diagnose" data-device-id="' + device.id + '">Diagnose</button></td>' +
                '</tr>';
        });

        tbody.innerHTML = html;
    }

    function getFilteredData() {
        var data = _classifications;

        // Tile filter
        if (_activeFilter && _activeFilter !== "total") {
            var tile = TILES.find(function (t) { return t.key === _activeFilter; });
            if (tile) {
                data = data.filter(function (item) {
                    return tile.filterFn(item.classification);
                });
            }
        }

        // Search text
        if (_searchText) {
            var q = _searchText.toLowerCase();
            data = data.filter(function (item) {
                return (item.device.name && item.device.name.toLowerCase().indexOf(q) !== -1) ||
                       (item.device.serialNumber && item.device.serialNumber.toLowerCase().indexOf(q) !== -1);
            });
        }

        return data;
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
                case "serial":
                    va = (a.device.serialNumber || "").toLowerCase();
                    vb = (b.device.serialNumber || "").toLowerCase();
                    break;
                case "severity":
                    va = severityRank(a.classification.severity);
                    vb = severityRank(b.classification.severity);
                    break;
                case "category":
                    va = a.classification.primaryIssue;
                    vb = b.classification.primaryIssue;
                    break;
                case "health":
                    va = a.classification.healthScore;
                    vb = b.classification.healthScore;
                    break;
                case "lastComm":
                    va = a.statusInfo.dateTime ? new Date(a.statusInfo.dateTime).getTime() : 0;
                    vb = b.statusInfo.dateTime ? new Date(b.statusInfo.dateTime).getTime() : 0;
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

    function severityRank(s) {
        switch (s) {
            case C.Severity.CRITICAL: return 0;
            case C.Severity.WARNING: return 1;
            case C.Severity.INFO: return 2;
            case C.Severity.HEALTHY: return 3;
            default: return 4;
        }
    }

    // ── Events ─────────────────────────────────────────────────────────

    function bindEvents() {
        // Tile clicks
        var tilesContainer = document.getElementById("dhdTiles");
        if (tilesContainer) {
            tilesContainer.addEventListener("click", function (e) {
                var tile = e.target.closest("[data-tile]");
                if (tile) {
                    var key = tile.getAttribute("data-tile");
                    _activeFilter = (_activeFilter === key) ? null : key;
                    renderTiles();
                    renderTable();
                }
            });
        }

        // Table row / diagnose button clicks
        var tbody = document.getElementById("dhdTableBody");
        if (tbody) {
            tbody.addEventListener("click", function (e) {
                var btn = e.target.closest("[data-device-id]");
                if (btn && _onDeviceClick) {
                    _onDeviceClick(btn.getAttribute("data-device-id"));
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
        var headers = document.querySelectorAll("[data-sort]");
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
    }

    function updateSortIndicators() {
        var headers = document.querySelectorAll("[data-sort]");
        headers.forEach(function (h) {
            h.classList.remove("dhd-sort--asc", "dhd-sort--desc");
            if (h.getAttribute("data-sort") === _sortCol) {
                h.classList.add(_sortAsc ? "dhd-sort--asc" : "dhd-sort--desc");
            }
        });
    }

    // ── Utilities ──────────────────────────────────────────────────────

    function formatDate(dateStr) {
        if (!dateStr) { return "N/A"; }
        var d = new Date(dateStr);
        var now = new Date();
        var diffH = (now - d) / (1000 * 60 * 60);

        if (diffH < 1) { return Math.round(diffH * 60) + "m ago"; }
        if (diffH < 24) { return Math.round(diffH) + "h ago"; }
        if (diffH < 720) { return Math.round(diffH / 24) + "d ago"; }
        return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    }

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
