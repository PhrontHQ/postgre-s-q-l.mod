DROP FUNCTION IF EXISTS interval_subtype_diff(anyarray, interval);
CREATE OR REPLACE FUNCTION interval_subtype_diff(x interval, y interval) RETURNS float8 AS
'select extract(epoch from (x - y))' LANGUAGE sql STRICT IMMUTABLE;

DROP TYPE IF EXISTS intervalrange;
CREATE TYPE intervalrange AS RANGE (
    subtype = interval,
    subtype_diff = interval_subtype_diff
);

SELECT '[- 1-1 1 03:10:10, - 0-1 1 03:10:10]'::intervalrange, interval_subtype_diff('- 1-1 1 03:10:10', '- 0-1 1 03:10:10')


