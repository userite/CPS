-- CPS_ATRA на SQL Server.
-- Същите таблици като db/001_cps_schema.sql.
-- Имена с префикс cps_.
--
-- Записът е: машина, параметър, време, стойност.
-- OEE не се смята тук.
-- range_min, range_max и sample_interval_seconds остават празни,
-- докато не се попълнят от администрацията.
-- NULL в cps_measurement.value е липсващо измерване, не нула.
--
-- ON DELETE CASCADE и от машина, и от параметър е позволено:
-- няма трета таблица, която да създава втори път за изтриване.

IF DB_ID(N'CPS_ATRA') IS NULL
BEGIN
  CREATE DATABASE CPS_ATRA;
END
GO

USE CPS_ATRA;
GO

IF OBJECT_ID(N'dbo.cps_machine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_machine (
    id          NVARCHAR(64)  NOT NULL CONSTRAINT PK_cps_machine PRIMARY KEY,
    name        NVARCHAR(200) NOT NULL,
    model       NVARCHAR(200) NULL,
    kind        NVARCHAR(16)  NOT NULL CONSTRAINT DF_cps_machine_kind DEFAULT N'other',
    created_at  DATETIME2     NOT NULL CONSTRAINT DF_cps_machine_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_cps_machine_kind CHECK (kind IN (N'lathe', N'other'))
  );
END
GO

IF OBJECT_ID(N'dbo.cps_parameter', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_parameter (
    id                       NVARCHAR(64)  NOT NULL CONSTRAINT PK_cps_parameter PRIMARY KEY,
    label                    NVARCHAR(200) NOT NULL,
    unit                     NVARCHAR(32)  NOT NULL CONSTRAINT DF_cps_parameter_unit DEFAULT N'',
    range_min                FLOAT         NULL,
    range_max                FLOAT         NULL,
    sample_interval_seconds  INT           NULL,
    CONSTRAINT CK_cps_parameter_interval CHECK (
      sample_interval_seconds IS NULL OR sample_interval_seconds > 0
    ),
    CONSTRAINT CK_cps_parameter_range CHECK (
      range_min IS NULL OR range_max IS NULL OR range_min <= range_max
    )
  );
END
GO

IF OBJECT_ID(N'dbo.cps_machine_parameter', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_machine_parameter (
    machine_id    NVARCHAR(64) NOT NULL,
    parameter_id  NVARCHAR(64) NOT NULL,
    CONSTRAINT PK_cps_machine_parameter PRIMARY KEY (machine_id, parameter_id),
    CONSTRAINT FK_cps_mp_machine FOREIGN KEY (machine_id)
      REFERENCES dbo.cps_machine (id) ON DELETE CASCADE,
    CONSTRAINT FK_cps_mp_parameter FOREIGN KEY (parameter_id)
      REFERENCES dbo.cps_parameter (id) ON DELETE CASCADE
  );
END
GO

IF OBJECT_ID(N'dbo.cps_measurement', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_measurement (
    machine_id    NVARCHAR(64) NOT NULL,
    parameter_id  NVARCHAR(64) NOT NULL,
    measured_at   DATETIME2    NOT NULL,
    value         FLOAT        NULL,
    CONSTRAINT PK_cps_measurement PRIMARY KEY (machine_id, parameter_id, measured_at),
    CONSTRAINT FK_cps_meas_machine FOREIGN KEY (machine_id)
      REFERENCES dbo.cps_machine (id) ON DELETE CASCADE,
    CONSTRAINT FK_cps_meas_parameter FOREIGN KEY (parameter_id)
      REFERENCES dbo.cps_parameter (id) ON DELETE CASCADE
  );
  CREATE INDEX cps_measurement_machine_time
    ON dbo.cps_measurement (machine_id, measured_at DESC);
END
GO

IF OBJECT_ID(N'dbo.cps_machine_state', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_machine_state (
    machine_id           NVARCHAR(64) NOT NULL CONSTRAINT PK_cps_machine_state PRIMARY KEY,
    status               NVARCHAR(16) NOT NULL,
    oee                  FLOAT        NULL,
    active_alert_count   INT          NULL,
    updated_at           DATETIME2    NOT NULL,
    CONSTRAINT FK_cps_state_machine FOREIGN KEY (machine_id)
      REFERENCES dbo.cps_machine (id) ON DELETE CASCADE,
    CONSTRAINT CK_cps_state_status CHECK (
      status IN (N'running', N'idle', N'setup', N'warning', N'alarm', N'offline', N'unknown')
    ),
    CONSTRAINT CK_cps_state_oee CHECK (oee IS NULL OR (oee >= 0 AND oee <= 100)),
    CONSTRAINT CK_cps_state_alerts CHECK (active_alert_count IS NULL OR active_alert_count >= 0)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.cps_machine)
BEGIN
  INSERT INTO dbo.cps_machine (id, name, model, kind) VALUES
    (N'LATHE_01', N'Струг 1', N'DMG MORI NLX 2500', N'lathe'),
    (N'LATHE_02', N'Струг 2', NULL, N'lathe'),
    (N'MACH_03', N'Машина 3', NULL, N'other'),
    (N'MACH_04', N'Машина 4', NULL, N'other');

  INSERT INTO dbo.cps_parameter (id, label, unit) VALUES
    (N'spindle_speed', N'Скорост на въртене', N'об/мин'),
    (N'idle_time', N'Празен ход', N'сек'),
    (N'good_count', N'Годни детайли', N'бр'),
    (N'scrap_count', N'Брак', N'бр');

  INSERT INTO dbo.cps_machine_parameter (machine_id, parameter_id)
  SELECT m.id, p.id
  FROM dbo.cps_machine m
  CROSS JOIN dbo.cps_parameter p;
END
GO

SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name LIKE N'cps[_]%'
GROUP BY t.name
ORDER BY t.name;
GO
