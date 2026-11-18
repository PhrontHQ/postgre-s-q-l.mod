"use strict";

/**
 * SQL for FRB's traverse{} block (syntax type "traverseBlock") in criteria.
 *
 * Registered in pgstringify.js's stringifiers. A traversal becomes a
 * JOIN LATERAL over a recursive CTE that walks the step relationship from the
 * row being qualified:
 *
 *     traverse(min, max){step}
 *
 *     JOIN LATERAL (
 *         WITH RECURSIVE "__traverse" AS (
 *             <start row, depth 0>
 *           UNION ALL
 *             <rows one step further, depth + 1, stopping at max>
 *         ) CYCLE <primary key> SET "__traverse_is_cycle" USING "__traverse_path"
 *         SELECT <every column of the reached rows>, depth
 *         WHERE NOT is_cycle AND depth >= min
 *     ) "traverse_<step>_<n>" ON true
 *
 * Each joined row is one reached node. What consumes the traversal decides
 * what the block does after adding the join:
 *
 *  - filter{} / some{}, last(), one(): the step's destination mapping and the
 *    subquery's alias are pushed on dataMappings, so the block body or the
 *    property after last()/one() resolves against the reached rows through
 *    pgstringify's existing alias handling. Those consumers already remove
 *    what was pushed when they're done.
 *  - has(): nothing is left on dataMappings, and the block returns
 *    ARRAY["<alias>"."<primary key>"] as the left side for the existing has()
 *    handling (_stringifyCollectionOperator) to append "@> ARRAY[value]".
 *
 * Semantics match mod's in-memory traverse: depth 0 is the start, the default
 * minimum depth is 1, cycles are cut per path (PostgreSQL's CYCLE clause), and
 * a node reachable by two routes is reached twice.
 *
 * Phase 1 limits, each reported with an explicit error rather than bad SQL:
 *  - the step is a single relationship back to the same table;
 *  - the traversal is consumed by filter{}, some{}, has(), last() or one();
 *    last() and one() need a to-one step;
 *  - a property directly after the traversal (traverse{parent}.name) is an
 *    error, as in FRB it reads the property of the array;
 *  - no localized relationships, no composite primary keys.
 */

var pgutils = require("./pg-utils"),
    escapeIdentifier = pgutils.escapeIdentifier,
    SQLJoinModule = require("./s-q-l-join"),
    SQLJoin = SQLJoinModule.SQLJoin,
    SQLJoinType = SQLJoinModule.SQLJoinType;

var CTE = "__traverse",
    NODE = "__traverse_node",
    DEPTH = "__traverse_depth",
    IS_CYCLE = "__traverse_is_cycle",
    PATH = "__traverse_path",
    MAX_IDENTIFIER_LENGTH = 63;

/*
    What may consume a traversal in a criteria.
*/
var SUPPORTED_PARENT_TYPES = {
    filterBlock: true,
    someBlock: true,
    has: true,
    last: true,
    one: true
};

function q(identifier) {
    return escapeIdentifier(identifier);
}

/*
    Each traverseBlock syntax node gets its own alias, so two traversals in one
    criteria are two independent joins. Sharing one join would make
    traverse{parent}.has($a) && traverse{parent}.has($b) require a single
    ancestor to be both. The alias is stable for a given syntax node, so a
    criteria stringifies to the same SQL every time.
*/
var aliasOrdinals = new WeakMap(),
    nextAliasOrdinal = 0;

function aliasOrdinalForSyntax(syntax) {
    var ordinal = aliasOrdinals.get(syntax);
    if (ordinal === undefined) {
        aliasOrdinals.set(syntax, (ordinal = (nextAliasOrdinal++).toString(36)));
    }
    return ordinal;
}

function describe(syntax) {
    return JSON.stringify(syntax);
}

function primaryKeyForMapping(mapping) {
    var keys = mapping.rawDataPrimaryKeys;
    if (keys && keys.length > 1) {
        throw new Error("pgstringify traverse{}: composite primary keys aren't supported (" + mapping.objectDescriptor.name + ")");
    }
    return (keys && keys[0]) || "id";
}

