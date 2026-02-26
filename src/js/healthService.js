/**
 * healthService.js — API fetch layer for fleet-level and device drill-down data.
 */
var DHD = DHD || {};

DHD.HealthService = (function () {
    "use strict";

    var C = DHD.Constants;

    /**
     * Fetch fleet-level health data (2 API calls via multiCall):
     *  1. DeviceStatusInfo for every device
     *  2. FaultData (GoFault source, last 30 days)
     *
     * @param {Object} api
     * @returns {Promise<{statusInfos: Object[], faultsByDevice: Object}>}
     */
    function fetchFleetHealth(api) {
        var now = new Date();
        var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        return new Promise(function (resolve, reject) {
            api.multiCall([
                ["Get", {
                    typeName: "DeviceStatusInfo",
                    resultsLimit: 50000
                }],
                ["Get", {
                    typeName: "FaultData",
                    search: {
                        fromDate: thirtyDaysAgo.toISOString(),
                        toDate: now.toISOString(),
                        diagnosticSearch: {
                            source: { id: "SourceGeotabGoId" }
                        }
                    },
                    resultsLimit: 100000
                }]
            ], function (results) {
                var statusInfos = results[0];
                var faults = results[1];

                // Index faults by device ID for O(1) lookup
                var faultsByDevice = {};
                faults.forEach(function (f) {
                    var devId = f.device ? f.device.id : null;
                    if (devId) {
                        if (!faultsByDevice[devId]) {
                            faultsByDevice[devId] = [];
                        }
                        faultsByDevice[devId].push(f);
                    }
                });

                resolve({
                    statusInfos: statusInfos,
                    faultsByDevice: faultsByDevice
                });
            }, function (err) {
                reject(err);
            });
        });
    }

    /**
     * Fetch device drill-down data (18 API calls via multiCall):
     *  - 16x StatusData (one per diagnostic KnownId, 30-day range)
     *  - 1x LogRecord (last 500 for GPS staleness)
     *  - 1x FaultData (all faults for device)
     *
     * @param {Object} api
     * @param {string} deviceId
     * @returns {Promise<{statusData: Object, logRecords: Object[], faults: Object[]}>}
     */
    function fetchDeviceDrillDown(api, deviceId) {
        var now = new Date();
        var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        var deviceSearch = { id: deviceId };
        var dateSearch = {
            fromDate: thirtyDaysAgo.toISOString(),
            toDate: now.toISOString()
        };

        var calls = [];

        // 16 StatusData calls — one per diagnostic
        C.ALL_DIAGNOSTIC_IDS.forEach(function (diagId) {
            calls.push(["Get", {
                typeName: "StatusData",
                search: {
                    deviceSearch: deviceSearch,
                    diagnosticSearch: { id: diagId },
                    fromDate: dateSearch.fromDate,
                    toDate: dateSearch.toDate
                },
                resultsLimit: 5000
            }]);
        });

        // LogRecord — last 500
        calls.push(["Get", {
            typeName: "LogRecord",
            search: {
                deviceSearch: deviceSearch,
                fromDate: dateSearch.fromDate,
                toDate: dateSearch.toDate
            },
            resultsLimit: 500
        }]);

        // FaultData — all for this device
        calls.push(["Get", {
            typeName: "FaultData",
            search: {
                deviceSearch: deviceSearch,
                fromDate: dateSearch.fromDate,
                toDate: dateSearch.toDate
            },
            resultsLimit: 5000
        }]);

        return new Promise(function (resolve, reject) {
            api.multiCall(calls, function (results) {
                // Map diagnostic results by KnownId
                var statusData = {};
                C.ALL_DIAGNOSTIC_IDS.forEach(function (diagId, i) {
                    statusData[diagId] = results[i];
                });

                var logRecords = results[16]; // index 16
                var faults = results[17];     // index 17

                resolve({
                    statusData: statusData,
                    logRecords: logRecords,
                    faults: faults
                });
            }, function (err) {
                reject(err);
            });
        });
    }

    return {
        fetchFleetHealth: fetchFleetHealth,
        fetchDeviceDrillDown: fetchDeviceDrillDown
    };
})();
