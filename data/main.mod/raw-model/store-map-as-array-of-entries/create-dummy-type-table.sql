
DROP TABLE IF EXISTS event_test;
DROP TYPE IF EXISTS Event_participationStatusLog_Entry;
CREATE TYPE Event_participationStatusLog_Entry AS (
    key       text,
    value    timestamp with time zone
);

CREATE TABLE "event_test"
(
	id uuid,
  participationStatusLog Event_participationStatusLog_Entry[]
);
CREATE INDEX event_test_participationStatusLog_idx ON event_test  USING GIN (participationStatusLog); -- note the parentheses!

INSERT INTO event_test VALUES
(
	'7aeaf71a-653e-4615-b2d9-211ae41be088', array[('Accepted', '2016-05-09 20:30:00+00')]::Event_participationStatusLog_Entry[]
),
(
	'f6aab9f5-c113-4c2f-bd6f-86fce1e476c1', array[('Accepted', '2016-05-04 15:40:20+00'),('InvitedIn', '2016-05-04 15:40:20+00')]::Event_participationStatusLog_Entry[]
)
;


/*
    raw version of of anObject.participationstatuslog.has('InvitedIn')
*/
SELECT *
FROM event_test, unnest(participationstatuslog) AS participationstatuslog_entry -- implicit lateral join
WHERE participationstatuslog_entry.key = 'InvitedIn' -- random uuid
