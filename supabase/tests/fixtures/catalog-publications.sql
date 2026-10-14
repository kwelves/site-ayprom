-- Only for a disposable local database; capabilities are public test strings.
insert into catalog_private.catalog_releases(id, revision, capability_hash, state) values
 ('10000000-0000-4000-8000-000000000001',1,encode(extensions.digest('fixture-release-one','sha256'),'hex'),'capturing'),
 ('10000000-0000-4000-8000-000000000002',2,encode(extensions.digest('fixture-release-two','sha256'),'hex'),'capturing');
insert into catalog_private.catalog_release_documents(release_id,kind,key,payload) values
 ('10000000-0000-4000-8000-000000000001','product','pump','{"name":"Old pump"}'),
 ('10000000-0000-4000-8000-000000000002','product','pump','{"name":"New pump"}');
insert into catalog_private.catalog_release_search
 (release_id,slug,name,category_slug,subcategory_slug,compatible_brands,vehicle_types,search_text,sort_order) values
 ('10000000-0000-4000-8000-000000000001','old-a','Pump A','hydraulics','gear',array['kamaz'],array['truck'],'pump a gear kamaz',2),
 ('10000000-0000-4000-8000-000000000001','old-b','Pump B','hydraulics',null,array['shacman'],array['truck'],'pump b shacman',1),
 ('10000000-0000-4000-8000-000000000001','old-c','Valve C','valves',null,array['kamaz'],array['crane'],'valve c kamaz',3),
 ('10000000-0000-4000-8000-000000000002','new-a','New pump','hydraulics','gear',array['kamaz'],array['truck'],'new pump gear kamaz',1);
update catalog_private.catalog_releases set state='sealed' where revision in (1,2);
update catalog_private.catalog_releases set state='ready' where revision=1;
