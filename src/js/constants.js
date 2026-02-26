/**
 * constants.js — Single source of truth for Geotab diagnostic KnownIds,
 * fault code mappings, and classification thresholds.
 */
var DHD = DHD || {};

DHD.Constants = (function () {
    "use strict";

    // ── StatusData diagnostic KnownIds (16 total) ──────────────────────

    var Diagnostics = {
        // Power
        VOLTAGE: "DiagnosticGoDeviceVoltageId",
        CRANKING_VOLTAGE: "DiagnosticCrankingVoltageId",

        // GPS
        GPS_NOT_RESPONDING: "DiagnosticGpsNotRespondingId",
        GPS_ANTENNA_UNPLUGGED: "DiagnosticGpsAntennaUnpluggedId",
        GPS_ANTENNA_SHORT: "DiagnosticGpsAntennaShortCircuitId",

        // Cellular
        CELLULAR_RSSI: "DiagnosticCellularRssiId",
        INTERMITTENT_CONNECTION: "DiagnosticIntermittentConnectionCommunicationsId",

        // Harness
        HARNESS_STANDARD: "DiagnosticStandardHarnessDetectedId",
        HARNESS_6PIN: "DiagnosticHarnessDetected6PinId",
        HARNESS_9PIN: "DiagnosticHarnessDetected9PinId",

        // CAN bus
        CAN_INIT_FAIL: "DiagnosticCanBusFailedToInitializeId",
        CAN_SHORT: "DiagnosticCanBusShortId",
        CAN_DISABLED: "DiagnosticCanBusDisabledId",

        // Device
        UNPLUGGED: "DiagnosticDeviceHasBeenUnpluggedId",
        FLASH_ERROR: "DiagnosticFlashErrorCountId",
        BOOTLOADER_FAIL: "DiagnosticBootloaderUpdateHasFailedId"
    };

    // Ordered list for multiCall StatusData requests
    var ALL_DIAGNOSTIC_IDS = [
        Diagnostics.VOLTAGE,
        Diagnostics.CRANKING_VOLTAGE,
        Diagnostics.GPS_NOT_RESPONDING,
        Diagnostics.GPS_ANTENNA_UNPLUGGED,
        Diagnostics.GPS_ANTENNA_SHORT,
        Diagnostics.CELLULAR_RSSI,
        Diagnostics.INTERMITTENT_CONNECTION,
        Diagnostics.HARNESS_STANDARD,
        Diagnostics.HARNESS_6PIN,
        Diagnostics.HARNESS_9PIN,
        Diagnostics.CAN_INIT_FAIL,
        Diagnostics.CAN_SHORT,
        Diagnostics.CAN_DISABLED,
        Diagnostics.UNPLUGGED,
        Diagnostics.FLASH_ERROR,
        Diagnostics.BOOTLOADER_FAIL
    ];

    // ── Fault code → category mapping ──────────────────────────────────

    var FaultCategories = {
        128: "hardware",   // Flash Fail
        135: "power",      // Low Voltage
        287: "installation", // Bad Install
        297: "hardware",   // RAM failure
        450: "hardware",   // RMA required
        467: "hardware",   // Water damage
        468: "hardware",   // Water damage
        488: "oem",        // SWC issue
        491: "oem"         // SWC issue
    };

    var HARDWARE_FAULT_CODES = [128, 297, 450, 467, 468];
    var OEM_FAULT_CODES = [488, 491];

    // ── Thresholds ─────────────────────────────────────────────────────

    var Voltage = {
        DEAD: 7,
        LOW: 9,
        WARNING: 11
    };

    var RSSI = {
        NO_SIGNAL: -113,
        POOR: -95,
        FAIR: -85
    };

    var OfflineHours = {
        NORMAL_SLEEP: 24,
        EXTENDED: 72
    };

    // ── Severity levels ────────────────────────────────────────────────

    var Severity = {
        CRITICAL: "critical",
        WARNING: "warning",
        INFO: "info",
        HEALTHY: "healthy"
    };

    // ── Issue categories ───────────────────────────────────────────────

    var Category = {
        UNPLUGGED: "unplugged",
        HARDWARE: "hardware",
        POWER: "power",
        INSTALLATION: "installation",
        GPS: "gps",
        CELLULAR: "cellular",
        FIRMWARE: "firmware",
        OEM: "oem",
        OFFLINE: "offline",
        HEALTHY: "healthy"
    };

    // ── Health score deductions ─────────────────────────────────────────

    var ScoreDeductions = {
        critical: 40,
        warning: 20,
        info: 5
    };

    return {
        Diagnostics: Diagnostics,
        ALL_DIAGNOSTIC_IDS: ALL_DIAGNOSTIC_IDS,
        FaultCategories: FaultCategories,
        HARDWARE_FAULT_CODES: HARDWARE_FAULT_CODES,
        OEM_FAULT_CODES: OEM_FAULT_CODES,
        Voltage: Voltage,
        RSSI: RSSI,
        OfflineHours: OfflineHours,
        Severity: Severity,
        Category: Category,
        ScoreDeductions: ScoreDeductions
    };
})();
