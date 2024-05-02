'use strict'
/**
 * borrowed and edited from:
 *  node-postgres/lib/utils.js
 *  node-postgres/lib/client.js
 *
 * Copyright (c) 2010-2017 Brian Carlson (brian.m.carlson@gmail.com)
 * All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * README.md file in the root directory of this source tree.
 */

var Range = require("mod/core/range").Range,
RFC3339UTCRangeStringToRangeConverter = require("mod/core/converter/r-f-c-3339-u-t-c-range-string-to-range-converter").singleton;


const parseInputDatesAsUTC = false;

function escapeElement (elementRepresentation, quoteCharacter) {
    var escaped = elementRepresentation
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"'),
        result = quoteCharacter || '"';
        result += escaped;
        result += quoteCharacter || '"';

    return result
}

// convert a JS array to a postgres array literal
// uses comma separator so won't work for types like box that use
// a different array separator.
function arrayString (val, type) {
    var toJSONB = (type === "jsonb"),
        toList = (type === "list"),
        isTypeCastArray = ( type && type.endsWith("[]") && type.length > 2),
        result = toJSONB
                    ? "'["
                    : toList
                    ? "("
                    :"'{",
        isUUID = (type === 'uuid[]');
    for (var i = 0, countI=val.length, iVal; i < countI; i++) {
        if (i > 0) {
            result += ',';
        }
        iVal = val[i];
        if (iVal === null || typeof iVal === 'undefined') {
            result += 'NULL';
        } else if (Array.isArray(iVal)) {
            result += arrayString(iVal)
        } else if (iVal instanceof Buffer) {
            result += '\\\\x';
            result += iVal.toString('hex');
        } else {
            if (typeof iVal === 'object' && toJSONB) {
                result += prepareValue(iVal, type);
            } else {
                if(isUUID) {
                    result += prepareValue(iVal);
                } else {
                    result += escapeElement(prepareValue(iVal,type), toList ? "'" : '"' );
                }
            }

        }
    }
    result += toJSONB
                ? "]'"
                : toList
                    ? ")"
                    :"}'";
    if(isTypeCastArray) {
        result += `::${type}`;
    }
    return result;
}

// converts values from javascript types
// to their 'raw' counterparts for use as a postgres parameter
// note: you can override this function to provide your own conversion mechanism
// for complex types, etc...
var prepareValue = function (val, type, seen) {
    if (val instanceof Buffer) {
        return val
    }
    if (ArrayBuffer.isView(val)) {
        var buf = Buffer.from(val.buffer, val.byteOffset, val.byteLength)
        if (buf.length === val.byteLength) {
            return buf
        }
        return buf.slice(val.byteOffset, val.byteOffset + val.byteLength) // Node.js v4 does not support those Buffer.from params
    }
    if (val instanceof Date) {
        //Hijacking for what we need now as we use timestamp with timezone. Need to be improved to allow other options
        //including original ones.
        if(type.endsWith("[]")) {
            return `${val.toISOString()}`;
        } else {
            return `'${val.toISOString()}'::timestamptz`;
        }

        //disabled for now
        if (parseInputDatesAsUTC) {
            return dateToStringUTC(val);
        } else {
            return dateToString(val);
        }
    }
    if (val instanceof Range) {
        if(val.begin instanceof Date) {
            return `'${RFC3339UTCRangeStringToRangeConverter.revert(val)}'::tstzrange`;
        } else {
            throw "Range raw conversion not handled for Range with begin:"+val.begin+", end:"+val.end;
        }
    }
    if (Array.isArray(val)) {
        return arrayString(val,type);
    }
    if (val === null || typeof val === 'undefined') {
        return null;
    }
    if (typeof val === 'object') {
        return prepareObject(val, seen, type);
    }
    return val.toString();
}

function prepareObject (val, seen, type) {
    if (val && typeof val.toPostgres === 'function') {
        seen = seen || []
        if (seen.indexOf(val) !== -1) {
            throw new Error('circular reference detected while preparing "' + val + '" for query')
        }
        seen.push(val);

        return prepareValue(val.toPostgres(prepareValue), seen);
    }
    if(type === "jsonb") {
        return  escapeString(JSON.stringify(val), "string");
    } else {
        return `'${JSON.stringify(val)}'`;
    }
}

