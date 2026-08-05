-- New vehicle type for the "Спецтехника" showcase redesign: garbage truck.
-- Continues the existing order sequence (avtovoz = 3).
insert into public.vehicle_types (slug, name, "order")
values ('musorovoz', 'Мусоровоз', 4);
