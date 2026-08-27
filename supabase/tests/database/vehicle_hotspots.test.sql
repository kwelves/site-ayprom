begin;

select plan(23);

insert into public.products (
  slug, name, category_slug, short_description, article, published, "order"
)
values
  ('vehicle-showcase-test-available', 'Vehicle showcase available product', 'hydraulic-pumps', 'Hotspot test fixture', 'VH-AVAILABLE', true, 91001),
  ('vehicle-showcase-test-reserved', 'Vehicle showcase reserved product', 'hydraulic-pumps', 'Hotspot test fixture', 'VH-RESERVED', true, 91002),
  ('vehicle-showcase-test-hidden', 'Vehicle showcase hidden product', 'hydraulic-pumps', 'Hotspot test fixture', 'VH-HIDDEN', false, 91003);

create function pg_temp.hotspot_updates(
  target_slug text,
  first_label text default null,
  first_product_slug text default null
)
returns jsonb
language sql
as $function$
  select jsonb_agg(
    jsonb_build_object(
      'id', hotspot.id,
      'label', case when hotspot.hotspot_number = 1 and first_label is not null then first_label else hotspot.label end,
      'productId', case
        when hotspot.hotspot_number = 1 then (
          select product.id from public.products as product where product.slug = first_product_slug
        )
        else hotspot.product_id
      end
    )
    order by hotspot.hotspot_number
  )
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_slug;
$function$;

create function pg_temp.duplicate_product_updates(target_slug text, product_slug text)
returns jsonb
language sql
as $function$
  select jsonb_agg(
    jsonb_build_object(
      'id', hotspot.id,
      'label', hotspot.label,
      'productId', case
        when hotspot.hotspot_number in (1, 2) then (
          select product.id from public.products as product where product.slug = product_slug
        )
        else null
      end
    )
    order by hotspot.hotspot_number
  )
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_slug;
$function$;

create function pg_temp.foreign_hotspot_updates(target_slug text)
returns jsonb
language sql
as $function$
  select jsonb_agg(
    jsonb_build_object(
      'id', case
        when hotspot.hotspot_number = 5 then (
          select foreign_hotspot.id
          from public.vehicle_hotspots as foreign_hotspot
          where foreign_hotspot.vehicle_type_slug = 'musorovoz'
            and foreign_hotspot.hotspot_number = 1
        )
        else hotspot.id
      end,
      'label', hotspot.label,
      'productId', null
    )
    order by hotspot.hotspot_number
  )
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_slug;
$function$;

-- QA-013 снял умолчание «EXECUTE для PUBLIC» у функций, создаваемых ролью
-- postgres, поэтому временные помощники теста тоже перестали быть доступны
-- другим ролям. Сценарии ниже выполняются под service_role, и права на
-- помощников теперь выдаются явно — как и на любую другую функцию.
grant execute on function pg_temp.hotspot_updates(text, text, text) to service_role;
grant execute on function pg_temp.duplicate_product_updates(text, text) to service_role;
grant execute on function pg_temp.foreign_hotspot_updates(text) to service_role;

select is(
  (
    select count(*)
    from public.vehicle_hotspots as hotspot
    join public.products as product on product.id = hotspot.product_id
    where product.slug = 'korobka-otbora-moschnosti-zf-1'
  ),
  0::bigint,
  'the former showcase product is no longer pinned to a hotspot'
);

select ok(
  to_regclass('public.vehicle_hotspots_product_id_idx') is not null,
  'a partial index supports product assignment lookups'
);

select ok(
  to_regclass('public.vehicle_hotspots_product_id_unique') is null
    and not (
      select index_row.indisunique
      from pg_catalog.pg_index as index_row
      where index_row.indexrelid = 'public.vehicle_hotspots_product_id_idx'::regclass
    ),
  'product assignment index is non-unique'
);

select has_function(
  'public',
  'update_vehicle_hotspots',
  array['text', 'jsonb'],
  'batch hotspot update RPC exists'
);

select has_function(
  'public',
  'restore_vehicle_hotspots',
  array['text', 'jsonb', 'jsonb'],
  'versioned hotspot restore RPC exists'
);

select ok(
  has_function_privilege('service_role', 'public.update_vehicle_hotspots(text, jsonb)', 'EXECUTE'),
  'service role can execute the hotspot batch RPC'
);

select ok(
  has_function_privilege('service_role', 'public.restore_vehicle_hotspots(text, jsonb, jsonb)', 'EXECUTE'),
  'service role can execute the versioned hotspot restore RPC'
);

