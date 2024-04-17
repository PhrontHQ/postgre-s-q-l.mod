/**
 * @module phront/data/main.mod/converter/localized-string-converter
 * @requires montage/core/converter/converter
 * @requires montage/core/converter/number-converter
 */
var Converter = require("montage/core/converter/converter").Converter,
    pgutils = require('../service/pg-utils'),
    prepareValue = pgutils.prepareValue;


/**
 * @class LocalizedStringConverter
 * @classdesc  Converts a JSON structure to a PostgreSQL structure.
 *
 * @extends Converter
 */
exports.LocalizedStringConverter = Converter.specialize( /** @lends PostgresqlJsonbConverter# */ {

    /**
     * Converts the specified value to byte format.
     * @function
     * @param {Property} v The value to format.
     * @returns {string} The value converted to byte format.
     */
    convert: {
        value: function (v) {
            return (typeof v === "string")
                ? JSON.parse(v)
                : v;
        }
    },

    /**
     * Reverts a JSON Structure to a string compatible with PostgreSQL JSONB type
     * @function
     * @param {object} v The value to revert.
     * @returns {string} v
     */
    revert: {
        value: function (v) {
            var jsonString = JSON.stringify(v);
            return prepareValue(jsonString,"jsonb");
        }
    }

});

