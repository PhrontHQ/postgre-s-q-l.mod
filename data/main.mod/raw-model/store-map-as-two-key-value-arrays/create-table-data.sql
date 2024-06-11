DROP TABLE IF EXISTS event_test2;

CREATE TABLE "event_test2"
(
	id uuid,
   	keys text[],
   	values timestamp with time zone[]

);
CREATE INDEX event_keys_idx ON event_test2 (keys);
CREATE INDEX event_values_idx ON event_test2 (values);

INSERT INTO event_test2 VALUES
(
	'7aeaf71a-653e-4615-b2d9-211ae41be088', array['Accepted']::text[], array['2016-05-09 20:30:00+00']::timestamp with time zone[]
),
(
	'f6aab9f5-c113-4c2f-bd6f-86fce1e476c1', array['Accepted','InvitedIn']::text[], array['2016-05-04 15:40:20+00','2016-05-04 15:50:20+00']::timestamp with time zone[]
)
;

SELECT id, keys, values, max(values_rows) as maxValue
FROM event_test2, unnest(values) AS values_rows
WHERE keys @> '{Accepted}'
group by id, keys, values
