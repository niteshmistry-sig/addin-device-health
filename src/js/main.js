/**
 * main.js — MyGeotab add-in lifecycle host.
 * Coordinates initialization, view switching, and data flow.
 * In standalone mode (no geotab global), uses mock data for UI preview.
 */
var DHD = DHD || {};

// Provide geotab stub when running standalone (preview mode)
if (typeof geotab === "undefined") {
    var geotab = { addin: {} };
}

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

    // ── Mock data for standalone preview ────────────────────────────────

    function buildMockApi() {
        var now = new Date();
        var hoursAgo = function (h) { return new Date(now.getTime() - h * 3600000).toISOString(); };

        // 24 mock devices across various health states
        var mockDevices = [
            { id: "d1",  name: "Truck 101 - Toronto",     serialNumber: "G9AA11000001", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d2",  name: "Truck 102 - Oakville",    serialNumber: "G9AA11000002", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d3",  name: "Van 201 - Mississauga",   serialNumber: "G9AA11000003", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
            { id: "d4",  name: "Van 202 - Brampton",      serialNumber: "G9AA11000004", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
            { id: "d5",  name: "Sedan 301 - Hamilton",    serialNumber: "G9AA11000005", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d6",  name: "Sedan 302 - Burlington",  serialNumber: "G9AA11000006", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d7",  name: "SUV 401 - Markham",       serialNumber: "G9AA11000007", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
            { id: "d8",  name: "SUV 402 - Richmond Hill", serialNumber: "G9AA11000008", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
            { id: "d9",  name: "Truck 103 - Vaughan",     serialNumber: "G9AA11000009", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d10", name: "Van 203 - Kitchener",     serialNumber: "G9AA11000010", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
            { id: "d11", name: "Truck 104 - London",      serialNumber: "G9AA11000011", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d12", name: "Van 204 - Waterloo",      serialNumber: "G9AA11000012", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
            { id: "d13", name: "Sedan 303 - Guelph",      serialNumber: "G9AA11000013", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d14", name: "SUV 403 - Oshawa",        serialNumber: "G9AA11000014", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
            { id: "d15", name: "Truck 105 - Barrie",      serialNumber: "G9AA11000015", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d16", name: "Van 205 - St. Catharines", serialNumber: "G9AA11000016", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
            { id: "d17", name: "Sedan 304 - Niagara",     serialNumber: "G9AA11000017", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d18", name: "SUV 404 - Peterborough",  serialNumber: "G9AA11000018", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
            { id: "d19", name: "Truck 106 - Sudbury",     serialNumber: "G9AA11000019", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d20", name: "Van 206 - Thunder Bay",   serialNumber: "G9AA11000020", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
            { id: "d21", name: "Sedan 305 - Windsor",     serialNumber: "G9AA11000021", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d22", name: "SUV 405 - Kingston",      serialNumber: "G9AA11000022", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
            { id: "d23", name: "Truck 107 - Ottawa",      serialNumber: "G9AA11000023", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
            { id: "d24", name: "Van 207 - Whitby",        serialNumber: "G9AA11000024", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] }
        ];

        var mockGroups = [
            { id: "g1", name: "Trucks & Sedans" },
            { id: "g2", name: "Vans" },
            { id: "g3", name: "SUVs" }
        ];

        // StatusInfos — vary communicating, lastComm, lat/lng
        var mockStatusInfos = [
            // Healthy — communicating, recent
            { device: {id:"d1"},  isDeviceCommunicating: true,  dateTime: hoursAgo(0.5), latitude: 43.65, longitude: -79.38 },
            { device: {id:"d2"},  isDeviceCommunicating: true,  dateTime: hoursAgo(1),   latitude: 43.45, longitude: -79.68 },
            { device: {id:"d5"},  isDeviceCommunicating: true,  dateTime: hoursAgo(0.2), latitude: 43.25, longitude: -79.87 },
            { device: {id:"d6"},  isDeviceCommunicating: true,  dateTime: hoursAgo(2),   latitude: 43.32, longitude: -79.80 },
            { device: {id:"d9"},  isDeviceCommunicating: true,  dateTime: hoursAgo(0.1), latitude: 43.80, longitude: -79.53 },
            { device: {id:"d11"}, isDeviceCommunicating: true,  dateTime: hoursAgo(3),   latitude: 42.98, longitude: -81.24 },
            { device: {id:"d13"}, isDeviceCommunicating: true,  dateTime: hoursAgo(1.5), latitude: 43.55, longitude: -80.25 },
            { device: {id:"d15"}, isDeviceCommunicating: true,  dateTime: hoursAgo(0.8), latitude: 44.38, longitude: -79.69 },
            { device: {id:"d17"}, isDeviceCommunicating: true,  dateTime: hoursAgo(4),   latitude: 43.06, longitude: -79.07 },
            { device: {id:"d22"}, isDeviceCommunicating: true,  dateTime: hoursAgo(0.3), latitude: 44.23, longitude: -76.49 },
            { device: {id:"d23"}, isDeviceCommunicating: true,  dateTime: hoursAgo(1.2), latitude: 45.42, longitude: -75.69 },
            { device: {id:"d24"}, isDeviceCommunicating: true,  dateTime: hoursAgo(0.7), latitude: 43.87, longitude: -78.94 },
            // GPS issue — communicating but lat/lng stuck at 0,0
            { device: {id:"d3"},  isDeviceCommunicating: true,  dateTime: hoursAgo(1),   latitude: 0,     longitude: 0 },
            { device: {id:"d14"}, isDeviceCommunicating: true,  dateTime: hoursAgo(2),   latitude: 0,     longitude: 0 },
            // Warning — communicating, recent, but will get faults
            { device: {id:"d4"},  isDeviceCommunicating: true,  dateTime: hoursAgo(3),   latitude: 43.73, longitude: -79.76 },
            { device: {id:"d7"},  isDeviceCommunicating: true,  dateTime: hoursAgo(5),   latitude: 43.85, longitude: -79.33 },
            { device: {id:"d10"}, isDeviceCommunicating: true,  dateTime: hoursAgo(2),   latitude: 43.45, longitude: -80.49 },
            { device: {id:"d12"}, isDeviceCommunicating: true,  dateTime: hoursAgo(6),   latitude: 43.46, longitude: -80.52 },
            { device: {id:"d16"}, isDeviceCommunicating: true,  dateTime: hoursAgo(4),   latitude: 43.16, longitude: -79.24 },
            { device: {id:"d21"}, isDeviceCommunicating: true,  dateTime: hoursAgo(8),   latitude: 42.32, longitude: -83.04 },
            // Offline > 24h
            { device: {id:"d8"},  isDeviceCommunicating: false, dateTime: hoursAgo(48),  latitude: 43.88, longitude: -79.43 },
            { device: {id:"d18"}, isDeviceCommunicating: false, dateTime: hoursAgo(36),  latitude: 44.30, longitude: -78.32 },
            // Offline > 72h (critical)
            { device: {id:"d19"}, isDeviceCommunicating: false, dateTime: hoursAgo(120), latitude: 46.49, longitude: -81.00 },
            { device: {id:"d20"}, isDeviceCommunicating: false, dateTime: hoursAgo(200), latitude: 48.38, longitude: -89.25 }
        ];

        // Faults — various codes to trigger different categories
        var mockFaults = [
            // d4 — low battery (fault code 135)
            { device: {id:"d4"},  diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hoursAgo(12) },
            // d7 — loose install (fault code 287)
            { device: {id:"d7"},  diagnostic: {id:"287"}, failureMode: {id:"287"}, dateTime: hoursAgo(24) },
            // d10 — low battery
            { device: {id:"d10"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hoursAgo(6) },
            // d12 — loose install
            { device: {id:"d12"}, diagnostic: {id:"287"}, failureMode: {id:"287"}, dateTime: hoursAgo(18) },
            // d16 — low battery + loose install
            { device: {id:"d16"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hoursAgo(10) },
            { device: {id:"d16"}, diagnostic: {id:"287"}, failureMode: {id:"287"}, dateTime: hoursAgo(10) },
            // d19 — hardware failure (fault code 128)
            { device: {id:"d19"}, diagnostic: {id:"128"}, failureMode: {id:"128"}, dateTime: hoursAgo(96) },
            // d20 — hardware failure + low battery
            { device: {id:"d20"}, diagnostic: {id:"450"}, failureMode: {id:"450"}, dateTime: hoursAgo(150) },
            { device: {id:"d20"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hoursAgo(150) },
            // d8 — OEM issue (fault code 488)
            { device: {id:"d8"},  diagnostic: {id:"488"}, failureMode: {id:"488"}, dateTime: hoursAgo(30) },
            // d21 — low battery
            { device: {id:"d21"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hoursAgo(5) }
        ];

        // Add firmware mismatch to a couple of devices
        mockDevices[10].parameterVersion = 42;  // d11
        mockDevices[10].parameterVersionOnDevice = 40;
        mockDevices[17].parameterVersion = 38;  // d18
        mockDevices[17].parameterVersionOnDevice = 36;

        return {
            multiCall: function (calls, success, failure) {
                var results = calls.map(function (call) {
                    var typeName = call[1].typeName;
                    switch (typeName) {
                        case "Device":       return mockDevices;
                        case "Group":        return mockGroups;
                        case "DeviceStatusInfo": return mockStatusInfos;
                        case "FaultData":    return mockFaults;
                        case "StatusData":   return [];
                        case "LogRecord":    return [];
                        default:             return [];
                    }
                });
                setTimeout(function () { success(results); }, 50);
            }
        };
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
        },

        /**
         * Auto-initialize with mock data when running standalone.
         */
        _initStandalone: function () {
            _api = buildMockApi();
            _page = {};
            bindRefresh();
            loadFleetData();
        }
    };
})();

// Auto-start in standalone mode (no MyGeotab host)
(function () {
    if (typeof document === "undefined") { return; }
    var _hostCalled = false;
    var _origInit = geotab.addin.deviceHealthDiagnostics.initialize;
    geotab.addin.deviceHealthDiagnostics.initialize = function (api, page, cb) {
        _hostCalled = true;
        return _origInit(api, page, cb);
    };
    function tryMockInit() {
        if (!_hostCalled) {
            geotab.addin.deviceHealthDiagnostics._initStandalone();
        }
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { setTimeout(tryMockInit, 200); });
    } else {
        setTimeout(tryMockInit, 200);
    }
})();
