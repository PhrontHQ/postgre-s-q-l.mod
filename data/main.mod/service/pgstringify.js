"use strict";

// const { result } = (require) ("lodash");

var parse = require("mod/core/frb/parse"),
    solve = require("mod/core/frb/algebra"),
    precedence = require("mod/core/frb/language").precedence,
    typeToToken = require("mod/core/frb/language").operatorTypes,
    // tokenToType = (require) ( "mod/core/frb/language" ).operatorTokens,
    pgutils = require('./pg-utils'),
    prepareValue = pgutils.prepareValue,
    escapeIdentifier = pgutils.escapeIdentifier,
    escapeLiteral = pgutils.escapeLiteral,
    literal = pgutils.literal,
    escapeString = pgutils.escapeString,
    //RangeDescriptor = (require) ("mod/core/range.mjson").montageObject,
    Range = require("mod/core/range").Range,
    EqualsToken = "==",
    DataServiceUserLocales = "DataServiceUserLocales",
    SyntaxIteratorModule = require("mod/core/frb/syntax-iterator"),
    SyntaxIteratorModule = require("mod/core/frb/syntax-iterator"),
    SQLJoinModule = require("./s-q-l-join"),
    SQLJoinType = SQLJoinModule.SQLJoinType,
    SQLJoin = SQLJoinModule.SQLJoin,
    SQLJoinStatements = require("./s-q-l-join-statements").SQLJoinStatements,
    SyntaxPostOrderIterator = SyntaxIteratorModule.SyntaxPostOrderIterator,
    SyntaxInOrderIterator = SyntaxIteratorModule.SyntaxInOrderIterator;

// module.exports.stringify = stringify;
// function stringify(syntax, scope) {
//     return stringify.semantics.stringify(syntax, scope);
// }

/*
    TODO: Add aliasing:

        SELECT column_name AS alias_name FROM table_name AS table_alias_name;

        The AS keyword is optional so

        SELECT column_name alias_name FROM table_name table_alias_name;


    - less bytes sent
    - only solution to support table self-joins as in:

        SELECT
            e.first_name employee,
            m .first_name manager
        FROM
            employee e
        INNER JOIN employee m
            ON m.employee_id = e.manager_id
        ORDER BY manager;

    - For columns, can only be used mopped as we need to have a mapping to build the final obects' expected property, but it could save quite some data, some already done by compression

    - https://www.postgresqltutorial.com/postgresql-alias/

*/

function makeBlockStringifier(type) {
    return function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
        /*
            Entering a block means we're entering an array so the syntax inside the block is built for the type of objects right before the block
        */
       var  _propertyNameStringifier = makeBlockStringifier._propertyName || (makeBlockStringifier._propertyName = dataService.stringifiers._propertyName),
            dataMappingStartLength = dataMappings.length,
            parentDataMapping = dataMappings[dataMappings.length - 1],
            parentObjectDescriptor = parentDataMapping.objectDescriptor,
            propertyFilteredSyntax = syntax.args[0],
            filteredPropertyName,
            filteredPropertyDescriptor,
            filteredPropertyValueDescriptor,
            joinToFilteredProperty,
            propertyFilteredSyntaxArg0Type,
            result;

        joinToFilteredProperty =  dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);


        // if((propertyFilteredSyntaxArg0Type = propertyFilteredSyntax.args[0].type) === "value") {

        //     //We should be able to use the generic top level method to route stringifiers.
        //     // joinToFilteredProperty = dataService.stringify(propertyFilteredSyntax, scope, dataMappings, locales, rawExpressionJoinStatements, syntax);

        //     filteredPropertyName = propertyFilteredSyntax.args[1].value;
        //     /*
        //         we need to take care of filteredPropertyName, which adds the mapping of filteredPropertyName's valueDescriptor if any to the dataMappings array.
        //     */
        //     joinToFilteredProperty =  _propertyNameStringifier(filteredPropertyName, scope, syntax, dataService, dataMappings, locales, rawExpressionJoinStatements);

        // } else if(propertyFilteredSyntaxArg0Type === "parameters") {
        //     filteredPropertyName = scope[propertyFilteredSyntax.args[1].value];
        //     /*
        //         we need to take care of filteredPropertyName, which adds the mapping of filteredPropertyName's valueDescriptor if any to the dataMappings array.
        //     */
        //     joinToFilteredProperty =  _propertyNameStringifier(filteredPropertyName, scope, syntax, dataService, dataMappings, locales, rawExpressionJoinStatements);

        // } else if(propertyFilteredSyntaxArg0Type === "property") {

        //     /*
        //         FIXME: Tried to, but here it seems like we should be able to delegate the processing of chanined properties leading to the filter block (left) to the generic dataService.stringify, but it doesn't handle joins properly as it's been handled in a more custom way so far. We should fix this, but until then, we leverage _propertyNameStringifier() that does handle the joins manually to get the work done.
        //     */
        //     //joinToFilteredProperty = dataService.stringify(propertyFilteredSyntax, scope, dataMappings, locales, rawExpressionJoinStatements, syntax);

        //     /*
        //         Here there could be be multiple chained properties leading to the filterBlock.
        //     */
        //     var iterator = new SyntaxInOrderIterator(propertyFilteredSyntax, "property"),
        //     currentSyntax;
        //     while ((currentSyntax = iterator.next("property").value)) {
        //         filteredPropertyName = currentSyntax.args[1].value;
        //         //console.log("filteredPropertyName: ",filteredPropertyName);

        //         /*
        //             we're not really expecting _propertyNameStringifier() to return anything here besides an empty string
        //         */

        //         joinToFilteredProperty =  _propertyNameStringifier(filteredPropertyName, scope, syntax, dataService, dataMappings, locales, rawExpressionJoinStatements);
        //         //console.log("joinToFilteredProperty:",joinToFilteredProperty);
        //     }
        // }



        //Then we need to stingify the content of the filter, but first we need to dive in one level:
        // filteredPropertyDescriptor = parentObjectDescriptor.propertyDescriptorForName(filteredPropertyName);
        // filteredPropertyValueDescriptor = filteredPropertyDescriptor ? filteredPropertyDescriptor._valueDescriptorReference : null;

        // if(!filteredPropertyValueDescriptor) {
        //     console.error("Could not find value descriptor for property named '"+filteredPropertyName+"'");
        // }
        //dataMappings.push(dataService.mappingForType(filteredPropertyValueDescriptor));
        //_propertyNameStringifier added the mapping of


        var filterExpressionStringified =  dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

        //The left side (0) leads to the filter and set the rigt contex, so we remove whatever was added before we leave our scope by the right side (args[1]):
        dataMappings.splice(dataMappingStartLength);
        if(dataMappings.aliases) {
            dataMappings.aliases.splice(dataMappingStartLength);
        }

        result = ` ${joinToFilteredProperty} ${filterExpressionStringified}`;

        return result;

        // var chain = type + '{' + filterExpressionStringified + '}';
        // if (syntax.args[0].type === "value") {
        //     return chain;
        // } else {
        //     return dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax) + '.' + chain;
        // }
    };
}

