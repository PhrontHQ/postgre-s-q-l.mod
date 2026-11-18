"use strict";
/*
    Standalone check of pg-traverse.js, the SQLJoin changes and the has()
    branch pgstringify-traverse.patch adds, run with:

        node data/service/pg-traverse-harness.js          (checks only)
        node data/service/pg-traverse-harness.js --print  (also prints the SQL)

    It drives pg-traverse.js through a minimal stand-in for pgstringify.js
    with the same dispatch, the same dataMappings handling for the operators it
    covers (==, &&, ||, blocks, a.b), and the code paths the patch adds. Its
    Organization model stores suborganizations in a "suborganizationIds"
    uuid[] column, with parent as the inverse.

    It checks the generated SQL text only: it doesn't run it, and it doesn't
    load the real pgstringify.js. The has() branch in _stringifyCollectionOperator
    below is a copy of the one in the patch; keep them in sync.
*/
var Module = require("module"), path = require("path"), assert = require("assert");

// Outside a mod install, stand in for the mod modules the service files need.
var shims = {
    "mod/core/core": {Montage: {specialize: function (d) {
        var C = d.constructor.value, ctor = function () { return C.apply(this, arguments) || this; };
        Object.keys(d).forEach(function (k) {
            if (k === "constructor") return;
            var x = d[k];
            Object.defineProperty(ctor.prototype, k, "value" in x
                ? {value: x.value, writable: true, configurable: true}
                : {get: x.get, set: x.set, configurable: true});
        });
        return ctor;
    }}},
    "mod/core/enum": {Enum: function () {
        this.initWithMembersAndValues = function (m, v) { var o = {}; m.forEach(function (k, i) { o[k] = v[i]; }); return o; };
    }},
    "mod/core/range": {Range: function Range() {}},
    "mod/data/model/localized-string": {LocalizedString: function LocalizedString() {}},
    "mod/core/converter/r-f-c-3339-u-t-c-range-string-to-date-range-converter": {singleton: {}}
};
var load = Module._load;
Module._load = function (request, parent) {
    try { return load.apply(this, arguments); }
    catch (error) { if (shims[request]) return shims[request]; throw error; }
};

var dir = __dirname,
    pgTraverse = require(path.join(dir, "pg-traverse")),
    escapeString = require(path.join(dir, "pg-utils")).escapeString,
    SQLJoinModule = require(path.join(dir, "s-q-l-join")),
    SQLJoin = SQLJoinModule.SQLJoin,
    SQLJoinType = SQLJoinModule.SQLJoinType,
    SQLJoinStatements = require(path.join(dir, "s-q-l-join-statements")).SQLJoinStatements;

var V = {type: "value"};
function lit(v) { return {type: "literal", value: v}; }
function prop(name, on) { return {type: "property", args: [on || V, lit(name)]}; }
function param(name) { return {type: "property", args: [{type: "parameters"}, lit(name)]}; }
function trav(step, depthArgs, start) { return {type: "traverseBlock", args: [start || V, prop(step)].concat(depthArgs || [])}; }
function block(type, input, body) { return {type: type, args: [input, body]}; }
function eq(a, b) { return {type: "equals", args: [a, b]}; }
function call(type) { return {type: type, args: Array.prototype.slice.call(arguments, 1)}; }

var Organization = {name: "Organization", propertyDescriptorForName: function (n) { return this._props[n]; }},
    Label = {name: "Label"},
    subs = {name: "suborganizations", cardinality: Infinity, _valueDescriptorReference: Organization},
    parentPD = {name: "parent", cardinality: 1, _valueDescriptorReference: Organization};
