SELECT *
FROM event_test, unnest(participationstatuslog) AS participationstatuslog_entry -- implicit lateral join
WHERE participationstatuslog_entry.key = 'Invited'