module.exports = {

    makeBlockStringifier: makeBlockStringifier,

    stringifyChild: function stringifyChild(child, scope, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
        var arg = this.stringify(child, scope, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix);
        if (!arg) return "this";
        return arg;
    },


    /**
     * stringifies a criteria to SQL, criteria expressed for the objectDescriptor's that's in dataMapping
     * as dataMapping.objectDescriptor.
     * @deprecated
     * @function
     * @param {object} syntax name of the property descriptor to create
     * @param {object} scope
     * @param {ExpressionDataMapping[]} dataMappings a stack of dataMappings as expression traverses relationships starting with the type searched
     * @param {object} parent syntax's parent in the AST.
     * @returns {string}
     */

    stringify: function (syntax, scope, dataMappings, locales, rawExpressionJoinStatements, parent, currentAliasPrefix) {
        var stringifiers = this.stringifiers,
            stringifier,
            string,
            i, countI, args,
            parentPrecedence;

        if(!syntax) return "";

        if(!dataMappings.aliases) {
            dataMappings.aliases = [];
        }

        if ((stringifier = stringifiers[syntax.type])) {
            // operators
            string = stringifier(syntax, scope, parent, this, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix);
        } else if (syntax.inline) {
            // inline invocations
            string = "&";
            string += syntax.type;
            string += "(";

            args = syntax.args;
            for(i=0, countI = args.length;i<countI;i++) {
                string += i > 0 ? ", " : "";
                string += this.stringifyChild(args[i],scope, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix);
            }
            string += ")";

        } else {
            // method invocations
            var chain;
            if (syntax.args.length === 1 && syntax.args[0].type === "mapBlock") {
                // map block function calls
                chain = syntax.type + "{" + this.stringify(syntax.args[0].args[1], scope, dataMappings, locales, rawExpressionJoinStatements) + "}";
                syntax = syntax.args[0];
            } else {
                // normal function calls
                if((stringifier = this.functionStringifiers[syntax.type])) {
                    chain = stringifier(syntax, scope, parent, this, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix);

                } else {
                    chain = `${syntax.type}(`;

                    args = syntax.args;
                    for(i=1, countI = args.length;i<countI;i++) {
                        if(i > 1) {
                            chain = `${chain}, `;
                        }
                        chain = `${chain}${this.stringifyChild(args[i],scope, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix)}`;
                    }
                    chain = `${chain})`;
                }

            }
            // left-side if it exists
            if (syntax.args[0].type === "value") {
                /*
                departure from frb stringify. watch that it doesn't break others use cases, possibly in a chain?
                */
               //|| syntax.type === "has") {
                //string = chain;

                string = this.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, /*parent*/syntax, currentAliasPrefix);
                string += " ";
                string += chain;

            } else {
                //string = this.stringify(syntax.args[0], scope, dataMappings) + "." + chain;
                string = `${this.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, /*parent*/syntax, currentAliasPrefix)} ${chain}`;
            }
        }

        // parenthesize if we're going backward in precedence
        if (
            !parent ||
            (parent.type === syntax.type && parent.type !== "if") ||
            (
                // TODO check on weirdness of "if"
                (parentPrecedence = precedence.get(parent.type)) && parentPrecedence.has(syntax.type)
            )
        ) {
            return string;
        } else if(string && string.length) {
            return `(${string})`;
        } else {
            return string;
        }
    },

    _rawOperatorByMethodInvocationType: {
        value: {
            "has": "@>",
            "overlaps": "&&"
        }
    },

    rawOperatorForMethodInvocationType: {
        value: function(methodInvocation) {
            return this._rawOperatorByMethodInvocationType[methodInvocation];
        }

    },

    _stringifyCollectionOperator: function(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix, operator, operatorForId) {
        var chain = "",
            value, propertyName, rawProperty, escapedRawProperty, escapedValue, condition,
            i, countI, args,
            dataMapping = dataMappings[dataMappings.length-1],
            objectDescriptor = dataMapping.objectDescriptor,
            tableName = dataService.tableForObjectDescriptor(objectDescriptor),
            propertyDescriptor, propertyValueDescriptor;

            //chain = "(";

        args = syntax.args;

        if(args[0].type === "parameters") {
            if(args[1].type === "property") {
                propertyName = args[1].args[1].value;
                propertyDescriptor = objectDescriptor ? objectDescriptor.propertyDescriptorForName(propertyName) : null;
                propertyValueDescriptor = propertyDescriptor ? propertyDescriptor._valueDescriptorReference : null;

                if((propertyName === "id" || (propertyDescriptor && propertyDescriptor.cardinality === 1)) && Array.isArray(scope)) {
                    //propertyName = `ARRAY[${propertyName}]`;
                    propertyName = `ARRAY[${escapeIdentifier(tableName)}.${escapeIdentifier(propertyName)}]`;
                }
            }
            else {
                throw new Error("pgstringify.js: unhandled syntax in has functionStringifiers syntax: "+JSON.stringify(syntax)+"objectDescriptor: "+dataMapping.objectDescriptor.name);
            }
            value = scope;
            escapedValue = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);

        } else if(args[0].type === "property") {
            propertyName = args[0].args[1].value;
            propertyDescriptor = objectDescriptor.propertyDescriptorForName(propertyName);
            propertyValueDescriptor = propertyDescriptor ? propertyDescriptor._valueDescriptorReference : null;

            if(!propertyDescriptor) {
                //Might be a rawDataProeprty already, we check:
                var rawDataMappingRule = dataMapping.rawDataMappingRuleForPropertyName(propertyName);

                if(rawDataMappingRule) {
                    propertyDescriptor = objectDescriptor.propertyDescriptorForName(rawDataMappingRule.sourcePath);
                    propertyValueDescriptor = propertyDescriptor ? propertyDescriptor._valueDescriptorReference : null;
                }
            }

            if(args[0].type === "parameters") {
                value = scope;
                rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
                escapedValue = dataService.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(propertyDescriptor, value, rawProperty, "list");
            }
            else if(args[1].type === "parameters") {
                value = scope;
                if(!Array.isArray(value)) {
                    value = [value];
                }
                rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
                escapedValue = dataService.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(propertyDescriptor, value, rawProperty);
            } else if(args[1].type === "property" && args[1].args[0].type === "parameters") {
                var parametersKey = args[1].args[1].value;
                value = scope[parametersKey];

                if((propertyValueDescriptor && propertyValueDescriptor.name !== "Range") && !Array.isArray(value)) {
                    value = [value];
                }

                rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
                escapedValue = dataService.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(propertyDescriptor, value, rawProperty);
            } else if(args[1].type === "property" && args[0].args[0].type === "parameters") {
                propertyName = args[1].args[1].value;
                var parametersKey = args[0].args[1].value;
                value = scope[parametersKey];
                propertyDescriptor = objectDescriptor ? objectDescriptor.propertyDescriptorForName(propertyName) : null;
                propertyValueDescriptor = propertyDescriptor ? propertyDescriptor._valueDescriptorReference : null;

                if((propertyName === "id" || (propertyDescriptor && propertyDescriptor.cardinality === 1)) && Array.isArray(value)) {
                    // propertyName = `ARRAY[${propertyName}]`;
                    propertyName = `ARRAY[${escapeIdentifier(tableName)}.${escapeIdentifier(propertyName)}]`;

                }
                escapedValue = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
            }

        } else if(args[0].type === "value") {

            propertyName = args[1].args[1].value;
            propertyDescriptor = objectDescriptor.propertyDescriptorForName(propertyName);
            propertyValueDescriptor = propertyDescriptor ? propertyDescriptor._valueDescriptorReference : null;

            value = scope;
            if(!Array.isArray(value)) {
                value = [value];
            }

            if((propertyName === "id" || (propertyDescriptor && propertyDescriptor.cardinality === 1)) && Array.isArray(scope)) {
                //propertyName = `ARRAY[${propertyName}]`;
                propertyName = `ARRAY[${escapeIdentifier(tableName)}.${escapeIdentifier(propertyName)}]`;
                escapedValue = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
            } else {
                rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
                escapedValue = dataService.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(propertyDescriptor, value, rawProperty);
            }
        } else {
            throw new Error("phront-service.js: unhandled syntax in mapCriteriaToRawStatement(criteria: "+JSON.stringify(criteria)+"objectDescriptor: "+mapping.objectDescriptor.name);
        }
        // rawProperty = mapping.mapObjectPropertyNameToRawPropertyName(propertyName);
        //escapedRawProperty = escapeIdentifier(rawProperty);

        // if(rawProperty === "id")  {
        //     //<@ should work here as well as in:
        //     //SELECT * FROM phront."Event" where '2020-04-09 12:38:00+00'::TIMESTAMPTZ <@ "timeRange"  ;
        //     //condition = `${escapedRawProperty} ${operatorForId} ${escapedValue}`
        //     condition = `${operatorForId} ${escapedValue}`
        // } else {
            //condition = `${escapedRawProperty} ${operator} ${escapedValue}`
            condition = `${operator} ${escapedValue}`
       // }


        chain += condition;
