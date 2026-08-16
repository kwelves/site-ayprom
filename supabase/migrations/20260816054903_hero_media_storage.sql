-- Hero video is public by design: it contains no user data and needs to be
-- streamed directly by the browser from Supabase's CDN. Uploads remain
-- server-only via the service role, just like the existing image buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-media', 'site-media', true, 40000000, ARRAY['video/mp4'])
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
