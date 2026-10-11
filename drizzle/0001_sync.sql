-- v3.1a eşitleme: yalnızca EKLEME. Mevcut tablolara ve satırlara dokunulmuyor.
-- docs/sync-tasarim.md. Tablolar drizzle-kit'ten, trigger'lar elle
-- (drizzle şemada trigger tanımlayamıyor).
CREATE TABLE `sync_outbox` (
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`session_id` text,
	`changed_at` text NOT NULL,
	PRIMARY KEY(`table_name`, `row_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sync_outbox_session` ON `sync_outbox` (`session_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`tracking` integer DEFAULT false NOT NULL,
	`suppress` integer DEFAULT false NOT NULL,
	`owner_user_id` text,
	`initial_upload_done` integer DEFAULT false NOT NULL,
	`pull_cursor` text,
	`last_sync_at` text,
	`last_error` text
);

--> statement-breakpoint
-- Kayıt upsert ile (ON CONFLICT DO UPDATE). INSERT OR REPLACE KULLANMA:
-- FK cascade / set null içinden tetiklenen trigger'da SQLite dış işlemin
-- ABORT kuralını uyguluyor, REPLACE yok sayılıyor ve kullanıcının silmesi
-- UNIQUE hatasıyla geri alınıyor (rutin silme; test/syncMigration.test.ts).
--
-- Tek satırlık durum. tracking = 0: trigger'lar hiçbir şey yazmaz.
INSERT OR IGNORE INTO `sync_state` (`id`) VALUES (1);
--> statement-breakpoint
-- Rutinler: antrenmana bağlı değil, hemen gönderilir.
CREATE TRIGGER `sync_routines_ai` AFTER INSERT ON `routines`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('routines', NEW.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routines_au` AFTER UPDATE ON `routines`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('routines', NEW.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routines_ad` AFTER DELETE ON `routines`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('routines', OLD.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routine_exercises_ai` AFTER INSERT ON `routine_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('routine_exercises', NEW.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routine_exercises_au` AFTER UPDATE ON `routine_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('routine_exercises', NEW.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routine_exercises_ad` AFTER DELETE ON `routine_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('routine_exercises', OLD.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
-- Antrenman ağacı: session_id ile. Bitmemiş antrenmanın kayıtları gönderimde bekletilir.
CREATE TRIGGER `sync_workout_sessions_ai` AFTER INSERT ON `workout_sessions`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('workout_sessions', NEW.id, NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_workout_sessions_au` AFTER UPDATE ON `workout_sessions`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('workout_sessions', NEW.id, NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
-- Bitmiş antrenman silindi: silme kaydı (sunucuda yumuşak silme).
CREATE TRIGGER `sync_workout_sessions_ad` AFTER DELETE ON `workout_sessions`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND OLD.ended_at IS NOT NULL
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('workout_sessions', OLD.id, OLD.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
-- Bitmemiş antrenman silindi (vazgeç, boş antrenman temizliği): hiç
-- gönderilmedi, bütün kayıtları atılır. Cascade'de çocukların trigger'ları
-- bundan ÖNCE çalışıyor (denendi), onların kayıtları da burada siliniyor.
CREATE TRIGGER `sync_workout_sessions_ad_open` AFTER DELETE ON `workout_sessions`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND OLD.ended_at IS NULL
BEGIN
  DELETE FROM sync_outbox WHERE session_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_session_exercises_ai` AFTER INSERT ON `session_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('session_exercises', NEW.id, NEW.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_session_exercises_au` AFTER UPDATE ON `session_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('session_exercises', NEW.id, NEW.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_session_exercises_ad` AFTER DELETE ON `session_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM workout_sessions WHERE id = OLD.session_id AND ended_at IS NULL)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('session_exercises', OLD.id, OLD.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
-- Bitmemiş antrenmandan silinen satır hiç gönderilmedi: kaydı atılır.
CREATE TRIGGER `sync_session_exercises_ad_open` AFTER DELETE ON `session_exercises`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND EXISTS (SELECT 1 FROM workout_sessions WHERE id = OLD.session_id AND ended_at IS NULL)
BEGIN
  DELETE FROM sync_outbox WHERE table_name = 'session_exercises' AND row_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_cardio_segments_ai` AFTER INSERT ON `cardio_segments`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('cardio_segments', NEW.id, NEW.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_cardio_segments_au` AFTER UPDATE ON `cardio_segments`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('cardio_segments', NEW.id, NEW.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_cardio_segments_ad` AFTER DELETE ON `cardio_segments`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM workout_sessions WHERE id = OLD.session_id AND ended_at IS NULL)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('cardio_segments', OLD.id, OLD.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_cardio_segments_ad_open` AFTER DELETE ON `cardio_segments`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND EXISTS (SELECT 1 FROM workout_sessions WHERE id = OLD.session_id AND ended_at IS NULL)
BEGIN
  DELETE FROM sync_outbox WHERE table_name = 'cardio_segments' AND row_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_sets_ai` AFTER INSERT ON `sets`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('sets', NEW.id, (SELECT session_id FROM session_exercises WHERE id = NEW.session_exercise_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
CREATE TRIGGER `sync_sets_au` AFTER UPDATE ON `sets`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('sets', NEW.id, (SELECT session_id FROM session_exercises WHERE id = NEW.session_exercise_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
-- Cascade silmede hareket satırı önce siliniyor; antrenman kimliği bulunamazsa
-- upsert, setin giden kutusundaki önceki kaydında olanı koruyor.
CREATE TRIGGER `sync_sets_ad` AFTER DELETE ON `sets`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM session_exercises se JOIN workout_sessions ws ON ws.id = se.session_id
    WHERE se.id = OLD.session_exercise_id AND ws.ended_at IS NULL)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, session_id, changed_at)
  VALUES ('sets', OLD.id, COALESCE(
    (SELECT session_id FROM session_exercises WHERE id = OLD.session_exercise_id),
    (SELECT session_id FROM sync_outbox WHERE table_name = 'session_exercises' AND row_id = OLD.session_exercise_id)
  ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET
    session_id = COALESCE(excluded.session_id, sync_outbox.session_id),
    changed_at = excluded.changed_at;
END;
--> statement-breakpoint
-- Bitmemiş antrenmanda silinen set (ör. bitirirken boş setler): kaydı atılır.
CREATE TRIGGER `sync_sets_ad_open` AFTER DELETE ON `sets`
WHEN (SELECT tracking = 1 AND suppress = 0 FROM sync_state WHERE id = 1)
  AND EXISTS (SELECT 1 FROM session_exercises se JOIN workout_sessions ws ON ws.id = se.session_id
    WHERE se.id = OLD.session_exercise_id AND ws.ended_at IS NULL)
BEGIN
  DELETE FROM sync_outbox WHERE table_name = 'sets' AND row_id = OLD.id;
END;