/*
        for(i=1, countI = args.length;i<countI;i++) {
            chain += i > 1 ? ", " : "";
            chain += dataService.stringifyChild(args[i],scope, dataMapping);
        }
*/
        //commenting out parenthesis here as it's too ealy to know if we need some here. Could create regression with has()
        //chain += ")";
        return chain;
    },


    functionStringifiers: {
        has: function( syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {

            return dataService._stringifyCollectionOperator(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix, "@>", "in");

            /*
                The (first) implementation bellow ends up inversing array parameter on the left and property on the right
                but it doesn't play well with the rest of the chaining as the part before "has(..)" is added by another
                part of the code.

                If for some (performance?) reason we needed to revert to that, we'd have to single it out more so it stand on it's own for dealing with both left and right.
            */
//             var chain,
//                 value, propertyName, rawProperty, escapedRawProperty, escapedValue, condition,
//                 i, countI, args,
//                 dataMapping = dataMappings[dataMappings.length-1];

//             chain = "(";

//             args = syntax.args;

//             if(args[0].type === "parameters") {
//                 if(args[1].type === "property") {
//                     propertyName = args[1].args[1].value;
//                 }
//                 else {
//                     throw new Error("pgstringify.js: unhandled syntax in has functionStringifiers syntax: "+JSON.stringify(syntax)+"objectDescriptor: "+dataMapping.objectDescriptor.name);
//                 }
//                 value = scope;
//                 rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
//                 escapedValue = dataService.mapPropertyDescriptorValueToRawTypeExpression(rawProperty,value,"list");

//             } else if(args[0].type === "property") {
//                 propertyName = args[0].args[1].value;

//                 if(args[0].type === "parameters") {
//                     value = scope;
//                     rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
//                     escapedValue = dataService.mapPropertyDescriptorValueToRawTypeExpression(rawProperty,value,"list");
//                 }
//                 else if(args[1].type === "parameters") {
//                     value = scope;
//                     if(!Array.isArray(value)) {
//                         value = [value];
//                     }
//                     rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
//                     escapedValue = dataService.mapPropertyDescriptorValueToRawTypeExpression(rawProperty,value);
//                 } else if(args[1].type === "property" && args[1].args[0].type === "parameters") {
//                     var parametersKey = args[1].args[1].value;
//                     value = scope[parametersKey];
//                     if(!Array.isArray(value)) {
//                         value = [value];
//                     }
//                     rawProperty = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName);
//                     escapedValue = dataService.mapPropertyDescriptorValueToRawTypeExpression(rawProperty,value);
//                 }

//             } else {
//                 throw new Error("phron-service.js: unhandled syntax in mapCriteriaToRawStatement(criteria: "+JSON.stringify(criteria)+"objectDescriptor: "+mapping.objectDescriptor.name);
//             }
//             // rawProperty = mapping.mapObjectPropertyNameToRawPropertyName(propertyName);
//             escapedRawProperty = escapeIdentifier(rawProperty);

//             if(rawProperty === "id")  {
//                 //<@ should work here as well as in:
//                 //SELECT * FROM phront."Event" where '2020-04-09 12:38:00+00'::TIMESTAMPTZ <@ "timeRange"  ;
//                 condition = `${escapedRawProperty} in ${escapedValue}`;
//             } else {
//                 condition = `${escapedRawProperty} @> ${escapedValue}`;
//             }


//             chain += condition;
// /*
//             for(i=1, countI = args.length;i<countI;i++) {
//                 chain += i > 1 ? ", " : "";
//                 chain += dataService.stringifyChild(args[i],scope, dataMapping);
//             }
// */
//             chain += ")";
//             return chain;
        },
        overlaps: function _overlaps(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return dataService._stringifyCollectionOperator(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix, "&&", "<@");
        },
        intersects: function _intersects(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return dataService._stringifyCollectionOperator(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix, "@>", "<@");
        }

    },

    stringifiers: {

        value: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            //return '';
            return dataService.mapPropertyDescriptorValueToRawValue(undefined,scope && (scope.value || scope));
        },

        literal: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            //New to replace a case in _propertyName
            if(parent.type === "property") {
                //console.log("literal: parent.type === 'property': "+syntax.value);
                return dataService.stringifiers._propertyName(syntax.value, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);

                var lastDataMappingIndex = dataMappings.length-1,
                    dataMapping = dataMappings[lastDataMappingIndex],
                    objectDescriptor = dataMapping.objectDescriptor,
                    tableName = dataMappings.aliases && (tableName = dataMappings.aliases[lastDataMappingIndex])
                    ? tableName
                    : dataService.tableForObjectDescriptor(objectDescriptor);

                return `${escapeIdentifier(tableName)}.${escapeIdentifier(syntax.value)}`;
            }
            else if (typeof syntax.value === 'string') {
                return "'" + syntax.value.replace("'", "\\'") + "'";
            } else {
                return "" + syntax.value;
            }
        },

        parameters: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return dataService.mapPropertyDescriptorValueToRawValue(undefined, scope && (scope.parameters || scope));
            //return typeof scope === "string" ? dataService.mapPropertyDescriptorValueToRawValue(undefined,scope) : '$';
        },

        record: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return "{" + Object.map(syntax.args, function (value, key) {
                var string;
                if (value.type === "value") {
                    string = "this";
                } else {
                    string = dataService.stringify(value, scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
                }
                return key + ": " + string;
            }).join(", ") + "}";
        },

        tuple: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return "[" + Object.map(syntax.args, function (value) {
                if (value.type === "value") {
                    return "this";
                } else {
                    return dataService.stringify(value, scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
                }
            }).join(", ") + "]";
        },

        component: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            var label;
            if (scope && scope.components && syntax.component) {
                if (scope.components.getObjectLabel) {
                    label = scope.components.getObjectLabel(syntax.component);
                } else if (scope.components.getLabelForObject) {
                    // I am hoping that we will change Montage to use this API
                    // for consistency with document.getElementById,
                    // components.getObjectByLabel, & al
                    label = scope.components.getLabelForObject(syntax.component);
                }
            } else {
                label = syntax.label;
            }
            return '@' + label;
        },

        element: function (syntax) {
            return '#' + syntax.id;
        },

        mapBlock: makeBlockStringifier("map"),
        filterBlock: makeBlockStringifier("filter"),
        someBlock: makeBlockStringifier("some"),
        everyBlock: makeBlockStringifier("every"),
        sortedBlock: makeBlockStringifier("sorted"),
        sortedSetBlock: makeBlockStringifier("sortedSet"),
        groupBlock: makeBlockStringifier("group"),
        groupMapBlock: makeBlockStringifier("groupMap"),
        minBlock: makeBlockStringifier("min"),
        maxBlock: makeBlockStringifier("max"),

        inlineCriteriaParameters: true,


        /**
         * Transforms a concat statement to it's SQL part. The point is to "merge" to arrays.
         * Our first implementation needs to support it in the context of this expression:
         *
         * "services.concat(parent.services).filter{variants.filter{serviceEngagements.filter{originId == $.serviceEngagementOriginId}}}"
         * combined with another into:
         * id == $parameter1 && services.concat(parent.services).filter{variants.filter{serviceEngagements.filter{originId == $serviceEngagementOriginId}}}
         *
         * 1. A first approach removes the second join between organization for parents, since both ends up joining servies, which becomes equivalent to do:
         *
         *          SELECT *
         *          FROM phront."Organization"
         *  >>>>>   JOIN "phront"."Service" ON ("Organization".id = "Service"."vendorId" or "Organization".parent = "Service"."vendorId")
         *          JOIN "phront"."ServiceProductVariant" ON "ServiceProductVariant".id = ANY ("Service"."variantIds")
         *          JOIN "phront"."ServiceEngagement" ON "ServiceProductVariant".id = "ServiceEngagement"."serviceVariantId"
         *          WHERE ("Organization"."id" = 'f643fca5-f539-4335-98d1-17f42b354234' AND ("ServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4'))
         *
         *      This is an optimization. The current logic would create a join for parent, like:
         *      JOIN "phront"."Organization" "parentOrganization" ON ("parentOrganization".id = "Organization"."parent")
         *
         *      but this doesn't work in all cases becauses it reduces the rows too much before we get to the condition in where for id == $parameter1,
         *      unless we use a left outer join:
         *
         *          LEFT JOIN "phront"."Organization" "parentOrganization" ON ("parentOrganization".id = "Organization"."parent")
         *
         *      which we can only know that after the fact, after all is processed as individual branches don't have access to ther whole tree.
         *      We could change that but should we? Should node type stringifier should account what's above? Doesn't feels right. The parent could pass a hint?
         *
         * 2. A second approach keeps it, but the left join is still needed:
         *
         *      This one doesn't need a second pass, if we're able to determine locally that a left join is needed. Is the presence of an alias one?
         *      An OR might require one as well.
         *
         *          SELECT *
         *          FROM phront."Organization"
         *          LEFT JOIN "phront"."Organization" "parentOrganization" ON ("parentOrganization".id = "Organization"."parent")
         *          JOIN "phront"."Service" ON ("Organization".id = "Service"."vendorId" or "parentOrganization".id = "Service"."vendorId")
         *          JOIN "phront"."ServiceProductVariant" ON "ServiceProductVariant".id = ANY ("Service"."variantIds")
         *          JOIN "phront"."ServiceEngagement" ON "ServiceProductVariant".id = "ServiceEngagement"."serviceVariantId"
         *          WHERE ("Organization"."id" = 'f643fca5-f539-4335-98d1-17f42b354234' AND ("ServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4'))
         *
         * 3. A third approach is to bring a condition on a property used as a join in the join itself rather than doing it in the where. This means no LEFT JOIN is needed
         *      It would look like this:
         *
         *          SELECT distinct (
	     *               SELECT to_jsonb(_)
         *               FROM (
         *                   SELECT "Organization"."id","Organization"."publicationDate","Organization"."modificationDate",
         *                          "Organization"."creationDate","Organization"."originId",
         *                          "Organization"."imageIds","Organization"."socialProfileIds","Organization"."urlAddresses",
         *                          "Organization"."existenceTimeRange", "Organization"."userPoolIds","Organization"."customerEngagementQuestionnaireIds",
         *                          "Organization"."mainContactId","Organization"."tags", "Organization"."suborganizations","Organization"."parent",
         *                          "Organization"."type","Organization"."name"
         *                ) as _
         *            )
         *
         *          FROM phront."Organization"
         *
         *          JOIN "phront"."Organization" "parentOrganization" ON (
         *              "parentOrganization".id = "Organization"."parent"
         *              or
         *              "Organization"."id" = '19a4daba-199b-4566-8fe2-29722af69a00'
         *          )
         *          JOIN "phront"."Service" ON (
         *              "Organization".id = "Service"."vendorId"
         *              or
         *              "parentOrganization".id = "Service"."vendorId")
         *          JOIN "phront"."ServiceProductVariant" ON "ServiceProductVariant".id = ANY ("Service"."variantIds")
         *          JOIN "phront"."ServiceEngagement" ON "ServiceProductVariant".id = "ServiceEngagement"."serviceVariantId"
         *
         *          WHERE (
         *              "Organization"."id" = '19a4daba-199b-4566-8fe2-29722af69a00' //----> this is redundant and should be removed
         *              AND
         *              ("ServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4')
         *          )
         *
         * @type {number}
         */

        concat: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            console.log("concat syntax:",syntax);

        },
        _propertyName: function (propertyName, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {

            var lastDataMappingIndex = dataMappings.length-1,
                dataMapping = dataMappings[lastDataMappingIndex],
                objectDescriptor = dataMapping.objectDescriptor,
                schemaName = dataService.connection.schema,
                tableName = dataService.tableForObjectDescriptor(objectDescriptor),
                leftDataSetAlias = dataMappings.aliases && (leftDataSetAlias = dataMappings.aliases[lastDataMappingIndex])
                ? leftDataSetAlias
                : tableName,
                rawPropertyValue = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName),
                // rule = dataMapping.rawDataMappingRuleForPropertyName(rawPropertyValue),
                objectRule = dataMapping.objectMappingRuleForPropertyName(propertyName),
                propertyDescriptor = objectDescriptor.propertyDescriptorForName(propertyName),
                isLocalizable = propertyDescriptor && propertyDescriptor.isLocalizable,
                //For backward compatibility, propertyDescriptor.valueDescriptor still returns a Promise....
                //propertyValueDescriptor = propertyDescriptor.valueDescriptor;
                //So until we fix this, tap into the private instance variable that contains what we want:
                propertyDescriptorValueDescriptor = propertyDescriptor ? propertyDescriptor._valueDescriptorReference : null,
                propertyDescriptorValueDescriptorAlias,
                language, region,
                //propertyDescriptorValueDescriptor = propertyDescriptor.valueDescriptor,
                resultJoinString,
                resultJoin,
                joinConditionLeftSide,
                joinCondition,
                joinType = SQLJoinType.Join,
                result;

            if(!propertyDescriptor && !objectRule && !dataMapping.rawDataMappingRuleForPropertyName(propertyName) && !dataMapping.isPrimaryKeyComponent(propertyName)) {
                throw "Can't stringify Unknown property `"+propertyName+"', no propertyDescriptor nor objectMappingRules found for objectDescriptor '"+objectDescriptor.name+"' in expression qualifying '"+dataMappings[0].objectDescriptor.name+"'";
            }

            if(locales) {
                language = locales[0].language;
                region = locales[0].region;
            } else if(isLocalizable) {
                //Use at least a default to be correct
                language = "en";
                region = "*";
            }

            //ToMany
            //if(propertyDescriptor && propertyDescriptor.cardinality > 1) {
            if(propertyDescriptor && propertyDescriptorValueDescriptor) {

 /*
                    TOTDO: handle polymorphic association joins:

                    var objectRuleConverter = objectRule && objectRule.converter,
                    objectRuleConverterForeignDescriptorMappings = objectRuleConverter && objectRuleConverter.foreignDescriptorMappings;

                    if(objectRuleConverterForeignDescriptorMappings && objectRule.sourcePath === "this") {

                        //Put all columns hosting the foreign keys (exclusive belongs-to approach) to all possible destinations in result
                        for(j=0, countJ = objectRuleConverterForeignDescriptorMappings.length;(j<countJ);j++) {
                            result.add(objectRuleConverter.rawDataPropertyForForeignDescriptor(objectRuleConverterForeignDescriptorMappings[j].type));
                        }

                    }

                    We basically need to build all the joins for all possible destinations.

                    However, if there's a property name down the expression that only belongs to one of the types only, we could narrow down the field for that. Is _propertyName methof the right place to do that? Or should it be done in property?

                */

                /*
                    If the property is a relationship to the same object descriptor, we need to alias in SQL.
                    Instead of using numbers and keep track of what number maps to what relationship,
                    we're going to bake the semantic in the name, which hopefully works out for many cases,
                    until we run into one where a new alias would be needed, but we'll cross that bridge
                    when we have to
                */
                if(propertyDescriptorValueDescriptor === objectDescriptor) {
                    joinType = SQLJoinType.LeftJoin;
                    if(currentAliasPrefix) {
                        propertyDescriptorValueDescriptorAlias = `${currentAliasPrefix}_${rawPropertyValue}${tableName}`;
                    } else {
                        propertyDescriptorValueDescriptorAlias = `${propertyName}_${rawPropertyValue}_${tableName}`;
                    }
                }
                // else if(currentAliasPrefix) {
                //     propertyDescriptorValueDescriptorAlias = `${currentAliasPrefix}_${tableName}`;
                // }

                //propertyDescriptorValueDescriptor = propertyDescriptor._valueDescriptorReference;

                /*
                    Create the SQLJoin and set shared properties
                */


                resultJoin = new SQLJoin();
                resultJoin.leftDataSetSchema = schemaName;
                resultJoin.leftDataSet = tableName;
                resultJoin.leftDataSetObjecDescriptor = objectDescriptor;
                resultJoin.leftDataSetAlias = leftDataSetAlias;
                resultJoin.rightDataSet = propertyDescriptorValueDescriptor.name;
                /*
                    needs rightDataSetObjecDescriptor later, would be better to just put propertyDescriptorValueDescriptor in rightDataSet and get the name,
                    but in SQL, a dataSet could be a full statement, for which we don't have an object model, yet...
                */
                resultJoin.rightDataSetObjecDescriptor = propertyDescriptorValueDescriptor;
                resultJoin.rightDataSetAlias = propertyDescriptorValueDescriptorAlias;
                resultJoin.rightDataSetSchema = schemaName;
                resultJoin.type = joinType;

                /*
                    This is the case where the table hosts the array of ids
                    We don't support (we haven't ran into) the case where we'd join from a foreignKey in a table to an array of values on the other side. To do so we might have to introduce
                    a formal relational mapping vs leveraging/abusing the exression data mapping as w've been doing so far.
                */
                if(objectRule.sourcePath !== "id") {

                    /*
                        If dataMappings.length === 1, we're evaluating a column on the "root" table
                        or if we're the end of a path.

                        But if we're entering a block we need to do a join.
                    */
                    // if(
                    //     (dataMappings.length === 1 && !propertyDescriptorValueDescriptor) ||
                    //     (parent.type !== "scope" && !parent.type.endsWith("Block"))
                    // ) {
                    //     result = `${escapeIdentifier(tableName)}.${escapeIdentifier(rawPropertyValue)}`;
                    // } else {

                    /*
                        We're trying to transform Service's vendors into something like:

                        //test query:
                        SELECT * FROM "Service" JOIN "Organization"
                        ON "Organization".id = ANY ("Service"."vendorIds")
                        where "Organization".name = 'SISTRA';

                        The following is working for this case.
                    */
                        if(locales && isLocalizable) {
                            //    JOIN "tableName" ON "tableName"."columnName"->>'jsonbKey' = text(res.id) ;
                            //    JOIN "tableName" ON "tableName"."columnName"->>'jsonbKey'::uuid = "otherTable".id ;
                            //join_type JOIN table_name2 ON (join_condition)
                        /*
                            return `COALESCE("${tableName}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${tableName}".${rawPropertyValue}::jsonb #>> '{${language},*}')`;
                        */

                            if(propertyDescriptor.cardinality > 1) {


                                result = joinConditionLeftSide = `ANY (COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}'))`;
                                joinCondition = `"${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".id = ${joinConditionLeftSide}`;


                                /*
                                    Previous string based implementation, the LEFT JOIN here was added as an attempt to handle a JOIN with an OR node that wouldn't work without. With the new SQLJoin object, the OR can do that himself if needed now if we don't have a local reason to do so here.
                                */
                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${propertyDescriptorValueDescriptorAlias}".id = ${joinConditionLeftSide}`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${propertyDescriptorValueDescriptor.name}".id = ${joinConditionLeftSide}`;
                                // console.log("resultJoinString: ",resultJoinString);

                            } else {

                                result = joinConditionLeftSide = `COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}')`;
                                joinCondition = `"${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".id = ${joinConditionLeftSide}`;

                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${propertyDescriptorValueDescriptorAlias}".id = COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}')`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${leftDataSetAlias}".id = COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}')`;

                                // console.log("resultJoinString: ",resultJoinString);

                            }

                            //resultJoin.onConditions.add(joinCondition);
                            resultJoin.onCondition = joinCondition;


                        } else {
                            if(propertyDescriptor.cardinality > 1) {

                                result = joinConditionLeftSide = `ANY ("${leftDataSetAlias}"."${rawPropertyValue}")`;
                                joinCondition = `"${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".id = ${joinConditionLeftSide}`;

                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${propertyDescriptorValueDescriptorAlias}".id = ANY ("${leftDataSetAlias}"."${rawPropertyValue}")`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${propertyDescriptorValueDescriptor.name}".id = ANY ("${leftDataSetAlias}"."${rawPropertyValue}")`;

                                //console.log("resultJoinString: ",resultJoinString);

                            } else {

                                result = joinConditionLeftSide = `"${leftDataSetAlias}"."${rawPropertyValue}"`;
                                joinCondition = `"${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".id = ${joinConditionLeftSide}`;

                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${propertyDescriptorValueDescriptorAlias}".id = "${leftDataSetAlias}"."${rawPropertyValue}"`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${propertyDescriptorValueDescriptor.name}".id = "${leftDataSetAlias}"."${rawPropertyValue}"`;

                                //console.log("resultJoinString: ",resultJoinString);


                            }

                            //resultJoin.onConditions.add(joinCondition);
                            resultJoin.onCondition = joinCondition;

                        }

                        rawExpressionJoinStatements.add(resultJoin);
                        dataMappings.push(dataService.mappingForType(propertyDescriptorValueDescriptor));

                        if(propertyDescriptorValueDescriptorAlias) {
                            dataMappings.aliases[dataMappings.length-1] = propertyDescriptorValueDescriptorAlias;
                        }

                        //result = "";
                    //}

                    return result;
                }
                //This is the case where we use the object's id to be found in the uuid[] on the other side
                //So we should always join.
                else {

                                        //If dataMappings.length === 1, we're evaluating a column on the "root" table
                    //or if we're the end of a path
                    // if (parent.type !== "scope" && !parent.type.endsWith("Block")) {
                    //     result = `${escapeIdentifier(tableName)}.${escapeIdentifier(rawPropertyValue)}`;
                    // } else {

                        var converterSyntax = objectRule.converter.convertSyntax,
                            syntaxProperty = converterSyntax.args[0].type === 'property'
                                ? converterSyntax.args[0]
                                : converterSyntax.args[1],
                            inversePropertyDescriptor = propertyDescriptor._inversePropertyDescriptor;

                            rawPropertyValue = syntaxProperty.args[1].type === 'literal'
                                ? syntaxProperty.args[1].value
                                : syntaxProperty.args[0].value;

                        // if(converterSyntax.type !== "equals") {
                        //     console.warn("Creaating a join where rule.reverter syntax operator isn't 'equals' but '"+converterSyntax.type+"'");
                        // }

                        if(locales && isLocalizable) {
                            if(inversePropertyDescriptor.cardinality > 1) {

                                result = joinConditionLeftSide = `ANY (COALESCE("${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".${rawPropertyValue}::jsonb #>> '{${language},*}'))`;
                                joinCondition = `"${resultJoin.leftDataSetAlias}".id = ${joinConditionLeftSide}`;

                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${leftDataSetAlias}".id = ANY (COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}'))`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${leftDataSetAlias}".id = ANY (COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}'))`;

                                // console.log("resultJoinString: ",resultJoinString);

                            } else {

                                result = joinConditionLeftSide = `COALESCE("${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}".${rawPropertyValue}::jsonb #>> '{${language},*}')`;
                                joinCondition = `"${resultJoin.leftDataSetAlias}".id = ${joinConditionLeftSide}`;

                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${leftDataSetAlias}".id = COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}')`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${leftDataSetAlias}".id = COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}')`;

                                // console.log("resultJoinString: ",resultJoinString);

                            }

                            //resultJoin.onConditions.add(joinCondition);
                            resultJoin.onCondition = joinCondition;

                        } else {
                            if((converterSyntax && converterSyntax.type === "has") || (inversePropertyDescriptor && inversePropertyDescriptor.cardinality > 1)) {

                                result = joinConditionLeftSide = `ANY ("${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}"."${rawPropertyValue}")`;
                                joinCondition = `"${resultJoin.leftDataSetAlias}".id = ${joinConditionLeftSide}`;


                            //if(converterSyntax && converterSyntax.type === "has") {
                            // if(inversePropertyDescriptor && inversePropertyDescriptor.cardinality > 1) {
                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${leftDataSetAlias}".id = ANY ("${propertyDescriptorValueDescriptorAlias}"."${rawPropertyValue}")`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${leftDataSetAlias}".id = ANY ("${propertyDescriptorValueDescriptor.name}"."${rawPropertyValue}")`;

                                //console.log("resultJoinString: ",resultJoinString);

                            } else {

                                result = joinConditionLeftSide = `"${resultJoin.rightDataSetAlias ? propertyDescriptorValueDescriptorAlias : resultJoin.rightDataSet}"."${rawPropertyValue}"`;
                                joinCondition = `"${resultJoin.leftDataSetAlias}".id = ${joinConditionLeftSide}`;

                                // resultJoinString = propertyDescriptorValueDescriptorAlias
                                //     ? `LEFT JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" "${propertyDescriptorValueDescriptorAlias}" ON "${leftDataSetAlias}".id = "${propertyDescriptorValueDescriptorAlias}"."${rawPropertyValue}"`
                                //     : `JOIN "${schemaName}"."${propertyDescriptorValueDescriptor.name}" ON "${leftDataSetAlias}".id = "${propertyDescriptorValueDescriptor.name}"."${rawPropertyValue}"`;

                                //console.log("resultJoinString: ",resultJoinString);

                            }

                            //resultJoin.onConditions.add(joinCondition);
                            resultJoin.onCondition = joinCondition;

                        }

                        rawExpressionJoinStatements.add(resultJoin);

                        dataMappings.push(dataService.mappingForType(propertyDescriptorValueDescriptor));

                        if(propertyDescriptorValueDescriptorAlias) {
                            dataMappings.aliases[dataMappings.length-1] = propertyDescriptorValueDescriptorAlias;
                        }

                        //result = "";

                    //}

                    return result;
                }

                // dataMappings.push(dataService.mappingForType(propertyDescriptorValueDescriptor));
                // return result;

            } else {
                if(locales && isLocalizable) {
                    /*
                        A criteria like name = "aName", can only really be meaningful for 1 locale, so we take the first.
                        Later on we'll add a fullTextSearch operator that will be able to use an index that contains all languages' values.
                    */

                    rawPropertyValue = escapeIdentifier(rawPropertyValue);

                    if(region && region !== "") {
                        return `COALESCE("${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},${region}}', "${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}')`;
                    } else {
                        return `"${leftDataSetAlias}".${rawPropertyValue}::jsonb #>> '{${language},*}'`;
                    }


                } else {
                    if(propertyDescriptorValueDescriptor) {
                        console.warn("shouldn't be here - DEBUG ME");
                        dataMappings.push(dataService.mappingForType(propertyDescriptorValueDescriptor));

                        if(propertyDescriptorValueDescriptorAlias) {
                            dataMappings.aliases[dataMappings.length-1] = propertyDescriptorValueDescriptorAlias;
                        }

                        return `"${leftDataSetAlias}".${escapeIdentifier(rawPropertyValue)}`
                    } else {
                        return `${escapeIdentifier(leftDataSetAlias)}.${escapeIdentifier(rawPropertyValue)}`;
                        //return `"${leftDataSetAlias}".${escapeIdentifier(rawPropertyValue)}`
                        //return escapeIdentifier(dataMapping.mapObjectPropertyNameToRawPropertyName(propertyName));
                    }
                }
            }

        },

        property: function _property(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            var dataMappingStartLength = dataMappings.length,
                dataMapping = dataMappings[dataMappingStartLength-1],
                objectDescriptor = dataMapping.objectDescriptor,
                propertyName,
                propertyDescriptor,
                syntaxArg0,
                _propertyNameStringifier = _property._propertyName || (_property._propertyName = dataService.stringifiers._propertyName);

            if ((syntaxArg0 = syntax.args[0]).type === "value") {
                if (typeof syntax.args[1].value === "string") {
                    var rawExpressionJoinStatementsSize = rawExpressionJoinStatements ? rawExpressionJoinStatements.size : 0,
                        result =  _propertyNameStringifier(syntax.args[1].value, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements/*, objectDescriptor*/, currentAliasPrefix);

                    /*
                        If parent is a property node and we added a join, we shouldn't need a statement in the where clause.
                    */
                    if(!parent || (parent && !parent.type.endsWith("Block") && (parent.type !== "property" || (parent.type === "property" && rawExpressionJoinStatementsSize == rawExpressionJoinStatements.size)))) {
                        return result;
                    } else {
                        return "";
                    }

                    // var propertyValue = syntax.args[1].value,
                    //     objectDescriptor = dataMapping.objectDescriptor,
                    //     rawPropertyValue = dataMapping.mapObjectPropertyNameToRawPropertyName(propertyValue),
                    //     rule = dataMapping.rawDataMappingRuleForPropertyName(rawPropertyValue),
                    //     propertyDescriptor = objectDescriptor.propertyDescriptorForName(propertyValue),
                    //     //For backward compatibility, propertyDescriptor.valueDescriptor still returns a Promise....
                    //     //propertyValueDescriptor = propertyDescriptor.valueDescriptor;
                    //     //So until we fix this, tap into the private instance variable that contains what we want:
                    //     propertyDescriptorValueDescriptor = propertyDescriptor._valueDescriptorReference,
                    //     //propertyDescriptorValueDescriptor = propertyDescriptor.valueDescriptor,
                    //     result;

                    // //ToMany
                    // if(propertyDescriptor.cardinality > 1) {

                    //     //This is the case where the table hosts the array of ids

                    //     if(rule.targetPath !== "id") {
                    //     /*
                    //         We're trying to transform Service's vendors into something like:

                    //         //test query:
                    //         SELECT * FROM "Service" JOIN "Organization"
                    //         ON "Organization".id = ANY ("Service"."vendorIds")
                    //         where "Organization".name = 'SISTRA';
                    //     */

                    //         result = `JOIN "${propertyDescriptorValueDescriptor.name}" ON "${propertyDescriptorValueDescriptor.name}".id = ANY ("${objectDescriptor.name}"."${rawPropertyValue}")`;
                    //         dataMappings.push(dataService.mappingForType(propertyDescriptorValueDescriptor));
                    //         return result;
                    //     }
                    //     //This is the case where we use the object's id to be found in the uuid[] on the other side
                    //     else {

                    //     }
                    // } else {
                    //     return escapeIdentifier(dataMapping.mapObjectPropertyNameToRawPropertyName(syntax.args[1].value));
                    // }

                }
                /*
                    ?
                    String literals take the form of any characters between single quotes. Any character can be escaped with a back slash.
                    Number literals are digits with an optional mantissa.
                */
                else if (syntax.args[1].type === "literal") {
                    //It likely that "." needs to be transformed into a "and"
                    return "." + syntax.args[1].value;
                } else {
                    return "this[" + dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + "]";
                }
            } else if (syntaxArg0.type === "parameters") {
                if(dataService.inlineCriteriaParameters) {
                    //We need to find the type of the property to know how to format the value
                    var parameterName = syntax.args[1].value,
                        parameterValue = scope[parameterName],
                        propertyValueSyntax = parent.args[0],
                        objectRule,
                        propertyDescriptor,
                        type,
                        escapedValue;

                    propertyName = propertyValueSyntax.args[1].value;
                    objectRule = dataMapping.objectMappingRuleForPropertyName(propertyName);


                    if(objectRule) {
                        propertyDescriptor = objectRule.propertyDescriptor;
                    }
                    escapedValue = dataService.mapPropertyDescriptorValueToRawValue(propertyDescriptor, parameterValue, parameterName, type);

                    return escapedValue;
                } else {
                    return ":" + syntax.args[1].value;
                }
            } else if(syntaxArg0.type === "property") {
                var arg0Result =  dataService.stringify(syntaxArg0, scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix),
                    rawExpressionJoinStatementsSize = rawExpressionJoinStatements ? rawExpressionJoinStatements.size : 0,
                    arg1Result =  dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

                //console.log("arg0Result: ",arg0Result," arg1Result:",arg1Result);


                // dataMappings.splice(dataMappingStartLength);
                // if(dataMappings.aliases) {
                //     dataMappings.aliases.splice(dataMappingStartLength);
                // }

                /*
                    If parent is a block node and we added a join, we shouldn't need a statement in the where clause.
                */
                if(parent.type.endsWith("Block") && rawExpressionJoinStatementsSize < rawExpressionJoinStatements.size) {
                    return "";
                } else {
                    return arg1Result;
                }
            }

            else if (
                syntax.args[1].type === "literal" &&
                /^[\w\d_]+$/.test(syntax.args[1].value)
            ) {

                /*
                    Where there are chained properies, the deapest one in the proeprty sub-tree is actually the first in the expresssion-form chain.
                */

                //When processing "vendors.name == $.name", we end up here for "name"
                //and then call dataService.stringify(..) that handles "vendors,
                //and it's concatenated wirh a "." again.
                //So this is likely where we should handle joins.
                var dataMappingsLength = dataMappings.length,
                    argZeroStringified,
                    argOneStringified,
                    lastDataMapping,
                    result;

                argZeroStringified =  dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, {
                    type: "scope"
                }, currentAliasPrefix);

                // argOneStringified =  _propertyNameStringifier(syntax.args[1].value, scope, {
                //     type: "scope"
                // }, dataService, dataMappings, locales, rawExpressionJoinStatements);
                /*
                    Changes to make multiple joins work. I think passing parent vs {type: "scope"} allows us to know in _propertyNameStringifier that that part is the end before an actual operator.
                */
                argOneStringified =  _propertyNameStringifier(syntax.args[1].value, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix);

                lastDataMapping = dataMappings[dataMappings.length - 1];


                /*
                    Here the behavior is different if we go from a property/relation in [0] that requires a join
                    to a property that is a column of the last table joined to. If 2 relations across tables follow
                    on the 2 slots, we need to just chain the join

                    otherwise, we need to add an "and". Right now we look at the produced syntax, which isn't great
                    and we might need to bring the processing of the 2 sides in one place where we'd generate both sides
                    and be in a better position looking at the model to make the right decision than looking at the striong result.
                */
                if(argZeroStringified.length && argOneStringified.length) {
                    if(argOneStringified.indexOf("JOIN") !== 0) {
                        result = `${argZeroStringified} AND ${argOneStringified}`;
                    } else {
                        result = `${argZeroStringified} ${argOneStringified}`;
                    }
                } else if(argZeroStringified.length) {
                    result = argZeroStringified;
                } else if(argOneStringified.length) {
                    result = argOneStringified;
                } else {
                    result = "";
                }

                //Needs to remove what nested property syntax may have added:
                if(dataMappings && parent && parent.type !== "scope") {
                    dataMappings.splice(dataMappingStartLength);
                    if(dataMappings.aliases) {
                        dataMappings.aliases.splice(dataMappingStartLength);
                    }
                }

                //return argZeroStringified + '.' + syntax.args[1].value;
                return result;
            } else {
                return dataService.stringify(syntax.args[0], {
                    type: "scope"
                }, dataMappings, locales, rawExpressionJoinStatements, scope, currentAliasPrefix) + '[' + dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + ']';
            }
        },

        "with": function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            var right = dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix, currentAliasPrefix);
            return dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + "." + right;
        },

        not: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            if (syntax.args[0].type === "equals") {
                /*
                    equals now takes care of looking at the parent to see if it's a not and do the rigth thing.

                    Otherwise we'd had to parse and do string substitution to fix it after the equals is generated.
                */
                return dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

                // var left = dataService.stringify(syntax.args[0].args[0], scope, dataMappings, locales, rawExpressionJoinStatements, {type: "equals"}, currentAliasPrefix),
                //     right = dataService.stringify(syntax.args[0].args[1], scope, dataMappings, locales, rawExpressionJoinStatements, {type: "equals"}, currentAliasPrefix);

                // if(right === "null") {
                //     return `${left} is not NULL`;
                // } else {
                //     return `${left} != ${right}`;
                // }

            } else {
                return '!' + dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix)
            }
        },

        neg: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return '-' + dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix)
        },

        toNumber: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return '+' + dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix)
        },

        /*
            handling parent might need LATERAL joins ?
        */

        parent: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return '^' + dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix)
        },

        if: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return (
                dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix) + " ? " +
                dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + " : " +
                dataService.stringify(syntax.args[2], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix)
            );
        },

        event: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return syntax.when + " " + syntax.event + " -> " + dataService.stringify(syntax.listener, scope, dataMappings, locales, rawExpressionJoinStatements,undefined, currentAliasPrefix);
        },

        binding: function (arrow, syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {

            var header = dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + " " + arrow + " " + dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
            var trailer = "";

            var descriptor = syntax.descriptor;
            if (descriptor) {
                for (var name in descriptor) {
                    trailer += ", " + name + ": " + dataService.stringify(descriptor[name], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
                }
            }

            return header + trailer;
        },

        bind: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return this.binding("<-", syntax, scope, dataService);
        },

        bind2: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return this.binding("<->", syntax, scope, dataService);
        },

        assign: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return dataService.stringify(syntax.args[0], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + ": " + dataService.stringify(syntax.args[1], scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
        },

        block: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            var header = "@" + syntax.label;
            if (syntax.connection) {
                if (syntax.connection === "prototype") {
                    header += " < ";
                } else if (syntax.connection === "object") {
                    header += " : ";
                }
                header += dataService.stringify({type: 'literal', value: syntax.module}, scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
                if (syntax.exports && syntax.exports.type !== "value") {
                    header += " " + dataService.stringify(syntax.exports, scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
                }
            }
            return header + " {\n" + syntax.statements.map(function (statement) {
                return "    " + dataService.stringify(statement, scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix) + ";\n";
            }).join("") + "}\n";
        },

        sheet: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {
            return "\n" + syntax.blocks.map(function (block) {
                return dataService.stringify(block, scope, dataMappings, locales, rawExpressionJoinStatements, undefined, currentAliasPrefix);
            }).join("\n") + "\n";
        },


        /*
            New kind to handle, an expression with shared similar expressions on left and right of the or, like:
            id == $parameter1
            &&
            (
                parent.services.filter{variants.filter{serviceEngagements.filter{originId == $serviceEngagementOriginId}}}
                ||
                services.filter{variants.filter{serviceEngagements.filter{originId == $serviceEngagementOriginId}}}
            )

            One way to handle is to alias both sides and use left joins:
                SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."publicationDate","Organization"."modificationDate","Organization"."creationDate","Organization"."originId","Organization"."imageIds","Organization"."socialProfileIds","Organization"."urlAddresses","Organization"."existenceTimeRange","Organization"."userPoolIds","Organization"."customerEngagementQuestionnaireIds","Organization"."mainContactId","Organization"."tags","Organization"."suborganizations","Organization"."parent","Organization"."type","Organization"."name") as _)

                FROM phront."Organization"

                LEFT JOIN "phront"."Organization" "parentOrganization" ON "parentOrganization".id = "Organization"."parent"
                LEFT JOIN "phront"."Service" "parentOrganizationService" ON "parentOrganization".id = "parentOrganizationService"."vendorId"
                LEFT JOIN "phront"."ServiceProductVariant" "parentOrganizationServiceProductVariant" ON "parentOrganizationServiceProductVariant".id = ANY ("parentOrganizationService"."variantIds")
                LEFT JOIN "phront"."ServiceEngagement" "parentOrganizationServiceEngagement" ON "parentOrganizationServiceProductVariant".id = "parentOrganizationServiceEngagement"."serviceVariantId"

                LEFT JOIN "phront"."Service" ON "Organization".id = "Service"."vendorId"
                LEFT JOIN "phront"."ServiceProductVariant" ON "ServiceProductVariant".id = ANY ("Service"."variantIds")
                LEFT JOIN "phront"."ServiceEngagement" ON "ServiceProductVariant".id = "ServiceEngagement"."serviceVariantId"

                WHERE (
                    "Organization"."id" = 'f643fca5-f539-4335-98d1-17f42b354234'
                    AND (
                        ("parentOrganizationServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4')
                        or
                        ("ServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4'))
                )


            Another is to just continue logically uniquing joins on fully formed equivalent, but detect when we have multiple conditions. To do so the OR could send his own new rawExpressionJoinStatements structure so it's clear after calling both left and rights side what joins came up directly from it's left and right.
            then if for a left-table to right table join there's an array with multiple conditions, then we combine them with the current operator, here the or.
            In the following, because

            SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."publicationDate","Organization"."modificationDate","Organization"."creationDate","Organization"."originId","Organization"."imageIds","Organization"."socialProfileIds","Organization"."urlAddresses","Organization"."existenceTimeRange","Organization"."userPoolIds","Organization"."customerEngagementQuestionnaireIds","Organization"."mainContactId","Organization"."tags","Organization"."suborganizations","Organization"."parent","Organization"."type","Organization"."name") as _)

            FROM phront."Organization"

            [LEFT] JOIN "phront"."Organization" "parentOrganization" ON "parentOrganization".id = "Organization"."parent" << left join not needed anymore in this case
            JOIN "phront"."Service" ON ("parentOrganization".id = "Service"."vendorId" or "Organization".id = "Service"."vendorId") <<<<<<
            JOIN "phront"."ServiceProductVariant" ON "ServiceProductVariant".id = ANY ("Service"."variantIds")
            JOIN "phront"."ServiceEngagement" ON "ServiceProductVariant".id = "ServiceEngagement"."serviceVariantId"
            >>>JOIN "phront"."Service" ON "Organization".id = "Service"."vendorId"<<<<---- Remove and move as to the join up on service as an OR in that join's condition

            WHERE (
                "Organization"."id" = 'f643fca5-f539-4335-98d1-17f42b354234'
                AND (
                    ("ServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4')
                    or
                    ("ServiceEngagement"."originId" = '187cfa9a-c303-4737-a770-17d46e7524a4')
                )
            )


        */

        or: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {

            //a list of Or becomes a tree of as syntax args go by 2
            //If the value of properties/expression involved is boolean, than we should use "or" operator
            //however if it's a or of properties and they are not of type boolean, then we ould use COALESCE()
            //and we should really use only one COALESCE for all.

            /*
                !!!! #WARNING TODO

                This has only been tested with one level of OR (not nested ones) and I think it will might be necessary to know what was added to rawExpressionJoinStatements by the two calls to stringify() for args[0] and args[1].

                Right now we're looping on all rawExpressionJoinStatements values after, but we should only do so for values that were actually added.

                So we could send an empty/new SQLJoin(), which would guarantee that rawExpressionJoinStatements.values() are what we want, and once we've consolidated things our way, we would merge it back on the rawExpressionJoinStatements we received.

                Or we could observer the rawExpressionJoinStatements for changes, and collect whhat was modified and use it to loop bellow.
            */

            var args = syntax.args,
                dataMappingStartLength = dataMappings.length,
                lastDataMappingIndex = dataMappings.length-1,
                dataMapping = dataMappings[lastDataMappingIndex],
                objectDescriptor = dataMapping.objectDescriptor,
                currentAliasPrefix = currentAliasPrefix || "",
                leftAliasPrefix = (currentAliasPrefix+"oL"),
                rightAliasPrefix = (currentAliasPrefix+"oR"),
                dataMappingsAliases = dataMappings.aliases,
                currentAlias = (dataMappingsAliases && dataMappingsAliases[lastDataMappingIndex]) || "",
                tableName = dataMappingsAliases && (tableName = dataMappingsAliases[lastDataMappingIndex])
                ? tableName
                : dataService.tableForObjectDescriptor(objectDescriptor),
                left,
                leftRawExpressionJoinStatements = new SQLJoinStatements(),
                leftRawExpressionAddOrderedJoins = leftRawExpressionJoinStatements._addOrderedJoins,
                rightRawExpressionJoinStatements = new SQLJoinStatements(),
                rightRawExpressionAddOrderedJoins = rightRawExpressionJoinStatements._addOrderedJoins,
                right,
                result;

                //dataMappingsAliases[lastDataMappingIndex] = `${leftAliasPrefix}_${tableName}`;
                // left = dataService.stringify(args[0],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, leftAliasPrefix);
                left = dataService.stringify(args[0],scope, dataMappings, locales, leftRawExpressionJoinStatements, syntax);
                //dataMappingsAliases[lastDataMappingIndex] = `${rightAliasPrefix}_${tableName}`;
                //right = dataService.stringify(args[1],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, rightAliasPrefix);
                right = dataService.stringify(args[1],scope, dataMappings, locales, rightRawExpressionJoinStatements, syntax);

                //Reset
                //dataMappingsAliases[lastDataMappingIndex] = currentAlias;

            /*
                Look at generated joins and if an entry has more than one join, we'll combine them with our operator.
                We're using a SET to eliminate duplicates so that conditions that are the same will only be generated once.
            */
            // var iterator = rawExpressionJoinStatements.values(),
            // iteration, iSQLJoins,
            // iSQLJoinsIterator,
            // iteration2, iSQLJoin,
            // iSQLConsolidatedJoin,
            // iSQLConsolidatedJoinConditions;

            // while(!(iteration = iterator.next()).done) {
            //     iSQLJoins = iteration.value;
            //     iSQLConsolidatedJoin = null;
            //     if(iSQLJoins.size > 1) {
            //         iSQLJoinsIterator = iSQLJoins.values();
            //         iSQLConsolidatedJoinConditions = new Set();

            //         while(!(iteration2 = iSQLJoinsIterator.next()).done) {
            //             iSQLJoin = iteration2.value;

            //             if(!iSQLConsolidatedJoin) {
            //                 iSQLConsolidatedJoin = iSQLJoin;
            //             } else {
            //                 rawExpressionJoinStatements.delete(iSQLJoin);
            //             }
            //             iSQLConsolidatedJoinConditions.add(iSQLJoin.onCondition);

            //         }
            //         iSQLConsolidatedJoin.onCondition = `(${iSQLConsolidatedJoinConditions.join(" OR ")})`;
            //         // result = result ? `${result} ${iSQLJoin.toString()}` : iSQLJoin.toString();
            //     }
            // }


            function addJoinDependenciesToArray(sqlJoinStatements, dependencyJoin, dependencyArray) {
                var dependency, dependencies, dependenciesIterator, dependenciesIteration, iterationJoin;
                dependency = sqlJoinStatements._joinDependencyMap.get(dependencyJoin);
                dependencies = sqlJoinStatements._joinMap.get(dependency);
                if(dependencies) {
                    dependenciesIterator = dependencies.values();
                    while(!(dependenciesIteration = dependenciesIterator.next()).done) {
                        iterationJoin = dependenciesIteration.value;
                        if(iterationJoin !== dependencyJoin) {
                            dependencyArray.push(iterationJoin);
                            addJoinDependenciesToArray(sqlJoinStatements, iterationJoin, dependencyArray);
                        }
                    }
                }
            };

            /*
                Loop on joins created, try to streamline/alias as needed and add back to main rawExpressionJoinStatements.
            */
           var mergedJoins = new Set();
            for(
                var li = 0, lCountI = leftRawExpressionAddOrderedJoins.length, liJoin,
                    riJoin, riMatchedJoins, riMatchedJoinsIterator, riMatchedJoinsIteration, riMatchedJoin, mainMatchedJoins, mainMatchedJoinsIterator, mainMatchedJoinsIteration, mainMatchedJoin;
                (li < lCountI);
                li++) {
                liJoin = leftRawExpressionAddOrderedJoins[li];
                // riJoin = rightRawExpressionAddOrderedJoins[li];

                //Now check if there's one on the right side:
                riMatchedJoins = rightRawExpressionJoinStatements._joinMap.get(liJoin.qualifiedRightDataSet);

                if(riMatchedJoins) {
                    riMatchedJoinsIterator = riMatchedJoins.values();
                    while(!(riMatchedJoinsIteration = riMatchedJoinsIterator.next()).done) {
                        riMatchedJoin = riMatchedJoinsIteration.value;

                        //If conditions aren't equal, we need to consolidate them in one join:
                        if(liJoin.onCondition !== riMatchedJoin.onCondition) {
                            liJoin.onCondition = `${liJoin.onCondition} OR ${riMatchedJoin.onCondition}`;

                            var dependencyArray = [];
                            addJoinDependenciesToArray(rightRawExpressionJoinStatements,riMatchedJoin,dependencyArray);
                            //Whatever riMatchedJoin relies on needs to be present before.
                            // var dependency, dependencyJoin = riMatchedJoin, dependencyArray = [];
                            // while(dependency = rightRawExpressionJoinStatements._joinDependencyMap.get(dependencyJoin)) {
                            //     dependencyJoin = rightRawExpressionJoinStatements._joinMap.get(dependency);
                            //     if(dependencyJoin) {
                            //         var                     riMatchedJoinsIterator = riMatchedJoins.values();

                            //         dependencyArray.push(dependencyJoin);
                            //     } else {
                            //         break;
                            //     }
                            // }

                            //Now dependencyArray contains the list that needs to preceed riMatchedJoin
                            var dependencyJoin, j=dependencyArray.length;
                            while((dependencyJoin = dependencyArray[--j])) {
                                if(!mergedJoins.has(dependencyJoin)) {
                                    mergedJoins.add(dependencyJoin);
                                    // if(!rawExpressionJoinStatements.hasJoinEqualTo(dependencyJoin)) {
                                        /*
                                            TODO FIXME REVIEW
                                            In the contex of Event's access control for service-engagemrnt originId, there's an or involved that doesn't work unless left joins are used.

                                            I wasn't able to find a way to assess a logic to decide which ones of the joins may be the ones who need it, so for now, let's add it to all:
                                        */
                                        dependencyJoin.type = SQLJoinType.LeftJoin;
                                        rawExpressionJoinStatements.add(dependencyJoin);
                                    // }
                                }
                            }

                        }

                        //If they match, we can eliminate the right side one
                        //rightRawExpressionJoinStatements.delete(riMatchedJoin);
                        mergedJoins.add(riMatchedJoin);
                    }
                    liJoin.onCondition = `(${liJoin.onCondition})`;

                }



                mainMatchedJoins = rawExpressionJoinStatements._joinMap.get(liJoin.qualifiedRightDataSet);
                if(mainMatchedJoins) {
                    mainMatchedJoinsIterator = mainMatchedJoins.values();
                    while(!(mainMatchedJoinsIteration = mainMatchedJoinsIterator.next()).done) {
                        mainMatchedJoin = mainMatchedJoinsIteration.value;

                        //If conditions aren't equal, we need to consolidate them in one join:
                        if(liJoin.onCondition !== mainMatchedJoin.onCondition) {
                            mainMatchedJoin.onCondition = `${mainMatchedJoin.onCondition} OR ${liJoin.onCondition}`;

                            var dependencyArray = [];
                            addJoinDependenciesToArray(leftRawExpressionJoinStatements,liJoin,dependencyArray);

                            //Now dependencyArray contains the list that needs to preceed riMatchedJoin
                            var dependencyJoin, j=dependencyArray.length;
                            while((dependencyJoin = dependencyArray[--j])) {
                                if(!mergedJoins.has(dependencyJoin)) {
                                    mergedJoins.add(dependencyJoin);
                                    // if(!rawExpressionJoinStatements.hasJoinEqualTo(dependencyJoin)) {
                                    /*
                                        TODO FIXME REVIEW
                                        In the contex of Event's access control for service-engagemrnt originId, there's an or involved that doesn't work unless left joins are used.

                                        I wasn't able to find a way to assess a logic to decide which ones of the joins may be the ones who need it, so for now, let's add it to all:
                                    */
                                        dependencyJoin.type = SQLJoinType.LeftJoin;

                                        rawExpressionJoinStatements.add(dependencyJoin);
                                    // }
                                }
                            }

                        }
                        mergedJoins.add(liJoin);

                    }
                    mainMatchedJoin.onCondition = `(${mainMatchedJoin.onCondition})`;
                } else {
                    mergedJoins.add(liJoin);
                    // if(!rawExpressionJoinStatements.hasJoinEqualTo(liJoin)) {

                        /*
                            TODO FIXME REVIEW
                            In the contex of Event's access control for service-engagemrnt originId, there's an or involved that doesn't work unless left joins are used.

                            I wasn't able to find a way to assess a logic to decide which ones of the joins may be the ones who need it, so for now, let's add it to all:
                        */
                        liJoin.type = SQLJoinType.LeftJoin;

                        rawExpressionJoinStatements.add(liJoin);
                    // }
                }
            }

            //Now add the right ones:
            for(var ri = 0, rCountI = rightRawExpressionAddOrderedJoins.length,
                riJoin,
                mainMatchedJoins, mainMatchedJoinsIterator, mainMatchedJoinsIteration, mainMatchedJoin;
                (ri < rCountI);
                ri++) {
                riJoin = rightRawExpressionAddOrderedJoins[ri];
                if(!mergedJoins.has(riJoin)) {
                    mainMatchedJoins = rawExpressionJoinStatements._joinMap.get(riJoin.qualifiedRightDataSet);
                    if(mainMatchedJoins) {
                        mainMatchedJoinsIterator = mainMatchedJoins.values();
                        while(!(mainMatchedJoinsIteration = mainMatchedJoinsIterator.next()).done) {
                            mainMatchedJoin = mainMatchedJoinsIteration.value;

                            //If conditions aren't equal, we need to consolidate them in one join:
                            if(riJoin.onCondition !== mainMatchedJoin.onCondition) {
                                mainMatchedJoin.onCondition = `${mainMatchedJoin.onCondition} OR ${riJoin.onCondition}`;

                                var dependencyArray = [];
                                addJoinDependenciesToArray(rightRawExpressionJoinStatements,riJoin,dependencyArray);

                                //Now dependencyArray contains the list that needs to preceed riMatchedJoin
                                var dependencyJoin, j=dependencyArray.length;
                                while((dependencyJoin = dependencyArray[--j])) {
                                    if(!mergedJoins.has(dependencyJoin)) {
                                        mergedJoins.add(dependencyJoin);
                                        // if(!rawExpressionJoinStatements.hasJoinEqualTo(dependencyJoin)) {

                                        /*
                                            TODO FIXME REVIEW
                                            In the contex of Event's access control for service-engagemrnt originId, there's an or involved that doesn't work unless left joins are used.

                                            I wasn't able to find a way to assess a logic to decide which ones of the joins may be the ones who need it, so for now, let's add it to all:
                                        */
                                            dependencyJoin.type = SQLJoinType.LeftJoin;

                                            rawExpressionJoinStatements.add(dependencyJoin);
                                        // }
                                    }
                                }

                            }
                            mergedJoins.add(riJoin);

                        }
                        mainMatchedJoin.onCondition = `(${mainMatchedJoin.onCondition})`;
                    } else {
                        mergedJoins.add(riJoin);
                        // if(!rawExpressionJoinStatements.hasJoinEqualTo(riJoin)) {

                            /*
                                TODO FIXME REVIEW
                                In the contex of Event's access control for service-engagemrnt originId, there's an or involved that doesn't work unless left joins are used.

                                I wasn't able to find a way to assess a logic to decide which ones of the joins may be the ones who need it, so for now, let's add it to all:
                            */
                            riJoin.type = SQLJoinType.LeftJoin;

                            rawExpressionJoinStatements.add(riJoin);
                        // }
                    }
                }
            }

            if(left && right && left !== right) {
                result = `(${left} OR ${right})`;
            } else if(left) {
                result = left;
            } else if(right) {
                result = right;
            }

            return result;

                //solved = solve(args[0],args[1]),
                i, countI, result = "";
            for(i = 0, countI = args.length;i<countI;i++) {
                if(i > 0) {
                    result += " ";
                    result += "or";
                    result += " ";
                }
                result += dataService.stringify(args[i],scope, dataMappings, locales, rawExpressionJoinStatements, syntax);
            }

            return result.trim();
        }
        /*
        ,

        has: function (syntax, scope, parent, dataService, dataMappings) {

            var args = syntax.args,
                i, countI, result = "",
                stringifiedArg,
                mappedToken = dataService.mapTokenToRawToken("has");
            for(i = 0, countI = args.length;i<countI;i++) {
                if(i > 0) {
                    result += " ";
                    result += mappedToken;
                    result += " ";
                }

                stringifiedArg = dataService.stringify(args[i],scope, dataMappings, syntax);

                result += stringifiedArg
            }

            return result.trim();
        }
*/
        ,

        equals: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {

            var dataMappingStartLength = dataMappings.length,
                argsZeroValue,
                argsOneValue;

            argsZeroValue = dataService.stringify(syntax.args[0],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

            dataMappings.splice(dataMappingStartLength);
            if(dataMappings.aliases) {
                dataMappings.aliases.splice(dataMappingStartLength);
            }

            argsOneValue = dataService.stringify(syntax.args[1],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

            dataMappings.splice(dataMappingStartLength);
            if(dataMappings.aliases) {
                dataMappings.aliases.splice(dataMappingStartLength);
            }
            return `${argsZeroValue} ${dataService.mapTokenToRawTokenForValue(EqualsToken,argsOneValue, parent)} ${argsOneValue}`;
        }

    },

    tokenMappers: {
        "&&": function(value, parentSyntax) {
            return "AND";
        },
        "||": function(value, parentSyntax) {
            return "OR";
        },
        "==": function(value, parentSyntax) {
            if(arguments.length > 0 && (value === null || value === undefined || value === "null")) {
                if(parentSyntax && parentSyntax.type === "not") {
                    return "IS NOT";
                } else {
                    return "IS";
                }
            } else {
                return "=";
            }
        }
        /*
        ,
        "!=": function(value) {
            if(arguments.length === 1 && (value === null || value === undefined)) {
                return "is not";
            } else {
                return "!=";
            }
        }
        */
    },

    mapTokenToRawTokenForValue: function(token, value, parentSyntax) {
        var tokenMapper = this.tokenMappers[token];
        if(tokenMapper) {
            return tokenMapper(value, parentSyntax);
        } else {
            return token;
        }
    }

};

// book a dataService for all the defined symbolic operators
typeToToken.forEach(function (token, type) {

    if(typeof module.exports.stringifiers[type] !== "function") {
        module.exports.stringifiers[type] = function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix) {

            /*
                TODO: Needs to finish transforming

                'name.givenName == $.givenName && name.familyName == $.familyName && name.namePrefix == $.namePrefix'

                into

                name @> '{"givenName":"Cathy"}' and name @> '{"familyName":"Smith"} and name @> '{"namePrefix":"Dr."}'

                or name->>'familyName' = 'Smith'

                select '{"a": {"b":{"c": "foo"}}}'::jsonb->'a'->'b'->'c' = '"foo"'
                //Note the double quote in '' around foo to make it a jsonb value compatible with the type returned by -> operator

                equal operator will have to adapt and know the column type to answer corretly? Not in the second option

            */

           var argsZeroValue = dataService.stringify(syntax.args[0],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix),
                argsOneValue = dataService.stringify(syntax.args[1],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

           if(argsZeroValue && argsOneValue) {
                return `${argsZeroValue} ${dataService.mapTokenToRawTokenForValue(token,argsZeroValue)} ${argsOneValue}`;
           } else {
               //In case one side doesn't lead to anything, we degrade to the side that did.
               return argsZeroValue || argsOneValue;
           }



            var args = syntax.args,
                i, countI, iValue, result = "";
                //mappedToken = dataService.mapTokenToRawToken(token);
            for(i = 0, countI = args.length;i<countI;i++) {
                if(i > 0) {
                    result += " ";
                }

                iValue = dataService.stringify(args[i],scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix);

                if(i > 0) {
                    result += dataService.mapTokenToRawTokenForValue(token,result);
                    result += " ";
                }

                result += iValue
            }

            return result.trim();
        }
    }
});