select ok(
  not has_function_privilege('anon', 'public.update_vehicle_hotspots(text, jsonb)', 'EXECUTE'),
  'anonymous users cannot execute the hotspot batch RPC'
);

select ok(
  not has_function_privilege('anon', 'public.restore_vehicle_hotspots(text, jsonb, jsonb)', 'EXECUTE'),
  'anonymous users cannot execute the versioned hotspot restore RPC'
);

set local role service_role;

select lives_ok(
  $$select public.update_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.hotspot_updates(
        'kran-manipulyator',
        'Hydraulic tank updated',
        'vehicle-showcase-test-available'
      )
    )$$,
  'a complete valid vehicle batch is saved'
);

select is(
  (
    select label
    from public.vehicle_hotspots
    where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1
  ),
  'Hydraulic tank updated',
  'batch save updates the hotspot label'
);

select is(
  (
    select product_id
    from public.vehicle_hotspots
    where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1
  ),
  (
    select id from public.products where slug = 'vehicle-showcase-test-available'
  ),
  'batch save assigns a published product'
);

select ok(
  exists (
    select 1
    from public.admin_audit_log as audit
    where audit.entity_type = 'vehicle_hotspots'
      and audit.entity_key = (
        select id::text
        from public.vehicle_hotspots
        where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1
      )
      and audit.action = 'UPDATE'
      and audit.changed_fields @> array['label', 'product_id']::text[]
  ),
  'direct hotspot edits are written to the audit log'
);

select lives_ok(
  $$select public.restore_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.hotspot_updates(
        'kran-manipulyator',
        'Hydraulic tank updated',
        'vehicle-showcase-test-available'
      ),
      pg_temp.hotspot_updates('kran-manipulyator', 'Hydraulic tank restored', null)
    )$$,
  'undo restores a matching saved snapshot'
);

select is(
  (
    select label
    from public.vehicle_hotspots
    where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1
  ),
  'Hydraulic tank restored',
  'undo restores the prior hotspot label'
);

select is(
  (
    select product_id
    from public.vehicle_hotspots
    where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1
  ),
  null::uuid,
  'undo restores the prior product assignment'
);

select throws_ok(
  $$select public.restore_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.hotspot_updates(
        'kran-manipulyator',
        'Hydraulic tank updated',
        'vehicle-showcase-test-available'
      ),
      pg_temp.hotspot_updates('kran-manipulyator', 'Hydraulic tank overwritten', null)
    )$$,
  'P0001',
  'Hotspot state has changed since this batch was saved',
  'stale undo does not overwrite another saved batch'
);

select public.update_vehicle_hotspots(
  'kran-manipulyator',
  pg_temp.hotspot_updates(
    'kran-manipulyator',
    'Hydraulic tank updated',
    'vehicle-showcase-test-available'
  )
);

select throws_ok(
  $$select public.update_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.hotspot_updates('kran-manipulyator', null, 'vehicle-showcase-test-hidden')
    )$$,
  'P0001',
  'Every selected product must be published',
  'an unpublished product cannot be assigned'
);

select throws_ok(
  $$select public.update_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.foreign_hotspot_updates('kran-manipulyator')
    )$$,
  'P0001',
  'Submitted hotspot ids must exactly match the selected vehicle type',
  'a hotspot from another vehicle cannot be saved in this batch'
);

select lives_ok(
  $$select public.update_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.duplicate_product_updates('kran-manipulyator', 'vehicle-showcase-test-available')
    )$$,
  'a product can be assigned twice inside one vehicle batch'
);

update public.vehicle_hotspots
set product_id = (
  select id from public.products where slug = 'vehicle-showcase-test-reserved'
)
where vehicle_type_slug = 'musorovoz' and hotspot_number = 1;

select lives_ok(
  $$select public.update_vehicle_hotspots(
      'kran-manipulyator',
      pg_temp.hotspot_updates('kran-manipulyator', null, 'vehicle-showcase-test-reserved')
    )$$,
  'a product assigned to another vehicle can also be used in this batch'
);

select lives_ok(
  $$update public.vehicle_hotspots
    set product_id = (select id from public.products where slug = 'vehicle-showcase-test-reserved')
    where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 2$$,
  'direct writes can reuse the same product on another hotspot'
);

update public.products
set published = false
where slug = 'vehicle-showcase-test-reserved';

select is(
  (
    select count(*)
    from public.vehicle_hotspots as hotspot
    join public.products as product on product.id = hotspot.product_id
    where product.slug = 'vehicle-showcase-test-reserved'
  ),
  0::bigint,
  'unpublishing a product automatically detaches all of its hotspots'
);

reset role;
select * from finish();
rollback;
