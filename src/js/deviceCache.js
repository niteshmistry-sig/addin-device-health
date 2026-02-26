/**
 * deviceCache.js — Caches Device + Group data via multiCall at startup.
 * Provides O(1) lookups by device ID.
 */
var DHD = DHD || {};

DHD.DeviceCache = (function () {
    "use strict";

    var _devices = {};   // id → device object
    var _groups = {};    // id → group object
    var _loaded = false;

    /**
     * Load all devices and groups in a single multiCall.
     * @param {Object} api - Geotab API object
     * @returns {Promise}
     */
    function load(api) {
        return new Promise(function (resolve, reject) {
            api.multiCall([
                ["Get", { typeName: "Device", resultsLimit: 50000 }],
                ["Get", { typeName: "Group", resultsLimit: 10000 }]
            ], function (results) {
                var deviceList = results[0];
                var groupList = results[1];

                _devices = {};
                deviceList.forEach(function (d) {
                    _devices[d.id] = d;
                });

                _groups = {};
                groupList.forEach(function (g) {
                    _groups[g.id] = g;
                });

                _loaded = true;
                resolve();
            }, function (err) {
                reject(err);
            });
        });
    }

    /**
     * Get device by ID.
     * @param {string} id
     * @returns {Object|null}
     */
    function getDevice(id) {
        return _devices[id] || null;
    }

    /**
     * Get all devices as an array.
     * @returns {Object[]}
     */
    function getAllDevices() {
        return Object.keys(_devices).map(function (id) {
            return _devices[id];
        });
    }

    /**
     * Get group name by ID.
     * @param {string} id
     * @returns {string}
     */
    function getGroupName(id) {
        var g = _groups[id];
        return g ? (g.name || id) : id;
    }

    /**
     * @returns {boolean}
     */
    function isLoaded() {
        return _loaded;
    }

    return {
        load: load,
        getDevice: getDevice,
        getAllDevices: getAllDevices,
        getGroupName: getGroupName,
        isLoaded: isLoaded
    };
})();
