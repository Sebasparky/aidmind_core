export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      compiled_policy_pack_chunks: {
        Row: {
          chunk_id: string
          chunk_index: number
          compiled_policy_pack_id: string
          created_at: string | null
          document_id: string
          id: string
          metadata: Json
          rank: number
          similarity: number
          tenant_id: string
        }
        Insert: {
          chunk_id: string
          chunk_index: number
          compiled_policy_pack_id: string
          created_at?: string | null
          document_id: string
          id?: string
          metadata?: Json
          rank: number
          similarity: number
          tenant_id: string
        }
        Update: {
          chunk_id?: string
          chunk_index?: number
          compiled_policy_pack_id?: string
          created_at?: string | null
          document_id?: string
          id?: string
          metadata?: Json
          rank?: number
          similarity?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compiled_policy_pack_chunks_compiled_policy_pack_id_fkey"
            columns: ["compiled_policy_pack_id"]
            isOneToOne: false
            referencedRelation: "compiled_policy_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      compiled_policy_packs: {
        Row: {
          created_at: string | null
          id: string
          metadata: Json
          retrieval_run_id: string
          session_id: string
          status: string
          template_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          metadata?: Json
          retrieval_run_id: string
          session_id: string
          status?: string
          template_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          metadata?: Json
          retrieval_run_id?: string
          session_id?: string
          status?: string
          template_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compiled_policy_packs_retrieval_run_id_fkey"
            columns: ["retrieval_run_id"]
            isOneToOne: false
            referencedRelation: "retrieval_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          heading_path: string | null
          id: string
          metadata: Json
          tenant_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          heading_path?: string | null
          id?: string
          metadata?: Json
          tenant_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          heading_path?: string | null
          id?: string
          metadata?: Json
          tenant_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ephemeral_artifacts: {
        Row: {
          artifact_type: string
          content: string
          created_at: string
          id: string
          session_id: string
          ttl_expires_at: string
        }
        Insert: {
          artifact_type: string
          content: string
          created_at?: string
          id?: string
          session_id: string
          ttl_expires_at?: string
        }
        Update: {
          artifact_type?: string
          content?: string
          created_at?: string
          id?: string
          session_id?: string
          ttl_expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ephemeral_artifacts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      eye_events: {
        Row: {
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          request_id_text: string | null
          session_id: string | null
        }
        Insert: {
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          request_id_text?: string | null
          session_id?: string | null
        }
        Update: {
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          request_id_text?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      kb_documents: {
        Row: {
          content: string
          created_at: string
          file_path: string | null
          id: string
          metadata: Json
          source: string | null
          tenant_id: string
          title: string
          updated_at: string
          version: string | null
        }
        Insert: {
          content: string
          created_at?: string
          file_path?: string | null
          id?: string
          metadata?: Json
          source?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          file_path?: string | null
          id?: string
          metadata?: Json
          source?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_ingestion_jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: number
          kb_document_id: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          priority: number
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: number
          kb_document_id: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          priority?: number
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: number
          kb_document_id?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          priority?: number
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_ingestion_jobs_kb_document_id_fkey"
            columns: ["kb_document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_templates: {
        Row: {
          content: string
          content_hash: string | null
          content_type: string
          created_at: string
          created_by: string | null
          extraction_status: string
          file_path: string | null
          id: string
          is_active: boolean
          metadata: Json
          name: string
          storage_path: string | null
          tenant_id: string
          updated_at: string
          version: string
        }
        Insert: {
          content?: string
          content_hash?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          extraction_status?: string
          file_path?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          storage_path?: string | null
          tenant_id: string
          updated_at?: string
          version: string
        }
        Update: {
          content?: string
          content_hash?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          extraction_status?: string
          file_path?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name?: string
          storage_path?: string | null
          tenant_id?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      retrieval_runs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error: string | null
          guardrails: Json
          id: string
          params: Json
          query_count: number
          selected_chunk_count: number
          session_id: string
          status: string
          template_id: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error?: string | null
          guardrails?: Json
          id?: string
          params?: Json
          query_count?: number
          selected_chunk_count?: number
          session_id: string
          status?: string
          template_id: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error?: string | null
          guardrails?: Json
          id?: string
          params?: Json
          query_count?: number
          selected_chunk_count?: number
          session_id?: string
          status?: string
          template_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      review_documents: {
        Row: {
          created_at: string
          error: string | null
          extracted_text: string | null
          extraction_metadata: Json
          file_size_bytes: number | null
          id: string
          mime_type: string
          original_filename: string | null
          review_metadata: Json
          review_report: Json | null
          reviewer_model: string | null
          session_id: string
          status: string
          storage_bucket: string
          storage_object_key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json
          file_size_bytes?: number | null
          id?: string
          mime_type?: string
          original_filename?: string | null
          review_metadata?: Json
          review_report?: Json | null
          reviewer_model?: string | null
          session_id: string
          status?: string
          storage_bucket?: string
          storage_object_key: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json
          file_size_bytes?: number | null
          id?: string
          mime_type?: string
          original_filename?: string | null
          review_metadata?: Json
          review_report?: Json | null
          reviewer_model?: string | null
          session_id?: string
          status?: string
          storage_bucket?: string
          storage_object_key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_documents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          cancelled_at: string | null
          case_id: string
          case_label: string | null
          client_label: string | null
          closed_at: string | null
          created_at: string
          guidance_scope: string | null
          guidance_scope_other: string | null
          guidance_scope_set_at: string | null
          guidance_scope_set_by: string | null
          id: string
          interaction_type: string | null
          interview_notes: string | null
          metadata: Json
          policy_pack_id: string | null
          review_document_id: string | null
          session_id: string
          state: string
          status: string
          template_id: string | null
          tenant_id: string | null
          ttl_expires_at: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          case_id?: string
          case_label?: string | null
          client_label?: string | null
          closed_at?: string | null
          created_at?: string
          guidance_scope?: string | null
          guidance_scope_other?: string | null
          guidance_scope_set_at?: string | null
          guidance_scope_set_by?: string | null
          id?: string
          interaction_type?: string | null
          interview_notes?: string | null
          metadata?: Json
          policy_pack_id?: string | null
          review_document_id?: string | null
          session_id?: string
          state?: string
          status?: string
          template_id?: string | null
          tenant_id?: string | null
          ttl_expires_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          case_id?: string
          case_label?: string | null
          client_label?: string | null
          closed_at?: string | null
          created_at?: string
          guidance_scope?: string | null
          guidance_scope_other?: string | null
          guidance_scope_set_at?: string | null
          guidance_scope_set_by?: string | null
          id?: string
          interaction_type?: string | null
          interview_notes?: string | null
          metadata?: Json
          policy_pack_id?: string | null
          review_document_id?: string | null
          session_id?: string
          state?: string
          status?: string
          template_id?: string | null
          tenant_id?: string | null
          ttl_expires_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_review_document_id_fkey"
            columns: ["review_document_id"]
            isOneToOne: false
            referencedRelation: "review_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_users: {
        Row: {
          created_at: string
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transcription_jobs: {
        Row: {
          audio_object_key: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          model: string
          session_id: string
          started_at: string | null
          status: string
          ttl_expires_at: string
        }
        Insert: {
          audio_object_key: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          model?: string
          session_id: string
          started_at?: string | null
          status?: string
          ttl_expires_at?: string
        }
        Update: {
          audio_object_key?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          model?: string
          session_id?: string
          started_at?: string | null
          status?: string
          ttl_expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcription_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_kb_document_content: {
        Args: { p_chunk: string; p_doc_id: string }
        Returns: undefined
      }
      claim_next_kb_job: {
        Args: { p_worker_id: string }
        Returns: {
          attempts: number
          dedupe_key: string
          end_page: number
          id: number
          job_type: string
          kb_document_id: string
          max_attempts: number
          priority: number
          start_page: number
          tenant_id: string
        }[]
      }
      complete_kb_job: {
        Args: { p_error?: string; p_job_id: number; p_status: string }
        Returns: undefined
      }
      enqueue_kb_continuation_job: {
        Args: {
          p_end_page: number
          p_kb_document_id: string
          p_priority?: number
          p_start_page: number
          p_tenant_id: string
        }
        Returns: number
      }
      get_my_profile: { Args: never; Returns: Json }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_policy_snippets_for_session: {
        Args: { session_id_input: string }
        Returns: {
          chunk_text: string
          snippet_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_document_chunks: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
          p_tenant_id: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      update_session_guidance_phase1: {
        Args: { guidance_json: Json; session_id_input: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "caseworker" | "supervisor" | "auditor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["caseworker", "supervisor", "auditor"],
    },
  },
} as const
