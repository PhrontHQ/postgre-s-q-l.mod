 CREATE TYPE "PhoneNumber" AS
   (
       countryCode text,
       nationalNumber text,
	   extension text
   );


-- https://medium.com/@andersonantunes/postgresql-working-with-composite-types-in-sql-queries-84767c71f7ab
-- create type tp_x as
-- (
--  a integer,
--  b text,
--  c boolean
-- );

-- select (1, 'Sample 1', true)::tp_x





-- http://www.sqlines.com/postgresql/how-to/create_user_defined_type

-- Create a Composite Type
-- CREATE TYPE allows you to create a composite type containing multiple fields:

--    CREATE TYPE full_address AS
--    (
--        city VARCHAR(90),
--        street VARCHAR(90)
--    );
-- Note that you cannot specify NOT NULL, DEFAULT and CHECK constraints for type items.

-- Let's create a table, insert and query data:

--    CREATE TABLE shipping
--    (
--       name VARCHAR(50),
--       address full_address
--    );

--    INSERT INTO shipping VALUES ('John', ('Northampton', 'Tower St'));
--    -- or
--    INSERT INTO shipping VALUES ('Tom', ROW('Bracknell', 'Market St'));
-- To access a type field use the syntax: (column_name).field:

--    -- Select full composite type
--    SELECT address FROM shipping;
-- Result:

-- address
-- (Northampton,”Tower St”)
-- (Bracknell,”Market St”)
--    -- Select each field separately
--    SELECT (address).city, (address).street FROM shipping;
-- Result:

-- city	street
-- Northampton	Tower St
-- Bracknell	Market St
