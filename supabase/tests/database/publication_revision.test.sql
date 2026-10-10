begin;
select plan(13);

select has_table('public', 'content_revision', 'publication revision is persisted');
select has_function('public', 'get_content_revision', array[]::text[], 'builder can read a revision');
select ok(has_table_privilege('anon', 'public.content_revision', 'SELECT'), 'public builder can read the non-secret revision');
select ok(not has_table_privilege('authenticated', 'public.content_revision', 'UPDATE'), 'ordinary clients cannot rewrite the revision');
select ok(not has_table_privilege('anon', 'public.content_revision', 'INSERT'), 'anonymous clients cannot create a revision row');
select ok(not has_table_privilege('anon', 'public.content_revision', 'TRUNCATE'), 'anonymous clients cannot truncate the revision table');
select ok(not has_table_privilege('authenticated', 'public.content_revision', 'TRUNCATE'), 'authenticated clients cannot truncate the revision table');
select ok(has_function_privilege('anon', 'public.get_content_revision()', 'EXECUTE'), 'public snapshot builder can read the revision number');

create temp table revision_before as select public.get_content_revision() as value;

insert into public.categories (slug, name, description, icon, image, "order")
values ('qa-revision-one', 'One', '', 'gear', '', 900001),
       ('qa-revision-two', 'Two', '', 'gear', '', 900002);
select is(public.get_content_revision(), (select value + 1 from revision_before), 'one INSERT statement increments only once');

insert into public.products (slug, name, category_slug, short_description)
values ('qa-revision-product', 'Product', 'qa-revision-one', '');
select ok(public.get_content_revision() > (select value + 1 from revision_before), 'product creation advances the revision');
create temp table revision_after_product as select public.get_content_revision() as value;

savepoint revision_rollback;
update public.products set availability = 'out_of_stock' where slug = 'qa-revision-product';
select ok(public.get_content_revision() > (select value from revision_after_product), 'availability change advances the revision');
rollback to savepoint revision_rollback;
select is(public.get_content_revision(), (select value from revision_after_product), 'rolled-back mutation cannot advance the revision');

select is((select count(distinct trigger_row.tgrelid)::int
           from pg_trigger as trigger_row
           where trigger_row.tgfoid = 'public.bump_content_revision()'::regprocedure
             and not trigger_row.tgisinternal), 11, 'all public-content tables are watched');

select * from finish();
rollback;
