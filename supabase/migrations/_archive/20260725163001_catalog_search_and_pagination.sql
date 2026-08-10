-- Server-side catalog search and a compact, pageable card projection.
-- The denormalized search_text is refreshed by triggers whenever product
-- text, characteristics, brands/aliases, category, or subcategory changes.

create extension if not exists pg_trgm;

alter table public.brands
  add column aliases text[] not null default '{}';

update public.brands
set aliases = case slug
  when 'daf' then array['даф']
  when 'man' then array['ман']
  when 'scania' then array['скания']
  when 'maz' then array['маз']
  when 'kamaz' then array['камаз']
  when 'renault-trucks' then array['рено', 'рено тракс']
  when 'mercedes-benz' then array['мерседес', 'мерс']
  when 'volvo' then array['вольво']
  when 'zf' then array['зф']
  when 'sitrak' then array['ситрак']
  when 'shacman' then array['шакман', 'шаанси']
  when 'faw' then array['фав']
  when 'howo' then array['хово']
  when 'isuzu' then array['исузу']
  when 'foton' then array['фотон']
  else aliases
end;

alter table public.products
  add column search_text text not null default '';

create or replace function public.normalize_catalog_search(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(lower(coalesce(value, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.refresh_product_search_text(target_product_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  -- Category and subcategory are pulled with scalar subqueries rather than an
  -- `update ... from ... left join`: Postgres forbids referencing the UPDATE
  -- target (`product`) from a join's ON clause, so the join form fails to even
  -- create the function with SQLSTATE 42P01.
  update public.products as product
  set search_text = public.normalize_catalog_search(concat_ws(
    ' ',
    product.name,
    product.article,
    product.short_description,
    product.description,
    (
      select category.name
      from public.categories as category
      where category.slug = product.category_slug
    ),
    (
      select subcategory.name
      from public.subcategories as subcategory
      where subcategory.id = product.subcategory_id
    ),
    (
      select string_agg(concat_ws(' ', brand.name, array_to_string(brand.aliases, ' ')), ' ')
      from public.product_brands as product_brand
      join public.brands as brand on brand.slug = product_brand.brand_slug
      where product_brand.product_id = product.id
    ),
    (
      select string_agg(concat_ws(' ', characteristic.attribute, characteristic.value), ' ')
      from public.product_characteristics as characteristic
      where characteristic.product_id = product.id
    )
  ))
  where product.id = target_product_id;
$$;

create or replace function public.refresh_product_search_from_product()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.refresh_product_search_text(new.id);
  return new;
end;
$$;

create or replace function public.refresh_product_search_from_child()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.refresh_product_search_text(coalesce(new.product_id, old.product_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_product_search_from_brand()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_product_id uuid;
begin
  for target_product_id in
    select product_id
    from public.product_brands
    where brand_slug = coalesce(new.slug, old.slug)
  loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_product_search_from_category()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_product_id uuid;
begin
  for target_product_id in
    select id
    from public.products
    where category_slug = coalesce(new.slug, old.slug)
  loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_product_search_from_subcategory()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_product_id uuid;
begin
  for target_product_id in
    select id
    from public.products
    where subcategory_id = coalesce(new.id, old.id)
  loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
  return coalesce(new, old);
end;
$$;

create trigger products_refresh_search_text
after insert or update of name, article, short_description, description, category_slug, subcategory_id
on public.products
for each row execute function public.refresh_product_search_from_product();

create trigger product_characteristics_refresh_search_text
after insert or update or delete on public.product_characteristics
for each row execute function public.refresh_product_search_from_child();

create trigger product_brands_refresh_search_text
after insert or update or delete on public.product_brands
for each row execute function public.refresh_product_search_from_child();

create trigger brands_refresh_product_search_text
after update of name, aliases on public.brands
for each row execute function public.refresh_product_search_from_brand();

create trigger categories_refresh_product_search_text
after update of name on public.categories
for each row execute function public.refresh_product_search_from_category();

create trigger subcategories_refresh_product_search_text
after update of name, category_slug on public.subcategories
for each row execute function public.refresh_product_search_from_subcategory();

do $$
declare
  target_product_id uuid;
begin
  for target_product_id in select id from public.products loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
end;
$$;

create index products_search_text_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);
create index products_name_trgm_idx
  on public.products using gin (name gin_trgm_ops);
create index products_article_trgm_idx
  on public.products using gin ((coalesce(article, '')) gin_trgm_ops);
create index brands_aliases_idx
  on public.brands using gin (aliases);
create index products_published_order_idx
  on public.products (published, "order", name);
create index products_category_published_order_idx
  on public.products (category_slug, published, "order");

create or replace function public.search_catalog_products(
  search_query text default null,
  category_filter text default null,
  subcategory_filter text default null,
  brand_filter text default null,
  vehicle_type_filter text default null
)
returns table (
  slug text,
  name text,
  category_slug text,
  subcategory_slug text,
  short_description text,
  article text,
  cover_url text,
  cover_scale numeric,
  compatible_brands text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with normalized_query as (
    select public.normalize_catalog_search(search_query) as value
  )
  select
    product.slug,
    product.name,
    product.category_slug,
    subcategory.slug as subcategory_slug,
    product.short_description,
    product.article,
    cover.url as cover_url,
    cover.scale as cover_scale,
    coalesce(brands.slugs, '{}') as compatible_brands
  from public.products as product
  cross join normalized_query
  left join public.subcategories as subcategory on subcategory.id = product.subcategory_id
  left join lateral (
    select image.url, image.scale
    from public.product_images as image
    where image.product_id = product.id
    order by image."order", image.id
    limit 1
  ) as cover on true
  left join lateral (
    select array_agg(product_brand.brand_slug order by product_brand.brand_slug) as slugs
    from public.product_brands as product_brand
    where product_brand.product_id = product.id
  ) as brands on true
  where product.published = true
    and (category_filter is null or product.category_slug = category_filter)
    and (
      subcategory_filter is null
      or (
        subcategory.slug = subcategory_filter
        and (category_filter is null or subcategory.category_slug = category_filter)
      )
    )
    and (
      brand_filter is null
      or exists (
        select 1
        from public.product_brands as product_brand_filter
        where product_brand_filter.product_id = product.id
          and product_brand_filter.brand_slug = brand_filter
      )
    )
    and (
      vehicle_type_filter is null
      or exists (
        select 1
        from public.product_vehicle_types as product_vehicle_type_filter
        where product_vehicle_type_filter.product_id = product.id
          and product_vehicle_type_filter.vehicle_type_slug = vehicle_type_filter
      )
    )
    and (
      normalized_query.value = ''
      or not exists (
        select 1
        from unnest(string_to_array(normalized_query.value, ' ')) as word
        where product.search_text not like ('%' || word || '%')
      )
    )
  order by product."order", product.name;
$$;

revoke execute on function public.refresh_product_search_text(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_product_search_from_product() from public, anon, authenticated;
revoke execute on function public.refresh_product_search_from_child() from public, anon, authenticated;
revoke execute on function public.refresh_product_search_from_brand() from public, anon, authenticated;
revoke execute on function public.refresh_product_search_from_category() from public, anon, authenticated;
revoke execute on function public.refresh_product_search_from_subcategory() from public, anon, authenticated;

grant execute on function public.search_catalog_products(text, text, text, text, text)
  to anon, authenticated, service_role;
