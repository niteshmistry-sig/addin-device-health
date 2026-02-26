/**
 * rootCauseEngine.js — Decision tree and health scoring engine.
 *
 * Two entry points:
 *  - classifyDevice()  : lightweight fleet-level classification
 *  - analyzeDevice()   : full drill-down root cause analysis
 */
var DHD = DHD || {};

DHD.RootCauseEngine = (function () {
    "use strict";

    var C = DHD.Constants;

    // ── Helpers ────────────────────────────────────────────────────────

    function hoursAgo(dateStr) {
        if (!dateStr) { return Infinity; }
        var dt = new Date(dateStr);
        return (Date.now() - dt.getTime()) / (1000 * 60 * 60);
    }

    function hasFaultCode(faults, code) {
        return faults.some(function (f) {
            return f.diagnostic && String(f.diagnostic.id) === String(code);
        });
    }

    function hasFaultCodes(faults, codes) {
        return codes.some(function (code) {
            return hasFaultCode(faults, code);
        });
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
                if (!isNaN(num)) {
                    codes.push(num);
                }
            }
            if (f.failureMode && f.failureMode.id) {
                var fmId = parseInt(f.failureMode.id, 10);
                if (!isNaN(fmId)) {
                    codes.push(fmId);
                }
            }
        });
        return codes;
    }

    // ── Fleet-level classification ─────────────────────────────────────

    /**
     * Lightweight classification using DeviceStatusInfo + FaultData.
     * @param {Object} statusInfo - DeviceStatusInfo record
     * @param {Object[]} faults - FaultData for this device
     * @param {Object} device - Device from cache
     * @returns {{ issues: Object[], primaryIssue: string, severity: string, healthScore: number }}
     */
    function classifyDevice(statusInfo, faults, device) {
        var issues = [];
        faults = faults || [];

        var isCommunicating = statusInfo.isDeviceCommunicating;
        var offlineH = hoursAgo(statusInfo.dateTime);

        // Offline
        if (!isCommunicating) {
            if (offlineH > C.OfflineHours.EXTENDED) {
                issues.push({ category: C.Category.OFFLINE, severity: C.Severity.CRITICAL,
                    label: "Offline > 72h" });
            } else if (offlineH > C.OfflineHours.NORMAL_SLEEP) {
                issues.push({ category: C.Category.OFFLINE, severity: C.Severity.WARNING,
                    label: "Offline > 24h" });
            }
        }

        // Check fault codes
        var codes = faultCodesForDevice(faults);
        if (codes.some(function (c) { return C.HARDWARE_FAULT_CODES.indexOf(c) !== -1; })) {
            issues.push({ category: C.Category.HARDWARE, severity: C.Severity.CRITICAL,
                label: "Hardware Failure" });
        }
        if (codes.indexOf(135) !== -1) {
            issues.push({ category: C.Category.POWER, severity: C.Severity.WARNING,
                label: "Low Battery" });
        }
        if (codes.indexOf(287) !== -1) {
            issues.push({ category: C.Category.INSTALLATION, severity: C.Severity.WARNING,
                label: "Loose Install" });
        }
        if (codes.some(function (c) { return C.OEM_FAULT_CODES.indexOf(c) !== -1; })) {
            issues.push({ category: C.Category.OEM, severity: C.Severity.INFO,
                label: "OEM Issue" });
        }

        // Firmware mismatch
        if (device && device.parameterVersion != null && device.parameterVersionOnDevice != null &&
            device.parameterVersion !== device.parameterVersionOnDevice) {
            issues.push({ category: C.Category.FIRMWARE, severity: C.Severity.INFO,
                label: "Firmware Pending" });
        }

        // GPS — position stuck at 0,0 or very old
        if (statusInfo.latitude === 0 && statusInfo.longitude === 0 && isCommunicating) {
            issues.push({ category: C.Category.GPS, severity: C.Severity.WARNING,
                label: "GPS Issue" });
        }

        // Determine primary issue and overall severity
        var severityOrder = [C.Severity.CRITICAL, C.Severity.WARNING, C.Severity.INFO];
        var primaryIssue = C.Category.HEALTHY;
        var severity = C.Severity.HEALTHY;

        for (var s = 0; s < severityOrder.length; s++) {
            for (var i = 0; i < issues.length; i++) {
                if (issues[i].severity === severityOrder[s]) {
                    primaryIssue = issues[i].category;
                    severity = issues[i].severity;
                    s = severityOrder.length; // break outer
                    break;
                }
            }
        }

        var healthScore = computeHealthScore(issues, offlineH, isCommunicating);

        return {
            issues: issues,
            primaryIssue: primaryIssue,
            severity: severity,
            healthScore: healthScore
        };
    }

    // ── Full drill-down analysis ───────────────────────────────────────

    /**
     * Full decision-tree analysis using StatusData + LogRecords + FaultData.
     * @param {Object} device - Device from cache
     * @param {Object} statusInfo - DeviceStatusInfo record
     * @param {Object} drillData - { statusData, logRecords, faults } from healthService
     * @returns {{ rootCauses: Object[], healthScore: number, issues: Object[] }}
     */
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
        var unpluggedData = sd[C.Diagnostics.UNPLUGGED];
        if (unpluggedData && unpluggedData.length > 0) {
            var lastUnplug = latestValue(unpluggedData);
            if (lastUnplug && lastUnplug > 0) {
                rank++;
                rootCauses.push({
                    rank: rank,
                    category: C.Category.UNPLUGGED,
                    confidence: 95,
                    severity: C.Severity.CRITICAL,
                    explanation: "The device has reported an unplugged event. The GO device connector may have been removed from the vehicle\u2019s OBD-II port or power source.",
                    actions: [
                        "Verify the GO device is firmly seated in the OBD-II port.",
                        "Check for physical damage to the connector or port.",
                        "Inspect the wiring harness if a T-harness is used.",
                        "If recently serviced, confirm the device was reconnected."
                    ]
                });
                issues.push({ category: C.Category.UNPLUGGED, severity: C.Severity.CRITICAL, label: "Unplugged" });
            }
        }

        // 2. Hardware Failure / RMA (90%)
        var hardwareFaults = faults.filter(function (f) {
            var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
            var dId = f.diagnostic ? parseInt(f.diagnostic.id, 10) : NaN;
            return C.HARDWARE_FAULT_CODES.indexOf(fmId) !== -1 || C.HARDWARE_FAULT_CODES.indexOf(dId) !== -1;
        });
        var flashErrors = sd[C.Diagnostics.FLASH_ERROR];
        var hasFlashErrors = flashErrors && flashErrors.length > 0 && latestValue(flashErrors) > 0;

        if (hardwareFaults.length > 0 || hasFlashErrors) {
            rank++;
            var hwExplanation = "Hardware-level faults detected.";
            if (hasFlashErrors) {
                hwExplanation += " Flash memory errors indicate possible internal component failure.";
            }
            if (hardwareFaults.length > 0) {
                hwExplanation += " Fault codes suggest the device may require replacement (RMA).";
            }
            rootCauses.push({
                rank: rank,
                category: C.Category.HARDWARE,
                confidence: 90,
                severity: C.Severity.CRITICAL,
                explanation: hwExplanation,
                actions: [
                    "Contact Geotab support to initiate an RMA (Return Merchandise Authorization).",
                    "Check for water damage or physical tampering on the device.",
                    "Document the fault codes for the support case.",
                    "Prepare a replacement device for swap."
                ]
            });
            issues.push({ category: C.Category.HARDWARE, severity: C.Severity.CRITICAL, label: "Hardware Failure" });
        }

        // 3. Power / Voltage (75-90%)
        var voltageData = sd[C.Diagnostics.VOLTAGE];
        var crankingData = sd[C.Diagnostics.CRANKING_VOLTAGE];
        var hasLowVoltFault = faults.some(function (f) {
            var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
            return fmId === 135;
        });
        var lastVoltage = latestValue(voltageData);
        var lastCranking = latestValue(crankingData);

        if (hasLowVoltFault || (lastVoltage !== null && lastVoltage < C.Voltage.WARNING)) {
            rank++;
            var voltConf = 75;
            var voltSev = C.Severity.WARNING;
            var voltExpl = "";

            if (lastVoltage !== null && lastVoltage < C.Voltage.DEAD) {
                voltConf = 90;
                voltSev = C.Severity.CRITICAL;
                voltExpl = "Vehicle battery voltage is critically low (" + lastVoltage.toFixed(1) + "V). The battery may be dead or disconnected.";
            } else if (lastVoltage !== null && lastVoltage < C.Voltage.LOW) {
                voltConf = 85;
                voltSev = C.Severity.CRITICAL;
                voltExpl = "Vehicle battery voltage is very low (" + lastVoltage.toFixed(1) + "V). The battery is likely failing or being drained.";
            } else if (lastVoltage !== null) {
                voltExpl = "Vehicle battery voltage is below normal (" + lastVoltage.toFixed(1) + "V). This may indicate a weak battery or parasitic drain.";
            } else {
                voltExpl = "Low voltage fault code detected, but no recent voltage readings are available.";
            }

            if (lastCranking !== null && lastCranking < C.Voltage.LOW) {
                voltExpl += " Cranking voltage was also low (" + lastCranking.toFixed(1) + "V), suggesting battery or starter issues.";
            }

            rootCauses.push({
                rank: rank,
                category: C.Category.POWER,
                confidence: voltConf,
                severity: voltSev,
                explanation: voltExpl,
                actions: [
                    "Test the vehicle battery with a multimeter or battery tester.",
                    "Check for parasitic drains (aftermarket accessories left on).",
                    "Verify the alternator is charging properly.",
                    "If the vehicle is stored long-term, consider a battery maintainer."
                ]
            });
            issues.push({ category: C.Category.POWER, severity: voltSev, label: "Low Battery" });
        }

        // 4. Installation / Harness (75%)
        var canInitFail = sd[C.Diagnostics.CAN_INIT_FAIL];
        var canShort = sd[C.Diagnostics.CAN_SHORT];
        var canDisabled = sd[C.Diagnostics.CAN_DISABLED];
        var hasInstallFault = faults.some(function (f) {
            var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
            return fmId === 287;
        });
        var hasCanIssue = (canInitFail && canInitFail.length > 0 && latestValue(canInitFail) > 0) ||
                          (canShort && canShort.length > 0 && latestValue(canShort) > 0);

        if (hasInstallFault || hasCanIssue) {
            rank++;
            var instExpl = "Installation issues detected.";
            if (hasInstallFault) {
                instExpl += " The device reported a bad-install fault, suggesting it is not properly connected to the vehicle.";
            }
            if (hasCanIssue) {
                instExpl += " CAN bus communication problems indicate a wiring or connector issue.";
            }

            rootCauses.push({
                rank: rank,
                category: C.Category.INSTALLATION,
                confidence: 75,
                severity: C.Severity.WARNING,
                explanation: instExpl,
                actions: [
                    "Re-seat the GO device in the OBD-II port.",
                    "Inspect the T-harness connections for corrosion or loose pins.",
                    "Verify the correct harness type is used for this vehicle.",
                    "Check that CAN bus wiring is not pinched or damaged."
                ]
            });
            issues.push({ category: C.Category.INSTALLATION, severity: C.Severity.WARNING, label: "Loose Install" });
        }

        // 5. GPS Issues (60-90%)
        var gpsNotResp = sd[C.Diagnostics.GPS_NOT_RESPONDING];
        var gpsUnplugged = sd[C.Diagnostics.GPS_ANTENNA_UNPLUGGED];
        var gpsShort = sd[C.Diagnostics.GPS_ANTENNA_SHORT];

        var hasGpsAntennaFault = (gpsUnplugged && gpsUnplugged.length > 0 && latestValue(gpsUnplugged) > 0) ||
                                (gpsShort && gpsShort.length > 0 && latestValue(gpsShort) > 0);
        var hasGpsNotResponding = gpsNotResp && gpsNotResp.length > 0 && latestValue(gpsNotResp) > 0;

        // Check for communicating-but-no-GPS-updates pattern
        var gpsStale = false;
        if (isCommunicating && logRecords.length > 0) {
            var sortedLogs = logRecords.slice().sort(function (a, b) {
                return new Date(b.dateTime) - new Date(a.dateTime);
            });
            var lastLog = new Date(sortedLogs[0].dateTime);
            var logAgeH = (Date.now() - lastLog.getTime()) / (1000 * 60 * 60);
            if (logAgeH > 4) {
                gpsStale = true;
            }
        }

        if (hasGpsAntennaFault || hasGpsNotResponding || gpsStale) {
            rank++;
            var gpsConf = 60;
            var gpsSev = C.Severity.WARNING;
            var gpsExpl = "";

            if (hasGpsAntennaFault) {
                gpsConf = 90;
                gpsSev = C.Severity.CRITICAL;
                gpsExpl = "GPS antenna fault detected (unplugged or short circuit). The device cannot acquire satellite position.";
            } else if (hasGpsNotResponding) {
                gpsConf = 80;
                gpsExpl = "The GPS module is not responding. This may be a hardware issue or severe signal blockage.";
            } else {
                gpsExpl = "The device is communicating but GPS data is stale. The device may be in a location with poor sky visibility (underground parking, dense urban canyon).";
            }

            rootCauses.push({
                rank: rank,
                category: C.Category.GPS,
                confidence: gpsConf,
                severity: gpsSev,
                explanation: gpsExpl,
                actions: [
                    "Verify the GPS antenna connection on the device.",
                    "Move the vehicle to an open-sky area and check for GPS lock.",
                    "Check if a metallic windshield tint is blocking GPS signals.",
                    "If using an external antenna, inspect the cable and mount."
                ]
            });
            issues.push({ category: C.Category.GPS, severity: gpsSev, label: "GPS Issue" });
        }

        // 6. Cellular / Connectivity (55-85%)
        var rssiData = sd[C.Diagnostics.CELLULAR_RSSI];
        var intermittent = sd[C.Diagnostics.INTERMITTENT_CONNECTION];
        var lastRSSI = latestValue(rssiData);
        var hasIntermittent = intermittent && intermittent.length > 0 && latestValue(intermittent) > 0;

        var cellIssue = false;
        var cellConf = 55;
        var cellSev = C.Severity.INFO;
        var cellExpl = "";

        if (lastRSSI !== null && lastRSSI < C.RSSI.NO_SIGNAL) {
            cellIssue = true;
            cellConf = 85;
            cellSev = C.Severity.CRITICAL;
            cellExpl = "Cellular signal is at no-signal level (" + lastRSSI + " dBm). The device cannot communicate with the server.";
        } else if (lastRSSI !== null && lastRSSI < C.RSSI.POOR) {
            cellIssue = true;
            cellConf = 70;
            cellSev = C.Severity.WARNING;
            cellExpl = "Cellular signal is poor (" + lastRSSI + " dBm). Data uploads may be delayed or incomplete.";
        } else if (hasIntermittent) {
            cellIssue = true;
            cellConf = 65;
            cellSev = C.Severity.WARNING;
            cellExpl = "Intermittent connectivity detected. The device is cycling between connected and disconnected states.";
        } else if (!isCommunicating && offlineH > C.OfflineHours.NORMAL_SLEEP) {
            cellIssue = true;
            cellConf = 60;
            cellSev = offlineH > C.OfflineHours.EXTENDED ? C.Severity.CRITICAL : C.Severity.WARNING;
            cellExpl = "The device has been offline for " + Math.round(offlineH) + " hours.";
            if (offlineH > C.OfflineHours.EXTENDED) {
                cellExpl += " Extended offline periods may indicate the vehicle is in a no-coverage area, the device has lost power, or there is a cellular modem issue.";
            }
        }

        if (cellIssue) {
            rank++;
            rootCauses.push({
                rank: rank,
                category: C.Category.CELLULAR,
                confidence: cellConf,
                severity: cellSev,
                explanation: cellExpl,
                actions: [
                    "Check the vehicle\u2019s typical operating area for cellular coverage.",
                    "Verify the device\u2019s SIM card is properly seated.",
                    "Try a power cycle by disconnecting and reconnecting the device.",
                    "If in a known dead zone, wait for the vehicle to move to coverage."
                ]
            });
            issues.push({ category: C.Category.CELLULAR, severity: cellSev, label: "Connectivity Issue" });
        }

        // 7. Firmware (95%)
        var bootloaderFail = sd[C.Diagnostics.BOOTLOADER_FAIL];
        var hasBootFail = bootloaderFail && bootloaderFail.length > 0 && latestValue(bootloaderFail) > 0;
        var hasFwMismatch = device && device.parameterVersion != null &&
                            device.parameterVersionOnDevice != null &&
                            device.parameterVersion !== device.parameterVersionOnDevice;

        if (hasBootFail || hasFwMismatch) {
            rank++;
            var fwSev = hasBootFail ? C.Severity.WARNING : C.Severity.INFO;
            var fwExpl = "";
            if (hasBootFail) {
                fwExpl = "A bootloader update has failed on this device. The device may not be running the expected firmware version.";
            } else {
                fwExpl = "The device has a pending configuration update (parameter version " +
                    device.parameterVersion + " vs on-device " + device.parameterVersionOnDevice +
                    "). It will apply on next communication.";
            }

            rootCauses.push({
                rank: rank,
                category: C.Category.FIRMWARE,
                confidence: 95,
                severity: fwSev,
                explanation: fwExpl,
                actions: [
                    "If bootloader failed, contact Geotab support for a manual firmware push.",
                    "Ensure the device has stable power and connectivity for firmware updates.",
                    "For pending config, the device will auto-update on next check-in.",
                    "Avoid making additional config changes until the current update completes."
                ]
            });
            issues.push({ category: C.Category.FIRMWARE, severity: fwSev, label: hasBootFail ? "Firmware Failure" : "Firmware Pending" });
        }

        // 8. OEM Issues (85%)
        var oemFaults = faults.filter(function (f) {
            var fmId = f.failureMode ? parseInt(f.failureMode.id, 10) : NaN;
            return C.OEM_FAULT_CODES.indexOf(fmId) !== -1;
        });

        if (oemFaults.length > 0) {
            rank++;
            rootCauses.push({
                rank: rank,
                category: C.Category.OEM,
                confidence: 85,
                severity: C.Severity.INFO,
                explanation: "OEM-related fault codes (SWC) detected. These typically relate to vehicle-specific steering-wheel-control or aftermarket integration issues.",
                actions: [
                    "Check if aftermarket steering wheel controls are installed.",
                    "Verify the T-harness is compatible with this vehicle make/model.",
                    "Consult the Geotab vehicle compatibility list for known issues.",
                    "These faults generally do not affect core tracking functionality."
                ]
            });
            issues.push({ category: C.Category.OEM, severity: C.Severity.INFO, label: "OEM Issue" });
        }

        var healthScore = computeHealthScore(issues, offlineH, isCommunicating);

        return {
            rootCauses: rootCauses,
            healthScore: healthScore,
            issues: issues
        };
    }

    // ── Health score computation ────────────────────────────────────────

    function computeHealthScore(issues, offlineH, isCommunicating) {
        var score = 100;

        issues.forEach(function (issue) {
            var deduction = C.ScoreDeductions[issue.severity] || 0;
            score -= deduction;
        });

        // Offline duration penalty
        if (!isCommunicating && offlineH > C.OfflineHours.NORMAL_SLEEP) {
            var extraH = offlineH - C.OfflineHours.NORMAL_SLEEP;
            score -= Math.min(20, Math.round(extraH / 24) * 5);
        }

        return Math.max(0, Math.min(100, score));
    }

    return {
        classifyDevice: classifyDevice,
        analyzeDevice: analyzeDevice
    };
})();
