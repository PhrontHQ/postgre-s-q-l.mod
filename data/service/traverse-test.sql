-- traverse{} SQL check for PostgreSQL 18 (CYCLE needs 14+).
--
-- Everything runs inside one transaction in a throwaway schema, traverse_test,
-- and ends with ROLLBACK, so nothing is left in your database. In psql, run
--     \set ON_ERROR_STOP on
-- first: after an error the transaction is aborted and the remaining
-- statements fail anyway.
--
-- Sections 2 and 3 are plain recursive queries. If they work but section 4
-- fails, the problem is the LATERAL correlation, not the recursion.
-- Section 5 is the SQL pg-traverse.js and the pgstringify.js patch generate,
-- copied verbatim from pg-traverse-harness.js --print, with the expected rows
-- above each query.
-- The statements use the service's SELECT DISTINCT to_jsonb(...) shape, so each
-- row comes back as {"id": ..., "name": ...} in no particular order.

BEGIN;

-- 1. Test data -------------------------------------------------------------
--
--   root ─┬─ a ─┐
--         └─ b ─┴─ a1 ── x      a1 has two parents, so it is reached twice
--   cyc1 ⇄ cyc2                 a cycle
--
-- Like your Organization table, the relationship is stored only as
-- "suborganizationIds" uuid[]; parent is its inverse.

CREATE SCHEMA traverse_test;
CREATE TABLE traverse_test."Organization" (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    "suborganizationIds" uuid[] NOT NULL DEFAULT '{}'
);
-- Serves "suborganizationIds" @> ARRAY[id] (walking up). Worth adding on the real table too.
CREATE INDEX ON traverse_test."Organization" USING GIN ("suborganizationIds");

INSERT INTO traverse_test."Organization" (id, name, "suborganizationIds") VALUES
    ('00000000-0000-0000-0000-000000000001', 'root', ARRAY['00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000003'::uuid]),
    ('00000000-0000-0000-0000-000000000002', 'a', ARRAY['00000000-0000-0000-0000-000000000004'::uuid]),
    ('00000000-0000-0000-0000-000000000003', 'b', ARRAY['00000000-0000-0000-0000-000000000004'::uuid]),
    ('00000000-0000-0000-0000-000000000004', 'a1', ARRAY['00000000-0000-0000-0000-000000000005'::uuid]),
    ('00000000-0000-0000-0000-000000000005', 'x', '{}'::uuid[]),
    ('00000000-0000-0000-0000-000000000006', 'cyc1', ARRAY['00000000-0000-0000-0000-000000000007'::uuid]),
    ('00000000-0000-0000-0000-000000000007', 'cyc2', ARRAY['00000000-0000-0000-0000-000000000006'::uuid]);

-- 2. Descendants of root, walking down through the array ---------------------
-- Expected (name, depth): root 0, a 1, b 1, a1 2, a1 2, x 3, x 3
WITH RECURSIVE t AS (
    SELECT o.id, o."suborganizationIds", 0 AS depth
    FROM traverse_test."Organization" o WHERE o.name = 'root'
  UNION ALL
    SELECT n.id, n."suborganizationIds", t.depth + 1
    FROM t JOIN traverse_test."Organization" n ON n.id = ANY(t."suborganizationIds")
) CYCLE id SET is_cycle USING path
SELECT o.name, t.depth
FROM t JOIN traverse_test."Organization" o ON o.id = t.id
WHERE NOT t.is_cycle
ORDER BY t.depth, o.name;

-- 3. Ancestors of x, walking up: "the rows whose array contains me" ----------
-- Expected (name, depth): x 0, a1 1, a 2, b 2, root 3, root 3
WITH RECURSIVE t AS (
    SELECT o.id, 0 AS depth
    FROM traverse_test."Organization" o WHERE o.name = 'x'
  UNION ALL
    SELECT n.id, t.depth + 1
    FROM t JOIN traverse_test."Organization" n ON n."suborganizationIds" @> ARRAY[t.id]
) CYCLE id SET is_cycle USING path
SELECT o.name, t.depth
FROM t JOIN traverse_test."Organization" o ON o.id = t.id
WHERE NOT t.is_cycle
ORDER BY t.depth, o.name;

