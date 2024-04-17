/**
 * Defines the BitField class, that compactly stores multiple values as a short
 * series of bits.
 * @module phront/data/main-data.reel/service/s-q-l-join-statements
 * @requires montage/core/core
 */

 var Montage = require("montage/core/core").Montage;

 /**
  * a SQLJoinStatements maintains information about joins being created by the conversion
  * of an frb expression to SQL. Internally we
  * @class SQLJoinStatements
  * @classdesc Compactly stores multiple values as a short series of bits.
  * @extends Montage
  */
 var SQLJoinStatements = exports.SQLJoinStatements = Montage.specialize( /** @lends SQLJoinStatements */ {
    /***************************************************************************
     * Constructor
     */

     constructor: {
        value: function SQLJoinStatements() {
            this._joinMap = new Map();
            this._joinDependencyMap = new Map();
            this._joinIndexMap = new Map();
            this._addOrderedJoins = [];
            return this;
        }
    },

     /**
      * Add a join to the table
      * @method
      * @param {SQLJoin} join a join to add to the table.
      */
     add: {
         value: function (join) {

            if(!this.hasJoinEqualTo(join)) {
                var value = this._joinMap.get(join.qualifiedRightDataSet);
                if(!value) {
                    value = new Set();
                    this._joinMap.set(join.qualifiedRightDataSet, value);
                }
                value.add(join);
                this._joinIndexMap.set(join,this._addOrderedJoins.length);
                this._addOrderedJoins.push(join);
                this._joinDependencyMap.set(join,join.qualifiedLeftDataSet);
                // console.log("------> SQLJoinStatements add "+join.toString() );
                // console.log("------> this._addOrderedJoins is "+this._addOrderedJoins.join(", ") );

            }
         }
     },

     hasJoinEqualTo: {
        value: function(aJoin) {
            var candidateJoins = this._joinMap.get(aJoin.qualifiedRightDataSet);
            if(candidateJoins) {
                var candidateJoinsIterator = candidateJoins.values(),
                    candidateJoinsIteration,
                    iCandidtateJoin;

                while(!(candidateJoinsIteration = candidateJoinsIterator.next()).done) {
                    iCandidtateJoin = candidateJoinsIteration.value;
                    if(iCandidtateJoin.onCondition === aJoin.onCondition) {
                        return true;
                    }
                }
                return false;
            }
        }
     },

     delete: {
        value: function (join) {

            var value = this._joinMap.get(join.qualifiedRightDataSet);
            if(value) {
                if(!value.has(join)) {
                    console.debug("something's off");
                }
                value.delete(join);
                if(!this._addOrderedJoins.has(join)) {
                    console.debug("something's off");
                }
                this._addOrderedJoins.delete(join);
                this._joinDependencyMap.delete(join);
                this._joinIndexMap.delete(join);
            }
        }
    },

    has: {
        value: function(value) {
            return this._joinDependencyMap.has(value);
        }
    },

     size: {
         get: function() {
             return this._joinMap.size;
         }
     },

    keys: {
        value: function() {
            return this._joinMap.keys();
        }
    },
    values: {
        value: function() {
            return this._joinMap.values();
        }
    },
    entries: {
        value: function() {
            return this._joinMap.entries();
        }
    },

    orderedJoins: {
        value: function() {
            return this._addOrderedJoins;
        }
    },


    stringifySQLJoinSet: {
        value: function(aSQLJoinSet) {

            if(aSQLJoinSet.size) {
                var iterator = aSQLJoinSet.values(),
                iteration, iSQLJoin,
                result;

                while(!(iteration = iterator.next()).done) {
                    iSQLJoin = iteration.value;

                    result = result ? `${result} ${iSQLJoin.toString()}` : iSQLJoin.toString();
                }
                return result;

            } else {
                return "";
            }

        }
    },

    fromClauseQualifiedRightDataSetsString: {
        get: function () {

            if (this._joinMap.size) {
                var separator = ", ",
                    keyIterator = this._joinMap.keys(), aValue, aNextValue, resultValue = "";

                    while((aValue = keyIterator.next().value) && (aNextValue = keyIterator.next().value)) {
                        //aValue and aNextValue are Sets that contain SQLJoins
                        if(resultValue.length > 0) {
                            resultValue += separator;
                        }
                        resultValue += `${aValue}${separator}${aNextValue}`;
                    }
                    if(aValue) {
                        resultValue += (resultValue.length > 0 )
                        ? `${separator}${aValue}`
                        : aValue;
                    }
                return resultValue;
            } else {
                return "";
            }

        }
    },

    _joinAndConditionStringForJoinSet: {
        value: function (joinSet) {
            if (joinSet.size) {
                var separator = " AND ",
                    setIterator = joinSet.values(), aValue, aNextValue, joinValue = "";
                while((aValue = setIterator.next().value) && (aNextValue = setIterator.next().value)) {
                    //aValue and aNextValue are Sets that contain SQLJoins
                    if(joinValue.length > 0) {
                        joinValue += separator;
                    }
                    joinValue += `${aValue.onCondition}${separator}${aNextValue.onCondition}`;
                }
                if(aValue) {
                    joinValue += (joinValue.length > 0 )
                    ? `${separator}${aValue.onCondition}`
                    : aValue.onCondition;
                }

                return joinValue;
            } else {
                return "";
            }
        }
    },

    joinAndConditionString: {
        get: function () {
            if (this.size) {
                var separator = " AND ",
                    setIterator = this._joinMap.values(), aValue, aNextValue, joinValue = "";
                while((aValue = setIterator.next().value) && (aNextValue = setIterator.next().value)) {
                    //aValue and aNextValue are Sets that contain SQLJoins
                    if(joinValue.length > 0) {
                        joinValue += separator;
                    }
                    joinValue += `${this._joinAndConditionStringForJoinSet(aValue)}${separator}${this._joinAndConditionStringForJoinSet(aNextValue)}`;
                }
                if(aValue) {
                    joinValue += (joinValue.length > 0 )
                    ? `${separator}${this._joinAndConditionStringForJoinSet(aValue)}`
                    : this._joinAndConditionStringForJoinSet(aValue);
                }

                return joinValue;
            } else {
                return "";
            }
        }
    },

    _toString: {
        value: function () {
            if (this.size) {
                var separator = " ",
                    setIterator = this._joinMap.values(), aValue, aNextValue, joinValue = "";
                while((aValue = setIterator.next().value) && (aNextValue = setIterator.next().value)) {
                    //aValue and aNextValue are Sets that contain SQLJoins
                    if(joinValue.length > 0) {
                        joinValue += separator;
                    }
                    joinValue += `${this.stringifySQLJoinSet(aValue)}${separator}${this.stringifySQLJoinSet(aNextValue)}`;
                }
                if(aValue) {
                    joinValue += (joinValue.length > 0 )
                    ? `${separator}${this.stringifySQLJoinSet(aValue)}`
                    : this.stringifySQLJoinSet(aValue);
                }

                return joinValue;
            } else {
                return "";
            }
        }
    },

    toString: {
        value: function () {
            if (this.size) {
                var separator = " ",
                    setIterator = this._addOrderedJoins .values(), aValue, aNextValue, joinValue = "";
                while((aValue = setIterator.next().value) && (aNextValue = setIterator.next().value)) {
                    //aValue and aNextValue are Sets that contain SQLJoins
                    if(joinValue.length > 0) {
                        joinValue += separator;
                    }
                    joinValue += `${aValue.toString()}${separator}${aNextValue.toString()}`;
                }
                if(aValue) {
                    joinValue += (joinValue.length > 0 )
                    ? `${separator}${aValue.toString()}`
                    : aValue.toString();
                }

                return joinValue;
            } else {
                return "";
            }
        }
    }


 });

