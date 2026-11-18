-- Цвят на параметър. Празно значи автоматичен цвят на пулта.
-- Формат: #929292. Същият ред се пуска и при старт на сървъра.

IF COL_LENGTH('dbo.cps_parameter', 'color') IS NULL
  ALTER TABLE dbo.cps_parameter ADD color nvarchar(7) NULL;