/**
 * The SQL join condition for one hop of a relationship, mirroring the
 * non-localized branches of pgstringify's _propertyName:
 *
 * | Column is on          | Type   | Condition                          |
 * | the from row          | scalar | to.pk = from.column                |
 * | the from row          | array  | to.pk = ANY(from.column)           |
 * | the to row (inverse)  | scalar | to.column = from.pk                |
 * | the to row (inverse)  | array  | to.column @> ARRAY[from.pk]        |
 *
 * The last row uses @> rather than _propertyName's from.pk = ANY(to.column)
 * so a GIN index on the array column can serve it at every recursion level.
 *
 * @returns {{objectDescriptor, mapping, cardinality, fromColumns: string[], condition: function(string, string): string}}
 */
function relationshipStep(dataService, mapping, propertyName) {
    var objectDescriptor = mapping.objectDescriptor,
        propertyDescriptor = objectDescriptor.propertyDescriptorForName(propertyName),
        valueDescriptor = propertyDescriptor && propertyDescriptor._valueDescriptorReference,
        objectRule = mapping.objectMappingRuleForPropertyName(propertyName),
        destinationMapping, fromKey, toKey, column, converterSyntax, syntaxProperty, inversePropertyDescriptor;

    if (!propertyDescriptor || !valueDescriptor || !objectRule || propertyDescriptor.name === "dataIdentifier") {
        throw new Error("pgstringify traverse{}: '" + propertyName + "' isn't a relationship of " + objectDescriptor.name);
    }
    if (propertyDescriptor.isLocalizable) {
        throw new Error("pgstringify traverse{}: localized relationships aren't supported ('" + propertyName + "' of " + objectDescriptor.name + ")");
    }

    destinationMapping = dataService.mappingForType(valueDescriptor);
    fromKey = primaryKeyForMapping(mapping);
    toKey = primaryKeyForMapping(destinationMapping);

    // The from row hosts the foreign key(s)
    if (objectRule.sourcePath !== fromKey) {
        column = mapping.mapObjectPropertyNameToRawPropertyName(propertyName);
        return {
            objectDescriptor: valueDescriptor,
            mapping: destinationMapping,
            cardinality: propertyDescriptor.cardinality,
            fromColumns: [column],
            condition: propertyDescriptor.cardinality > 1
                ? function (from, to) { return q(to) + "." + q(toKey) + " = ANY(" + q(from) + "." + q(column) + ")"; }
                : function (from, to) { return q(to) + "." + q(toKey) + " = " + q(from) + "." + q(column); }
        };
    }

    // The to row hosts the foreign key(s): read the column from the converter, as _propertyName does
    converterSyntax = objectRule.converter && objectRule.converter.convertSyntax;
    if (!converterSyntax) {
        throw new Error("pgstringify traverse{}: no converter syntax to find the column for '" + propertyName + "' of " + objectDescriptor.name);
    }
    syntaxProperty = converterSyntax.args[0].type === "property" ? converterSyntax.args[0] : converterSyntax.args[1];
    column = syntaxProperty.args[1].type === "literal" ? syntaxProperty.args[1].value : syntaxProperty.args[0].value;
    inversePropertyDescriptor = propertyDescriptor._inversePropertyDescriptor;

    return {
        objectDescriptor: valueDescriptor,
        mapping: destinationMapping,
        cardinality: propertyDescriptor.cardinality,
        fromColumns: [],
        condition: (converterSyntax.type === "has" || (inversePropertyDescriptor && inversePropertyDescriptor.cardinality > 1))
            ? function (from, to) { return q(to) + "." + q(column) + " @> ARRAY[" + q(from) + "." + q(fromKey) + "]"; }
            : function (from, to) { return q(to) + "." + q(column) + " = " + q(from) + "." + q(fromKey); }
    };
}

/*
    Literal, $ or $name, looked up in the criteria parameters (pgstringify's scope).
*/
function resolveArgument(syntax, scope, what) {
    if (syntax.type === "literal") {
        return syntax.value;
    }
    if (syntax.type === "parameters") {
        return scope;
    }
    if (syntax.type === "property" && syntax.args[0].type === "parameters" && syntax.args[1].type === "literal") {
        return scope == null ? undefined : scope[syntax.args[1].value];
    }
    throw new Error("pgstringify traverse{}: " + what + " must be a literal or a parameter: " + describe(syntax));
}

