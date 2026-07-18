-- Client decided the "Для бренда"/"От бренда" split isn't needed — brands
-- become a single undifferentiated list. A future replacement classification
-- (by vehicle type — dump truck / tractor unit / crane-manipulator) is
-- planned but not designed yet; this migration only removes the old model.
alter table public.brands drop column relation;
