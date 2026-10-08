-- Promemoria vocali: schema iniziale
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'altro',
  priority TEXT NOT NULL DEFAULT 'normale',
  kind TEXT NOT NULL DEFAULT 'cosa_da_fare',
  due_date TEXT,              -- YYYY-MM-DD (ora locale)
  due_time TEXT,              -- HH:MM (ora locale)
  remind_at TEXT,             -- YYYY-MM-DDTHH:MM (ora locale) quando notificare
  remind_at_utc INTEGER,      -- stesso istante in ms UTC
  recurrence TEXT NOT NULL DEFAULT 'nessuna',
  notified INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  place_query TEXT,
  place_name TEXT,
  place_address TEXT,
  place_lat REAL,
  place_lon REAL,
  distance_m REAL,
  drive_min REAL,
  walk_min REAL,
  source_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (done, notified, remind_at_utc);

CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
