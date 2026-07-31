# [Convert a row to a nested JSON document containing all relations](https://dba.stackexchange.com/questions/247241/convert-a-row-to-a-nested-json-document-containing-all-relations)

Ask Question
Asked 6 years, 6 months ago
Modified 6 years, 6 months ago
Viewed 2k times

In PostgreSQL 10.10, I have created a trigger function in PL/pgSQL that converts the NEW row to a JSON object using to_jsonb(NEW). But now I need to include the records on the other side of the foreign keys of the NEW record in the JSON object in a nested fashion.

For example:

before:

`employee = { 
    "id": 1,
    "name": "myname", 
    "department": 2, 
    "phone_no": 
    "123456789" 
}`

after:

employee = {
"id": 1,
"name": "myname",
"department": {
"id": 2,
"name": "IT"
},
"phone_no": "123456789"
}

What is the best and most generic way to accomplish this without prior knowledge about the schema of the NEW record? I need to keep this trigger function as generic as possible because I plan to use it on all tables. One level of depth in following foreign keys is currently enough for me. Also to simplify, I can assume that all foreign keys should be a single column.

As I understand, I need to loop over all columns in the NEW record, find out if the column is a foreign key using information_schema or pg_catalog, find the foreign key details like to which column on which table it points to, then perform a dynamic SQL SELECT (because I presume table and column names would be strings, not SQL identifiers) over the target table for the target record, convert the record to JSON and finally assign it to the appropriate key of the top-level row JSON object.

I'm yet trying to write the actual working code for this, for which I welcome any help or directions. And there might be simpler solutions to this problem, which I would like to know about.
postgresqltriggerjsondynamic-sqlplpgsql
Share
Improve this question
Follow
edited Sep 16, 2019 at 4:28
asked Sep 7, 2019 at 3:59
zaadeh's user avatar
zaadeh
48511 gold badge55 silver badges9

1 Answer:

Your guess is pretty close, you'll need dynamic SQL.

But this should be considerably faster and more elegant than looping through all columns in the NEW record etc.:

CREATE OR REPLACE FUNCTION trg_jsonb_row_with_fk()
RETURNS trigger AS
$func$
DECLARE
_sql text;
_jsonb_row jsonb;
BEGIN
SELECT 'SELECT to_jsonb($1) || '
|| string_agg(
format('(SELECT jsonb_build_object(%1$L, t.*)
FROM %2$s t WHERE %3$I = $1.%1$I)'
, a.attname                 -- %1$L, %1$I
, c.confrelid::regclass     -- %2$s
, f.attname)                -- %3$I
, ' || ')
FROM   pg_constraint c
JOIN   pg_attribute  a ON a.attrelid = c.conrelid
JOIN   pg_attribute  f ON f.attrelid = c.confrelid
WHERE  c.conrelid = TG_RELID
AND    c.contype  = 'f'               -- to select only FK constraints
AND    a.attnum   = c.conkey[1]       -- assuming only single-col FKs!
AND    f.attnum   = c.confkey[1]
INTO   _sql;

IF FOUND THEN                         -- FKs found
EXECUTE _sql USING NEW INTO _jsonb_row;
ELSE                                  -- no FKs found, plain conversion
_jsonb_row := to_jsonb(NEW);
END IF;

RAISE NOTICE '%', _jsonb_row;         -- do something with it ...
RETURN NEW;                           -- proceed with org. row
END
$func$  LANGUAGE plpgsql;
Example trigger using above function:

CREATE TRIGGER upd_bef_jsonb_row_with_fk
BEFORE UPDATE ON tbl
FOR EACH ROW EXECUTE PROCEDURE trg_jsonb_row_with_fk();
This builds subqueries for all FKs from the [Postgres catalog tables](https://www.postgresql.org/docs/current/catalogs.html) and executes the SQL command dynamically. For simplicity, I include all user columns from corresponding rows in lookup tables (t.*).

Nitpick: jsonb_build_object(%1$L, t.*), not jsonb_build_object(%1$L, t).
Seems like adding noise, but it avoids a corner case problem: This is supposed to work for any input table, and one might contain a column named t. Then the name t in above expression would resolve to the column instead of the table alias (the whole row). Using t.* removes this ambiguity as it can only resolve to the whole row. (Parentheses would be required to refer to a composite type column, like (t).*). Read the manual [here](https://www.postgresql.org/docs/current/sql-expressions.html#FIELD-SELECTION) and [here](https://www.postgresql.org/docs/current/rowtypes.html#ROWTYPES-USAGE).

Since it uses the column name of original FK columns as key name for extended objects, plain [concatenation with ||](https://www.postgresql.org/docs/current/functions-json.html#FUNCTIONS-JSONB-OP-TABLE) does what you need: it replaces the existing simple value with the jsonb object.

Further reading:

[Retrieving all PK and FK](https://dba.stackexchange.com/questions/36979/retrieving-all-pk-and-fk/37068#37068)
[How to access NEW or OLD field given only the field&#39;s name?](https://dba.stackexchange.com/questions/61271/how-to-access-new-or-old-field-given-only-the-fields-name/61304#61304)

edited Sep 16, 2019 at 12:39
answered Sep 15, 2019 at 23:27
[Erwin Brandstetter](https://dba.stackexchange.com/users/3684/erwin-brandstetter)
