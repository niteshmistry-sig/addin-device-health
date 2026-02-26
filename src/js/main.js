/**
 * main.js — MyGeotab add-in lifecycle host.
 * Coordinates initialization, view switching, and data flow.
 */
var DHD = DHD || {};

geotab.addin.deviceHealthDiagnostics = (function () {
    "use strict";

    var C = DHD.Constants;
    var _api, _page;
    var _fleetData = null;      // cached fleet health
    var _classifications = [];  // classified fleet data
    var _statusInfoMap = {};    // deviceId → statusInfo

    // ── View toggling ──────────────────────────────────────────────────

    function showFleetView() {
        var fleet = document.getElementById("dhdFleetView");
        var drill = document.getElementById("dhdDrillView");
        if (fleet) { fleet.classList.add("dhd-view--active"); }
        if (drill) { drill.classList.remove("dhd-view--active"); }
    }

    function showDrillView() {
        var fleet = document.getElementById("dhdFleetView");
        var drill = document.getElementById("dhdDrillView");
        if (fleet) { fleet.classList.remove("dhd-view--active"); }
        if (drill) { drill.classList.add("dhd-view--active"); }
    }

    // ── Loading / Error states ─────────────────────────────────────────

    function showLoading(message) {
        var el = document.getElementById("dhdLoading");
        if (el) {
            el.textContent = message || "Loading\u2026";
            el.style.display = "flex";
        }
        var err = document.getElementById("dhdError");
        if (err) { err.style.display = "none"; }
    }

    function hideLoading() {
        var el = document.getElementById("dhdLoading");
        if (el) { el.style.display = "none"; }
    }

    function showError(message) {
        hideLoading();
        var el = document.getElementById("dhdError");
        if (el) {
            el.textContent = message;
            el.style.display = "block";
        }
    }

    // ── Fleet data load & classify ─────────────────────────────────────

    function loadFleetData() {
        showLoading("Loading fleet health data\u2026");

        DHD.DeviceCache.load(_api)
            .then(function () {
                return DHD.HealthService.fetchFleetHealth(_api);
            })
            .then(function (data) {
                _fleetData = data;
                classifyFleet();
                hideLoading();
                DHD.FleetDashboard.render(_classifications, onDeviceClick);
            })
            .catch(function (err) {
                showError("Failed to load fleet data: " + (err.message || err));
                console.error("DHD fleet load error:", err);
            });
    }

    function classifyFleet() {
        _classifications = [];
        _statusInfoMap = {};

        var devices = DHD.DeviceCache.getAllDevices();
        var siMap = {};

        // Index statusInfos by device id
        _fleetData.statusInfos.forEach(function (si) {
            if (si.device && si.device.id) {
                siMap[si.device.id] = si;
            }
        });

        devices.forEach(function (device) {
            var si = siMap[device.id];
            if (!si) { return; } // no status info — skip

            _statusInfoMap[device.id] = si;

            var faults = _fleetData.faultsByDevice[device.id] || [];
            var classification = DHD.RootCauseEngine.classifyDevice(si, faults, device);

            _classifications.push({
                device: device,
                statusInfo: si,
                classification: classification
            });
        });
    }

    // ── Device drill-down ──────────────────────────────────────────────

    function onDeviceClick(deviceId) {
        var device = DHD.DeviceCache.getDevice(deviceId);
        var statusInfo = _statusInfoMap[deviceId];
        if (!device || !statusInfo) { return; }

        showDrillView();
        showLoading("Loading device diagnostics\u2026");

        DHD.HealthService.fetchDeviceDrillDown(_api, deviceId)
            .then(function (drillData) {
                var analysis = DHD.RootCauseEngine.analyzeDevice(device, statusInfo, drillData);
                hideLoading();
                DHD.DeviceDiagnostics.render(device, statusInfo, analysis, drillData, function () {
                    showFleetView();
                });
            })
            .catch(function (err) {
                showError("Failed to load device diagnostics: " + (err.message || err));
                console.error("DHD drill-down error:", err);
            });
    }

    // ── Refresh button ─────────────────────────────────────────────────

    function bindRefresh() {
        var btn = document.getElementById("dhdRefreshBtn");
        if (btn) {
            btn.addEventListener("click", function () {
                showFleetView();
                loadFleetData();
            });
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    return {
        /**
         * Called once when the add-in is first loaded.
         */
        initialize: function (api, page, callback) {
            _api = api;
            _page = page;

            bindRefresh();
            loadFleetData();

            if (callback) { callback(); }
        },

        /**
         * Called each time the user navigates to this add-in.
         */
        focus: function (api, page) {
            _api = api;
            _page = page;

            var container = document.getElementById("dhdContainer");
            if (container) { container.style.display = "block"; }

            showFleetView();
        },

        /**
         * Called when the user navigates away from this add-in.
         */
        blur: function () {
            var container = document.getElementById("dhdContainer");
            if (container) { container.style.display = "none"; }
        }
    };
})();
