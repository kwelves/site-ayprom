-- An Undo operation must not overwrite a batch saved by another administrator
-- after the original save. The expected snapshot is compared while the five
-- target rows are locked, then the existing validated batch writer performs
-- the restore in the same transaction.

CREATE OR REPLACE FUNCTION public.restore_vehicle_hotspots(
  target_vehicle_type_slug text,
  expected_hotspot_updates jsonb,
  prior_hotspot_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  expected_count integer;
  distinct_expected_count integer;
  matching_count integer;
begin
  if nullif(btrim(target_vehicle_type_slug), '') is null then
    raise exception 'Vehicle type is required' using errcode = 'P0001';
  end if;

  if jsonb_typeof(expected_hotspot_updates) is distinct from 'array' then
    raise exception 'Expected hotspot updates must be an array' using errcode = 'P0001';
  end if;

  -- This lock and comparison deliberately live in the database, rather than
  -- in the Server Action, so a second admin cannot save in between checking
  -- the snapshot and restoring it.
  perform 1
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  for update;

  with expected as (
    select
      (entry.value ->> 'id')::uuid as id,
      entry.value ->> 'label' as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(expected_hotspot_updates) as entry(value)
  )
  select count(*), count(distinct expected.id)
  into expected_count, distinct_expected_count
  from expected;

  if expected_count <> 5 or distinct_expected_count <> 5 then
    raise exception 'Expected hotspot snapshot must contain exactly five distinct rows' using errcode = 'P0001';
  end if;

  with expected as (
    select
      (entry.value ->> 'id')::uuid as id,
      entry.value ->> 'label' as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(expected_hotspot_updates) as entry(value)
  )
  select count(*)
  into matching_count
  from public.vehicle_hotspots as hotspot
  join expected
    on expected.id = hotspot.id
    and expected.label = hotspot.label
    and expected.product_id is not distinct from hotspot.product_id
  where hotspot.vehicle_type_slug = target_vehicle_type_slug;

  if matching_count <> 5 then
    raise exception 'Hotspot state has changed since this batch was saved' using errcode = 'P0001';
  end if;

  perform public.update_vehicle_hotspots(target_vehicle_type_slug, prior_hotspot_updates);
end;
$function$;

REVOKE ALL ON FUNCTION public.restore_vehicle_hotspots(text, jsonb, jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_vehicle_hotspots(text, jsonb, jsonb) TO service_role;
