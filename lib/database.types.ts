export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          email: string;
          avatar: string;
          is_sqemes_admin: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          name?: string;
          email?: string;
          avatar?: string;
          is_sqemes_admin?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          avatar?: string;
          is_sqemes_admin?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      external_chat_history: {
        Row: {
          id: string;
          user_id: string;
          platform: string;
          chat_key: string;
          title: string;
          url: string;
          pinned: boolean;
          created_at: string;
          last_seen_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform: string;
          chat_key: string;
          title?: string;
          url: string;
          pinned?: boolean;
          created_at?: string;
          last_seen_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          platform?: string;
          chat_key?: string;
          title?: string;
          url?: string;
          pinned?: boolean;
          created_at?: string;
          last_seen_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          plan: 'Solo' | 'Team' | 'Business';
          is_managed: boolean;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          billing_cycle: string | null;
          credits_used: number;
          credits_limit: number;
          blacklisted_terms: string[];
          block_emails: boolean;
          block_iban: boolean;
          block_phone: boolean;
          tags: string[];
          openrouter_models: string[];
          brand_profile: Json | null;
          credits_period_start: string;
          subscription_status: string | null;
          trial_ends_at: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          plan?: 'Solo' | 'Team' | 'Business';
          is_managed?: boolean;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          billing_cycle?: string | null;
          credits_used?: number;
          credits_limit?: number;
          blacklisted_terms?: string[];
          block_emails?: boolean;
          block_iban?: boolean;
          block_phone?: boolean;
          tags?: string[];
          openrouter_models?: string[];
          brand_profile?: Json | null;
          credits_period_start?: string;
          subscription_status?: string | null;
          trial_ends_at?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          plan?: 'Solo' | 'Team' | 'Business';
          is_managed?: boolean;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          billing_cycle?: string | null;
          credits_used?: number;
          credits_limit?: number;
          blacklisted_terms?: string[];
          block_emails?: boolean;
          block_iban?: boolean;
          block_phone?: boolean;
          tags?: string[];
          openrouter_models?: string[];
          brand_profile?: Json | null;
          credits_period_start?: string;
          subscription_status?: string | null;
          trial_ends_at?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: 'admin' | 'editor' | 'member';
          joined_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: 'admin' | 'editor' | 'member';
          joined_at?: string;
        };
        Update: {
          workspace_id?: string;
          user_id?: string;
          role?: 'admin' | 'editor' | 'member';
          joined_at?: string;
        };
        Relationships: [];
      };
      workspace_api_keys: {
        Row: {
          id: string;
          workspace_id: string;
          provider: string;
          encrypted_key: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          provider: string;
          encrypted_key: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          provider?: string;
          encrypted_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sqemes_api_keys: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes: string[];
          expires_at: string | null;
          connection_expires_at: string | null;
          is_oauth: boolean;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes?: string[];
          expires_at?: string | null;
          connection_expires_at?: string | null;
          is_oauth?: boolean;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          key_hash?: string;
          key_prefix?: string;
          scopes?: string[];
          expires_at?: string | null;
          connection_expires_at?: string | null;
          is_oauth?: boolean;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      prompts: {
        Row: {
          id: string;
          workspace_id: string;
          kind: string;
          title: string;
          description: string;
          tags: string[];
          variables: Json;
          steps: Json;
          content: string;
          system_instruction: string | null;
          context_file_ids: string[];
          skill_ids: string[];
          model: string | null;
          created_by: string | null;
          usage_count: number;
          is_favorite: boolean;
          published: boolean;
          source_template_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          kind?: string;
          title: string;
          description?: string;
          tags?: string[];
          variables?: Json;
          steps?: Json;
          content?: string;
          system_instruction?: string | null;
          context_file_ids?: string[];
          skill_ids?: string[];
          model?: string | null;
          created_by?: string | null;
          usage_count?: number;
          is_favorite?: boolean;
          published?: boolean;
          source_template_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          kind?: string;
          title?: string;
          description?: string;
          tags?: string[];
          variables?: Json;
          steps?: Json;
          content?: string;
          system_instruction?: string | null;
          context_file_ids?: string[];
          skill_ids?: string[];
          model?: string | null;
          created_by?: string | null;
          usage_count?: number;
          is_favorite?: boolean;
          published?: boolean;
          source_template_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: 'admin' | 'editor' | 'member';
          token: string;
          invited_by: string | null;
          status: 'pending' | 'accepted' | 'expired';
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: 'admin' | 'editor' | 'member';
          token?: string;
          invited_by?: string | null;
          status?: 'pending' | 'accepted' | 'expired';
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string;
          role?: 'admin' | 'editor' | 'member';
          token?: string;
          invited_by?: string | null;
          status?: 'pending' | 'accepted' | 'expired';
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      library_templates: {
        Row: {
          id: string;
          kind: string;
          title: string;
          description: string;
          category: string;
          tags: string[];
          variables: Json;
          steps: Json;
          system_instruction: string | null;
          brand_config: Json | null;
          created_by: string | null;
          usage_count: number;
          published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kind?: string;
          title: string;
          description?: string;
          category?: string;
          tags?: string[];
          variables?: Json;
          steps?: Json;
          system_instruction?: string | null;
          brand_config?: Json | null;
          created_by?: string | null;
          usage_count?: number;
          published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          kind?: string;
          title?: string;
          description?: string;
          category?: string;
          tags?: string[];
          variables?: Json;
          steps?: Json;
          system_instruction?: string | null;
          brand_config?: Json | null;
          created_by?: string | null;
          usage_count?: number;
          published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_sessions: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          title: string;
          model: string;
          assistant_id: string | null;
          visibility: 'private' | 'workspace';
          is_generating: boolean;
          pinned: boolean;
          created_at: string;
          last_active_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          title?: string;
          model?: string;
          assistant_id?: string | null;
          visibility?: 'private' | 'workspace';
          is_generating?: boolean;
          pinned?: boolean;
          created_at?: string;
          last_active_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          title?: string;
          model?: string;
          assistant_id?: string | null;
          visibility?: 'private' | 'workspace';
          is_generating?: boolean;
          pinned?: boolean;
          created_at?: string;
          last_active_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          session_id: string;
          role: 'user' | 'assistant';
          content: string;
          model: string | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          role: 'user' | 'assistant';
          content: string;
          model?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          role?: 'user' | 'assistant';
          content?: string;
          model?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_prompt_favorites: {
        Row: {
          user_id: string;
          prompt_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          prompt_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          prompt_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      workspace_files: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          tags: string[];
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          tags?: string[];
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          tags?: string[];
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_user_workspace_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      get_user_role: {
        Args: { ws_id: string };
        Returns: 'admin' | 'editor' | 'member';
      };
      increment_credits: {
        Args: { ws_id: string; amount: number };
        Returns: undefined;
      };
      accept_invitation: {
        Args: { p_token: string };
        Returns: string;
      };
      increment_template_usage: {
        Args: { template_id: string };
        Returns: undefined;
      };
      create_workspace: {
        Args: { ws_name: string };
        Returns: string;
      };
      set_workspace_managed: {
        Args: { ws_id: string; managed: boolean };
        Returns: undefined;
      };
      is_sqemes_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      plan_tier: 'Solo' | 'Team' | 'Business';
      workspace_role: 'admin' | 'editor' | 'member';
      folder_type: 'global' | 'personal';
      run_status: 'success' | 'error';
    };
  };
};
