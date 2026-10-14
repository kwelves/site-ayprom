begin;
select no_plan();

select has_function('public','capture_catalog_publication',array['bigint','uuid','text'],
 'private builder has an atomic capture endpoint');

-- Explicit deterministic fixture: no production data and transaction rollback.
insert into public.categories(slug,name,description,icon,image,intro,type,"order")
 values ('capture-category','Category','Description','pump','/category.svg','Intro','subcategory',8);
insert into public.subcategories(id,category_slug,slug,name,image,intro,"order")
 values ('20000000-0000-4000-8000-000000000010','capture-category','child','Child','/child.svg','Child intro',9);
insert into public.brands(slug,name,country,logo,logo_scale,"order",aliases)
 values ('capture-brand','Brand','KG','/brand.svg',1.4,3,array['alias']);
insert into public.category_brands(category_slug,brand_slug,logo_scale_override,"order")
 values ('capture-category','capture-brand',1.7,4);
insert into public.vehicle_types(slug,name,"order") values ('capture-truck','Truck',5);
insert into public.products(id,slug,name,category_slug,subcategory_id,short_description,
 description,article,meta_title,meta_description,"order",published,updated_at)
 values ('20000000-0000-4000-8000-000000000020','capture-product','Product','capture-category',
 '20000000-0000-4000-8000-000000000010','Short','Full description','P-123','SEO title','SEO desc',6,true,'2026-10-01T00:00:00Z'),
 ('20000000-0000-4000-8000-000000000021','capture-empty','Empty','capture-category',null,'Empty',null,null,null,null,7,true,'2026-10-01T00:00:00Z'),
 ('20000000-0000-4000-8000-000000000022','capture-draft','Secret draft','capture-category',null,'Private',null,null,null,null,8,false,'2026-10-01T00:00:00Z');
insert into public.product_images(product_id,url,thumbnail_url,gallery_url,scale,"order")
 values ('20000000-0000-4000-8000-000000000020','/master.png','/thumb.webp','/gallery.webp',1.2,2),
 ('20000000-0000-4000-8000-000000000020','/other.png',null,null,null,3);
insert into public.product_characteristics(product_id,attribute,value,"order")
 values ('20000000-0000-4000-8000-000000000020','Pressure','350 bar',2);
insert into public.product_brands(product_id,brand_slug)
 values ('20000000-0000-4000-8000-000000000020','capture-brand');
insert into public.product_vehicle_types(product_id,vehicle_type_slug)
 values ('20000000-0000-4000-8000-000000000020','capture-truck');
insert into public.vehicle_hotspots(id,vehicle_type_slug,hotspot_number,label,x_pct,y_pct,product_id)
 values ('20000000-0000-4000-8000-000000000030','capture-truck',1,'Pump',12.34,56.78,'20000000-0000-4000-8000-000000000020'),
 ('20000000-0000-4000-8000-000000000031','capture-truck',2,'Coming soon',30,40,null),
 ('20000000-0000-4000-8000-000000000032','capture-truck',3,'Hidden product',50,60,'20000000-0000-4000-8000-000000000022');

create temp table capture_result as select public.capture_catalog_publication(public.get_content_revision(),
 '20000000-0000-4000-8000-000000000001',encode(extensions.digest('test-capture-capability','sha256'),'hex')) as result;
select ok((select result->>'sha256' ~ '^[0-9a-f]{64}$' from capture_result),'capture seals a SHA-256');
select is((select state from catalog_private.catalog_releases where id='20000000-0000-4000-8000-000000000001'),
 'sealed','capture is not automatically public');
select is((select count(*) from catalog_private.catalog_publication_active),0::bigint,'capture does not activate');
select throws_ok($$select public.read_catalog_publication_document('product','capture-product')$$,
 '55000','Catalog publication unavailable','no implicit active release');

create temp table captured as select kind,key,payload from catalog_private.catalog_release_documents
 where release_id='20000000-0000-4000-8000-000000000001';
select is((select payload from captured where kind='product' and key='capture-product'),
 jsonb_build_object('slug','capture-product','name','Product','category_slug','capture-category',
 'short_description','Short','description','Full description','article','P-123','meta_title','SEO title','meta_description','SEO desc',
 'order',6,'updated_at','2026-10-01T00:00:00+00:00','subcategories',jsonb_build_object('slug','child'),
 'product_images',jsonb_build_array(jsonb_build_object('url','/master.png','thumbnail_url','/thumb.webp','gallery_url','/gallery.webp','scale',1.2,'order',2),
 jsonb_build_object('url','/other.png','thumbnail_url',null,'gallery_url',null,'scale',null,'order',3)),
 'product_characteristics',jsonb_build_array(jsonb_build_object('attribute','Pressure','value','350 bar','order',2)),
 'product_brands',jsonb_build_array(jsonb_build_object('brands',jsonb_build_object('slug','capture-brand','name','Brand','country','KG','logo','/brand.svg','logo_scale',1.4))),
 'product_vehicle_types',jsonb_build_array(jsonb_build_object('vehicle_type_slug','capture-truck'))),
 'every legacy product detail, image variant, metadata and sitemap field survives');