function pad (number, digits) {
    number = '' + number
    while (number.length < digits) { number = '0' + number }
    return number;
}

function dateToString (date) {
    var offset = -date.getTimezoneOffset()

    var year = date.getFullYear()
    var isBCYear = year < 1
    if (isBCYear) year = Math.abs(year) + 1 // negative years are 1 off their BC representation

    var ret = pad(year, 4) + '-' +
        pad(date.getMonth() + 1, 2) + '-' +
        pad(date.getDate(), 2) + 'T' +
        pad(date.getHours(), 2) + ':' +
        pad(date.getMinutes(), 2) + ':' +
        pad(date.getSeconds(), 2) + '.' +
        pad(date.getMilliseconds(), 3)

    if (offset < 0) {
        ret += '-'
        offset *= -1
    } else { ret += '+' }

    ret += pad(Math.floor(offset / 60), 2) + ':' + pad(offset % 60, 2)
    if (isBCYear) ret += ' BC'
    return ret
}

function dateToStringUTC (date) {
    var year = date.getUTCFullYear()
    var isBCYear = year < 1
    if (isBCYear) year = Math.abs(year) + 1 // negative years are 1 off their BC representation

    var ret = pad(year, 4) + '-' +
        pad(date.getUTCMonth() + 1, 2) + '-' +
        pad(date.getUTCDate(), 2) + 'T' +
        pad(date.getUTCHours(), 2) + ':' +
        pad(date.getUTCMinutes(), 2) + ':' +
        pad(date.getUTCSeconds(), 2) + '.' +
        pad(date.getUTCMilliseconds(), 3)

    ret += '+00:00'
    if (isBCYear) ret += ' BC'
    return ret
}

function normalizeQueryConfig (config, values, callback) {
    // can take in strings or config objects
    config = (typeof (config) === 'string') ? { text: config } : config
    if (values) {
        if (typeof values === 'function') {
            config.callback = values
        } else {
            config.values = values
        }
    }
    if (callback) {
        config.callback = callback
    }
    return config
}

function escapeString(str, rawType, propertyDescriptor) {
    let hasBackslash = false;
    let isJSONB = rawType === "jsonb";
    let delimiter = isJSONB ? '' : "'";
    let escaped = delimiter;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'") {
            escaped += c + c;
        } else if (c === '\\') {
            escaped += c + c;
            hasBackslash = true;
        } else {
            escaped += c;
        }
    }
    escaped += delimiter;
    if (hasBackslash === true) {
        escaped = 'E' + escaped;
    }

    return isJSONB ? JSON.stringify(escaped) : escaped;
}

module.exports = {
    prepareValue: function prepareValueWrapper (value, type, propertyDescriptor) {
        // this ensures that extra arguments do not get passed into prepareValue
        // by accident, eg: from calling values.map(utils.prepareValue)
        return prepareValue(value, type, propertyDescriptor)
    },

    // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
    escapeIdentifier: function (str) {
        return str ? '"' + str.replace(/"/g, '""') + '"' : "";
    },

    // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
    escapeLiteral: function (str) {
        var hasBackslash = false
        var escaped = '\''

        for (var i = 0; i < str.length; i++) {
            var c = str[i]
            if (c === '\'') {
                escaped += c + c
            } else if (c === '\\') {
                escaped += c + c
                hasBackslash = true
            } else {
                escaped += c
            }
        }

        escaped += '\''

        if (hasBackslash === true) {
            escaped = ' E' + escaped
        }

        return escaped
    },
    literal: function(val) {
        if (null == val) return 'NULL';
        if (Array.isArray(val)) {
            var vals = val.map(exports.literal)
            return "(" + vals.join(", ") + ")"
        }
        var backslash = ~val.indexOf('\\');
        var prefix = backslash ? 'E' : '';
        val = val.replace(/'/g, "''");
        val = val.replace(/\\/g, '\\\\');
        return prefix + "'" + val + "'";
    },
    escapeString: escapeString
}