subs._inversePropertyDescriptor = parentPD;
parentPD._inversePropertyDescriptor = subs;
Organization._props = {
    name: {name: "name", cardinality: 1},
    suborganizations: subs,
    parent: parentPD,
    label: {name: "label", cardinality: 1, _valueDescriptorReference: Label}
};
var rules = {
    name: {sourcePath: "name"},
    suborganizations: {sourcePath: "suborganizationIds"},
    // parent: the row whose suborganizationIds has this row's id
    parent: {sourcePath: "id", converter: {convertSyntax: call("has", prop("suborganizationIds"), {type: "parameters"})}},
    label: {sourcePath: "labelId"}
};
var mapping = {
    objectDescriptor: Organization,
    rawDataPrimaryKeys: ["id"],
    objectMappingRuleForPropertyName: function (n) { return rules[n]; },
    mapObjectPropertyNameToRawPropertyName: function (n) { return n === "suborganizations" ? "suborganizationIds" : n === "label" ? "labelId" : n; }
};
var labelMapping = {objectDescriptor: Label, rawDataPrimaryKeys: ["id"],
    objectMappingRuleForPropertyName: function () {}, mapObjectPropertyNameToRawPropertyName: function (n) { return n; }};

function copyMappings(dm) { var c = dm.slice(); c.aliases = dm.aliases.slice(); c.dataMappingScopes = dm.dataMappingScopes.slice(); return c; }
function makeBlock() {
    // like makeBlockStringifier: what the left side pushed is removed after the body
    return function (syntax, scope, parent, ds, dm, l, j, p, i) {
        var n = dm.length,
            a = ds.stringify(syntax.args[0], scope, dm, l, j, syntax, p, i),
            b = ds.stringify(syntax.args[1], scope, dm, l, j, syntax, p, i);
        dm.splice(n); dm.aliases.splice(n);
        return " " + a + " " + b;
    };
}
var service = {
    connection: {schema: "traverse_test"},
    tableForObjectDescriptor: function (od) { return od.name; },
    mappingForType: function (od) { return od === Organization ? mapping : labelMapping; },
    // The two cases of the service's mapPropertyDescriptorValueToRawValue() that has() uses here
    mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression: function (propertyDescriptor, value, rawPropertyName, type) {
        if (typeof value === "string") return escapeString(value, type, propertyDescriptor);
        if (value && value.primaryKey != null) return "'" + value.primaryKey + "'"; // a DataIdentifier
        throw new Error("not part of this harness: " + JSON.stringify(value));
    },
    stringify: function (syntax, scope, dataMappings, locales, joins, parent, prefix, inl) {
        if (!dataMappings.aliases) dataMappings.aliases = [];
        if (!dataMappings.dataMappingScopes) dataMappings.dataMappingScopes = [];
        var s = this.stringifiers[syntax.type], string, f;
        if (s) return s(syntax, scope, parent, this, dataMappings, locales, joins, prefix, inl);
        // patch: last()/one() after traverse{}
        if ((syntax.type === "last" || syntax.type === "one") && syntax.args && syntax.args[0] && syntax.args[0].type === "traverseBlock") {
            return this.stringify(syntax.args[0], scope, dataMappings, locales, joins, syntax, prefix, inl);
        }
        // the generic function-call path: left side, then the function stringifier
        string = this.stringify(syntax.args[0], scope, dataMappings, locales, joins, syntax, prefix, inl);
        f = this.functionStringifiers[syntax.type];
        return string + " " + (f ? f(syntax, scope, parent, this, dataMappings, locales, joins, prefix, inl) : syntax.type + "()");
    },
    _stringifyCollectionOperator: function (syntax, scope, parent, dataService, dataMappings, locales, rawExpressionJoinStatements, currentAliasPrefix, inlinedDataPropertyDescriptor, operator, operatorForId) {
        var value, escapedValue, args = syntax.args;

        /*
            traverse{…}.has(value): the traverseBlock stringifier added a JOIN LATERAL of the
            reached rows and returned ARRAY["<alias>"."<primary key>"] as the left side, like
            ARRAY["Table"."id"] in the branches below. Each joined row is one reached node, so
            "@> ARRAY[value]" reads "some reached node is value".
        */
        if(args[0].type === "traverseBlock") {
            if(syntax.type !== "has") {
                throw new Error("pgstringify.js: "+syntax.type+"() after traverse{} isn't supported in SQL criteria yet, only has(): "+JSON.stringify(syntax));
            }
            if(args[1].type === "parameters") {
                value = scope;
            } else if(args[1].type === "property" && args[1].args[0].type === "parameters") {
                value = scope ? scope[args[1].args[1].value] : undefined;
            } else if(args[1].type === "literal") {
                value = args[1].value;
            } else {
                throw new Error("pgstringify.js: traverse{}.has() takes a literal or a parameter: "+JSON.stringify(syntax));
            }
            /*
                In FRB, has([a]) looks for the array [a] itself among the reached objects.
                SQL can't express that, so it's an error rather than a different answer.
            */
            if(Array.isArray(value)) {
                throw new Error("pgstringify.js: traverse{}.has() takes one object or primary key, not an array: "+JSON.stringify(syntax));
            }
            //A data object stands for its dataIdentifier, which the value mapping turns into its primary key
            if(value && typeof value === "object" && value.dataIdentifier) {
                value = value.dataIdentifier;
            }
            /*
                null and undefined match nothing, as in FRB. They're handled here because
                mapPropertyDescriptorValueToRawValue() reads dataOperation.type for a null uuid.
                ARRAY[NULL] is contained in no array, so the condition is false.
                Primary keys are uuid in this service (see mapObjectDescriptorRawPropertyToRawType).
            */
            escapedValue = (value === null || value === undefined)
                ? "NULL"
                : dataService.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(undefined, value, undefined, "uuid");
            return `@> ARRAY[${escapedValue}]::uuid[]`;
        }

        throw new Error("not part of this harness");
    },
    functionStringifiers: {
        has: function (syntax, scope, parent, ds, dm, l, j, p, i) {
            return ds._stringifyCollectionOperator(syntax, scope, parent, ds, dm, l, j, p, i, "@>", "in");
        },
        intersects: function (syntax, scope, parent, ds, dm, l, j, p, i) {
            return ds._stringifyCollectionOperator(syntax, scope, parent, ds, dm, l, j, p, i, "@>", "<@");
        }
    },
    stringifiers: {
        traverseBlock: pgTraverse.traverseBlock, // patch: registration
        literal: function (syntax, scope, parent, ds, dm) {
            if (parent && parent.type === "property") return ds.stringifiers._propertyName(syntax.value, dm);
            return typeof syntax.value === "string" ? "'" + syntax.value.replace("'", "\\'") + "'" : "" + syntax.value;
        },
        _propertyName: function (name, dm) {
            var i = dm.length - 1, alias = dm.aliases[i] || dm[i].objectDescriptor.name;
            return '"' + alias + '"."' + dm[i].mapObjectPropertyNameToRawPropertyName(name) + '"';
        },
        property: function (syntax, scope, parent, ds, dm, l, j, p, inl) {
            if (syntax.args[0].type === "value") return ds.stringifiers._propertyName(syntax.args[1].value, dm);
            if (syntax.args[0].type === "parameters") { var v = scope[syntax.args[1].value]; return typeof v === "string" ? "'" + v + "'" : String(v); }
            var start = dm.length,
                a0 = ds.stringify(syntax.args[0], scope, dm, l, j, {type: "scope"}, p, inl),
                a1 = ds.stringifiers._propertyName(syntax.args[1].value, dm),
                r = a0.length && a1.length ? a0 + " AND " + a1 : a0.length ? a0 : a1;
            if (parent && parent.type !== "scope") { dm.splice(start); dm.aliases.splice(start); }
            return r;
        },
        filterBlock: makeBlock(), someBlock: makeBlock(), everyBlock: makeBlock(),
        equals: function (syntax, scope, parent, ds, dm, l, j, p, i) {
            var n = dm.length, a = ds.stringify(syntax.args[0], scope, dm, l, j, syntax, p, i);
            dm.splice(n); dm.aliases.splice(n);
            return a + " = " + ds.stringify(syntax.args[1], scope, dm, l, j, syntax, p, i);
        },
        // like pgstringify's generic operators: each side gets a copy of dataMappings
        and: function (syntax, scope, parent, ds, dm, l, j, p, i) {
            return ds.stringify(syntax.args[0], scope, copyMappings(dm), l, j, syntax, p, i) + " AND " + ds.stringify(syntax.args[1], scope, copyMappings(dm), l, j, syntax, p, i);
        },
        // like pgstringify's or: both sides share dataMappings, each side collects its
        // joins separately, and the joins are merged back as LEFT JOINs
        or: function (syntax, scope, parent, ds, dm, l, j, p, i) {
            var lj = new SQLJoinStatements(), rj = new SQLJoinStatements(),
                a = ds.stringify(syntax.args[0], scope, dm, l, lj, syntax, p, i),
                b = ds.stringify(syntax.args[1], scope, dm, l, rj, syntax, p, i);
            lj._addOrderedJoins.concat(rj._addOrderedJoins).forEach(function (join) { join.type = SQLJoinType.LeftJoin; j.add(join); });
            return "(" + a + " OR " + b + ")";
        }
    }
};