select is((select payload->'product_images' from captured where kind='product' and key='capture-empty'),'[]'::jsonb,'no images stays empty');
select is((select payload->'product_characteristics' from captured where kind='product' and key='capture-empty'),'[]'::jsonb,'no characteristics stays empty');
select is((select payload->'subcategories' from captured where kind='product' and key='capture-empty'),'null'::jsonb,'no subcategory stays null');
select is((select count(*) from captured where kind='product' and key='capture-draft'),0::bigint,'unpublished product excluded');
select ok((select payload @> '{"intro":"Intro","order":8,"type":"subcategory","description":"Description","icon":"pump","image":"/category.svg"}' from captured where kind='category' and key='capture-category'),'category content and ordering retained');
select ok((select payload @> '{"category_slug":"capture-category","intro":"Child intro","order":9}' from captured where kind='subcategory' and key='["capture-category", "child"]'),'subcategory parent and intro retained with collision-free key');
select ok((select payload @> '{"logo_scale":1.4,"country":"KG","order":3}' from captured where kind='brand' and key='capture-brand'),'brand fields retained');
select ok((select payload @> '{"logo_scale_override":1.7,"order":4,"brand_slug":"capture-brand"}' from captured where kind='category_brand' and key='["capture-category", "capture-brand"]'),'category-specific brand scale retained');
select ok((select payload @> '{"name":"Truck","order":5}' from captured where kind='vehicle_type' and key='capture-truck'),'vehicle type retained');
select ok((select payload @> '{"x_pct":12.34,"y_pct":56.78,"label":"Pump","products":{"slug":"capture-product","product_images":[{"gallery_url":"/gallery.webp"}]}}' from captured where kind='vehicle_hotspot' and key='20000000-0000-4000-8000-000000000030'),'showcase coordinates and full gallery retained');
select is((select payload->'products' from captured where kind='vehicle_hotspot' and key='20000000-0000-4000-8000-000000000031'),'null'::jsonb,'unlinked hotspot retained');
select is((select payload->'products' from captured where kind='vehicle_hotspot' and key='20000000-0000-4000-8000-000000000032'),'null'::jsonb,'draft hotspot cannot expose draft details');
select is((select cover_url from catalog_private.catalog_release_search where release_id='20000000-0000-4000-8000-000000000001' and slug='capture-product'),'/thumb.webp','search uses thumbnail');
select is((select cover_fallback_url from catalog_private.catalog_release_search where release_id='20000000-0000-4000-8000-000000000001' and slug='capture-product'),'/master.png','search retains fallback');
select is((select count(*) from public.search_catalog_products('350',null,null,null,null,false,'20000000-0000-4000-8000-000000000001','test-capture-capability')),1::bigint,'characteristics remain searchable');

select is(public.capture_catalog_publication(public.get_content_revision(), '20000000-0000-4000-8000-000000000001',encode(extensions.digest('test-capture-capability','sha256'),'hex')),
 (select result from capture_result),'same ID retry is idempotent');
select is(public.capture_catalog_publication(public.get_content_revision(), '20000000-0000-4000-8000-000000000002',repeat('b',64))->>'sha256',
 (select result->>'sha256' from capture_result),'content hash independent of release id, capability and capture time');
select throws_ok($$select public.capture_catalog_publication(public.get_content_revision()-1,'20000000-0000-4000-8000-000000000003',repeat('c',64))$$,
 '55000','Catalog capture unavailable','stale revision refuses capture');
select throws_ok($$select public.capture_catalog_publication(public.get_content_revision(),'20000000-0000-4000-8000-000000000001',repeat('c',64))$$,
 '55000','Catalog capture unavailable','same ID with different capability refuses reuse');
select throws_ok($$select public.capture_catalog_publication(-1,'20000000-0000-4000-8000-000000000003',repeat('c',64))$$,
 '22023','Invalid catalog capture request','invalid revision rejected');
select throws_ok($$select public.capture_catalog_publication(public.get_content_revision(),'20000000-0000-4000-8000-000000000003','not-a-hash')$$,
 '22023','Invalid catalog capture request','invalid hash rejected without echo');
update public.products set name='Changed after capture' where slug='capture-product';
select is(public.read_catalog_publication_document('product','capture-product','20000000-0000-4000-8000-000000000001','test-capture-capability')->>'name','Product','source edit cannot change captured document');
select is(public.capture_catalog_publication((select (result->>'revision')::bigint from capture_result),'20000000-0000-4000-8000-000000000001',encode(extensions.digest('test-capture-capability','sha256'),'hex')),
 (select result from capture_result),'lost-response retry returns sealed snapshot even after source changes');
update public.products set description=repeat('x',1048577) where slug='capture-product';
select throws_ok($$select public.capture_catalog_publication(public.get_content_revision(),'20000000-0000-4000-8000-000000000004',repeat('d',64))$$,
 '55000','Catalog capture unavailable','oversized data safely aborts capture');
select is((select count(*) from catalog_private.catalog_releases where id='20000000-0000-4000-8000-000000000004'),0::bigint,'failed capture leaves no partial release');
-- A separate bound failure, not the already oversized product above.
savepoint capture_count_bound;
update public.products set description='Small again' where slug='capture-product';
insert into public.vehicle_types(slug,name)
 select 'capture-bound-'||n,'Bound fixture' from generate_series(1,20001) n;
select throws_ok($$select public.capture_catalog_publication(public.get_content_revision(),'20000000-0000-4000-8000-000000000005',repeat('e',64))$$,
 '55000','Catalog capture unavailable','too many documents reject the entire capture');
select is((select count(*) from catalog_private.catalog_releases where id='20000000-0000-4000-8000-000000000005'),0::bigint,'count overflow leaves no partial release');
rollback to savepoint capture_count_bound;
select ok(not has_function_privilege('anon','public.capture_catalog_publication(bigint,uuid,text)','execute'),'anon cannot capture');
select ok(not has_function_privilege('authenticated','public.capture_catalog_publication(bigint,uuid,text)','execute'),'authenticated cannot capture');
select ok(has_function_privilege('service_role','public.capture_catalog_publication(bigint,uuid,text)','execute'),'dedicated server may capture');
select * from finish();
rollback;
