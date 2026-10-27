CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`hour` integer NOT NULL,
	`call_owner_first` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_run_on` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_one_per_order` ON `schedules` (`request_id`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`call_id` text,
	`heard` text,
	`said` text NOT NULL,
	`stopped` text,
	`numbers` text NOT NULL,
	`think_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `turns_call_idx` ON `turns` (`call_id`);--> statement-breakpoint
CREATE INDEX `turns_request_idx` ON `turns` (`request_id`);--> statement-breakpoint
ALTER TABLE `calls` ADD `callback_at` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `is_simulation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `buyer_phone` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `owner_updates` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The transcript is evidence like the quote book: nothing may edit or remove a turn.
CREATE TRIGGER `turns_no_update` BEFORE UPDATE ON `turns`
BEGIN
  SELECT RAISE(ABORT, 'turns are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `turns_no_delete` BEFORE DELETE ON `turns`
BEGIN
  SELECT RAISE(ABORT, 'turns are append-only');
END;
