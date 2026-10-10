begin;
select no_plan();
select has_table('public', 'product_media_jobs', 'private durable queue exists');
select ok(not has_table_privilege('anon', 'public.product_media_jobs', 'SELECT'), 'anonymous cannot read jobs');
select ok(not has_table_privilege('authenticated', 'public.product_media_jobs', 'SELECT'), 'ordinary auth cannot read jobs');
select ok(not has_table_privilege('service_role', 'public.product_media_jobs', 'TRUNCATE'), 'runner cannot truncate queue');
select ok((select relrowsecurity from pg_class where oid = 'public.product_media_jobs'::regclass), 'RLS enabled');
select ok(not has_function_privilege('anon', 'public.claim_product_media_job(integer)', 'EXECUTE'), 'public cannot claim');
select ok(not has_function_privilege('authenticated', 'public.claim_product_media_job(integer)', 'EXECUTE'), 'ordinary auth cannot claim');

insert into public.categories(slug,name,description,icon,image) values ('media-test','Test','','gear','');
insert into public.products(id,slug,name,category_slug,short_description)
values ('11111111-1111-4111-8111-111111111111','media-product','Test','media-test','');
create temp table before_revision as select public.get_content_revision() as n;
create temp table before_images as select count(*)::int as n from public.product_images;

select lives_ok($$select public.reserve_product_media_job('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',repeat('a',64),'normal','image/jpeg',100)$$, 'reserve');
select lives_ok($$select public.reserve_product_media_job('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',repeat('a',64),'normal','image/jpeg',100)$$, 'same reservation is idempotent');
select is((select count(*)::int from public.product_media_jobs), 1, 'one reservation');
select throws_ok($$select public.reserve_product_media_job('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',repeat('b',64),'normal','image/jpeg',100)$$, '22023', 'media_job_conflict', 'owner cannot be replaced');
select throws_ok($$select public.queue_product_media_job('22222222-2222-4222-8222-222222222222',repeat('b',64),'11111111-1111-4111-8111-111111111111',repeat('c',64))$$, '22023', 'media_job_conflict', 'wrong owner cannot enqueue');
select lives_ok($$select public.queue_product_media_job('22222222-2222-4222-8222-222222222222',repeat('a',64),'11111111-1111-4111-8111-111111111111',repeat('c',64))$$, 'enqueue checked upload');
select lives_ok($$select public.queue_product_media_job('22222222-2222-4222-8222-222222222222',repeat('a',64),'11111111-1111-4111-8111-111111111111',repeat('c',64))$$, 'enqueue repeat');
select throws_ok($$select public.queue_product_media_job('22222222-2222-4222-8222-222222222222',repeat('a',64),'11111111-1111-4111-8111-111111111111',repeat('d',64))$$, '22023', 'media_job_conflict', 'source hash immutable');
select is(public.get_content_revision(), (select n from before_revision), 'queue does not publish changes');

create temp table lease as select * from public.claim_product_media_job(60);
select is((select count(*)::int from lease), 1, 'one claim');
select is((select count(*)::int from public.claim_product_media_job(60)), 0, 'live lease cannot be claimed again');
select throws_ok($$select public.fail_product_media_job('22222222-2222-4222-8222-222222222222','ffffffff-ffff-4fff-8fff-ffffffffffff',true)$$, '22023', 'media_job_conflict', 'wrong token cannot fail');
select lives_ok($$select public.fail_product_media_job(id,lease_token,true) from lease$$, 'retry releases lease');
create temp table lease2 as select * from public.claim_product_media_job(60);
select isnt((select lease_token from lease2), (select lease_token from lease), 'retry rotates fencing token');
select is((select attempts from lease2), 2, 'attempt counted');

