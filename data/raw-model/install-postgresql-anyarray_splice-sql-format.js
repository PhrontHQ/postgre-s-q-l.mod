

exports.format = (schema) => {

    return `DROP FUNCTION IF EXISTS "${schema}".anyarray_splice(input_array anyarray, start_index integer, delete_count integer, insert_items anyarray);
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
    $BODY$ LANGUAGE plpgsql;

    
    DROP FUNCTION IF EXISTS "${schema}".anyarray_splice(anyarray, jsonb);
    CREATE OR REPLACE FUNCTION "${schema}".anyarray_splice(
        input_array anyarray,
        splice_ops jsonb
    )
    RETURNS anyarray AS
    $BODY$
    DECLARE
        result_array input_array%TYPE;
        op jsonb;

        start_index integer;
        delete_count integer;
        insert_items input_array%TYPE;

        array_type_text text;
        empty_same  input_array%TYPE;
    BEGIN
        IF splice_ops IS NULL OR jsonb_typeof(splice_ops) <> 'array' THEN
            RAISE EXCEPTION 'splice_ops must be a JSON array';
        END IF;

        IF input_array IS NULL THEN
            empty_same := insert_items[0:-1];
            input_array := empty_same; -- treat NULL as empty array for splicing
        END IF;

        result_array := input_array;
        array_type_text := pg_typeof(input_array)::text;

        FOR op IN
            SELECT value
            FROM jsonb_array_elements(splice_ops)
        LOOP
            IF jsonb_typeof(op) <> 'array' THEN
                RAISE EXCEPTION 'Each splice operation must be a JSON array';
            END IF;

            IF jsonb_array_length(op) < 2 THEN
                RAISE EXCEPTION 'Each splice operation must contain at least [start_index, delete_count]';
            END IF;

            start_index := (op ->> 0)::integer;
            delete_count := COALESCE((op ->> 1)::integer, 0);

            IF jsonb_array_length(op) > 2 THEN
                EXECUTE format(
                    'SELECT ARRAY(
                        SELECT jsonb_array_elements_text(to_jsonb(ARRAY(SELECT jsonb_array_elements($1) OFFSET 2)))
                    )::%s',
                    array_type_text
                )
                INTO insert_items
                USING op;
            ELSE
                insert_items := input_array[0:-1];
            END IF;

            result_array := "${schema}".anyarray_splice(
                result_array,
                start_index,
                delete_count,
                insert_items
            );
        END LOOP;

        RETURN result_array;
    END;
$BODY$ LANGUAGE plpgsql;`
};
