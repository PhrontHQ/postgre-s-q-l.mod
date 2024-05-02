var Montage = require("mod/core/core").Montage;

/**
 * @class PGCatalog
 * @extends Montage
 */


exports.PGCatalog = Montage.specialize(/** @lends PGCatalog.prototype */ {
    namespaceName: {
        value: undefined
    },
    oid: {
        value: undefined
    }

});
