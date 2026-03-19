/**
 * @module core/converter/r-f-c-3339-u-t-c-range-string-to-date-range-converter
 * @requires montage/core/converter/converter
 */
var RFC3339UTCRangeStringToCalendarDateRangeConverter = require("mod/core/converter/r-f-c-3339-u-t-c-range-string-to-calendar-date-range-converter").RFC3339UTCRangeStringToDateRangeConverter;


console.warn("[Deprecation Warning] mod/core/converter/r-f-c-3339-u-t-c-range-string-to-calendar-date-range-converter is deprecated in favor of mod/core/converter/r-f-c-3339-u-t-c-range-string-to-calendar-date-range-converter");

/**
 * @class RFC3339UTCRangeStringToCalendarDateRangeConverter
 * @classdesc Converts an RFC3339 UTC string to a calendarDate and reverts it.
 */
exports.RFC3339UTCRangeStringToCalendarDateRangeConverter = RFC3339UTCRangeStringToCalendarDateRangeConverter;

Object.defineProperty(exports, 'singleton', {
    get: function () {
        return RFC3339UTCRangeStringToCalendarDateRangeConverter.singleton;
    }
});
