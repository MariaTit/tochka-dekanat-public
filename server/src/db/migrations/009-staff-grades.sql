-- Только дополнение существующей таблицы: прежние результаты и связи сохраняются.
ALTER TABLE attestations ADD COLUMN is_differentiated INTEGER NOT NULL DEFAULT 0
  CHECK (is_differentiated IN (0, 1) AND (type = 'credit' OR is_differentiated = 0));
ALTER TABLE attestations ADD COLUMN grade INTEGER CHECK (
  (is_differentiated = 0 AND grade IS NULL) OR
  (is_differentiated = 1 AND type = 'credit' AND (
    (status = 'pending' AND grade IS NULL) OR
    (status = 'published' AND grade IS NOT NULL AND grade IN (2, 3, 4, 5)
      AND result = CASE WHEN grade = 2 THEN 'Не зачтено' ELSE 'Зачтено' END))));
ALTER TABLE attestations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(revision) = 'integer' AND revision >= 0);

-- Старые возможные дубликаты не удаляются. Новые создать нельзя.
CREATE TRIGGER attestation_no_duplicate_insert BEFORE INSERT ON attestations
WHEN EXISTS (SELECT 1 FROM attestations
  WHERE student_discipline_id = NEW.student_discipline_id AND type = NEW.type)
BEGIN
  SELECT RAISE(ABORT, 'duplicate-attestation');
END;
CREATE TRIGGER attestation_no_duplicate_update BEFORE UPDATE OF student_discipline_id, type ON attestations
WHEN EXISTS (SELECT 1 FROM attestations WHERE id <> OLD.id
  AND student_discipline_id = NEW.student_discipline_id AND type = NEW.type)
BEGIN
  SELECT RAISE(ABORT, 'duplicate-attestation');
END;
