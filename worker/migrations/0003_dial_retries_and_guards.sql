CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_created_idx` ON `login_attempts` (`created_at`);--> statement-breakpoint
DROP INDEX `calls_one_per_round`;--> statement-breakpoint
ALTER TABLE `calls` ADD `attempt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `calls` ADD `retryable` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `calls_one_per_round` ON `calls` (`request_id`,`supplier_id`,`round`,`attempt`);--> statement-breakpoint
CREATE INDEX `requests_item_key_idx` ON `requests` (lower(trim("item")),`unit`);