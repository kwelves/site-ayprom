-- Public buckets already serve objects via their public URL without going
-- through RLS — a SELECT policy on storage.objects is only needed for the
-- list()/query API, and here it just lets anyone enumerate every uploaded
-- file. Drop it; public URL access for known object paths keeps working.
--
-- `if exists` because 0005_storage.sql was retro-edited to stop creating this
-- policy at all: on the hosted project the policy exists and is dropped here,
-- but a fresh local `supabase db reset` never creates it.
drop policy if exists "Public can read product images" on storage.objects;