function resolveDepth(syntax, scope) {
    var value = resolveArgument(syntax, scope, "depth");
    if (value == null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error("pgstringify traverse{}: depth must be a non-negative integer, got " + JSON.stringify(value));
    }
    return value;
}

/**
 * {min, max, isSet}: [start, step] → 1..unbounded, [start, step, max],
 * [start, step, min, max]. An unset depth gives isSet false: as in mod's
 * evaluator, where the traversal is then undefined, it matches nothing.
 * It never means "unbounded".
 */
function depthRange(syntax, scope) {
    var args = syntax.args, min = 1, max = null, isSet = true;
    if (args.length === 3) {
        max = resolveDepth(args[2], scope);
        isSet = max !== null;
    } else if (args.length >= 4) {
        min = resolveDepth(args[2], scope);
        max = resolveDepth(args[3], scope);
        isSet = min !== null && max !== null;
    }
    return {min: min === null ? 1 : min, max: max, isSet: isSet};
}

function checkParent(syntax, parent) {
    if (parent && parent.type === "scope") {
        // pgstringify's property stringifier passes {type: "scope"} for the left side of a.b
        throw new Error("pgstringify traverse{}: traverse{…} is an array, so a property right after it reads that property " +
            "of the array, not of the reached objects. Use traverse{…}.some{property == …}, or .last()/.one() for a single object: " + describe(syntax));
    }
    if (!parent || !SUPPORTED_PARENT_TYPES[parent.type]) {
        throw new Error("pgstringify traverse{}: " + (parent ? "'" + parent.type + "'" : "a bare traversal") +
            " isn't supported in SQL criteria yet. Use traverse{…} with filter{}, some{}, has(), last() or one(): " + describe(syntax));
    }
    if (parent.args[0] !== syntax) {
        throw new Error("pgstringify traverse{}: a traversal is only supported as the collection " + parent.type + "() applies to: " + describe(parent));
    }
}

/**
 * Stringifier for "traverseBlock", registered in pgstringify's stringifiers.
 * Adds the JOIN LATERAL. Returns ARRAY["<alias>"."<primary key>"] when the
 * traversal is the left side of has(), "" otherwise: it adds nothing to WHERE
 * itself.
 */
