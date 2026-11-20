-- Роля на параметър (metric/plan/report/status) и дискретни състояния за status.
-- Празен role = metric. Същите редове се пускат и при старт на сървъра.

IF COL_LENGTH('dbo.cps_parameter', 'role') IS NULL
  ALTER TABLE dbo.cps_parameter ADD role nvarchar(16) NULL;

IF OBJECT_ID(N'dbo.cps_parameter_state', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_parameter_state (
    parameter_id  NVARCHAR(64)  NOT NULL,
    value         FLOAT         NOT NULL,
    label         NVARCHAR(200) NOT NULL,
    color         NVARCHAR(7)   NOT NULL,
    sort_order    INT           NOT NULL CONSTRAINT DF_cps_parameter_state_sort DEFAULT 0,
    CONSTRAINT PK_cps_parameter_state PRIMARY KEY (parameter_id, value),
    CONSTRAINT FK_cps_parameter_state_parameter FOREIGN KEY (parameter_id)
      REFERENCES dbo.cps_parameter (id) ON DELETE CASCADE
  );
END
GO
