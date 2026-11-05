-- TEST_CASES_SAVED audit events were written without an actor.
-- Fill the actor from the session that saved the cases (test_sessions.created_by).
-- Rows whose session has no creator stay empty and still show as "System".
update project_audit_events e
   set actor_id = s.created_by
  from test_sessions s
 where e.event_type = 'TEST_CASES_SAVED'
   and e.actor_id is null
   and e.session_id = s.id
   and s.created_by is not null;
