/**
 * @module data/main.mod/converter/postgresql-i-s-o-8601-date-string-to-date-component-values-callback-converter
 * @requires montage/core/converter/converter
 */
var Converter = require("montage/core/converter/converter").Converter;


/**
 * @class PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter
 * @classdesc Parse string like '2019-09-12 09:52:52.992823+00' to help convert it to a date
 *
 */
var PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter = exports.PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter = Converter.specialize({

    callback: {
        value: function (year, month, day, hours, minutes, seconds, milliseconds) {
            return  Array.prototype.slice.call(arguments);
        }
    },

    /**
     * Converts the ISO 8601 string coming from PostgreSQL to Date component values
     * passed to the converter's callback function
     *
     * Parse string like '2019-09-12 09:52:52.992823+00'
     * Assumes string is always +00
     *
     * @function
     * @param {string} v The string to convert.
     * @returns {Range} The Date converted from the string.
     *
     */
    convert: {
        value: function (s) {
            if(typeof s === "string") {
                var b = s.split(/\D/),
                hasQuotePadding =  (b[0] === "" && b[b.length-1] === ""),
                yearIndex, monthIndex, dayIndex, hourIndex, minuteIndex, secondIndex, millisecondIndex;

            if(hasQuotePadding) {
                yearIndex = 1;
                monthIndex = 2;
                dayIndex = 3;
                hourIndex = 4;
                minuteIndex = 5;
                secondIndex = 6;
                millisecondIndex = 7;
            } else {
                yearIndex = 0;
                monthIndex = 1;
                dayIndex = 2;
                hourIndex = 3;
                minuteIndex = 4;
                secondIndex = 5;
                millisecondIndex = 6;
            }

            //--b[monthIndex];                  // Adjust month number, 0 based in Date.UTC()
            b[millisecondIndex] = b[millisecondIndex].substr(0,3); // Microseconds to milliseconds
            return this.callback(b[yearIndex], b[monthIndex], b[dayIndex], b[hourIndex], b[minuteIndex], b[secondIndex], b[millisecondIndex]);
                    } else {
                return null;
            }
        }
    }

});
