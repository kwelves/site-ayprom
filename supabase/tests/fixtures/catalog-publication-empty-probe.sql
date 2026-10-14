-- This is run BEFORE optional seed, only in the disposable contract stack.
begin;
do $$ declare receipt jsonb; document_count bigint; begin
  if exists(select 1 from public.categories) or exists(select 1 from public.products) then
    raise exception 'empty probe requires a fresh test database';
  end if;
  receipt := public.capture_catalog_publication(public.get_content_revision(),
    '50000000-0000-4000-8000-000000000001',encode(extensions.digest('empty-fixture','sha256'),'hex'));
  if (receipt->>'documentCount')::bigint <> 0 or receipt->>'sha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'empty catalog was not sealed correctly';
  end if;
  select count(*) into document_count from public.list_catalog_publication_documents('product',
    '50000000-0000-4000-8000-000000000001','empty-fixture');
  if document_count <> 0 then raise exception 'empty release is not empty'; end if;
end $$;
rollback;
