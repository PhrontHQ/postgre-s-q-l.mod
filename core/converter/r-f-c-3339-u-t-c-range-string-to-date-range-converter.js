/**
 * @module data/main.mod/converter/r-f-c-3339-u-t-c-range-string-to-date-range-converter
 * @requires montage/core/converter/converter
 */
var Converter = require("mod/core/converter/converter").Converter,
    Range = require("mod/core/range").Range,
    ISO8601DateStringToDateComponentValuesCallbackConverter = require("mod/core/converter/i-s-o-8601-date-string-to-date-component-values-callback-converter").ISO8601DateStringToDateComponentValuesCallbackConverter,
    singleton;

    //ISO 8601

    //for Date.parseRFC3339
    require("mod/core/extras/date");

/**
 * @class RFC3339UTCRangeStringToDateRangeConverter
 * @classdesc Converts an RFC3339 UTC string to a date and reverts it.
 */
var RFC3339UTCRangeStringToDateRangeConverter = exports.RFC3339UTCRangeStringToDateRangeConverter = Converter.specialize({

    constructor: {
        value: function () {
            if (this.constructor === RFC3339UTCRangeStringToDateRangeConverter) {
                if (!singleton) {
                    singleton = this;
                    this._stringConverter = new ISO8601DateStringToDateComponentValuesCallbackConverter();

                    this._stringConverter.callback = function dateConverter(year, month, day, hours, minutes, seconds, milliseconds) {
                        return new Date(Date.UTC(year, --month, day, hours, minutes, seconds, milliseconds));
                    };

                    this._rangeParser = this._stringConverter.convert.bind(this._stringConverter);
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
     * @returns {Range} The Date converted from the string.
     */
    convert: {
        value: function (v) {
            if(typeof v === "string") {
                return Range.parse(v, this._rangeParser);
            } else {
                return v;
            }
        }
    },

    /**
     * Reverts the specified Date to an RFC3339 String.
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
                        ? ((typeof v.begin.toJSDate === "function")
                            ? v.begin.toJSDate().toISOString()
                            : v.begin.toISOString())
                        : "-infinity"
                ) + "," +
                (
                    v.end
                        ? ((typeof v.end.toJSDate === "function")
                            ? v.end.toJSDate().toISOString()
                            : v.end.toISOString())
                        : "infinity"
                ) + v.bounds[1];

            return v.toISOString();
        }
    }

});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        if (!singleton) {
            singleton = new RFC3339UTCRangeStringToDateRangeConverter();
        }

        return singleton;
    }
});