function traverseBlock(syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix, inlinedDataPropertyDescriptor) {
    var args = syntax.args,
        startSyntax = args[0],
        stepSyntax = args[1],
        lengthBefore = dataMappings.length,
        schemaName = dataService.connection.schema,
        startMapping, objectDescriptor, tableName, table, startAlias, primaryKey,
        stepName, step, depth, columns, nodeColumns, orderAndLimit, body, alias, join;

    checkParent(syntax, parent);

    if (!dataMappings.aliases) {
        dataMappings.aliases = [];
    }

    // A relationship path before traverse (a.b.traverse{…}) adds its own joins and pushes its mapping
    if (startSyntax.type !== "value") {
        dataService.stringify(startSyntax, scope, dataMappings, locales, rawExpressionJoinStatements, syntax, currentAliasPrefix, inlinedDataPropertyDescriptor);
    }

    startMapping = dataMappings[dataMappings.length - 1];
    objectDescriptor = startMapping.objectDescriptor;
    tableName = dataService.tableForObjectDescriptor(objectDescriptor);
    table = q(schemaName) + "." + q(tableName);
    startAlias = dataMappings.aliases[dataMappings.length - 1] || tableName;
    primaryKey = primaryKeyForMapping(startMapping);

    if (stepSyntax.type !== "property" || stepSyntax.args[0].type !== "value" || stepSyntax.args[1].type !== "literal") {
        throw new Error("pgstringify traverse{}: the step must be a single relationship, like traverse{parent}: " + describe(stepSyntax));
    }
    stepName = stepSyntax.args[1].value;
    step = relationshipStep(dataService, startMapping, stepName);

    if (dataService.tableForObjectDescriptor(step.objectDescriptor) !== tableName) {
        throw new Error("pgstringify traverse{" + stepName + "}: the step must stay in the same table (" + objectDescriptor.name + " → " + step.objectDescriptor.name + ")");
    }
    if ((parent.type === "last" || parent.type === "one") && step.cardinality > 1) {
        throw new Error("pgstringify traverse{" + stepName + "}." + parent.type + "(): only supported for a to-one step, like traverse{parent}." + parent.type + "()");
    }

    depth = depthRange(syntax, scope);

    // Carry only what the recursion needs; the full rows are joined back at the end.
    columns = [primaryKey].concat(step.fromColumns.filter(function (column) { return column !== primaryKey; }));
    nodeColumns = columns.map(function (column) { return q(NODE) + "." + q(column); }).join(", ");

    // For a to-one step the walk is a single chain: last() is the farthest, one() the nearest.
    orderAndLimit = parent.type === "last" ? " ORDER BY " + q(CTE) + "." + q(DEPTH) + " DESC LIMIT 1"
        : parent.type === "one" ? " ORDER BY " + q(CTE) + "." + q(DEPTH) + " ASC LIMIT 1"
        : "";

    body = "(WITH RECURSIVE " + q(CTE) + " AS (" +
            "SELECT " + nodeColumns + ", 0 AS " + q(DEPTH) +
            " FROM " + table + " " + q(NODE) +
            " WHERE " + (depth.isSet ? q(NODE) + "." + q(primaryKey) + " = " + q(startAlias) + "." + q(primaryKey) : "FALSE") +
        " UNION ALL " +
            "SELECT " + nodeColumns + ", " + q(CTE) + "." + q(DEPTH) + " + 1" +
            " FROM " + q(CTE) + " JOIN " + table + " " + q(NODE) + " ON " + step.condition(CTE, NODE) +
            (depth.max !== null ? " WHERE " + q(CTE) + "." + q(DEPTH) + " < " + depth.max : "") +
        ") CYCLE " + q(primaryKey) + " SET " + q(IS_CYCLE) + " USING " + q(PATH) +
        " SELECT " + q(NODE) + ".*, " + q(CTE) + "." + q(DEPTH) +
        " FROM " + q(CTE) + " JOIN " + table + " " + q(NODE) + " ON " + q(NODE) + "." + q(primaryKey) + " = " + q(CTE) + "." + q(primaryKey) +
        " WHERE NOT " + q(CTE) + "." + q(IS_CYCLE) + " AND " + q(CTE) + "." + q(DEPTH) + " >= " + depth.min +
        orderAndLimit +
        ")";

    alias = ("traverse_" + stepName).slice(0, MAX_IDENTIFIER_LENGTH - 8) + "_" + aliasOrdinalForSyntax(syntax);

    join = new SQLJoin();
    join.type = SQLJoinType.Join;
    join.leftDataSetSchema = schemaName;
    join.leftDataSet = tableName;
    join.leftDataSetAlias = dataMappings.aliases[dataMappings.length - 1];
    join.leftDataSetObjecDescriptor = objectDescriptor;
    join.rightDataSetSchema = schemaName;
    join.rightDataSet = tableName;
    join.rightDataSetExpression = body;
    join.isLateral = true;
    join.rightDataSetAlias = alias;
    join.rightDataSetObjecDescriptor = step.objectDescriptor;
    join.onCondition = "true";
    rawExpressionJoinStatements.add(join);

    if (parent.type === "has") {
        /*
            has() only needs the reached node's primary key on the left of @>.
            Leave dataMappings as we found it (including what a path before the
            traversal pushed), so whatever is stringified next with the same
            dataMappings, like the other side of ||, starts from the same scope.
        */
        dataMappings.splice(lengthBefore);
        dataMappings.aliases.splice(lengthBefore);
        return "ARRAY[" + q(alias) + "." + q(primaryKeyForMapping(step.mapping)) + "]";
    }

    dataMappings.push(step.mapping);
    dataMappings.aliases[dataMappings.length - 1] = alias;

    return "";
}

module.exports = {
    traverseBlock: traverseBlock,
    relationshipStep: relationshipStep,
    depthRange: depthRange
};
