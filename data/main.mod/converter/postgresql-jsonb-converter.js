/**
 * @module montage/core/converter/bytes-converter
 * @requires montage/core/converter/converter
 * @requires montage/core/converter/number-converter
 */
var Converter = require("montage/core/converter/converter").Converter,
    pgutils = require('../service/pg-utils'),
    prepareValue = pgutils.prepareValue;


/**
 * @class BytesConverter
 * @classdesc  Converts a JSON structure to a PostgreSQL structure.
 *
 * @extends Converter
 */
exports.PostgresqlJsonbConverter = Converter.specialize( /** @lends PostgresqlJsonbConverter# */ {

    /**
     * Converts the passed JSON string value to an object.
     * @function
     * @param {String} v The value to convert.
     * @returns {Object} The object parsed.
     */
    convert: {
        value: function (v) {
            return JSON.parse(v);
            // return (typeof v === "string" && (!this.locales || this.locales.length > 1))
            //     ? JSON.parse(v)
            //     : v;
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

