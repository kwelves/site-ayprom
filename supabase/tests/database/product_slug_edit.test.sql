begin;
select plan(11);
insert into public.categories (slug, name, description, icon, image, "order")
values ('qa-slug-edit-category', 'Slug test', '', 'icon', 'image', 919991);
insert into public.products (slug, name, category_slug, short_description, updated_at)
values ('qa-slug-original', 'Original', 'qa-slug-edit-category', '', '2026-01-01'),
       ('qa-slug-taken', 'Taken', 'qa-slug-edit-category', '', '2026-01-01');
create temp table slug_original_id as select id from public.products where slug = 'qa-slug-original';

create function pg_temp.rename_product(new_slug text, version timestamptz default '2026-01-01') returns void
language plpgsql as $$begin
  perform public.update_product_with_slug(
    p_slug => case when new_slug = 'qa-slug-new' then 'qa-slug-original' else 'qa-slug-new' end,
    p_new_slug => new_slug, p_expected_updated_at => version,
    p_name => case when new_slug = 'qa-slug-taken' then 'Must roll back' else 'Edited' end,
    p_category_slug => 'qa-slug-edit-category', p_subcategory_slug => null,
    p_short_description => '', p_description => null, p_article => null,
    p_published => true, p_availability => 'in_stock', p_meta_title => null, p_meta_description => null,
    p_characteristics => '[{"attribute":"Size","value":"10"}]'::jsonb,
    p_compatible_brands => '{}'::text[], p_vehicle_types => '{}'::text[]);
end$$;

select lives_ok($$select pg_temp.rename_product('qa-slug-new')$$, 'renames atomically');
select is((select id from public.products where slug = 'qa-slug-new'),
          (select id from slug_original_id), 'keeps product identity');
select is((select count(*)::int from public.product_characteristics where product_id = (select id from slug_original_id)),
          1, 'saves relations with the new slug');
select throws_ok($$select pg_temp.rename_product('qa-slug-taken', (select updated_at from public.products where slug = 'qa-slug-new'))$$,
 '22023', 'Этот адрес уже занят другим товаром. Укажите другой slug.', 'rejects occupied slug');
select is((select slug from public.products where id = (select id from slug_original_id)), 'qa-slug-new', 'collision preserves original product');
select is((select name from public.products where id = (select id from slug_original_id)), 'Edited', 'collision rolls back other field edits');
select throws_ok($$select pg_temp.rename_product('qa-slug-stale')$$, '55000',
 'Товар был изменён другим администратором. Обновите страницу, чтобы увидеть актуальную версию.', 'rejects stale form');
select throws_ok($$select pg_temp.rename_product('')$$, '22023',
 'Укажите адрес товара: латинские буквы, цифры и дефисы.', 'rejects empty slug');
select ok(not has_function_privilege('anon',
 'public.update_product_with_slug(text,text,timestamptz,text,text,text,text,text,text,boolean,public.product_availability,text,text,jsonb,text[],text[])', 'EXECUTE'),
 'anonymous users cannot rename products');
select ok(not has_function_privilege('authenticated',
 'public.update_product_with_slug(text,text,timestamptz,text,text,text,text,text,text,boolean,public.product_availability,text,text,jsonb,text[],text[])', 'EXECUTE'),
 'ordinary authenticated users cannot rename products');
select ok(has_function_privilege('service_role',
 'public.update_product_with_slug(text,text,timestamptz,text,text,text,text,text,text,boolean,public.product_availability,text,text,jsonb,text[],text[])', 'EXECUTE'),
 'server admin client can rename products');
select * from finish();
rollback;
