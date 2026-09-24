-- A separate RPC preserves compatibility with already deployed clients.
-- The existing mutation and the rename share one transaction and row lock.
CREATE OR REPLACE FUNCTION "public"."update_product_with_slug"(
  p_slug text, p_new_slug text, p_expected_updated_at timestamptz,
  p_name text, p_category_slug text, p_subcategory_slug text,
  p_short_description text, p_description text, p_article text,
  p_published boolean, p_availability public.product_availability,
  p_meta_title text, p_meta_description text, p_characteristics jsonb,
  p_compatible_brands text[], p_vehicle_types text[]
) RETURNS TABLE(out_id uuid, out_updated_at timestamptz)
LANGUAGE plpgsql
SET search_path = ''
AS $$
declare
  v_id uuid;
  v_updated_at timestamptz;
begin
  if p_new_slug is null or p_new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Укажите адрес товара: латинские буквы, цифры и дефисы.' using errcode = '22023';
  end if;

  select m.out_id, m.out_updated_at into v_id, v_updated_at
  from public.update_product_with_relations(
    p_slug, p_expected_updated_at, p_name, p_category_slug, p_subcategory_slug,
    p_short_description, p_description, p_article, p_published, p_availability,
    p_meta_title, p_meta_description, p_characteristics, p_compatible_brands, p_vehicle_types
  ) m;

  if p_new_slug is distinct from p_slug then
    begin
      update public.products set slug = p_new_slug where id = v_id;
    exception when unique_violation then
      raise exception 'Этот адрес уже занят другим товаром. Укажите другой slug.' using errcode = '22023';
    end;
  end if;

  return query select v_id, v_updated_at;
end;
$$;

REVOKE ALL ON FUNCTION "public"."update_product_with_slug"(text,text,timestamptz,text,text,text,text,text,text,boolean,public.product_availability,text,text,jsonb,text[],text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION "public"."update_product_with_slug"(text,text,timestamptz,text,text,text,text,text,text,boolean,public.product_availability,text,text,jsonb,text[],text[]) TO service_role;

