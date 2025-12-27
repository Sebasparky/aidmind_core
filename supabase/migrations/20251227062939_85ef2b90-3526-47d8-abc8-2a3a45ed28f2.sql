-- Create sessions table for ephemeral session management
CREATE TABLE public.sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL,
  case_label TEXT,
  client_label TEXT,
  interaction_type TEXT,
  state TEXT NOT NULL DEFAULT 'NEW',
  ttl_expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE
);

-- Create transcription_jobs table
CREATE TABLE public.transcription_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.sessions(session_id) ON DELETE CASCADE,
  audio_object_key TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini-transcribe',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  ttl_expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Create ephemeral_artifacts table for transcripts and minimized transcripts
CREATE TABLE public.ephemeral_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.sessions(session_id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL, -- 'raw_transcript', 'minimized_transcript'
  content TEXT NOT NULL,
  ttl_expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create eye_events table for audit logging (no PHI stored)
CREATE TABLE public.eye_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_sessions_session_id ON public.sessions(session_id);
CREATE INDEX idx_sessions_ttl ON public.sessions(ttl_expires_at);
CREATE INDEX idx_sessions_state ON public.sessions(state);
CREATE INDEX idx_transcription_jobs_session_id ON public.transcription_jobs(session_id);
CREATE INDEX idx_transcription_jobs_status ON public.transcription_jobs(status);
CREATE INDEX idx_transcription_jobs_ttl ON public.transcription_jobs(ttl_expires_at);
CREATE INDEX idx_ephemeral_artifacts_session_id ON public.ephemeral_artifacts(session_id);
CREATE INDEX idx_ephemeral_artifacts_ttl ON public.ephemeral_artifacts(ttl_expires_at);
CREATE INDEX idx_eye_events_session_id ON public.eye_events(session_id);
CREATE INDEX idx_eye_events_type ON public.eye_events(event_type);

-- Enable RLS on all tables
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcription_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ephemeral_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eye_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for sessions - allow service role and anon for now (no auth yet)
CREATE POLICY "Allow all operations on sessions" ON public.sessions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on transcription_jobs" ON public.transcription_jobs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on ephemeral_artifacts" ON public.ephemeral_artifacts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on eye_events" ON public.eye_events
  FOR ALL USING (true) WITH CHECK (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for sessions timestamp
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for audio uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio-uploads',
  'audio-uploads',
  false,
  52428800, -- 50MB limit
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a']
);

-- Storage policies for audio uploads bucket
CREATE POLICY "Allow upload to audio-uploads bucket"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'audio-uploads');

CREATE POLICY "Allow read from audio-uploads bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'audio-uploads');

CREATE POLICY "Allow delete from audio-uploads bucket"
ON storage.objects FOR DELETE
USING (bucket_id = 'audio-uploads');