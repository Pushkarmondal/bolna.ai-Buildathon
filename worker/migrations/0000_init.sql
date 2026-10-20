CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`round` integer NOT NULL,
	`channel` text DEFAULT 'phone' NOT NULL,
	`bolna_execution_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`best_offer_said` text,
	`started_at` integer,
	`ended_at` integer,
	`recording_url` text,
	`transcript` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calls_request_idx` ON `calls` (`request_id`);--> statement-breakpoint
CREATE INDEX `calls_execution_idx` ON `calls` (`bolna_execution_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`call_id` text,
	`type` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_request_idx` ON `events` (`request_id`);--> statement-breakpoint
CREATE INDEX `events_call_idx` ON `events` (`call_id`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`call_id` text NOT NULL,
	`price` real NOT NULL,
	`unit` text NOT NULL,
	`pack_size` real,
	`pack_unit` text,
	`min_quantity` real,
	`delivery_date` text,
	`delivery_charge` real,
	`payment_terms` text,
	`landed_price_per_unit` real,
	`supplier_words` text NOT NULL,
	`read_back_confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quotes_request_idx` ON `quotes` (`request_id`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_name` text,
	`item` text,
	`quantity` real,
	`unit` text,
	`quality` text,
	`deliver_by` text,
	`area` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_quote_id` text,
	`is_practice` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`language` text DEFAULT 'hi' NOT NULL,
	`consent_note` text,
	`do_not_call` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `suppliers_request_idx` ON `suppliers` (`request_id`);--> statement-breakpoint
CREATE INDEX `suppliers_phone_idx` ON `suppliers` (`phone`);