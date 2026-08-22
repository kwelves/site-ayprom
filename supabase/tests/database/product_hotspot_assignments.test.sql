begin;

select plan(28);

insert into public.products (
  slug, name, category_slug, short_description, article, published, "order"
)
values
  ('quick-hotspot-test-available', 'Quick hotspot available product', 'hydraulic-pumps', 'Quick action fixture', 'QH-AVAILABLE', true, 92001),
  ('quick-hotspot-test-reserved', 'Quick hotspot reserved product', 'hydraulic-pumps', 'Quick action fixture', 'QH-RESERVED', true, 92002),
  ('quick-hotspot-test-hidden', 'Quick hotspot hidden product', 'hydraulic-pumps', 'Quick action fixture', 'QH-HIDDEN', false, 92003);

update public.vehicle_hotspots
set product_id = null
where (vehicle_type_slug = 'kran-manipulyator' and hotspot_number in (1, 2))
   or (vehicle_type_slug = 'musorovoz' and hotspot_number = 1);

create function pg_temp.assignment_update(
  target_vehicle_slug text,
  target_hotspot_number integer,
  expected_product_slug text,
  desired_product_slug text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'hotspotId', hotspot.id,
    'expectedProductId', expected_product.id,
    'productId', desired_product.id
  )
  from public.vehicle_hotspots as hotspot
  left join public.products as expected_product on expected_product.slug = expected_product_slug
  left join public.products as desired_product on desired_product.slug = desired_product_slug
  where hotspot.vehicle_type_slug = target_vehicle_slug
    and hotspot.hotspot_number = target_hotspot_number;
$function$;

select has_function(
  'public',
  'update_vehicle_hotspot_assignments',
  array['jsonb'],
  'quick hotspot assignment RPC exists'
);

select ok(
  has_function_privilege('service_role', 'public.update_vehicle_hotspot_assignments(jsonb)', 'EXECUTE'),
  'service role can execute the quick assignment RPC'
);

select ok(
  not has_function_privilege('anon', 'public.update_vehicle_hotspot_assignments(jsonb)', 'EXECUTE'),
  'anonymous users cannot execute the quick assignment RPC'
);

select ok(
  not has_function_privilege('authenticated', 'public.update_vehicle_hotspot_assignments(jsonb)', 'EXECUTE'),
  'authenticated users cannot execute the quick assignment RPC'
);

select ok(
  not (
    select routine.prosecdef
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname = 'update_vehicle_hotspot_assignments'
      and pg_catalog.pg_get_function_identity_arguments(routine.oid) = 'assignment_updates jsonb'
  ),
  'quick assignment RPC is security invoker'
);

select ok(
  strpos(pg_get_functiondef('public.update_vehicle_hotspot_assignments(jsonb)'::regprocedure), 'perform product.id')
    < strpos(pg_get_functiondef('public.update_vehicle_hotspot_assignments(jsonb)'::regprocedure), 'perform hotspot.id'),
  'quick assignments lock products before hotspots'
);

select ok(
  strpos(pg_get_functiondef('public.update_vehicle_hotspots(text, jsonb)'::regprocedure), 'perform product.id')
    < strpos(pg_get_functiondef('public.update_vehicle_hotspots(text, jsonb)'::regprocedure), 'perform hotspot.id'),
  'full hotspot saves lock products before hotspots'
);

select ok(
  strpos(pg_get_functiondef('public.restore_vehicle_hotspots(text, jsonb, jsonb)'::regprocedure), 'perform product.id')
    < strpos(pg_get_functiondef('public.restore_vehicle_hotspots(text, jsonb, jsonb)'::regprocedure), 'perform hotspot.id'),
  'hotspot Undo locks products before hotspots'
);

set local role service_role;

select lives_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(pg_temp.assignment_update('kran-manipulyator', 1, null, 'quick-hotspot-test-available'))
  ),
  'a published product is assigned to a free hotspot'
);

select is(
  (select product.slug
   from public.vehicle_hotspots as hotspot
   join public.products as product on product.id = hotspot.product_id
   where hotspot.vehicle_type_slug = 'kran-manipulyator' and hotspot.hotspot_number = 1),
  'quick-hotspot-test-available',
  'the selected hotspot contains the assigned product'
);

select throws_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(pg_temp.assignment_update('kran-manipulyator', 1, null, null))
  ),
  'P0001',
  'Hotspot assignment state has changed',
  'a stale expected product does not overwrite the hotspot'
);

select lives_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(pg_temp.assignment_update('kran-manipulyator', 1, 'quick-hotspot-test-available', null))
  ),
  'an assigned product can be detached'
);

select is(
  (select product_id from public.vehicle_hotspots where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1),
  null::uuid,
  'detach leaves the hotspot free'
);

