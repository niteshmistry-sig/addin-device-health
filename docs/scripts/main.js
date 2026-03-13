/**
 * Device Health Diagnostics — MyGeotab Add-In
 * All modules merged into a single factory function.
 */
(function () {
  "use strict";

  if (typeof geotab === "undefined") { window.geotab = { addin: {} }; }
  if (!geotab.addin) { geotab.addin = {}; }

  geotab.addin.deviceHealthDiagnostics = function () {

    // ====================================================================
    //  Constants
    // ====================================================================

    var Diagnostics = {
      VOLTAGE: "DiagnosticGoDeviceVoltageId",
      CRANKING_VOLTAGE: "DiagnosticCrankingVoltageId",
      GPS_NOT_RESPONDING: "DiagnosticGpsNotRespondingId",
      GPS_ANTENNA_UNPLUGGED: "DiagnosticGpsAntennaUnpluggedId",
      GPS_ANTENNA_SHORT: "DiagnosticGpsAntennaShortCircuitId",
      CELLULAR_RSSI: "DiagnosticCellularRssiId",
      INTERMITTENT_CONNECTION: "DiagnosticIntermittentConnectionCommunicationsId",
      HARNESS_STANDARD: "DiagnosticStandardHarnessDetectedId",
      HARNESS_6PIN: "DiagnosticHarnessDetected6PinId",
      HARNESS_9PIN: "DiagnosticHarnessDetected9PinId",
      CAN_INIT_FAIL: "DiagnosticCanBusFailedToInitializeId",
      CAN_SHORT: "DiagnosticCanBusShortId",
      CAN_DISABLED: "DiagnosticCanBusDisabledId",
      UNPLUGGED: "DiagnosticDeviceHasBeenUnpluggedId",
      FLASH_ERROR: "DiagnosticFlashErrorCountId",
      BOOTLOADER_FAIL: "DiagnosticBootloaderUpdateHasFailedId"
    };

    var ALL_DIAGNOSTIC_IDS = [
      Diagnostics.VOLTAGE, Diagnostics.CRANKING_VOLTAGE,
      Diagnostics.GPS_NOT_RESPONDING, Diagnostics.GPS_ANTENNA_UNPLUGGED,
      Diagnostics.GPS_ANTENNA_SHORT, Diagnostics.CELLULAR_RSSI,
      Diagnostics.INTERMITTENT_CONNECTION, Diagnostics.HARNESS_STANDARD,
      Diagnostics.HARNESS_6PIN, Diagnostics.HARNESS_9PIN,
      Diagnostics.CAN_INIT_FAIL, Diagnostics.CAN_SHORT,
      Diagnostics.CAN_DISABLED, Diagnostics.UNPLUGGED,
      Diagnostics.FLASH_ERROR, Diagnostics.BOOTLOADER_FAIL
    ];

    var FaultCategories = {
      128: "hardware", 135: "power", 287: "installation",
      297: "hardware", 450: "hardware", 467: "hardware",
      468: "hardware", 488: "oem", 491: "oem"
    };

    var HARDWARE_FAULT_CODES = [128, 297, 450, 467, 468];
    var OEM_FAULT_CODES = [488, 491];

    var Voltage = { DEAD: 7, LOW: 9, WARNING: 11 };
    var RSSI = { NO_SIGNAL: -113, POOR: -95, FAIR: -85 };
    var OfflineHours = { NORMAL_SLEEP: 24, EXTENDED: 72 };
    var Severity = { CRITICAL: "critical", WARNING: "warning", INFO: "info", HEALTHY: "healthy" };
    var Category = {
      UNPLUGGED: "unplugged", HARDWARE: "hardware", POWER: "power",
      INSTALLATION: "installation", GPS: "gps", CELLULAR: "cellular",
      FIRMWARE: "firmware", OEM: "oem", OFFLINE: "offline", HEALTHY: "healthy"
    };
    var ScoreDeductions = { critical: 40, warning: 20, info: 5 };

    // ====================================================================
    //  Device Cache
    // ====================================================================

    var _devices = {};
    var _groups = {};
    var _cacheLoaded = false;

    function loadCache(api) {
      return new Promise(function (resolve, reject) {
        api.multiCall([
          ["Get", { typeName: "Device", resultsLimit: 50000 }],
          ["Get", { typeName: "Group", resultsLimit: 10000 }]
        ], function (results) {
          _devices = {};
          results[0].forEach(function (d) { _devices[d.id] = d; });
          _groups = {};
          results[1].forEach(function (g) { _groups[g.id] = g; });
          _cacheLoaded = true;
          resolve();
        }, function (err) { reject(err); });
      });
    }

    function getDevice(id) { return _devices[id] || null; }

    function getAllDevices() {
      return Object.keys(_devices).map(function (id) { return _devices[id]; });
    }

    function getGroupName(id) {
      var g = _groups[id];
      return g ? (g.name || id) : id;
    }

    // ====================================================================
    //  Health Service
    // ====================================================================

    function fetchFleetHealth(api) {
      var now = new Date();
      var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      return new Promise(function (resolve, reject) {
        api.multiCall([
          ["Get", { typeName: "DeviceStatusInfo", resultsLimit: 50000 }],
          ["Get", {
            typeName: "FaultData",
            search: {
              fromDate: thirtyDaysAgo.toISOString(),
              toDate: now.toISOString(),
              diagnosticSearch: { source: { id: "SourceGeotabGoId" } }
            },
            resultsLimit: 100000
          }]
        ], function (results) {
          var faultsByDevice = {};
          results[1].forEach(function (f) {
            var devId = f.device ? f.device.id : null;
            if (devId) {
              if (!faultsByDevice[devId]) { faultsByDevice[devId] = []; }
              faultsByDevice[devId].push(f);
            }
          });
          resolve({ statusInfos: results[0], faultsByDevice: faultsByDevice });
        }, function (err) { reject(err); });
      });
    }

    function fetchDeviceDrillDown(api, deviceId) {
      var now = new Date();
      var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      var deviceSearch = { id: deviceId };
      var dateSearch = { fromDate: thirtyDaysAgo.toISOString(), toDate: now.toISOString() };
      var calls = [];

      ALL_DIAGNOSTIC_IDS.forEach(function (diagId) {
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

      calls.push(["Get", {
        typeName: "LogRecord",
        search: { deviceSearch: deviceSearch, fromDate: dateSearch.fromDate, toDate: dateSearch.toDate },
        resultsLimit: 500
      }]);

      calls.push(["Get", {
        typeName: "FaultData",
        search: {
          deviceSearch: deviceSearch,
          fromDate: dateSearch.fromDate,
          toDate: dateSearch.toDate,
          diagnosticSearch: { source: { id: "SourceGeotabGoId" } }
        },
        resultsLimit: 5000
      }]);

      return new Promise(function (resolve, reject) {
        api.multiCall(calls, function (results) {
          var statusData = {};
          ALL_DIAGNOSTIC_IDS.forEach(function (diagId, i) { statusData[diagId] = results[i]; });
          var nDiag = ALL_DIAGNOSTIC_IDS.length;
          resolve({ statusData: statusData, logRecords: results[nDiag], faults: results[nDiag + 1] });
        }, function (err) { reject(err); });
      });
    }

    // ====================================================================
    //  Root Cause Engine
    // ====================================================================

    function hoursAgo(dateStr) {
      if (!dateStr) { return Infinity; }
      return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
    }

    function latestValue(statusRecords) {
      if (!statusRecords || statusRecords.length === 0) { return null; }
      var sorted = statusRecords.slice().sort(function (a, b) {
        return new Date(b.dateTime) - new Date(a.dateTime);
      });
      return sorted[0].data;
    }

    function faultCodesForDevice(faults) {
      var codes = [];
      faults.forEach(function (f) {
        if (f.diagnostic && f.diagnostic.id) {
          var num = parseInt(f.diagnostic.id, 10);
          if (!isNaN(num)) { codes.push(num); }
        }
        if (f.failureMode && f.failureMode.id) {
          var fmId = parseInt(f.failureMode.id, 10);
          if (!isNaN(fmId)) { codes.push(fmId); }
        }
      });
      return codes;
    }

    function computeHealthScore(issues, offlineH, isCommunicating) {
      var score = 100;
      issues.forEach(function (issue) { score -= (ScoreDeductions[issue.severity] || 0); });
      if (!isCommunicating && offlineH > OfflineHours.NORMAL_SLEEP) {
        var extraH = offlineH - OfflineHours.NORMAL_SLEEP;
        score -= Math.min(20, Math.round(extraH / 24) * 5);
      }
      return Math.max(0, Math.min(100, score));
    }

    function classifyDevice(statusInfo, faults, device) {
      var issues = [];
      faults = faults || [];
      var isCommunicating = statusInfo.isDeviceCommunicating;
      var offlineH = hoursAgo(statusInfo.dateTime);

      if (!isCommunicating) {
        if (offlineH > OfflineHours.EXTENDED) {
          issues.push({ category: Category.OFFLINE, severity: Severity.CRITICAL, label: "Offline > 72h" });
        } else if (offlineH > OfflineHours.NORMAL_SLEEP) {
          issues.push({ category: Category.OFFLINE, severity: Severity.WARNING, label: "Offline > 24h" });
        }
      }

      var codes = faultCodesForDevice(faults);
      if (codes.some(function (c) { return HARDWARE_FAULT_CODES.indexOf(c) !== -1; })) {
        issues.push({ category: Category.HARDWARE, severity: Severity.CRITICAL, label: "Hardware Failure" });
      }
      if (codes.indexOf(135) !== -1) {
        issues.push({ category: Category.POWER, severity: Severity.WARNING, label: "Low Battery" });
      }
      if (codes.indexOf(287) !== -1) {
        issues.push({ category: Category.INSTALLATION, severity: Severity.WARNING, label: "Loose Install" });
      }
      if (codes.some(function (c) { return OEM_FAULT_CODES.indexOf(c) !== -1; })) {
        issues.push({ category: Category.OEM, severity: Severity.INFO, label: "OEM Issue" });
      }

      if (device && device.parameterVersion != null && device.parameterVersionOnDevice != null &&
          device.parameterVersion !== device.parameterVersionOnDevice) {
        issues.push({ category: Category.FIRMWARE, severity: Severity.INFO, label: "Firmware Pending" });
      }

      if (statusInfo.latitude === 0 && statusInfo.longitude === 0 && isCommunicating) {
        issues.push({ category: Category.GPS, severity: Severity.WARNING, label: "GPS Issue" });
      }

      var severityOrder = [Severity.CRITICAL, Severity.WARNING, Severity.INFO];
      var primaryIssue = Category.HEALTHY;
      var severity = Severity.HEALTHY;
      for (var s = 0; s < severityOrder.length; s++) {
        for (var i = 0; i < issues.length; i++) {
          if (issues[i].severity === severityOrder[s]) {
            primaryIssue = issues[i].category;
            severity = issues[i].severity;
            s = severityOrder.length;
            break;
          }
        }
      }

      return {
        issues: issues,
        primaryIssue: primaryIssue,
        severity: severity,
        healthScore: computeHealthScore(issues, offlineH, isCommunicating)
      };
    }

    function analyzeDevice(device, statusInfo, drillData) {
      var sd = drillData.statusData;
      var faults = drillData.faults || [];
      var logRecords = drillData.logRecords || [];
      var rootCauses = [];
      var issues = [];
      var rank = 0;
      var isCommunicating = statusInfo ? statusInfo.isDeviceCommunicating : false;
      var offlineH = statusInfo ? hoursAgo(statusInfo.dateTime) : Infinity;

      // 1. Unplugged (95%)
      var unpluggedData = sd[Diagnostics.UNPLUGGED];
      if (unpluggedData && unpluggedData.length > 0) {
        var lastUnplug = latestValue(unpluggedData);
        if (lastUnplug && lastUnplug > 0) {
          rank++;
          rootCauses.push({
            rank: rank, category: Category.UNPLUGGED, confidence: 95,
            severity: Severity.CRITICAL,
            explanation: "The device has reported an unplugged event. The GO device connector may have been removed from the vehicle\u2019s OBD-II port or power source.",
            actions: [
              "Verify the GO device is firmly seated in the OBD-II port.",
              "Check for physical damage to the connector or port.",
              "Inspect the wiring harness if a T-harness is used.",
              "If recently serviced, confirm the device was reconnected."
            ]
          });
          issues.push({ category: Category.UNPLUGGED, severity: Severity.CRITICAL, label: "Unplugged" });
        }
      }

      // 2. Hardware Failure / RMA (90%)
      var hardwareFaults = faults.filter(function (f) {
        var ids = [];
        if (f.failureMode && f.failureMode.id) { ids.push(parseInt(f.failureMode.id, 10)); }
        if (f.diagnostic && f.diagnostic.id) { ids.push(parseInt(f.diagnostic.id, 10)); }
        return ids.some(function (id) { return HARDWARE_FAULT_CODES.indexOf(id) !== -1; });
      });
      var flashErrors = sd[Diagnostics.FLASH_ERROR];
      var hasFlashErrors = flashErrors && flashErrors.length > 0 && latestValue(flashErrors) > 0;

      if (hardwareFaults.length > 0 || hasFlashErrors) {
        rank++;
        var hwExpl = "Hardware-level faults detected.";
        if (hasFlashErrors) { hwExpl += " Flash memory errors indicate possible internal component failure."; }
        if (hardwareFaults.length > 0) { hwExpl += " Fault codes suggest the device may require replacement (RMA)."; }
        rootCauses.push({
          rank: rank, category: Category.HARDWARE, confidence: 90, severity: Severity.CRITICAL,
          explanation: hwExpl,
          actions: [
            "Contact Geotab support to initiate an RMA (Return Merchandise Authorization).",
            "Check for water damage or physical tampering on the device.",
            "Document the fault codes for the support case.",
            "Prepare a replacement device for swap."
          ]
        });
        issues.push({ category: Category.HARDWARE, severity: Severity.CRITICAL, label: "Hardware Failure" });
      }

      // 3. Power / Voltage (75-90%)
      var voltageData = sd[Diagnostics.VOLTAGE];
      var crankingData = sd[Diagnostics.CRANKING_VOLTAGE];
      var hasLowVoltFault = faults.some(function (f) {
        var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
        var dId = f.diagnostic ? parseInt(f.diagnostic.id, 10) : NaN;
        return fmId === 135 || dId === 135;
      });
      var lastVoltage = latestValue(voltageData);
      var lastCranking = latestValue(crankingData);

      if (hasLowVoltFault || (lastVoltage !== null && lastVoltage < Voltage.WARNING)) {
        rank++;
        var voltConf = 75;
        var voltSev = Severity.WARNING;
        var voltExpl = "";

        if (lastVoltage !== null && lastVoltage < Voltage.DEAD) {
          voltConf = 90; voltSev = Severity.CRITICAL;
          voltExpl = "Vehicle battery voltage is critically low (" + lastVoltage.toFixed(1) + "V). The battery may be dead or disconnected.";
        } else if (lastVoltage !== null && lastVoltage < Voltage.LOW) {
          voltConf = 85; voltSev = Severity.CRITICAL;
          voltExpl = "Vehicle battery voltage is very low (" + lastVoltage.toFixed(1) + "V). The battery is likely failing or being drained.";
        } else if (lastVoltage !== null) {
          voltExpl = "Vehicle battery voltage is below normal (" + lastVoltage.toFixed(1) + "V). This may indicate a weak battery or parasitic drain.";
        } else {
          voltExpl = "Low voltage fault code detected, but no recent voltage readings are available.";
        }

        if (lastCranking !== null && lastCranking < Voltage.LOW) {
          voltExpl += " Cranking voltage was also low (" + lastCranking.toFixed(1) + "V), suggesting battery or starter issues.";
        }

        rootCauses.push({
          rank: rank, category: Category.POWER, confidence: voltConf, severity: voltSev,
          explanation: voltExpl,
          actions: [
            "Test the vehicle battery with a multimeter or battery tester.",
            "Check for parasitic drains (aftermarket accessories left on).",
            "Verify the alternator is charging properly.",
            "If the vehicle is stored long-term, consider a battery maintainer."
          ]
        });
        issues.push({ category: Category.POWER, severity: voltSev, label: "Low Battery" });
      }

      // 4. Installation / Harness (75%)
      var canInitFail = sd[Diagnostics.CAN_INIT_FAIL];
      var canShort = sd[Diagnostics.CAN_SHORT];
      var hasInstallFault = faults.some(function (f) {
        var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
        var dId = f.diagnostic ? parseInt(f.diagnostic.id, 10) : NaN;
        return fmId === 287 || dId === 287;
      });
      var hasCanIssue = (canInitFail && canInitFail.length > 0 && latestValue(canInitFail) > 0) ||
                        (canShort && canShort.length > 0 && latestValue(canShort) > 0);

      if (hasInstallFault || hasCanIssue) {
        rank++;
        var instExpl = "Installation issues detected.";
        if (hasInstallFault) { instExpl += " The device reported a bad-install fault, suggesting it is not properly connected to the vehicle."; }
        if (hasCanIssue) { instExpl += " CAN bus communication problems indicate a wiring or connector issue."; }
        rootCauses.push({
          rank: rank, category: Category.INSTALLATION, confidence: 75, severity: Severity.WARNING,
          explanation: instExpl,
          actions: [
            "Re-seat the GO device in the OBD-II port.",
            "Inspect the T-harness connections for corrosion or loose pins.",
            "Verify the correct harness type is used for this vehicle.",
            "Check that CAN bus wiring is not pinched or damaged."
          ]
        });
        issues.push({ category: Category.INSTALLATION, severity: Severity.WARNING, label: "Loose Install" });
      }

      // 5. GPS Issues (60-90%)
      var gpsNotResp = sd[Diagnostics.GPS_NOT_RESPONDING];
      var gpsUnplugged = sd[Diagnostics.GPS_ANTENNA_UNPLUGGED];
      var gpsShort = sd[Diagnostics.GPS_ANTENNA_SHORT];
      var hasGpsAntennaFault = (gpsUnplugged && gpsUnplugged.length > 0 && latestValue(gpsUnplugged) > 0) ||
                               (gpsShort && gpsShort.length > 0 && latestValue(gpsShort) > 0);
      var hasGpsNotResponding = gpsNotResp && gpsNotResp.length > 0 && latestValue(gpsNotResp) > 0;
      var gpsStale = false;
      if (isCommunicating && logRecords.length > 0) {
        var sortedLogs = logRecords.slice().sort(function (a, b) { return new Date(b.dateTime) - new Date(a.dateTime); });
        var logAgeH = (Date.now() - new Date(sortedLogs[0].dateTime).getTime()) / (1000 * 60 * 60);
        if (logAgeH > 4) { gpsStale = true; }
      }

      if (hasGpsAntennaFault || hasGpsNotResponding || gpsStale) {
        rank++;
        var gpsConf = 60;
        var gpsSev = Severity.WARNING;
        var gpsExpl = "";
        if (hasGpsAntennaFault) {
          gpsConf = 90; gpsSev = Severity.CRITICAL;
          gpsExpl = "GPS antenna fault detected (unplugged or short circuit). The device cannot acquire satellite position.";
        } else if (hasGpsNotResponding) {
          gpsConf = 80;
          gpsExpl = "The GPS module is not responding. This may be a hardware issue or severe signal blockage.";
        } else {
          gpsExpl = "The device is communicating but GPS data is stale. The device may be in a location with poor sky visibility (underground parking, dense urban canyon).";
        }
        rootCauses.push({
          rank: rank, category: Category.GPS, confidence: gpsConf, severity: gpsSev,
          explanation: gpsExpl,
          actions: [
            "Verify the GPS antenna connection on the device.",
            "Move the vehicle to an open-sky area and check for GPS lock.",
            "Check if a metallic windshield tint is blocking GPS signals.",
            "If using an external antenna, inspect the cable and mount."
          ]
        });
        issues.push({ category: Category.GPS, severity: gpsSev, label: "GPS Issue" });
      }

      // 6. Cellular / Connectivity (55-85%)
      var rssiData = sd[Diagnostics.CELLULAR_RSSI];
      var intermittent = sd[Diagnostics.INTERMITTENT_CONNECTION];
      var lastRSSI = latestValue(rssiData);
      var hasIntermittent = intermittent && intermittent.length > 0 && latestValue(intermittent) > 0;
      var cellIssue = false;
      var cellConf = 55;
      var cellSev = Severity.INFO;
      var cellExpl = "";

      if (lastRSSI !== null && lastRSSI < RSSI.NO_SIGNAL) {
        cellIssue = true; cellConf = 85; cellSev = Severity.CRITICAL;
        cellExpl = "Cellular signal is at no-signal level (" + lastRSSI + " dBm). The device cannot communicate with the server.";
      } else if (lastRSSI !== null && lastRSSI < RSSI.POOR) {
        cellIssue = true; cellConf = 70; cellSev = Severity.WARNING;
        cellExpl = "Cellular signal is poor (" + lastRSSI + " dBm). Data uploads may be delayed or incomplete.";
      } else if (hasIntermittent) {
        cellIssue = true; cellConf = 65; cellSev = Severity.WARNING;
        cellExpl = "Intermittent connectivity detected. The device is cycling between connected and disconnected states.";
      } else if (!isCommunicating && offlineH > OfflineHours.NORMAL_SLEEP) {
        cellIssue = true; cellConf = 60;
        cellSev = offlineH > OfflineHours.EXTENDED ? Severity.CRITICAL : Severity.WARNING;
        cellExpl = "The device has been offline for " + Math.round(offlineH) + " hours.";
        if (offlineH > OfflineHours.EXTENDED) {
          cellExpl += " Extended offline periods may indicate the vehicle is in a no-coverage area, the device has lost power, or there is a cellular modem issue.";
        }
      }

      if (cellIssue) {
        rank++;
        rootCauses.push({
          rank: rank, category: Category.CELLULAR, confidence: cellConf, severity: cellSev,
          explanation: cellExpl,
          actions: [
            "Check the vehicle\u2019s typical operating area for cellular coverage.",
            "Verify the device\u2019s SIM card is properly seated.",
            "Try a power cycle by disconnecting and reconnecting the device.",
            "If in a known dead zone, wait for the vehicle to move to coverage."
          ]
        });
        issues.push({ category: Category.CELLULAR, severity: cellSev, label: "Connectivity Issue" });
      }

      // 7. Firmware (95%)
      var bootloaderFail = sd[Diagnostics.BOOTLOADER_FAIL];
      var hasBootFail = bootloaderFail && bootloaderFail.length > 0 && latestValue(bootloaderFail) > 0;
      var hasFwMismatch = device && device.parameterVersion != null &&
                          device.parameterVersionOnDevice != null &&
                          device.parameterVersion !== device.parameterVersionOnDevice;

      if (hasBootFail || hasFwMismatch) {
        rank++;
        var fwSev = hasBootFail ? Severity.WARNING : Severity.INFO;
        var fwExpl = "";
        if (hasBootFail) {
          fwExpl = "A bootloader update has failed on this device. The device may not be running the expected firmware version.";
        } else {
          fwExpl = "The device has a pending configuration update (parameter version " +
              device.parameterVersion + " vs on-device " + device.parameterVersionOnDevice +
              "). It will apply on next communication.";
        }
        rootCauses.push({
          rank: rank, category: Category.FIRMWARE, confidence: 95, severity: fwSev,
          explanation: fwExpl,
          actions: [
            "If bootloader failed, contact Geotab support for a manual firmware push.",
            "Ensure the device has stable power and connectivity for firmware updates.",
            "For pending config, the device will auto-update on next check-in.",
            "Avoid making additional config changes until the current update completes."
          ]
        });
        issues.push({ category: Category.FIRMWARE, severity: fwSev, label: hasBootFail ? "Firmware Failure" : "Firmware Pending" });
      }

      // 8. OEM Issues (85%)
      var oemFaults = faults.filter(function (f) {
        var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
        var dId = f.diagnostic ? parseInt(f.diagnostic.id, 10) : NaN;
        return OEM_FAULT_CODES.indexOf(fmId) !== -1 || OEM_FAULT_CODES.indexOf(dId) !== -1;
      });

      if (oemFaults.length > 0) {
        rank++;
        rootCauses.push({
          rank: rank, category: Category.OEM, confidence: 85, severity: Severity.INFO,
          explanation: "OEM-related fault codes (SWC) detected. These typically relate to vehicle-specific steering-wheel-control or aftermarket integration issues.",
          actions: [
            "Check if aftermarket steering wheel controls are installed.",
            "Verify the T-harness is compatible with this vehicle make/model.",
            "Consult the Geotab vehicle compatibility list for known issues.",
            "These faults generally do not affect core tracking functionality."
          ]
        });
        issues.push({ category: Category.OEM, severity: Severity.INFO, label: "OEM Issue" });
      }

      return {
        rootCauses: rootCauses,
        healthScore: computeHealthScore(issues, offlineH, isCommunicating),
        issues: issues
      };
    }

    // ====================================================================
    //  Diagnostic Timeline (canvas charts)
    // ====================================================================

    var CHART_PADDING = { top: 20, right: 20, bottom: 40, left: 50 };
    var CHART_COLORS = {
      line: "#4a90d9", point: "#3a7bc8", grid: "#e0e0e0", text: "#666",
      thresholdCritical: "rgba(198, 40, 40, 0.6)",
      thresholdWarning: "rgba(230, 81, 0, 0.6)",
      thresholdOk: "rgba(46, 125, 50, 0.3)"
    };

    function renderVoltageChart(canvasId, statusRecords) {
      renderTimelineChart(canvasId, statusRecords, [
        { value: Voltage.DEAD, color: CHART_COLORS.thresholdCritical, label: "Dead (7V)" },
        { value: Voltage.LOW, color: CHART_COLORS.thresholdWarning, label: "Low (9V)" },
        { value: Voltage.WARNING, color: CHART_COLORS.thresholdWarning, label: "Warning (11V)" }
      ], "Voltage (V)", 0, 16);
    }

    function renderRSSIChart(canvasId, statusRecords) {
      renderTimelineChart(canvasId, statusRecords, [
        { value: RSSI.POOR, color: CHART_COLORS.thresholdWarning, label: "Poor (-95)" },
        { value: RSSI.FAIR, color: CHART_COLORS.thresholdOk, label: "Fair (-85)" }
      ], "RSSI (dBm)", -120, -50);
    }

    function renderTimelineChart(canvasId, records, thresholds, yLabel, yMin, yMax) {
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

      var P = CHART_PADDING;
      var plotW = w - P.left - P.right;
      var plotH = h - P.top - P.bottom;
      ctx.clearRect(0, 0, w, h);

      if (!records || records.length === 0) {
        ctx.fillStyle = "#999";
        ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No data available", w / 2, h / 2);
        return;
      }

      var sorted = records.slice().sort(function (a, b) { return new Date(a.dateTime) - new Date(b.dateTime); });
      var tMin = new Date(sorted[0].dateTime).getTime();
      var tMax = new Date(sorted[sorted.length - 1].dateTime).getTime();
      if (tMin === tMax) { tMax = tMin + 1; }

      function xScale(t) { return P.left + ((t - tMin) / (tMax - tMin)) * plotW; }
      function yScale(v) { return P.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

      // Grid
      ctx.strokeStyle = CHART_COLORS.grid;
      ctx.lineWidth = 0.5;
      var ySteps = 5;
      var yStep = (yMax - yMin) / ySteps;
      for (var yi = 0; yi <= ySteps; yi++) {
        var yv = yMin + yi * yStep;
        var yy = yScale(yv);
        ctx.beginPath(); ctx.moveTo(P.left, yy); ctx.lineTo(P.left + plotW, yy); ctx.stroke();
        ctx.fillStyle = CHART_COLORS.text;
        ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(yv.toFixed(0), P.left - 6, yy + 3);
      }

      // Threshold lines
      thresholds.forEach(function (t) {
        if (t.value >= yMin && t.value <= yMax) {
          var ty = yScale(t.value);
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.moveTo(P.left, ty); ctx.lineTo(P.left + plotW, ty); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = t.color;
          ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(t.label, P.left + plotW + 2, ty + 3);
        }
      });

      // Data line
      ctx.strokeStyle = CHART_COLORS.line;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      sorted.forEach(function (rec, i) {
        var x = xScale(new Date(rec.dateTime).getTime());
        var y = yScale(rec.data);
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      });
      ctx.stroke();

      // Data points
      if (sorted.length < 100) {
        ctx.fillStyle = CHART_COLORS.point;
        sorted.forEach(function (rec) {
          var x = xScale(new Date(rec.dateTime).getTime());
          var y = yScale(rec.data);
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        });
      }

      // X-axis date labels
      ctx.fillStyle = CHART_COLORS.text;
      ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      var xSteps = Math.min(5, sorted.length);
      for (var xi = 0; xi < xSteps; xi++) {
        var ratio = xi / (xSteps - 1 || 1);
        var tVal = tMin + ratio * (tMax - tMin);
        var dt = new Date(tVal);
        ctx.fillText((dt.getMonth() + 1) + "/" + dt.getDate(), xScale(tVal), h - P.bottom + 16);
      }

      // Y-axis title
      ctx.save();
      ctx.translate(12, P.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = CHART_COLORS.text;
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }

    // ====================================================================
    //  Fleet Dashboard
    // ====================================================================

    var _classifications = [];
    var _searchText = "";
    var _sortCol = "score";
    var _sortAsc = false;
    var _onDeviceClick = null;
    var _eventsBound = false;

    var HEALTH_LEVELS = [
      { key: "healthy",  label: "Healthy",  severity: Severity.HEALTHY,  color: "#4caf50" },
      { key: "info",     label: "Info",     severity: Severity.INFO,     color: "#0288d1" },
      { key: "warning",  label: "Warning",  severity: Severity.WARNING,  color: "#ff9800" },
      { key: "critical", label: "Critical", severity: Severity.CRITICAL, color: "#f44336" }
    ];

    var CATEGORY_COLS = [
      { key: "power",        label: "Power",    categories: [Category.POWER] },
      { key: "gps",          label: "GPS",      categories: [Category.GPS] },
      { key: "cellular",     label: "Cellular", categories: [Category.CELLULAR, Category.OFFLINE] },
      { key: "installation", label: "Install",  categories: [Category.INSTALLATION] },
      { key: "hardware",     label: "Hardware", categories: [Category.HARDWARE, Category.UNPLUGGED] }
    ];

    function getHealthLevel(severity) {
      for (var i = 0; i < HEALTH_LEVELS.length; i++) {
        if (HEALTH_LEVELS[i].severity === severity) { return HEALTH_LEVELS[i]; }
      }
      return HEALTH_LEVELS[0];
    }

    function getScoreColor(score) {
      if (score >= 80) { return "#4caf50"; }
      if (score >= 60) { return "#ff9800"; }
      if (score >= 40) { return "#f57c00"; }
      return "#f44336";
    }

    function renderFleetDashboard(classifications, onDeviceClick) {
      _classifications = classifications;
      _onDeviceClick = onDeviceClick;
      _searchText = "";
      var metrics = computeFleetMetrics();
      renderKPICards(metrics);
      renderHealthDistribution(metrics);
      renderTopIssues();
      renderNeedAttention();
      renderTableHeader();
      renderFleetTable();
      bindFleetEvents();
    }

    function computeFleetMetrics() {
      var total = _classifications.length;
      var totalScore = 0;
      var healthyCount = 0;
      var issueCount = 0;
      var statusCounts = { healthy: 0, info: 0, warning: 0, critical: 0 };

      _classifications.forEach(function (item) {
        var cls = item.classification;
        totalScore += cls.healthScore;
        var level = getHealthLevel(cls.severity);
        statusCounts[level.key]++;
        if (cls.severity === Severity.HEALTHY) { healthyCount++; } else { issueCount++; }
      });

      return {
        fleetScore: total > 0 ? (totalScore / total) : 0,
        totalDevices: total,
        healthyCount: healthyCount,
        issueCount: issueCount,
        statusCounts: statusCounts
      };
    }

    function renderKPICards(metrics) {
      var container = document.getElementById("dhdKpiRow");
      if (!container) { return; }

      var cards = [
        { value: metrics.fleetScore.toFixed(1), label: "Fleet Health",    accent: "success" },
        { value: formatNum(metrics.totalDevices), label: "Total Devices", accent: "" },
        { value: formatNum(metrics.healthyCount), label: "Healthy",       accent: "success" },
        { value: formatNum(metrics.issueCount),   label: "Issues Detected", accent: metrics.issueCount > 0 ? "error" : "" }
      ];

      var html = "";
      cards.forEach(function (c) {
        var accentClass = c.accent ? " dhd-kpi-card--" + c.accent : "";
        html += '<div class="dhd-kpi-card' + accentClass + '">' +
            '<div class="dhd-kpi-value">' + c.value + '</div>' +
            '<div class="dhd-kpi-label">' + c.label + '</div>' +
            '</div>';
      });
      container.innerHTML = html;
    }

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

      var cx = size / 2, cy = size / 2, outerR = 80, innerR = 55;
      var total = metrics.totalDevices || 1;
      var segments = [];
      HEALTH_LEVELS.forEach(function (level) {
        var count = metrics.statusCounts[level.key] || 0;
        if (count > 0) { segments.push({ label: level.label, count: count, color: level.color }); }
      });
      if (segments.length === 0) { segments.push({ label: "No Data", count: 1, color: "#e0e0e0" }); }

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

      if (centerEl) {
        centerEl.innerHTML = '<span style="font-size:28px;font-weight:700;line-height:1.1;display:block;">' + formatNum(metrics.totalDevices) + '</span>' +
            '<span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Devices</span>';
      }

      if (legendEl) {
        var lhtml = "";
        HEALTH_LEVELS.forEach(function (level) {
          var count = metrics.statusCounts[level.key] || 0;
          lhtml += '<span style="display:inline-block;margin:0 8px 4px 0;font-size:11px;color:#666;white-space:nowrap;">' +
              '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + level.color + ';vertical-align:middle;margin-right:4px;"></span>' +
              level.label + ' (' + count + ')' + '</span>';
        });
        legendEl.innerHTML = lhtml;
      }
    }

    function renderTopIssues() {
      var container = document.getElementById("dhdTopIssues");
      if (!container) { return; }
      var issueCounts = {};
      var issueSeverity = {};
      _classifications.forEach(function (item) {
        item.classification.issues.forEach(function (issue) {
          var lbl = issue.label || "Unknown";
          issueCounts[lbl] = (issueCounts[lbl] || 0) + 1;
          if (!issueSeverity[lbl] || severityRank(issue.severity) < severityRank(issueSeverity[lbl])) {
            issueSeverity[lbl] = issue.severity;
          }
        });
      });

      var sorted = Object.keys(issueCounts).map(function (lbl) {
        return { label: lbl, count: issueCounts[lbl], severity: issueSeverity[lbl] };
      }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

      if (sorted.length === 0) {
        container.innerHTML = '<div class="dhd-empty-state">No issues detected</div>';
        return;
      }

      var maxCount = sorted[0].count;
      var sevColors = {};
      sevColors[Severity.CRITICAL] = "#f44336";
      sevColors[Severity.WARNING] = "#ff9800";
      sevColors[Severity.INFO] = "#0288d1";
      sevColors[Severity.HEALTHY] = "#4caf50";

      var html = '<table style="width:100%;border-collapse:collapse;">';
      sorted.forEach(function (item) {
        var color = sevColors[item.severity] || "#9e9e9e";
        var barPct = Math.round((item.count / maxCount) * 100);
        html += '<tr style="border-bottom:1px solid #eee;">' +
            '<td style="width:12px;padding:8px 4px 8px 0;vertical-align:middle;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span></td>' +
            '<td style="padding:8px 4px;font-size:13px;font-weight:500;">' + escHtml(item.label) + '</td>' +
            '<td style="width:30px;padding:8px 4px;font-size:13px;font-weight:700;text-align:right;">' + item.count + '</td>' +
            '<td style="width:50px;padding:8px 4px;font-size:11px;color:#999;">devices</td>' +
            '<td style="width:60px;padding:8px 0;"><div style="width:100%;height:6px;background:#f5f5f5;border-radius:3px;overflow:hidden;"><div style="width:' + barPct + '%;height:100%;background:' + color + ';border-radius:3px;"></div></div></td>' +
            '</tr>';
      });
      html += '</table>';
      container.innerHTML = html;
    }

    function renderNeedAttention() {
      var container = document.getElementById("dhdNeedAttention");
      if (!container) { return; }
      var withIssues = _classifications.filter(function (item) {
        return item.classification.severity !== Severity.HEALTHY;
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
        html += '<tr data-device-id="' + item.device.id + '" style="cursor:pointer;border-bottom:1px solid #eee;">' +
            '<td style="width:24px;padding:8px 4px 8px 0;font-size:13px;font-weight:700;color:#999;">' + (i + 1) + '.</td>' +
            '<td style="padding:8px 4px;font-size:13px;color:#4a90d9;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(item.device.name) + '</td>' +
            '<td style="width:40px;padding:8px 0 8px 4px;font-size:14px;font-weight:700;text-align:right;color:' + color + ';">' + score + '</td>' +
            '</tr>';
      });
      html += '</table>';
      container.innerHTML = html;
    }

    function renderTableHeader() {
      var countEl = document.getElementById("dhdTableCount");
      if (countEl) {
        countEl.textContent = "All Devices (" + getFilteredData().length + ")";
      }
    }

    function renderFleetTable() {
      var tbody = document.getElementById("dhdTableBody");
      if (!tbody) { return; }
      var filtered = sortData(getFilteredData());
      var countEl = document.getElementById("dhdTableCount");
      if (countEl) { countEl.textContent = "All Devices (" + filtered.length + ")"; }

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
        var catScores = computeCategoryScores(cls);

        html += '<tr data-device-id="' + device.id + '">';
        html += '<td>' + escHtml(device.name) + '</td>';
        html += '<td>' + renderScoreBar(score) + '</td>';
        html += '<td><span class="dhd-badge dhd-badge-' + level.key + '">' + level.label + '</span></td>';
        CATEGORY_COLS.forEach(function (col) {
          var cs = catScores[col.key];
          html += '<td>' + renderScoreBar(cs.score, cs.count) + '</td>';
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
            deduction += (ScoreDeductions[issue.severity] || 0);
          }
        });
        scores[col.key] = { score: Math.max(0, 100 - deduction), count: count };
      });
      return scores;
    }

    function renderScoreBar(score, eventCount) {
      var color = getScoreColor(score);
      var countStr = typeof eventCount === "number" ? ' <span style="color:#999;">(' + eventCount + ')</span>' : '';
      return '<div class="dhd-score-bar">' +
          '<div class="dhd-score-track"><div class="dhd-score-fill" style="width:' + score + '%;background:' + color + ';"></div></div>' +
          '<span class="dhd-score-text" style="color:' + color + ';">' + score + countStr + '</span>' +
          '</div>';
    }

    function getFilteredData() {
      var data = _classifications;
      if (_searchText) {
        var terms = _searchText.toLowerCase().trim().split(/\s+/).filter(function (t) { return t.length > 0; });
        if (terms.length > 0) {
          data = data.filter(function (item) {
            var searchable = buildSearchString(item);
            return terms.every(function (term) { return searchable.indexOf(term) !== -1; });
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
        device.name || "", device.serialNumber || "",
        device.vehicleIdentificationNumber || "", device.comment || "",
        device.licensePlate || "",
        device.productId ? "GO" + device.productId : "",
        device.deviceType || "", level.label || "",
        cls.severity || "", cls.primaryIssue || ""
      ];
      if (device.groups && device.groups.length > 0) {
        device.groups.forEach(function (g) { parts.push(getGroupName(g.id)); });
      }
      if (cls.issues) {
        cls.issues.forEach(function (issue) {
          parts.push(issue.label || "");
          parts.push(issue.category || "");
        });
      }
      return parts.join(" ").toLowerCase();
    }

    function severityRank(s) {
      switch (s) {
        case Severity.CRITICAL: return 0;
        case Severity.WARNING: return 1;
        case Severity.INFO: return 2;
        case Severity.HEALTHY: return 3;
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
          case "power": case "gps": case "cellular": case "installation": case "hardware":
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

    function bindFleetEvents() {
      if (_eventsBound) { return; }
      _eventsBound = true;

      var tbody = document.getElementById("dhdTableBody");
      if (tbody) {
        tbody.addEventListener("click", function (e) {
          var row = e.target.closest("[data-device-id]");
          if (row && _onDeviceClick) { _onDeviceClick(row.getAttribute("data-device-id")); }
        });
      }

      var attentionEl = document.getElementById("dhdNeedAttention");
      if (attentionEl) {
        attentionEl.addEventListener("click", function (e) {
          var item = e.target.closest("[data-device-id]");
          if (item && _onDeviceClick) { _onDeviceClick(item.getAttribute("data-device-id")); }
        });
      }

      var searchInput = document.getElementById("dhdSearch");
      if (searchInput) {
        searchInput.addEventListener("input", function () {
          _searchText = searchInput.value;
          renderFleetTable();
        });
      }

      var headers = document.querySelectorAll("#dhdFleetView [data-sort]");
      headers.forEach(function (header) {
        header.addEventListener("click", function () {
          var col = header.getAttribute("data-sort");
          if (_sortCol === col) { _sortAsc = !_sortAsc; }
          else { _sortCol = col; _sortAsc = true; }
          updateSortIndicators();
          renderFleetTable();
        });
      });

      var csvBtn = document.getElementById("dhdCsvBtn");
      if (csvBtn) { csvBtn.addEventListener("click", exportCSV); }
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

    function exportCSV() {
      var filtered = sortData(getFilteredData());
      var hdrs = ["Device Name", "Health Score", "Status", "Power", "GPS", "Cellular", "Installation", "Hardware"];
      var rows = [hdrs.join(",")];
      filtered.forEach(function (item) {
        var cls = item.classification;
        var catScores = computeCategoryScores(cls);
        var level = getHealthLevel(cls.severity);
        rows.push([
          '"' + (item.device.name || "").replace(/"/g, '""') + '"',
          cls.healthScore,
          '"' + level.label + '"',
          catScores.power.score + " (" + catScores.power.count + ")",
          catScores.gps.score + " (" + catScores.gps.count + ")",
          catScores.cellular.score + " (" + catScores.cellular.count + ")",
          catScores.installation.score + " (" + catScores.installation.count + ")",
          catScores.hardware.score + " (" + catScores.hardware.count + ")"
        ].join(","));
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

    // ====================================================================
    //  Device Diagnostics (Drill-Down)
    // ====================================================================

    function renderDrillDown(device, statusInfo, analysis, drillData, onBack) {
      renderDrillHeader(device, onBack);
      renderDrillHealthScore(analysis.healthScore);
      renderActiveIssues(analysis.issues);
      renderRootCauses(analysis.rootCauses);
      renderDrillCharts(drillData.statusData);
      renderFaultHistory(drillData.faults);
      renderDeviceInfo(device, statusInfo);
    }

    function renderDrillHeader(device, onBack) {
      var el = document.getElementById("dhdDrillHeader");
      if (!el) { return; }
      el.innerHTML =
          '<button class="dhd-btn dhd-btn-back" id="dhdBackBtn">&larr; Back to Fleet</button>' +
          '<div class="dhd-drill-title">' +
              '<h2>' + escHtml(device.name) + '</h2>' +
              '<span class="dhd-drill-serial">S/N: ' + escHtml(device.serialNumber || "N/A") +
              ' &middot; Firmware: ' + escHtml(formatFirmware(device)) + '</span>' +
          '</div>';
      document.getElementById("dhdBackBtn").addEventListener("click", function () {
        if (onBack) { onBack(); }
      });
    }

    function renderDrillHealthScore(score) {
      var el = document.getElementById("dhdHealthScore");
      if (!el) { return; }
      var colorClass = "dhd-score-healthy";
      if (score < 40) { colorClass = "dhd-score-critical"; }
      else if (score < 70) { colorClass = "dhd-score-warning"; }
      el.innerHTML =
          '<div class="dhd-score-display ' + colorClass + '">' +
              '<div class="dhd-score-value">' + score + '</div>' +
              '<div class="dhd-score-label">Health Score</div>' +
          '</div>';
    }

    function renderActiveIssues(issues) {
      var el = document.getElementById("dhdActiveIssues");
      if (!el) { return; }
      if (issues.length === 0) {
        el.innerHTML = '<span class="dhd-badge dhd-badge-healthy">No Active Issues</span>';
        return;
      }
      var html = "";
      issues.forEach(function (issue) {
        html += '<span class="dhd-badge dhd-badge-' + issue.severity + '">' + escHtml(issue.label) + '</span> ';
      });
      el.innerHTML = html;
    }

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
            '<div class="dhd-root-cause-header">' +
                '<span class="dhd-root-cause-rank">#' + rc.rank + '</span>' +
                '<span class="dhd-root-cause-category">' + capitalize(rc.category) + '</span>' +
                '<span class="dhd-root-cause-confidence">' + rc.confidence + '% confidence</span>' +
                '<span class="dhd-badge dhd-badge-' + rc.severity + '">' + capitalize(rc.severity) + '</span>' +
            '</div>' +
            '<div class="dhd-root-cause-explanation">' + escHtml(rc.explanation) + '</div>' +
            '<div class="dhd-root-cause-actions"><strong>Recommended Actions:</strong><ul>';
        rc.actions.forEach(function (action) { html += '<li>' + escHtml(action) + '</li>'; });
        html += '</ul></div></div>';
      });
      el.innerHTML = html;
    }

    function renderDrillCharts(statusData) {
      setTimeout(function () {
        renderVoltageChart("dhdVoltageChart", statusData[Diagnostics.VOLTAGE]);
        renderRSSIChart("dhdRSSIChart", statusData[Diagnostics.CELLULAR_RSSI]);
      }, 50);
    }

    function renderFaultHistory(faults) {
      var el = document.getElementById("dhdFaultHistory");
      if (!el) { return; }
      if (!faults || faults.length === 0) {
        el.innerHTML = '<div class="dhd-empty-state">No faults recorded in the last 30 days.</div>';
        return;
      }
      var sorted = faults.slice().sort(function (a, b) {
        return new Date(b.dateTime) - new Date(a.dateTime);
      }).slice(0, 50);

      var html = '<table class="dhd-table dhd-table--faults"><thead><tr>' +
          '<th>Date</th><th>Code</th><th>Description</th><th>Severity</th><th>State</th>' +
          '</tr></thead><tbody>';
      sorted.forEach(function (f) {
        var dt = f.dateTime ? formatDate(f.dateTime) : "N/A";
        var code = f.diagnostic ? (f.diagnostic.id || "\u2014") : "\u2014";
        var desc = f.diagnostic ? (f.diagnostic.name || code) : "\u2014";
        var sev = classifyFaultSeverity(f);
        var state = f.failureModeState === 1 ? "Active" : "Inactive";
        html += '<tr>' +
            '<td>' + dt + '</td>' +
            '<td>' + escHtml(String(code)) + '</td>' +
            '<td>' + escHtml(desc) + '</td>' +
            '<td><span class="dhd-badge dhd-badge-' + sev + '">' + capitalize(sev) + '</span></td>' +
            '<td>' + state + '</td></tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    }

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
              (fwPending ? ' <span class="dhd-badge dhd-badge-info">Update Pending</span>' : "")) +
          infoItem("On-Device Config", device.parameterVersionOnDevice || "N/A") +
          infoItem("Communicating", statusInfo.isDeviceCommunicating ? "Yes" : "No") +
          infoItem("Last Communication", statusInfo.dateTime ? formatDate(statusInfo.dateTime) : "N/A") +
          infoItem("Position", statusInfo.latitude != null ?
              statusInfo.latitude.toFixed(4) + ", " + statusInfo.longitude.toFixed(4) : "N/A") +
          '</div>';
      el.innerHTML = html;
    }

    // ====================================================================
    //  Utilities
    // ====================================================================

    function infoItem(label, value) {
      return '<div class="dhd-info-item"><span class="dhd-info-label">' +
          escHtml(label) + '</span><span class="dhd-info-value">' + value + '</span></div>';
    }

    function classifyFaultSeverity(fault) {
      if (!fault.diagnostic) { return Severity.INFO; }
      var id = parseInt(fault.diagnostic.id, 10);
      if (HARDWARE_FAULT_CODES.indexOf(id) !== -1) { return Severity.CRITICAL; }
      if (id === 135 || id === 287) { return Severity.WARNING; }
      return Severity.INFO;
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

    function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

    function formatNum(n) {
      if (n == null) { return "0"; }
      return n.toLocaleString ? n.toLocaleString() : String(n);
    }

    // ====================================================================
    //  Main App State & Lifecycle
    // ====================================================================

    var _api, _page;
    var _fleetData = null;
    var _classifiedFleet = [];
    var _statusInfoMap = {};

    function showFleetView() {
      var fleet = document.getElementById("dhdFleetView");
      var drill = document.getElementById("dhdDrillView");
      if (fleet) { fleet.style.display = "block"; fleet.classList.add("dhd-view--active"); }
      if (drill) { drill.style.display = "none"; drill.classList.remove("dhd-view--active"); }
    }

    function showDrillView() {
      var fleet = document.getElementById("dhdFleetView");
      var drill = document.getElementById("dhdDrillView");
      if (fleet) { fleet.style.display = "none"; fleet.classList.remove("dhd-view--active"); }
      if (drill) { drill.style.display = "block"; drill.classList.add("dhd-view--active"); }
    }

    function showLoading(message) {
      var el = document.getElementById("dhdLoading");
      if (el) {
        el.querySelector("span").textContent = message || "Loading\u2026";
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
      if (el) { el.textContent = message; el.style.display = "block"; }
    }

    function loadFleetData() {
      showLoading("Loading fleet health data\u2026");
      loadCache(_api)
        .then(function () { return fetchFleetHealth(_api); })
        .then(function (data) {
          _fleetData = data;
          classifyFleet();
          hideLoading();
          renderFleetDashboard(_classifiedFleet, onDeviceClickHandler);
        })
        .catch(function (err) {
          showError("Failed to load fleet data: " + (err.message || err));
          console.error("DHD fleet load error:", err);
        });
    }

    function classifyFleet() {
      _classifiedFleet = [];
      _statusInfoMap = {};
      var devices = getAllDevices();
      var siMap = {};
      _fleetData.statusInfos.forEach(function (si) {
        if (si.device && si.device.id) { siMap[si.device.id] = si; }
      });
      devices.forEach(function (device) {
        var si = siMap[device.id];
        if (!si) { return; }
        _statusInfoMap[device.id] = si;
        var faults = _fleetData.faultsByDevice[device.id] || [];
        var classification = classifyDevice(si, faults, device);
        _classifiedFleet.push({ device: device, statusInfo: si, classification: classification });
      });
    }

    function onDeviceClickHandler(deviceId) {
      var device = getDevice(deviceId);
      var statusInfo = _statusInfoMap[deviceId];
      if (!device || !statusInfo) { return; }
      showDrillView();
      showLoading("Loading device diagnostics\u2026");
      fetchDeviceDrillDown(_api, deviceId)
        .then(function (drillData) {
          var analysis = analyzeDevice(device, statusInfo, drillData);
          hideLoading();
          renderDrillDown(device, statusInfo, analysis, drillData, function () { showFleetView(); });
        })
        .catch(function (err) {
          showError("Failed to load device diagnostics: " + (err.message || err));
          console.error("DHD drill-down error:", err);
        });
    }

    function bindRefresh() {
      var btn = document.getElementById("dhdRefreshBtn");
      if (btn) {
        btn.addEventListener("click", function () {
          showFleetView();
          loadFleetData();
        });
      }
    }

    // ====================================================================
    //  Mock API for Standalone Preview
    // ====================================================================

    function buildMockApi() {
      var now = new Date();
      var hrs = function (h) { return new Date(now.getTime() - h * 3600000).toISOString(); };

      var mockDevices = [
        { id: "d1",  name: "Truck 101 - Toronto",      serialNumber: "G9AA11000001", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d2",  name: "Truck 102 - Oakville",     serialNumber: "G9AA11000002", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d3",  name: "Van 201 - Mississauga",    serialNumber: "G9AA11000003", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
        { id: "d4",  name: "Van 202 - Brampton",       serialNumber: "G9AA11000004", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
        { id: "d5",  name: "Sedan 301 - Hamilton",     serialNumber: "G9AA11000005", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d6",  name: "Sedan 302 - Burlington",   serialNumber: "G9AA11000006", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d7",  name: "SUV 401 - Markham",        serialNumber: "G9AA11000007", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
        { id: "d8",  name: "SUV 402 - Richmond Hill",  serialNumber: "G9AA11000008", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
        { id: "d9",  name: "Truck 103 - Vaughan",      serialNumber: "G9AA11000009", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d10", name: "Van 203 - Kitchener",      serialNumber: "G9AA11000010", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
        { id: "d11", name: "Truck 104 - London",       serialNumber: "G9AA11000011", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d12", name: "Van 204 - Waterloo",       serialNumber: "G9AA11000012", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
        { id: "d13", name: "Sedan 303 - Guelph",       serialNumber: "G9AA11000013", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d14", name: "SUV 403 - Oshawa",         serialNumber: "G9AA11000014", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
        { id: "d15", name: "Truck 105 - Barrie",       serialNumber: "G9AA11000015", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d16", name: "Van 205 - St. Catharines", serialNumber: "G9AA11000016", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
        { id: "d17", name: "Sedan 304 - Niagara",      serialNumber: "G9AA11000017", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d18", name: "SUV 404 - Peterborough",   serialNumber: "G9AA11000018", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
        { id: "d19", name: "Truck 106 - Sudbury",      serialNumber: "G9AA11000019", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d20", name: "Van 206 - Thunder Bay",    serialNumber: "G9AA11000020", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] },
        { id: "d21", name: "Sedan 305 - Windsor",      serialNumber: "G9AA11000021", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d22", name: "SUV 405 - Kingston",       serialNumber: "G9AA11000022", deviceType: "GO9", productId: 9, groups: [{id:"g3"}] },
        { id: "d23", name: "Truck 107 - Ottawa",       serialNumber: "G9AA11000023", deviceType: "GO9", productId: 9, groups: [{id:"g1"}] },
        { id: "d24", name: "Van 207 - Whitby",         serialNumber: "G9AA11000024", deviceType: "GO9", productId: 9, groups: [{id:"g2"}] }
      ];

      var mockGroups = [
        { id: "g1", name: "Trucks & Sedans" },
        { id: "g2", name: "Vans" },
        { id: "g3", name: "SUVs" }
      ];

      var mockStatusInfos = [
        { device: {id:"d1"},  isDeviceCommunicating: true,  dateTime: hrs(0.5), latitude: 43.65, longitude: -79.38 },
        { device: {id:"d2"},  isDeviceCommunicating: true,  dateTime: hrs(1),   latitude: 43.45, longitude: -79.68 },
        { device: {id:"d5"},  isDeviceCommunicating: true,  dateTime: hrs(0.2), latitude: 43.25, longitude: -79.87 },
        { device: {id:"d6"},  isDeviceCommunicating: true,  dateTime: hrs(2),   latitude: 43.32, longitude: -79.80 },
        { device: {id:"d9"},  isDeviceCommunicating: true,  dateTime: hrs(0.1), latitude: 43.80, longitude: -79.53 },
        { device: {id:"d11"}, isDeviceCommunicating: true,  dateTime: hrs(3),   latitude: 42.98, longitude: -81.24 },
        { device: {id:"d13"}, isDeviceCommunicating: true,  dateTime: hrs(1.5), latitude: 43.55, longitude: -80.25 },
        { device: {id:"d15"}, isDeviceCommunicating: true,  dateTime: hrs(0.8), latitude: 44.38, longitude: -79.69 },
        { device: {id:"d17"}, isDeviceCommunicating: true,  dateTime: hrs(4),   latitude: 43.06, longitude: -79.07 },
        { device: {id:"d22"}, isDeviceCommunicating: true,  dateTime: hrs(0.3), latitude: 44.23, longitude: -76.49 },
        { device: {id:"d23"}, isDeviceCommunicating: true,  dateTime: hrs(1.2), latitude: 45.42, longitude: -75.69 },
        { device: {id:"d24"}, isDeviceCommunicating: true,  dateTime: hrs(0.7), latitude: 43.87, longitude: -78.94 },
        { device: {id:"d3"},  isDeviceCommunicating: true,  dateTime: hrs(1),   latitude: 0,     longitude: 0 },
        { device: {id:"d14"}, isDeviceCommunicating: true,  dateTime: hrs(2),   latitude: 0,     longitude: 0 },
        { device: {id:"d4"},  isDeviceCommunicating: true,  dateTime: hrs(3),   latitude: 43.73, longitude: -79.76 },
        { device: {id:"d7"},  isDeviceCommunicating: true,  dateTime: hrs(5),   latitude: 43.85, longitude: -79.33 },
        { device: {id:"d10"}, isDeviceCommunicating: true,  dateTime: hrs(2),   latitude: 43.45, longitude: -80.49 },
        { device: {id:"d12"}, isDeviceCommunicating: true,  dateTime: hrs(6),   latitude: 43.46, longitude: -80.52 },
        { device: {id:"d16"}, isDeviceCommunicating: true,  dateTime: hrs(4),   latitude: 43.16, longitude: -79.24 },
        { device: {id:"d21"}, isDeviceCommunicating: true,  dateTime: hrs(8),   latitude: 42.32, longitude: -83.04 },
        { device: {id:"d8"},  isDeviceCommunicating: false, dateTime: hrs(48),  latitude: 43.88, longitude: -79.43 },
        { device: {id:"d18"}, isDeviceCommunicating: false, dateTime: hrs(36),  latitude: 44.30, longitude: -78.32 },
        { device: {id:"d19"}, isDeviceCommunicating: false, dateTime: hrs(120), latitude: 46.49, longitude: -81.00 },
        { device: {id:"d20"}, isDeviceCommunicating: false, dateTime: hrs(200), latitude: 48.38, longitude: -89.25 }
      ];

      var mockFaults = [
        { device: {id:"d4"},  diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hrs(12) },
        { device: {id:"d7"},  diagnostic: {id:"287"}, failureMode: {id:"287"}, dateTime: hrs(24) },
        { device: {id:"d10"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hrs(6) },
        { device: {id:"d12"}, diagnostic: {id:"287"}, failureMode: {id:"287"}, dateTime: hrs(18) },
        { device: {id:"d16"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hrs(10) },
        { device: {id:"d16"}, diagnostic: {id:"287"}, failureMode: {id:"287"}, dateTime: hrs(10) },
        { device: {id:"d19"}, diagnostic: {id:"128"}, failureMode: {id:"128"}, dateTime: hrs(96) },
        { device: {id:"d20"}, diagnostic: {id:"450"}, failureMode: {id:"450"}, dateTime: hrs(150) },
        { device: {id:"d20"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hrs(150) },
        { device: {id:"d8"},  diagnostic: {id:"488"}, failureMode: {id:"488"}, dateTime: hrs(30) },
        { device: {id:"d21"}, diagnostic: {id:"135"}, failureMode: {id:"135"}, dateTime: hrs(5) }
      ];

      // Firmware mismatch
      mockDevices[10].parameterVersion = 42;
      mockDevices[10].parameterVersionOnDevice = 40;
      mockDevices[17].parameterVersion = 38;
      mockDevices[17].parameterVersionOnDevice = 36;

      return {
        multiCall: function (calls, success) {
          var results = calls.map(function (call) {
            var typeName = call[1].typeName;
            switch (typeName) {
              case "Device":           return mockDevices;
              case "Group":            return mockGroups;
              case "DeviceStatusInfo": return mockStatusInfos;
              case "FaultData":        return mockFaults;
              case "StatusData":       return [];
              case "LogRecord":        return [];
              default:                 return [];
            }
          });
          setTimeout(function () { success(results); }, 50);
        }
      };
    }

    // ====================================================================
    //  Add-In Lifecycle
    // ====================================================================

    return {
      initialize: function (api, page, callback) {
        _api = api;
        _page = page;
        bindRefresh();
        loadFleetData();
        if (callback) { callback(); }
      },

      focus: function (api, page) {
        _api = api;
        _page = page;
        var root = document.getElementById("dhd-root");
        if (root) { root.style.display = "flex"; }
        showFleetView();
      },

      blur: function () {
        var root = document.getElementById("dhd-root");
        if (root) { root.style.display = "none"; }
      },

      _initStandalone: function () {
        _api = buildMockApi();
        _page = {};
        bindRefresh();
        loadFleetData();
      }
    };
  };

  // Standalone auto-init
  function tryStandaloneInit() {
    if (typeof geotab.addin.deviceHealthDiagnostics === "function") {
      var addin = geotab.addin.deviceHealthDiagnostics();
      addin._initStandalone();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(tryStandaloneInit, 2000); });
  } else {
    setTimeout(tryStandaloneInit, 2000);
  }

})();
