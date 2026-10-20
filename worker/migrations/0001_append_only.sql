-- The quote book and the events log are append-only: nothing may edit or remove a row.
CREATE TRIGGER `quotes_no_update` BEFORE UPDATE ON `quotes`
BEGIN
  SELECT RAISE(ABORT, 'quotes are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `quotes_no_delete` BEFORE DELETE ON `quotes`
BEGIN
  SELECT RAISE(ABORT, 'quotes are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;
