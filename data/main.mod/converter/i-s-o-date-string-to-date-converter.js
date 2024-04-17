/**
 * @module data/main.mod/converter/i-s-o-date-string-to-date-converter
 * @requires data/main.mod/converter/postgresql-i-s-o-8601-date-string-to-date-component-values-callback-converter
 */
var PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter = require("./postgresql-i-s-o-8601-date-string-to-date-component-values-callback-converter").PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter,
    singleton;

    //ISO 8601

    //for Date.parseRFC3339
    require("montage/core/extras/date");

/**
 * @class ISO8601DateStringToDateConverter
 * @classdesc Converts an ISO8601 UTC string to a date and reverts it.
 */
var ISODateStringToDateConverter = exports.ISODateStringToDateConverter = PostgresqlISO8601DateStringToDateComponentValuesCallbackConverter.specialize({

    constructor: {
        value: function () {
            if (this.constructor === ISODateStringToDateConverter) {
                if (!singleton) {
                    singleton = this;

                    this.callback = function dateConverter(year, month, day, hours, minutes, seconds, milliseconds) {
                        return new Date(Date.UTC(year, --month, day, hours, minutes, seconds, milliseconds));
                    };
                }

                return singleton;
            }

            return this;
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
            //Wish we could just called toString() on v,
            //but it's missing the abillity to cutomize the
            //stringify of begin/end
            /*
                if v.begin/end are CalendarDate, we need to transform them to JSDate to make them in UTC, be able to use toISOString
            */
            return (
                    v
                        ? ((typeof v.toJSDate === "function")
                            ? v.toJSDate().toISOString()
                            : v.toISOString())
                        : v
            );
        }
    }

},{
    singleton: {
        get: function () {
            if (!singleton) {
                singleton = new ISODateStringToDateConverter();
            }

            return singleton;
        }
    }
});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        return ISODateStringToDateConverter.singleton;
    }
});
