-- Domande di Siri in attesa di risposta ("alle 7 di mattina o di sera?")
CREATE TABLE IF NOT EXISTS pending (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  question TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
