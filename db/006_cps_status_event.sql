-- Ръчни статус/коментар събития от таблото.
-- Същите редове се пускат и при старт на SQL Server връзката.

IF OBJECT_ID(N'dbo.cps_status_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.cps_status_event (
    id            INT           NOT NULL IDENTITY(1, 1)
      CONSTRAINT PK_cps_status_event PRIMARY KEY,
    machine_id    NVARCHAR(64)  NOT NULL,
    parameter_id  NVARCHAR(64)  NOT NULL,
    status_value  FLOAT         NOT NULL,
    comment       NVARCHAR(2000) NOT NULL
      CONSTRAINT DF_cps_status_event_comment DEFAULT (N''),
    kind          NVARCHAR(32)  NOT NULL,
    created_at    DATETIME2     NOT NULL,
    CONSTRAINT FK_cps_status_event_machine FOREIGN KEY (machine_id)
      REFERENCES dbo.cps_machine (id) ON DELETE CASCADE,
    CONSTRAINT FK_cps_status_event_parameter FOREIGN KEY (parameter_id)
      REFERENCES dbo.cps_parameter (id) ON DELETE CASCADE,
    CONSTRAINT CK_cps_status_event_kind CHECK (
      kind IN (N'status_change', N'comment_update')
    )
  );
  CREATE INDEX cps_status_event_machine_time
    ON dbo.cps_status_event (machine_id, created_at DESC);
END
GO
