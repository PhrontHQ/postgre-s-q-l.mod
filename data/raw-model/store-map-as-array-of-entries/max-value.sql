SELECT id, participationstatuslog, max(participationstatuslog_entry.value) as status
FROM event_test, unnest(participationstatuslog) AS participationstatuslog_entry -- implicit lateral join
Group by id, participationstatuslog
