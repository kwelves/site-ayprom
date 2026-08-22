CREATE OR REPLACE FUNCTION public.update_vehicle_hotspot_assignments(assignment_updates jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
declare
  submitted_count integer;
  distinct_hotspot_count integer;
  locked_hotspot_count integer;
  matching_state_count integer;
  duplicate_product_count integer;
  invalid_product_count integer;
  outside_assignment_count integer;
begin
  if jsonb_typeof(assignment_updates) is distinct from 'array' then
    raise exception 'Hotspot assignment updates must be an array' using errcode = 'P0001';
  end if;

  submitted_count := jsonb_array_length(assignment_updates);
  if submitted_count < 1 or submitted_count > 2 then
    raise exception 'One or two hotspot assignment updates are required' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(assignment_updates) as entry(value)
    where case
      when jsonb_typeof(entry.value) is distinct from 'object' then true
      else
        not (entry.value ?& array['hotspotId', 'expectedProductId', 'productId'])
        or (select count(*) from jsonb_object_keys(entry.value)) <> 3
        or jsonb_typeof(entry.value -> 'hotspotId') is distinct from 'string'
        or jsonb_typeof(entry.value -> 'expectedProductId') not in ('string', 'null')
        or jsonb_typeof(entry.value -> 'productId') not in ('string', 'null')
      end
  ) then
    raise exception 'Each hotspot assignment update must contain exactly hotspotId, expectedProductId, and productId' using errcode = 'P0001';
  end if;

  with submitted as (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(distinct submitted.hotspot_id)
  into distinct_hotspot_count
  from submitted;

  if distinct_hotspot_count <> submitted_count then
    raise exception 'Hotspot assignment ids must be distinct' using errcode = 'P0001';
  end if;

  -- Product rows are locked first to match the products -> hotspot lock order
  -- used by the unpublish trigger. Sorting every lock set prevents two quick
  -- actions that touch the same rows in reverse order from deadlocking.
  perform product.id
  from public.products as product
  join (
    select distinct product_id
    from (
      select nullif(entry.value ->> 'expectedProductId', '')::uuid as product_id
      from jsonb_array_elements(assignment_updates) as entry(value)
      union
      select nullif(entry.value ->> 'productId', '')::uuid as product_id
      from jsonb_array_elements(assignment_updates) as entry(value)
    ) as referenced_products
    where product_id is not null
  ) as referenced on referenced.product_id = product.id
  order by product.id
  for update of product;

  perform hotspot.id
  from public.vehicle_hotspots as hotspot
  join (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  ) as submitted on submitted.hotspot_id = hotspot.id
  order by hotspot.id
  for update of hotspot;

  with submitted as (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(*)
  into locked_hotspot_count
  from public.vehicle_hotspots as hotspot
  join submitted on submitted.hotspot_id = hotspot.id;

  if locked_hotspot_count <> submitted_count then
    raise exception 'Every selected hotspot must exist' using errcode = 'P0001';
  end if;

  with submitted as (
    select
      (entry.value ->> 'hotspotId')::uuid as hotspot_id,
      nullif(entry.value ->> 'expectedProductId', '')::uuid as expected_product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(*)
  into matching_state_count
  from public.vehicle_hotspots as hotspot
  join submitted
    on submitted.hotspot_id = hotspot.id
    and submitted.expected_product_id is not distinct from hotspot.product_id;

  if matching_state_count <> submitted_count then
    raise exception 'Hotspot assignment state has changed' using errcode = 'P0001';
  end if;

  with submitted as (
    select nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
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
    from jsonb_array_elements(assignment_updates) as entry(value)
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
      (entry.value ->> 'hotspotId')::uuid as hotspot_id,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(*)
  into outside_assignment_count
  from submitted
  join public.vehicle_hotspots as assigned_hotspot on assigned_hotspot.product_id = submitted.product_id
  where submitted.product_id is not null
    and not exists (
      select 1
      from submitted as changed_hotspot
      where changed_hotspot.hotspot_id = assigned_hotspot.id
    );

  if outside_assignment_count <> 0 then
    raise exception 'A selected product is already assigned to another hotspot' using errcode = 'P0001';
  end if;

  with submitted as (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  update public.vehicle_hotspots as hotspot
  set product_id = null
  from submitted
  where hotspot.id = submitted.hotspot_id
    and hotspot.product_id is not null;

  with submitted as (
    select
      (entry.value ->> 'hotspotId')::uuid as hotspot_id,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  update public.vehicle_hotspots as hotspot
  set product_id = submitted.product_id
  from submitted
  where hotspot.id = submitted.hotspot_id
    and submitted.product_id is not null;
end;
$$;

ALTER FUNCTION public.update_vehicle_hotspot_assignments(jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_vehicle_hotspot_assignments(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_vehicle_hotspot_assignments(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.update_vehicle_hotspot_assignments(jsonb) FROM authenticated;
GRANT ALL ON FUNCTION public.update_vehicle_hotspot_assignments(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.update_vehicle_hotspots(target_vehicle_type_slug text, hotspot_updates jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
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

  -- Keep the same products -> hotspots lock order as quick assignments and
  -- the product-unpublish trigger. Product locks also prevent a selected
  -- product from becoming unpublished between validation and assignment.
  perform product.id
  from public.products as product
  join (
    select distinct nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  ) as desired on desired.product_id = product.id
  where desired.product_id is not null
  order by product.id
  for update of product;

  perform hotspot.id
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  order by hotspot.id
  for update of hotspot;

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
$$;

ALTER FUNCTION public.update_vehicle_hotspots(text, jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.restore_vehicle_hotspots(target_vehicle_type_slug text, expected_hotspot_updates jsonb, prior_hotspot_updates jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
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

  -- Lock both the saved and restored product sets before hotspot rows. This
  -- matches update_vehicle_hotspots and keeps Undo out of the reverse-order
  -- deadlock cycle with quick assignments and product unpublishing.
  perform product.id
  from public.products as product
  join (
    select distinct product_id
    from (
      select nullif(entry.value ->> 'productId', '')::uuid as product_id
      from jsonb_array_elements(expected_hotspot_updates) as entry(value)
      union
      select nullif(entry.value ->> 'productId', '')::uuid as product_id
      from jsonb_array_elements(prior_hotspot_updates) as entry(value)
    ) as referenced_products
    where product_id is not null
  ) as referenced on referenced.product_id = product.id
  order by product.id
  for update of product;

  perform hotspot.id
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  order by hotspot.id
  for update of hotspot;

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
$$;

ALTER FUNCTION public.restore_vehicle_hotspots(text, jsonb, jsonb) OWNER TO postgres;
