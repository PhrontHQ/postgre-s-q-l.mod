exports.format = (schema) => {

    return `DROP FUNCTION IF EXISTS "${schema}".anyarray_splice(anyarray, integer, anyarray);
    CREATE OR REPLACE FUNCTION "${schema}".anyarray_splice(input_array anyarray, start_index integer, delete_count integer, insert_items anyarray)
        RETURNS anyarray AS
    $BODY$
        DECLARE
        -- The variable used to track iteration over "input_array".
        loop_offset integer;
        -- The array to be returned by this function.
        return_array input_array%TYPE;

        arr_length integer;
        normalized_start integer;
        normalized_delete integer;
        left_part input_array%TYPE;
        right_part input_array%TYPE;
        empty_same  input_array%TYPE;

        BEGIN
            IF input_array IS NULL AND insert_items IS NULL THEN
                RAISE EXCEPTION 'input_array and insert_items cannot both be null';
            END IF;

            IF input_array IS NOT NULL THEN
                empty_same := input_array[0:-1];
            ELSE
                empty_same := insert_items[0:-1];
                input_array := empty_same; -- treat NULL as empty array for splicing
            END IF;

            arr_length := COALESCE(array_length(input_array, 1), 0);

            IF start_index IS NULL OR start_index < 1 THEN
                RAISE EXCEPTION 'start_index must be a positive 1-based index (got %)', start_index;
            END IF;


            -- Clamp start into bounds
            normalized_start := GREATEST(1, LEAST(start_index, arr_length + 1));

            normalized_delete := GREATEST(0, COALESCE(delete_count, 0));
            normalized_delete := LEAST(normalized_delete, arr_length - normalized_start + 1);


            -- Left side
            IF normalized_start > 1 THEN
                left_part := input_array[1 : normalized_start - 1];
            ELSE
                left_part := empty_same;
            END IF;

            -- Right side
            IF normalized_start + normalized_delete <= arr_length THEN
                right_part := input_array[normalized_start + normalized_delete : arr_length];
            ELSE
                right_part := empty_same;
            END IF;

            -- Final result
            return_array :=
                left_part
                || COALESCE(insert_items, input_array[0:-1])
                || right_part;

            RETURN return_array;
        END;
    $BODY$ LANGUAGE plpgsql;`
};
