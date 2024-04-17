/**
 * @module data/main.mod/converter/postgresql-interval-range-to-duration-range-converter
 * @requires montage/core/converter/converter
 */
var Converter = require("montage/core/converter/converter").Converter,
    Range = require("montage/core/range").Range,
    PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter = require("./postgresql-i-s-o-8601-date-string-to-date-component-values-callback-converter").PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter,
    PostgreSQLIntervalToDurationConverter = require("./postgresql-interval-to-duration-converter").PostgreSQLIntervalToDurationConverter,
    singleton;

    //ISO 8601

    //for Date.parseRFC3339
    require("montage/core/extras/date");

/**
 * @class PostgresqlIntervalRangeToDurationRangeConverter
 * @classdesc Converts an RFC3339 UTC string to a date and reverts it.
 */
var PostgresqlIntervalRangeToDurationRangeConverter = exports.PostgresqlIntervalRangeToDurationRangeConverter = Converter.specialize({

    constructor: {
        value: function () {
            if (this.constructor === PostgresqlIntervalRangeToDurationRangeConverter) {
                if (!singleton) {
                    singleton = this;
                    this._stringConverter = new PostgreSQLIntervalToDurationConverter();

                    // this._stringConverter.callback = function dateConverter(year, month, day, hours, minutes, seconds, milliseconds) {
                    //     return new Date(Date.UTC(year, --month, day, hours, minutes, seconds, milliseconds));
                    // };

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
                        ? this._stringConverter.revert(v.begin)
                        : "-infinity"
                ) + "," +
                (
                    v.end
                        ? this._stringConverter.revert(v.end)
                        : "infinity"
                ) + v.bounds[1];
        }
    }

});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        if (!singleton) {
            singleton = new PostgresqlIntervalRangeToDurationRangeConverter();
        }

        return singleton;
    }
});