-- 4. The recursion started from each outer row (JOIN LATERAL) ----------------
-- Expected (name, descendants): a 2, a1 1, b 2, cyc1 1, cyc2 1, root 6
-- (x has none, so the inner JOIN drops it.)
SELECT o.name, d.descendants
FROM traverse_test."Organization" o
JOIN LATERAL (
    WITH RECURSIVE t AS (
        SELECT n.id, n."suborganizationIds", 0 AS depth
        FROM traverse_test."Organization" n WHERE n.id = o.id
      UNION ALL
        SELECT n.id, n."suborganizationIds", t.depth + 1
        FROM t JOIN traverse_test."Organization" n ON n.id = ANY(t."suborganizationIds")
    ) CYCLE id SET is_cycle USING path
    SELECT count(*) AS descendants FROM t WHERE NOT t.is_cycle AND t.depth >= 1
    HAVING count(*) > 0
) d ON true
ORDER BY o.name;

-- 4b. has() with null ------------------------------------------------------
-- traverse{…}.has(null) becomes ARRAY[id] @> ARRAY[NULL]::uuid[]. That must be
-- false, not NULL, so hasNull in section 5 matches nothing.
-- Expected: f
SELECT ARRAY['00000000-0000-0000-0000-000000000001'::uuid] @> ARRAY[NULL]::uuid[] AS contains_null;

-- 5. Generated SQL, one query per criteria ---------------------------------

-- ancestorNamed: traverse{parent}.filter{name == $name}
--   parameters: {name: "a"}
--   expected: a1, x
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_0" ON true  WHERE (  "traverse_parent_0"."name" = 'a');

-- descendantNamed: traverse{suborganizations}.filter{name == $name}
--   parameters: {name: "x"}
--   expected: root, a, b, a1
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds")) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_suborganizations_1" ON true  WHERE (  "traverse_suborganizations_1"."name" = 'x');

-- childNamed: traverse(1){suborganizations}.some{name == 'a1'}
--   expected: a, b
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds") WHERE "__traverse"."__traverse_depth" < 1) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_suborganizations_2" ON true  WHERE (  "traverse_suborganizations_2"."name" = 'a1');

-- selfOrChildNamed: traverse(0, 1){suborganizations}.filter{name == 'a'}
--   expected: root, a   (a matches itself at depth 0)
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds") WHERE "__traverse"."__traverse_depth" < 1) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 0) "traverse_suborganizations_3" ON true  WHERE (  "traverse_suborganizations_3"."name" = 'a');

-- hasAncestor: traverse{parent}.has($org)
--   parameters: {org: <id of b>}
--   expected: a1, x
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_4" ON true  WHERE (ARRAY["traverse_parent_4"."id"] @> ARRAY['00000000-0000-0000-0000-000000000003']::uuid[]);

-- hasAncestorObject: traverse{parent}.has($org)
--   parameters: {org: <the b object>}
--   expected: a1, x   (same SQL as hasAncestor)
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_5" ON true  WHERE (ARRAY["traverse_parent_5"."id"] @> ARRAY['00000000-0000-0000-0000-000000000003']::uuid[]);

-- rootNamed: traverse{parent}.last().name == 'root'
--   expected: a, b, a1, x   (cyc1/cyc2 never reach root; root has no ancestors)
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1 ORDER BY "__traverse"."__traverse_depth" DESC LIMIT 1) "traverse_parent_6" ON true  WHERE ("traverse_parent_6"."name" = 'root');