create temp table receipt as select jsonb_build_object(
 'inputSha256',repeat('c',64),
 'master',jsonb_build_object('path','media-product/22222222-2222-4222-8222-222222222222/master.jpg','contentType','image/jpeg','sha256',repeat('1',64),'bytes',100),
 'thumbnail',jsonb_build_object('path','media-product/22222222-2222-4222-8222-222222222222/variants/v2/thumbnail-'||repeat('2',16)||'.webp','contentType','image/webp','sha256',repeat('2',64),'bytes',50),
 'gallery',jsonb_build_object('path','media-product/22222222-2222-4222-8222-222222222222/variants/v1/gallery-'||repeat('3',16)||'.webp','contentType','image/webp','sha256',repeat('3',64),'bytes',75)
) as value;
select throws_ok($$select public.finish_product_media_job(id,lease_token,(select value from receipt),'https://media.example.invalid') from lease$$, '22023','media_job_conflict','stale lease cannot publish');
select throws_ok($$select public.finish_product_media_job(id,lease_token,jsonb_set((select value from receipt),'{master,path}','"../outside"'),'https://media.example.invalid') from lease2$$,'22023','invalid_media_receipt','unsafe receipt rejected');
select is((select count(*)::int from public.product_images),(select n from before_images),'failed finalize writes no image');
select lives_ok($$select public.finish_product_media_job(id,lease_token,(select value from receipt),'https://media.example.invalid') from lease2$$,'finalize');
select lives_ok($$select public.finish_product_media_job(id,lease_token,(select value from receipt),'https://media.example.invalid') from lease2$$,'lost response retry idempotent');
select is((select count(*)::int from public.product_images),(select n+1 from before_images),'only one product image added');
select is((select state from public.product_media_jobs),'succeeded','job and image committed together');
select is(public.get_content_revision(), (select n+1 from before_revision),'only image publication advances revision');
select is((select url from public.product_images where product_id='11111111-1111-4111-8111-111111111111'),'https://media.example.invalid/product-images/media-product/22222222-2222-4222-8222-222222222222/master.jpg','existing R2 URL layout');
select throws_ok($$select public.finish_product_media_job(id,lease_token,(select value from receipt),'https://other.example.invalid') from lease2$$,'22023','media_job_conflict','finished receipt cannot change origin');

select lives_ok($$select public.reserve_product_media_job('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',repeat('a',64),'script-webp','image/png',100)$$,'reserve another');
select lives_ok($$select public.cancel_product_media_job('44444444-4444-4444-8444-444444444444',repeat('a',64))$$,'cancel');
select throws_ok($$select public.queue_product_media_job('44444444-4444-4444-8444-444444444444',repeat('a',64),'11111111-1111-4111-8111-111111111111',repeat('c',64))$$,'22023','media_job_conflict','cancelled job cannot return to queue');

select lives_ok($$select public.reserve_product_media_job('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',repeat('a',64),'normal','image/jpeg',100)$$,'reserve retry case');
select lives_ok($$select public.queue_product_media_job('55555555-5555-4555-8555-555555555555',repeat('a',64),'11111111-1111-4111-8111-111111111111',repeat('c',64))$$,'enqueue retry case');
create temp table expired_lease as select * from public.claim_product_media_job(60);
update public.product_media_jobs set lease_until = clock_timestamp()-interval '1 second' where id = '55555555-5555-4555-8555-555555555555';
create temp table reclaimed as select * from public.claim_product_media_job(60);
select is((select attempts from reclaimed),2,'crashed worker lease recovered');
select isnt((select lease_token from reclaimed),(select lease_token from expired_lease),'expired token fenced');
select throws_ok($$select public.fail_product_media_job(id,lease_token,false) from expired_lease$$,'22023','media_job_conflict','old worker cannot fail new attempt');
select lives_ok($$select public.fail_product_media_job(id,lease_token,true) from reclaimed$$,'second retry');
create temp table third as select * from public.claim_product_media_job(60);
select lives_ok($$select public.fail_product_media_job(id,lease_token,true) from third$$,'third failure terminal');
select is((select state from public.product_media_jobs where id = '55555555-5555-4555-8555-555555555555'),'failed','bounded retries');
select is((select count(*)::int from public.claim_product_media_job(60)),0,'no fourth attempt');
select * from finish();
rollback;
