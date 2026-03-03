import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function logEyeEvent(
  supabase: SupabaseClient,
  sessionId: string | null,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('eye_events').insert({
    session_id: sessionId,
    event_type: eventType,
    event_data: eventData,
  });

  if (error) {
    console.error(`Failed to log eye event ${eventType}:`, error.message);
  }
}