-- nearestAncestorNamed: traverse{parent}.one().name == 'a1'
--   expected: x
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1 ORDER BY "__traverse"."__traverse_depth" ASC LIMIT 1) "traverse_parent_7" ON true  WHERE ("traverse_parent_7"."name" = 'a1');

-- twoAncestors: traverse{parent}.has($a) && traverse{parent}.has($b)
--   parameters: {a: <id of a>, b: <id of b>}
--   expected: a1, x   (two independent joins: with one shared join this would return nothing)
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_8" ON true JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_9" ON true  WHERE (ARRAY["traverse_parent_8"."id"] @> ARRAY['00000000-0000-0000-0000-000000000002']::uuid[] AND ARRAY["traverse_parent_9"."id"] @> ARRAY['00000000-0000-0000-0000-000000000003']::uuid[]);

-- ancestorOrNamed: traverse{parent}.has($org) || name == 'cyc1'
--   parameters: {org: <id of b>}
--   expected: a1, x, cyc1   (|| makes the join a LEFT JOIN LATERAL, so rows without ancestors are kept)
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" LEFT JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_a" ON true  WHERE ((ARRAY["traverse_parent_a"."id"] @> ARRAY['00000000-0000-0000-0000-000000000003']::uuid[] OR "Organization"."name" = 'cyc1'));

-- liveDepth: traverse($depth){suborganizations}.filter{name == 'x'}
--   parameters: {depth: 1}
--   expected: a1
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds") WHERE "__traverse"."__traverse_depth" < 1) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_suborganizations_b" ON true  WHERE (  "traverse_suborganizations_b"."name" = 'x');

-- unsetDepth: traverse($depth){suborganizations}.filter{name == 'x'}
--   parameters: {}  ($depth unset)
--   expected: no rows   (never "unbounded")
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE FALSE UNION ALL SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds")) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_suborganizations_c" ON true  WHERE (  "traverse_suborganizations_c"."name" = 'x');

-- hasNull: traverse{parent}.has($org)
--   parameters: {org: null}
--   expected: no rows
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."suborganizationIds" @> ARRAY["__traverse"."id"]) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_parent_d" ON true  WHERE (ARRAY["traverse_parent_d"."id"] @> ARRAY[NULL]::uuid[]);

-- cycleDescendant: traverse{suborganizations}.filter{name == 'cyc1'}
--   expected: cyc2   (cyc1 -> cyc2 -> cyc1 is cut, so cyc1 is not its own descendant)
SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT "Organization"."id","Organization"."name") as _) FROM "traverse_test"."Organization" JOIN LATERAL (WITH RECURSIVE "__traverse" AS (SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", 0 AS "__traverse_depth" FROM "traverse_test"."Organization" "__traverse_node" WHERE "__traverse_node"."id" = "Organization"."id" UNION ALL SELECT "__traverse_node"."id", "__traverse_node"."suborganizationIds", "__traverse"."__traverse_depth" + 1 FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = ANY("__traverse"."suborganizationIds")) CYCLE "id" SET "__traverse_is_cycle" USING "__traverse_path" SELECT "__traverse_node".*, "__traverse"."__traverse_depth" FROM "__traverse" JOIN "traverse_test"."Organization" "__traverse_node" ON "__traverse_node"."id" = "__traverse"."id" WHERE NOT "__traverse"."__traverse_is_cycle" AND "__traverse"."__traverse_depth" >= 1) "traverse_suborganizations_e" ON true  WHERE (  "traverse_suborganizations_e"."name" = 'cyc1');


ROLLBACK;

-- 6. On your real table ---------------------------------------------------
-- Replace "traverse_test" with your schema in any query of section 5 and
-- prefix it with EXPLAIN (ANALYZE, BUFFERS) to see the per-row recursion
-- cost. Walking up uses "suborganizationIds" @> ARRAY[id] at every level and
-- needs this index to avoid a sequential scan per level:
--
--   CREATE INDEX CONCURRENTLY ON "<schema>"."Organization" USING GIN ("suborganizationIds");
