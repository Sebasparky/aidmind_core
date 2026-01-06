-- Enable full replica identity for sessions table to support realtime updates
ALTER TABLE public.sessions REPLICA IDENTITY FULL;

-- Add sessions table to realtime publication (if not already added)
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;