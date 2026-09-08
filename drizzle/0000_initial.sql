CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`weight_unit` text DEFAULT 'kg' NOT NULL,
	`distance_unit` text DEFAULT 'km' NOT NULL,
	`default_rest_seconds` integer DEFAULT 90 NOT NULL,
	`height_cm` real,
	`birth_date` text,
	`gender` text,
	`goal` text,
	`theme` text DEFAULT 'system' NOT NULL,
	`rest_timer_sound` integer DEFAULT true NOT NULL,
	`rest_timer_vibrate` integer DEFAULT true NOT NULL,
	`language` text DEFAULT 'tr' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `body_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`weight_kg` real,
	`body_fat_pct` real,
	`waist_cm` real,
	`chest_cm` real,
	`arm_cm` real,
	`thigh_cm` real,
	`hip_cm` real,
	`neck_cm` real,
	`notes` text,
	`photo_path` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_body_metrics_date` ON `body_metrics` (`date`);--> statement-breakpoint
CREATE TABLE `cardio_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`distance_km` real,
	`avg_heart_rate` integer,
	`max_heart_rate` integer,
	`calories_kcal` integer,
	`avg_pace_seconds_per_km` integer,
	`elevation_gain_m` real,
	`cardio_type` text DEFAULT 'steady' NOT NULL,
	`perceived_effort` integer,
	`external_source` text,
	`external_id` text,
	`route_polyline` text,
	`notes` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_cardio_segments_session` ON `cardio_segments` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_cardio_segments_exercise` ON `cardio_segments` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_tr` text,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text,
	`equipment` text,
	`mechanic` text,
	`force` text,
	`category` text NOT NULL,
	`level` text,
	`instructions` text,
	`image_paths` text,
	`is_custom` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exercises_category` ON `exercises` (`category`);--> statement-breakpoint
CREATE INDEX `idx_exercises_archived` ON `exercises` (`is_archived`);--> statement-breakpoint
CREATE TABLE `routine_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`target_sets` integer,
	`target_reps` text,
	`target_weight_kg` real,
	`target_rir` integer,
	`target_duration_seconds` integer,
	`target_distance_km` real,
	`target_pace_seconds_per_km` integer,
	`rest_seconds` integer DEFAULT 90 NOT NULL,
	`notes` text,
	`superset_group` integer,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_routine_exercises_routine` ON `routine_exercises` (`routine_id`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`estimated_duration_min` integer,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`superset_group` integer,
	`notes` text,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_session_exercises_session` ON `session_exercises` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_exercises_exercise` ON `session_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_exercise_id` text NOT NULL,
	`set_number` integer NOT NULL,
	`set_type` text DEFAULT 'normal' NOT NULL,
	`reps` integer,
	`weight_kg` real,
	`rir` integer,
	`rpe` real,
	`is_completed` integer DEFAULT false NOT NULL,
	`rest_taken_seconds` integer,
	`notes` text,
	`completed_at` text,
	FOREIGN KEY (`session_exercise_id`) REFERENCES `session_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sets_session_exercise` ON `sets` (`session_exercise_id`);--> statement-breakpoint
CREATE INDEX `idx_sets_completed_at` ON `sets` (`completed_at`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text,
	`name` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_seconds` integer,
	`notes` text,
	`bodyweight_kg` real,
	`perceived_difficulty` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_started_at` ON `workout_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_routine` ON `workout_sessions` (`routine_id`);