/*
    References:

    For Remove multiple elements:

    This answer is the simplest I think: https://stackoverflow.com/a/6535089/673187

        SELECT array(SELECT unnest(:array1) EXCEPT SELECT unnest(:array2) order by 1);
        SELECT array(SELECT unnest(array['a', 'b', 'c','d','e','f','g','h','i','j','k','l','m']) EXCEPT SELECT unnest(array['a', 'c', 'e']) order by 1);



    so you can easily use it in an UPDATE command, when you need to remove some elements from an array column:

        UPDATE table1 SET array1_column=(SELECT array(SELECT unnest(array1_column) EXCEPT SELECT unnest('{2, 3}'::int[])));

    https://stackoverflow.com/questions/6533029/how-to-compare-two-arrays-and-pick-only-the-non-matching-elements-in-postgres/6535089#6535089
    https://stackoverflow.com/questions/37917905/how-to-remove-elements-of-array-in-postgresql


    To add elements without creating duplicates:

    This one has the benefit of using only one unnest, and "order by 1" allows to keep the order:

    select array(select distinct unnest(array['a', 'b', 'c','d','e','f','g','h','i','j','k','l','m'] || '{a,o,p}') order by 1)

    This one uses 2 unnest:

    SELECT array(SELECT unnest(array['a', 'b', 'c','d','e','f','g','h','i','j','k','l','m']) union SELECT unnest(array['a', 'o', 'p']) order by 1);


    Going to use functions from

    https://github.com/PhrontHQ/postgresql-anyarray

    forked from https://github.com/JDBurnZ/postgresql-anyarray



    We use:
    - anyarray_concat_uniq();
    - from https://github.com/PhrontHQ/postgresql-anyarray/blob/master/stable/anyarray_concat_uniq.sql

    anyarray_remove()
    - from https://github.com/PhrontHQ/postgresql-anyarray/blob/master/stable/anyarray_remove.sql


*/


