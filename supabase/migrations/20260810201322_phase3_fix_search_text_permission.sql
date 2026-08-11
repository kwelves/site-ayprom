-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

GRANT ALL ON FUNCTION public.refresh_product_search_text(uuid) TO service_role;