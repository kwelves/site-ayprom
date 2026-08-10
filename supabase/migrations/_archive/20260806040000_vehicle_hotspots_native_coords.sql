-- Re-measures y_pct from "% of the Figma showcase-frame crop" to "% of the
-- full native photo" (x_pct is untouched — every frame in this set happened
-- to be width-constrained by Figma's cover-fit, so x never shifted).
-- Needed because the section now renders vehicles with object-contain
-- against a fixed-aspect stage (whole vehicle always visible, no per-vehicle
-- crop) instead of object-cover matching each Figma frame's aspect ratio —
-- see project memory for the cover-crop math this reverses.
update public.vehicle_hotspots set y_pct = 58.18 where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1;
update public.vehicle_hotspots set y_pct = 59.85 where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 2;
update public.vehicle_hotspots set y_pct = 61.60 where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 3;
update public.vehicle_hotspots set y_pct = 50.03 where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 4;
update public.vehicle_hotspots set y_pct = 48.31 where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 5;

update public.vehicle_hotspots set y_pct = 45.02 where vehicle_type_slug = 'musorovoz' and hotspot_number = 1;
update public.vehicle_hotspots set y_pct = 50.94 where vehicle_type_slug = 'musorovoz' and hotspot_number = 2;
update public.vehicle_hotspots set y_pct = 63.65 where vehicle_type_slug = 'musorovoz' and hotspot_number = 3;
update public.vehicle_hotspots set y_pct = 56.15 where vehicle_type_slug = 'musorovoz' and hotspot_number = 4;
update public.vehicle_hotspots set y_pct = 55.50 where vehicle_type_slug = 'musorovoz' and hotspot_number = 5;

update public.vehicle_hotspots set y_pct = 61.00 where vehicle_type_slug = 'avtovoz' and hotspot_number = 1;
update public.vehicle_hotspots set y_pct = 59.32 where vehicle_type_slug = 'avtovoz' and hotspot_number = 2;
update public.vehicle_hotspots set y_pct = 59.27 where vehicle_type_slug = 'avtovoz' and hotspot_number = 3;
update public.vehicle_hotspots set y_pct = 55.73 where vehicle_type_slug = 'avtovoz' and hotspot_number = 4;
update public.vehicle_hotspots set y_pct = 50.55 where vehicle_type_slug = 'avtovoz' and hotspot_number = 5;

update public.vehicle_hotspots set y_pct = 64.49 where vehicle_type_slug = 'samosval' and hotspot_number = 1;
update public.vehicle_hotspots set y_pct = 58.20 where vehicle_type_slug = 'samosval' and hotspot_number = 2;
update public.vehicle_hotspots set y_pct = 41.41 where vehicle_type_slug = 'samosval' and hotspot_number = 3;
update public.vehicle_hotspots set y_pct = 36.16 where vehicle_type_slug = 'samosval' and hotspot_number = 4;
update public.vehicle_hotspots set y_pct = 45.77 where vehicle_type_slug = 'samosval' and hotspot_number = 5;

update public.vehicle_hotspots set y_pct = 72.02 where vehicle_type_slug = 'tyagach' and hotspot_number = 1;
update public.vehicle_hotspots set y_pct = 69.41 where vehicle_type_slug = 'tyagach' and hotspot_number = 2;
update public.vehicle_hotspots set y_pct = 81.75 where vehicle_type_slug = 'tyagach' and hotspot_number = 3;
update public.vehicle_hotspots set y_pct = 74.72 where vehicle_type_slug = 'tyagach' and hotspot_number = 4;
update public.vehicle_hotspots set y_pct = 78.25 where vehicle_type_slug = 'tyagach' and hotspot_number = 5;
