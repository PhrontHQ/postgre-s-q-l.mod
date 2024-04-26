/**
 * @module data/main.mod/converter/postgresql-interval-to-duration-converter
 * @requires montage/core/converter/converter
 */
var Converter = require("montage/core/converter/converter").Converter,
    Duration = require("montage/core/duration").Duration,
    Enum = require("montage/core/enum").Enum,
    IntervalStyle,
    intervalstyle = [
        "SQLStandard", "Postgres", "PostgresVerbose", "ISO8601"
    ],
    intervalstyleValues = [
        "sql_standard", "postgres", "postgres_verbose", "iso_8601"
    ],
    NUMBER = '([+-]?\\d+)',
    YEAR = NUMBER+'\\s+years?',
    MONTH = NUMBER+'\\s+mons?',
    DAY = NUMBER+'\\s+days?',

    // NOTE: PostgreSQL automatically overflows seconds into minutes and minutes
    // into hours, so we can rely on minutes and seconds always being 2 digits
    // (plus decimal for seconds). The overflow stops at hours - hours do not
    // overflow into days, so could be arbitrarily long.
    TIME = '([+-])?(\\d+):(\\d\\d):(\\d\\d(?:\\.\\d{1,6})?)',
    INTERVAL = new RegExp(
    '^\\s*' +
        // All parts of an interval are optional
        [YEAR, MONTH, DAY, TIME].map((str) => '(?:' + str + ')?').join('\\s*') +
        '\\s*$'
    );

    exports.IntervalStyle = IntervalStyle = new Enum().initWithMembersAndValues(intervalstyle,intervalstyleValues);


/**
 * @class PostgreSQLIntervalToDurationConverter
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
 *
 * PostgreSQL conversion borrowed from
 * https://github.com/bendrucker/postgres-interval (MIT)
 */
var PostgreSQLIntervalToDurationConverter = exports.PostgreSQLIntervalToDurationConverter = Converter.specialize({

    constructor: {
        value: function () {

            return this;
        }
    },

    /*
        This is PostgreSQL's default, easier in serveless default config
    */
    intervalStyle: {
        value: IntervalStyle.Postgres
    },

    _durationToStringOptions: {
        value: {
            postgreSQLIntervalCompatibility: true
        }
    },

    convertPostgresIntervalstyle: {
        value: function(interval) {
            if(!interval) {
                return (new Duration()).initWithComponents(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
            }

            var matches = INTERVAL.exec(interval) || [],
                plusMinusTime = matches[4],
                timeMultiplier = plusMinusTime === '-' ? -1 : 1,
                yearsString = matches[1],
                years = yearsString ? parseInt(yearsString, 10) : 0,
                monthsString = matches[2],
                months = monthsString ? parseInt(monthsString, 10) : 0,
                daysString = matches[3],
                days = daysString ? parseInt(daysString, 10) : 0,
                hoursString = matches[5],
                hours = hoursString ? timeMultiplier * parseInt(hoursString, 10) : 0,
                minutesString = matches[6],
                minutes = minutesString
                    ? timeMultiplier * parseInt(minutesString, 10)
                    : 0,
                secondsString = matches[7],
                secondsFloat = parseFloat(secondsString) || 0,
                // secondsFloat is guaranteed to be >= 0, so floor is safe
                absSeconds = Math.floor(secondsFloat),
                seconds = timeMultiplier * absSeconds,
                // Without the rounding, we end up with decimals like 455.99999999999994 instead of 456
                milliseconds = Math.round(timeMultiplier * (secondsFloat - absSeconds) * 1000000) / 1000;

                return (new Duration).initWithComponents(years, months, 0, days, hours, minutes, seconds, milliseconds, 0, 0);
        }
    },

    convertISO8601Intervalstyle: {
        value: function(interval) {
            return Duration.from(interval);
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
            if(typeof v === "string") {
                if(this.intervalStyle === IntervalStyle.Postgres) {
                    return this.convertPostgresIntervalstyle(v);
                } else if(this.intervalStyle === IntervalStyle.ISO8601) {
                    return this.convertISO8601Intervalstyle(v);
                } else {
                    throw "PostgreSQLIntervalToDurationConverter can't convert value: '"+v+"'";
                }
            } else if( v instanceof "object") {
                return Duration.from(v);
            } else {
                throw "PostgreSQLIntervalToDurationConverter can't convert value: "+JSON.stringify(v);
            }
        }
    },

    /**
     * Reverts the specified Duration to an an ISO 8601-2 Duration format String.
     * PostgreSQL interval don't support a string starting by "-", but instead each value starting by "-"
     * if it's negative, like 'PT-6H-3M'::interval becomes "-06:03:00"
     * @function
     * @param {Duration} v The specified durtion.
     * @returns {string}
     */
    revert: {
        value: function (v) {
            return v ? v.toString(this._durationToStringOptions) : "";
        }
    }

});

Object.defineProperty(exports, 'singleton', {
    get: function () {
        if (!singleton) {
            singleton = new PostgreSQLIntervalToDurationConverter();
        }

        return singleton;
    }
});
