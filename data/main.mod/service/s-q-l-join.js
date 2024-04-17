/**
 * Defines the BitField class, that compactly stores multiple values as a short
 * series of bits.
 * @module phront/data/main-data.reel/service/s-q-l-join
 * @requires montage/core/core
 */

 var Montage = require("montage/core/core").Montage,
    Enum = require("montage/core/enum").Enum,
    SQLJoin,
    SQLJoinType;



/*
[ INNER ] JOIN

LEFT [ OUTER ] JOIN

RIGHT [ OUTER ] JOIN

FULL [ OUTER ] JOIN

CROSS JOIN


*/

var joinTypesMembers = [
    "Join", "LeftJoin", "RightJoin", "FullJoin", "CrossJoin"
];

joinTypesValues = [
    "JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN"
];

exports.SQLJoinType = SQLJoinType = new Enum().initWithMembersAndValues(joinTypesMembers,joinTypesValues);

 /**
  * a SQLJoin represents a SQL join
  * @class SQLJoin
  * @classdesc Compactly stores multiple values as a short series of bits.
  * @extends Montage
  */
SQLJoin = exports.SQLJoin = Montage.specialize( /** @lends SQLJoin */ {
    /***************************************************************************
     * Constructor
     */

    constructor: {
        value: function SQLJoin() {
            return this;
        }
    },
    type: {
        value: SQLJoinType.Join
    },

    /**
     * The "left" Data Set, often a table (ObjectDescriptor for us?) though in reality
     * they can be any type of FROM item Like a sub-query.
     * Use parentheses if necessary to determine the order of nesting. In the absence of parentheses,
     * JOINs nest left-to-right. In any case JOIN binds more tightly than the commas separating FROM-list items.
     *
     * @property
     */
    leftDataSet: {
        value: undefined
    },
    leftDataSetAlias: {
        value: undefined
    },
    leftDataSetAliasToStringFragment: {
        get: function() {
            return this.leftDataSetAlias ? ` "${this.leftDataSetAlias}"` : "";
        }
    },
    leftDataSetSchema: {
        value: undefined
    },
    qualifiedLeftDataSet: {
        get: function() {
            return `"${this.leftDataSetSchema}"."${this.leftDataSet}"${this.leftDataSetAliasToStringFragment}`;
        }
    },

    /**
     * The "right" Data Set
     *
     *  JOIN [Table] ON ...
     *  [Table] is always the right table.
     *
     *  @property
     *
     */
    rightDataSet: {
        value: undefined
    },
    rightDataSetAlias: {
        value: undefined
    },
    rightDataSetAliasToStringFragment: {
        get: function() {
            return this.rightDataSetAlias ? ` "${this.rightDataSetAlias}"` : "";
        }
    },
    rightDataSetSchema: {
        value: undefined
    },

    qualifiedRightDataSet: {
        get: function() {
            return `"${this.rightDataSetSchema}"."${this.rightDataSet}"${this.rightDataSetAliasToStringFragment}`;
        }
    },

    /**
     * an expression resulting in a value of type boolean (similar to a WHERE clause) that specifies which rows in a join are considered to match.
     *
     * @property
     */

    _onConditions: {
        value: undefined
    },
    onConditions: {
        get: function() {
            return this._onConditions || (this._onConditions = new Set());
        },
        set:function(value) {
            if(value !== this._onConditions) {
                this._onConditions = value;
            }
        }
    },
    onCondition: {
        value: ""
    },
    toString: {
        value: function () {
            // return `${this.type} "${this.rightDataSetSchema}"."${this.rightDataSet}"${this.rightDataSetAliasToStringFragment} ON ${this.onConditions.join(" ")}`;
            return `${this.type} ${this.qualifiedRightDataSet} ON ${this.onCondition}`;
        }
    }


 });

