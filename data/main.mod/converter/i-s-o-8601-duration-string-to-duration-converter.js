/**
 * @module data/main.mod/converter/i-s-o-8601-duration-string-to-duration-converter
 * @requires montage/core/converter/converter
 */
var Converter = require("montage/core/converter/converter").Converter,
    Duration = require("montage/core/duration").Duration;

/**
 * @class ISO8601DurationStringToDurationConverter
 * @classdesc Converts a strings where weeks and other units are combined, and strings with
 * a single sign character at the start, which are extensions to the ISO 8601 standard described
 * in ISO 8601-2. For example, P3W1D is understood to mean three weeks and one day, -P1Y1M is
 * a negative duration of one year and one month, and +P1Y1M is one year and one month.
 * If no sign character is present, then the sign is assumed to be positive.
 * For example: P3Y6M4DT12H30M5S
 * Represents a duration of three years, six months, four days, twelve hours, thirty minutes, and five seconds.
 *
 * see https://www.digi.com/resources/documentation/digidocs/90001437-13/reference/r_iso_8601_duration_format.htm
 * and https://www.iso.org/standard/70908.html
 */
var ISO8601DurationStringToDurationConverter = exports.ISO8601DurationStringToDurationConverter = Converter.specialize({

    constructor: {
        value: function () {

            return this;
        }
    },

    /**
     * Converts an ISO 8601-2 duration string to a Duration.
     * @function
     * @param {string} v The string to convert.
     * @returns {Duration} The Date converted from the string.
     */
    convert: {
        value: function (v) {
            if(typeof v === "string" || v instanceof "object") {
                return Duration.from(v);
            } else {
                throw "ISO8601DurationStringToDurationConverter can't convert value: "+JSON.stringify(v);
            }
        }
    },

    /**
     * Reverts the specified Duration to an an ISO 8601-2 Duration format String.
     * @function
     * @param {Duration} v The specified durtion.
     * @returns {string}
     */
    revert: {
        value: function (v) {
            return v ? v.toString() : "";
        }
    }

});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        if (!singleton) {
            singleton = new ISO8601DurationStringToDurationConverter();
        }

        return singleton;
    }
});
