exports.format = (schema) => {
    return `DROP FUNCTION IF EXISTS "${schema}".interval_subtype_diff(anyarray, interval);
    CREATE OR REPLACE FUNCTION "${schema}".interval_subtype_diff(x interval, y interval) RETURNS float8 AS
    'select extract(epoch from (x - y))' LANGUAGE sql STRICT IMMUTABLE;

    DROP TYPE IF EXISTS "${schema}".intervalrange;
    CREATE TYPE "${schema}".intervalrange AS RANGE (
        subtype = interval,
        subtype_diff = "${schema}".interval_subtype_diff
    );`;
};

