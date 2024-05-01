var Montage = require("montage/core/core").Montage;

/**
 * @class PGClass
 * @extends Montage
 */


exports.PGClass = Montage.specialize(/** @lends PGClass.prototype */ {
    name: {
        value: undefined
    },
    oid: {
        value: undefined
    },
    kind: {
        value: undefined
    }

});
