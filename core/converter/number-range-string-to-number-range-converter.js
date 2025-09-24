/**
 * @module data/converter/r-f-c-3339-u-t-c-range-string-to-date-range-converter
 * @requires montage/core/converter/converter
 */
var Converter = require("mod/core/converter/converter").Converter,
    Range = require("mod/core/range").Range,
    ISO8601DateStringToDateComponentValuesCallbackConverter = require("mod/core/converter/i-s-o-8601-date-string-to-date-component-values-callback-converter").ISO8601DateStringToDateComponentValuesCallbackConverter,
    singleton;
/**
 * @class NumberRangeStringToNumberRangeConverter
 * @classdesc Converts an RFC3339 UTC string to a date and reverts it.
 */
var NumberRangeStringToNumberRangeConverter = exports.NumberRangeStringToNumberRangeConverter = Converter.specialize({

    constructor: {
        value: function () {
            if (this.constructor === NumberRangeStringToNumberRangeConverter) {
                if (!singleton) {
                    singleton = this;
                }

                return singleton;
            }

            return this;
        }
    },

    /**
     * Converts the RFC3339 string to a Date.
     * @function
     * @param {string} v The string to convert.
     * @returns {Range} The range with values parsed from the string.
     */
    convert: {
        value: function (v) {
            if(typeof v === "string") {
                return Range.parse(v, Number);
            } else {
                return v;
            }
        }
    },

    /**
     * Reverts the specified number range to an range String.
     * @function
     * @param {Range} v The specified string.
     * @returns {string}
     */
    revert: {
        value: function (v) {

            if(!v) return v;
            //Wish we could just called toString() on v,
            //but it's missing the abillity to cutomize the
            //stringify of begin/end
            /*
                if v.begin/end are CalendarDate, we need to transform them to JSDate to make them in UTC, be able to use toISOString
            */
            return v.bounds[0] +
                (
                    v.begin
                        ? v.begin
                        : "-infinity"
                ) + "," +
                (
                    v.end
                        ? v.end
                        : "infinity"
                ) + v.bounds[1];

        }
    }

});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        if (!singleton) {
            singleton = new NumberRangeStringToNumberRangeConverter();
        }

        return singleton;
    }
});
