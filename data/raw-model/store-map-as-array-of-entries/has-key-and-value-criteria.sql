SELECT *
FROM event_test, unnest(participationstatuslog) AS participationstatuslog_entry -- implicit lateral join
WHERE participationstatuslog_entry.key = 'Accepted'
and participationstatuslog_entry.value > '2016-05-08 20:30:00+00'::timestamptz
