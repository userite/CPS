-- База blondina за CPS.
-- Локален SQLite файл: data/blondina.sqlite
-- Имената на таблиците са с префикс cps_.
--
-- Записът е: машина, параметър, време, стойност.
-- OEE не се смята тук. Формулата не е зададена.
-- Петият параметър не е именуван и не се създава от схемата.
-- range_min, range_max и sample_interval_seconds са празни, докато
-- не се попълнят от администрацията. Това не са утвърдени цехови граници.
-- NULL в cps_measurement.value е липсващо измерване, не нула.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cps_machine (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  model       TEXT,
  kind        TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('lathe', 'other')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS cps_parameter (
  id                       TEXT PRIMARY KEY,
  label                    TEXT NOT NULL,
  unit                     TEXT NOT NULL DEFAULT '',
  range_min                REAL,
  range_max                REAL,
  sample_interval_seconds  INTEGER,
  color                    TEXT,
  CHECK (
    sample_interval_seconds IS NULL OR sample_interval_seconds > 0
  ),
  CHECK (
    range_min IS NULL OR range_max IS NULL OR range_min <= range_max
  )
);

CREATE TABLE IF NOT EXISTS cps_machine_parameter (
  machine_id    TEXT NOT NULL REFERENCES cps_machine (id) ON DELETE CASCADE,
  parameter_id  TEXT NOT NULL REFERENCES cps_parameter (id) ON DELETE CASCADE,
  PRIMARY KEY (machine_id, parameter_id)
);

CREATE TABLE IF NOT EXISTS cps_measurement (
  machine_id    TEXT NOT NULL REFERENCES cps_machine (id) ON DELETE CASCADE,
  parameter_id  TEXT NOT NULL REFERENCES cps_parameter (id) ON DELETE CASCADE,
  measured_at   TEXT NOT NULL,
  value         REAL,
  PRIMARY KEY (machine_id, parameter_id, measured_at)
);

CREATE INDEX IF NOT EXISTS cps_measurement_machine_time
  ON cps_measurement (machine_id, measured_at DESC);

-- Статус и OEE се пазят само ако дойдат готови отвън.
CREATE TABLE IF NOT EXISTS cps_machine_state (
  machine_id           TEXT PRIMARY KEY REFERENCES cps_machine (id) ON DELETE CASCADE,
  status               TEXT NOT NULL CHECK (
    status IN ('running', 'idle', 'setup', 'warning', 'alarm', 'offline', 'unknown')
  ),
  oee                  REAL CHECK (oee IS NULL OR (oee >= 0 AND oee <= 100)),
  active_alert_count   INTEGER CHECK (active_alert_count IS NULL OR active_alert_count >= 0),
  updated_at           TEXT NOT NULL
);
