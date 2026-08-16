-- Hero video is public by design: it contains no user data and needs to be
-- streamed directly by the browser from Supabase's CDN. Uploads remain
-- server-only via the service role, just like the existing image buckets.
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-media', 'site-media', true)
ON CONFLICT (id) DO NOTHING;