select throws_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(pg_temp.assignment_update('kran-manipulyator', 1, null, 'quick-hotspot-test-hidden'))
  ),
  'P0001',
  'Every selected product must be published',
  'an unpublished product cannot be assigned'
);

select throws_ok(
  $$select public.update_vehicle_hotspot_assignments('[]'::jsonb)$$,
  'P0001',
  'One or two hotspot assignment updates are required',
  'an empty assignment batch is rejected'
);

select throws_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(pg_temp.assignment_update('kran-manipulyator', 1, null, null) || '{"extra": true}'::jsonb)
  ),
  'P0001',
  'Each hotspot assignment update must contain exactly hotspotId, expectedProductId, and productId',
  'unexpected payload fields are rejected'
);

select lives_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(
      pg_temp.assignment_update('kran-manipulyator', 1, null, 'quick-hotspot-test-available'),
      pg_temp.assignment_update('musorovoz', 1, null, 'quick-hotspot-test-reserved')
    )
  ),
  'two independent assignments can be prepared atomically'
);

select lives_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(
      pg_temp.assignment_update('kran-manipulyator', 1, 'quick-hotspot-test-available', null),
      pg_temp.assignment_update('musorovoz', 1, 'quick-hotspot-test-reserved', 'quick-hotspot-test-available')
    )
  ),
  'a product can atomically move onto an occupied hotspot'
);

select is(
  (select product.slug
   from public.vehicle_hotspots as hotspot
   join public.products as product on product.id = hotspot.product_id
   where hotspot.vehicle_type_slug = 'musorovoz' and hotspot.hotspot_number = 1),
  'quick-hotspot-test-available',
  'the moved product occupies the target hotspot'
);

select is(
  (select product_id from public.vehicle_hotspots where vehicle_type_slug = 'kran-manipulyator' and hotspot_number = 1),
  null::uuid,
  'the source hotspot is cleared during the move'
);

select is(
  (select count(*) from public.vehicle_hotspots as hotspot
   join public.products as product on product.id = hotspot.product_id
   where product.slug = 'quick-hotspot-test-reserved'),
  0::bigint,
  'the replaced product is detached'
);

select lives_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(
      pg_temp.assignment_update('kran-manipulyator', 1, null, 'quick-hotspot-test-available'),
      pg_temp.assignment_update('musorovoz', 1, 'quick-hotspot-test-available', 'quick-hotspot-test-reserved')
    )
  ),
  'the inverse CAS batch restores the prior assignments for Undo'
);

select ok(
  (select product.slug = 'quick-hotspot-test-available'
   from public.vehicle_hotspots as hotspot
   join public.products as product on product.id = hotspot.product_id
   where hotspot.vehicle_type_slug = 'kran-manipulyator' and hotspot.hotspot_number = 1)
  and
  (select product.slug = 'quick-hotspot-test-reserved'
   from public.vehicle_hotspots as hotspot
   join public.products as product on product.id = hotspot.product_id
   where hotspot.vehicle_type_slug = 'musorovoz' and hotspot.hotspot_number = 1),
  'Undo restores both the moved and replaced products'
);

select throws_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(
      pg_temp.assignment_update('kran-manipulyator', 1, 'quick-hotspot-test-available', 'quick-hotspot-test-available'),
      pg_temp.assignment_update('musorovoz', 1, 'quick-hotspot-test-reserved', 'quick-hotspot-test-available')
    )
  ),
  'P0001',
  'A product may be assigned to only one hotspot',
  'the same product cannot be desired by two submitted hotspots'
);

select throws_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(pg_temp.assignment_update('kran-manipulyator', 2, null, 'quick-hotspot-test-available'))
  ),
  'P0001',
  'A selected product is already assigned to another hotspot',
  'a product cannot be assigned while its current hotspot is outside the batch'
);

select throws_ok(
  $$select public.update_vehicle_hotspot_assignments(
      '[{"hotspotId":"00000000-0000-0000-0000-000000000000","expectedProductId":null,"productId":null}]'::jsonb
    )$$,
  'P0001',
  'Every selected hotspot must exist',
  'a missing hotspot id is rejected'
);

select throws_ok(
  format(
    'select public.update_vehicle_hotspot_assignments(%L::jsonb)',
    jsonb_build_array(
      pg_temp.assignment_update('kran-manipulyator', 1, 'quick-hotspot-test-available', null),
      pg_temp.assignment_update('musorovoz', 1, null, null)
    )
  ),
  'P0001',
  'Hotspot assignment state has changed',
  'a stale row rejects the entire two-row batch'
);

select is(
  (select product.slug
   from public.vehicle_hotspots as hotspot
   join public.products as product on product.id = hotspot.product_id
   where hotspot.vehicle_type_slug = 'kran-manipulyator' and hotspot.hotspot_number = 1),
  'quick-hotspot-test-available',
  'a rejected two-row batch leaves its otherwise valid row unchanged'
);

select * from finish();
rollback;