// Same shape as the statement mapReadOperationToRawReadOperation builds
function sql(syntax, scope) {
    var joins = new SQLJoinStatements(), dataMappings = [mapping],
        where = service.stringify(syntax, scope, dataMappings, null, joins);
    return {
        joins: joins,
        where: where.trim(),
        mappingsAfter: dataMappings.length + "/" + dataMappings.aliases.filter(Boolean).length,
        sql: 'SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization"' +
            (joins.size ? " " + joins.toString() : "") + (where ? "  WHERE (" + where + ")" : "")
    };
}

var A = "00000000-0000-0000-0000-000000000002",
    B = "00000000-0000-0000-0000-000000000003",
    cases = {
        ancestorNamed: sql(block("filterBlock", trav("parent"), eq(prop("name"), param("name"))), {name: "a"}),
        descendantNamed: sql(block("filterBlock", trav("suborganizations"), eq(prop("name"), param("name"))), {name: "x"}),
        childNamed: sql(block("someBlock", trav("suborganizations", [lit(1)]), eq(prop("name"), lit("a1")))),
        selfOrChildNamed: sql(block("filterBlock", trav("suborganizations", [lit(0), lit(1)]), eq(prop("name"), lit("a")))),
        hasAncestor: sql(call("has", trav("parent"), param("org")), {org: B}),
        hasAncestorObject: sql(call("has", trav("parent"), param("org")), {org: {dataIdentifier: {primaryKey: B}}}),
        rootNamed: sql(eq(prop("name", call("last", trav("parent"))), lit("root"))),
        nearestAncestorNamed: sql(eq(prop("name", call("one", trav("parent"))), lit("a1"))),
        twoAncestors: sql(call("and", call("has", trav("parent"), param("a")), call("has", trav("parent"), param("b"))), {a: A, b: B}),
        ancestorOrNamed: sql(call("or", call("has", trav("parent"), param("org")), eq(prop("name"), lit("cyc1"))), {org: B}),
        liveDepth: sql(block("filterBlock", trav("suborganizations", [param("depth")]), eq(prop("name"), lit("x"))), {depth: 1}),
        unsetDepth: sql(block("filterBlock", trav("suborganizations", [param("depth")]), eq(prop("name"), lit("x"))), {}),
        hasNull: sql(call("has", trav("parent"), param("org")), {org: null}),
        cycleDescendant: sql(block("filterBlock", trav("suborganizations"), eq(prop("name"), lit("cyc1"))))
    };

