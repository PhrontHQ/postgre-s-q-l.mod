/**
 * @module data/main.mod/converter/r-f-c-3339-u-t-c-range-string-to-date-range-converter
 * @requires montage/core/converter/converter
 */
var RFC3339UTCRangeStringToDateRangeConverter = require("./r-f-c-3339-u-t-c-range-string-to-date-range-converter").RFC3339UTCRangeStringToDateRangeConverter,
    CalendarDate = require("montage/core/date/calendar-date").CalendarDate,
    Range = require("montage/core/range").Range,
    TimeZone = require("montage/core/date/time-zone").TimeZone,
    PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter = require("./postgresql-i-s-o-8601-date-string-to-date-component-values-callback-converter").PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter,
    singleton;

/**
 * @class RFC3339UTCRangeStringToCalendarDateRangeConverter
 * @classdesc Converts an RFC3339 UTC string to a calendarDate and reverts it.
 */
var RFC3339UTCRangeStringToCalendarDateRangeConverter = exports.RFC3339UTCRangeStringToCalendarDateRangeConverter = RFC3339UTCRangeStringToDateRangeConverter.specialize({

    constructor: {
        value: function () {
            if (this.constructor === RFC3339UTCRangeStringToCalendarDateRangeConverter) {
                if (!singleton) {
                    singleton = this;
                    this._stringConverter = new PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter();

                    this._stringConverter.callback = function dateConverter(year, month, day, hours, minutes, seconds, milliseconds) {
                        return TimeZone.systemTimeZone
                        .then(function(systemTimeZone) {
                            return new CalendarDate.withUTCComponentValuesInTimeZone(year, month, day, hours, minutes, seconds, milliseconds, systemTimeZone);
                        });
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
    }
});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        if (!singleton) {
            singleton = new RFC3339UTCRangeStringToCalendarDateRangeConverter();
        }

        return singleton;
    }
});
