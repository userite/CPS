-- Метод за агрегиране на параметър през всички машини на таблото.
-- Стойности: sum | avg | last | min | max | count. NULL = подразбиране (avg, или sum за бройни).

IF COL_LENGTH('dbo.cps_parameter', 'aggregate_method') IS NULL
  ALTER TABLE dbo.cps_parameter ADD aggregate_method nvarchar(16) NULL;
GO
