-- Administrative editing for the five fixed vehicle-showcase hotspots.
-- The public section keeps treating a NULL product_id as a "coming soon" card.

SET check_function_bodies = false;

-- The former showcase demonstration product must not remain pinned when the
-- management screen goes live. The subquery intentionally makes this a no-op
-- in environments where that product is absent.
UPDATE public.vehicle_hotspots
SET product_id = NULL
WHERE product_id = (
  SELECT id
  FROM public.products
  WHERE slug = 'korobka-otbora-moschnosti-zf-1'
);

-- Historic imports allowed the same product on several vehicle types. Retain
-- the first deterministic position (vehicle type, then hotspot number) and
-- turn every later duplicate into the existing public "coming soon" state
-- before the new unique index is created.
WITH ranked_product_links AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY product_id
      ORDER BY vehicle_type_slug, hotspot_number, id
    ) AS position
  FROM public.vehicle_hotspots
  WHERE product_id IS NOT NULL
)
UPDATE public.vehicle_hotspots AS hotspot
SET product_id = NULL
FROM ranked_product_links AS ranked
WHERE hotspot.id = ranked.id
  AND ranked.position > 1;

-- A product can power only one hotspot. The existing full index is covered by
-- this partial index for every non-NULL foreign-key lookup and is therefore
-- redundant once the invariant is enforced.
DROP INDEX IF EXISTS public.vehicle_hotspots_product_id_idx;
CREATE UNIQUE INDEX vehicle_hotspots_product_id_unique
  ON public.vehicle_hotspots (product_id)
  WHERE product_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.detach_vehicle_hotspots_from_unpublished_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
begin
  update public.vehicle_hotspots
  set product_id = null
  where product_id = new.id;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_vehicle_hotspots(
  target_vehicle_type_slug text,
  hotspot_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  target_hotspot_count integer;
  submitted_count integer;
  distinct_submitted_count integer;
  matching_count integer;
  blank_label_count integer;
  duplicate_product_count integer;
  invalid_product_count integer;
  outside_assignment_count integer;
begin
  if nullif(btrim(target_vehicle_type_slug), '') is null then
    raise exception 'Vehicle type is required' using errcode = 'P0001';
  end if;

  if jsonb_typeof(hotspot_updates) is distinct from 'array' then
    raise exception 'Hotspot updates must be an array' using errcode = 'P0001';
  end if;

  -- Lock all target rows before validating and writing them. This keeps the
  -- batch internally consistent if two administrators save the same vehicle
  -- at once; cross-vehicle product races are still protected by the unique
  -- index above.
  perform 1
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  for update;

  select count(*)
  into target_hotspot_count
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug;

  if target_hotspot_count <> 5 then
    raise exception 'Vehicle type must have exactly five hotspots' using errcode = 'P0001';
  end if;

  with submitted as (
    select
      (entry.value ->> 'id')::uuid as id,
      entry.value ->> 'label' as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select
    count(*),
    count(distinct submitted.id),
    count(*) filter (where nullif(btrim(submitted.label), '') is null)
  into submitted_count, distinct_submitted_count, blank_label_count
  from submitted;

  if submitted_count <> 5 or distinct_submitted_count <> 5 then
    raise exception 'Exactly five distinct hotspot ids are required' using errcode = 'P0001';
  end if;

  if blank_label_count <> 0 then
    raise exception 'Hotspot labels cannot be blank' using errcode = 'P0001';
  end if;

  with submitted as (
    select (entry.value ->> 'id')::uuid as id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into matching_count
  from public.vehicle_hotspots as hotspot
  join submitted on submitted.id = hotspot.id
  where hotspot.vehicle_type_slug = target_vehicle_type_slug;

  if matching_count <> 5 then
    raise exception 'Submitted hotspot ids must exactly match the selected vehicle type' using errcode = 'P0001';
  end if;

  with submitted as (
    select nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into duplicate_product_count
  from (
    select submitted.product_id
    from submitted
    where submitted.product_id is not null
    group by submitted.product_id
    having count(*) > 1
  ) as duplicate_product;

  if duplicate_product_count <> 0 then
    raise exception 'A product may be assigned to only one hotspot' using errcode = 'P0001';
  end if;

  with submitted as (
    select nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into invalid_product_count
  from submitted
  left join public.products as product on product.id = submitted.product_id
  where submitted.product_id is not null
    and (product.id is null or product.published is false);

  if invalid_product_count <> 0 then
    raise exception 'Every selected product must be published' using errcode = 'P0001';
  end if;

  with submitted as (
    select
      (entry.value ->> 'id')::uuid as id,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into outside_assignment_count
  from public.vehicle_hotspots as assigned_hotspot
  join submitted on submitted.product_id = assigned_hotspot.product_id
  where assigned_hotspot.product_id is not null
    and not exists (
      select 1
      from submitted as submitted_hotspot
      where submitted_hotspot.id = assigned_hotspot.id
    );

  if outside_assignment_count <> 0 then
    raise exception 'A selected product is already assigned to another hotspot' using errcode = 'P0001';
  end if;

  -- Clear first, then write final values. This permits an administrator to
  -- exchange two assigned products in one save despite the immediate unique
  -- index. A raised exception rolls both statements back together.
  update public.vehicle_hotspots as hotspot
  set product_id = null
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
    and hotspot.product_id is not null;

  with submitted as (
    select
      (entry.value ->> 'id')::uuid as id,
      btrim(entry.value ->> 'label') as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  update public.vehicle_hotspots as hotspot
  set
    label = submitted.label,
    product_id = submitted.product_id
  from submitted
  where hotspot.id = submitted.id;
end;
$function$;

CREATE TRIGGER audit_vehicle_hotspots
AFTER INSERT OR DELETE OR UPDATE ON public.vehicle_hotspots
FOR EACH ROW EXECUTE FUNCTION public.record_admin_mutation();

CREATE TRIGGER products_detach_vehicle_hotspots_when_unpublished
AFTER UPDATE OF published ON public.products
FOR EACH ROW
WHEN (old.published is true and new.published is false)
EXECUTE FUNCTION public.detach_vehicle_hotspots_from_unpublished_product();

REVOKE ALL ON FUNCTION public.update_vehicle_hotspots(text, jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_vehicle_hotspots(text, jsonb) TO service_role;