var c = cases.ancestorNamed;
assert.strictEqual(c.joins.size, 1);
assert(/^JOIN LATERAL \(WITH RECURSIVE/.test(c.joins.toString()));
assert(c.sql.includes('ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]'));
assert(c.sql.includes('WHERE "__traverse_node"."id" = "Organization"."id"'));
assert(/^"traverse_parent_[0-9a-z]+"\."name" = 'a'$/.test(c.where), c.where);
assert(!c.sql.includes('"__traverse_depth" <'), "no maximum depth");
assert(c.sql.includes('"__traverse_depth" >= 1'));
assert(cases.descendantNamed.sql.includes('ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds")'));
assert(cases.descendantNamed.sql.includes('SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS'));
assert(cases.childNamed.sql.includes('WHERE "__traverse"."__traverse_depth" < 1'));
assert(cases.selfOrChildNamed.sql.includes('>= 0') && cases.selfOrChildNamed.sql.includes('< 1'));
// has(): the traversal is the left side of the existing @> handling
assert(/^ARRAY\["traverse_parent_[0-9a-z]+"\."id"\] @> ARRAY\['00000000-0000-0000-0000-000000000003'\]::uuid\[\]$/.test(cases.hasAncestor.where), cases.hasAncestor.where);
assert.strictEqual(cases.hasAncestor.where.replace(/_[0-9a-z]+"/, ""), cases.hasAncestorObject.where.replace(/_[0-9a-z]+"/, ""));
assert(/@> ARRAY\[NULL\]::uuid\[\]$/.test(cases.hasNull.where), cases.hasNull.where);
// nothing a traversal pushes on dataMappings outlives what consumes it
Object.keys(cases).forEach(function (k) { assert.strictEqual(cases[k].mappingsAfter, "1/0", k + " leaves dataMappings as it found it"); });
assert(cases.rootNamed.sql.includes('DESC LIMIT 1'));
assert(/^"traverse_parent_[0-9a-z]+"\."name" = 'root'$/.test(cases.rootNamed.where), cases.rootNamed.where);
assert(cases.nearestAncestorNamed.sql.includes('ASC LIMIT 1'));
assert.strictEqual(cases.twoAncestors.joins.size, 2, "two traversals are two independent joins");
// ||: the right side still resolves against Organization, and the traversal becomes a LEFT JOIN LATERAL
assert(/^\(ARRAY\["traverse_parent_[0-9a-z]+"\."id"\] @> ARRAY\['[0-9a-f-]+'\]::uuid\[\] OR "Organization"\."name" = 'cyc1'\)$/.test(cases.ancestorOrNamed.where), cases.ancestorOrNamed.where);
assert(/^LEFT JOIN LATERAL \(WITH RECURSIVE/.test(cases.ancestorOrNamed.joins.toString()));
assert(cases.unsetDepth.sql.includes('WHERE FALSE UNION ALL'));
assert(cases.liveDepth.sql.includes('< 1'));
assert(/^LATERAL \(WITH RECURSIVE/.test(c.joins.fromClauseQualifiedRightDataSetsString));
// the same syntax node stringifies to the same SQL every time
var again = block("filterBlock", trav("parent"), eq(prop("name"), lit("a")));
assert.strictEqual(sql(again).sql, sql(again).sql);
// plain joins are unchanged
var plain = new SQLJoin();
plain.rightDataSetSchema = "s"; plain.rightDataSet = "T"; plain.rightDataSetAlias = "a"; plain.onCondition = "x";
assert.strictEqual(plain.toString(), 'JOIN "s"."T" "a" ON x');

function throws(syntax, scope, re) { assert.throws(function () { sql(syntax, scope); }, re); }
throws(eq(prop("name", trav("parent")), lit("root")), {}, /traverse\{…\} is an array/);
throws(block("everyBlock", trav("parent"), eq(prop("name"), lit("x"))), {}, /'everyBlock' isn't supported/);
throws(call("last", trav("suborganizations")), {}, /only supported for a to-one step/);
throws(block("filterBlock", trav("name"), eq(prop("name"), lit("x"))), {}, /'name' isn't a relationship/);
throws(block("filterBlock", trav("label"), eq(prop("name"), lit("x"))), {}, /must stay in the same table/);
throws(block("filterBlock", trav("parent", [lit(-1)]), eq(prop("name"), lit("x"))), {}, /non-negative integer/);
throws(block("filterBlock", trav("parent", [lit(1.5)]), eq(prop("name"), lit("x"))), {}, /non-negative integer/);
throws(block("filterBlock", trav("parent", [lit("1; DROP TABLE x")]), eq(prop("name"), lit("x"))), {}, /non-negative integer/);
throws(block("filterBlock", {type: "traverseBlock", args: [V, prop("name", prop("parent"))]}, eq(prop("name"), lit("x"))), {}, /single relationship/);
throws(call("and", trav("parent"), eq(prop("name"), lit("x"))), {}, /'and' isn't supported/);
throws(call("has", trav("parent"), param("org")), {org: [B]}, /not an array/);
throws(call("intersects", trav("parent"), param("org")), {org: B}, /'intersects' isn't supported/);

if (require.main === module) {
    if (process.argv[2] === "--print") {
        Object.keys(cases).forEach(function (k) { console.log("-- " + k + "\n" + cases[k].sql + ";\n"); });
    }
    console.log("pg-traverse: all checks passed");
}
module.exports = cases;
