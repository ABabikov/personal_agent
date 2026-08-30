export type WorkoutType = "gym" | "swim";

export type GymSet = {
  weight: number;
  reps: number;
};

export type PlanExercise = {
  exercise_name: string;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  last_weight: number;
};

export type SwimBlockPhase = "warmup" | "main" | "cooldown";

export type SwimBlockSource = "own" | "curated" | "generator_seed";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ExpenseKind = "expense" | "income" | "withdrawal" | "transfer";

export type ExpenseSource = "manual" | "money_manager" | "bank_sber" | "agent";

/** Признак, по которому правило автокатегоризации узнаёт операцию. */
export type ExpenseRuleMatchType = "merchant" | "mcc" | "bank_category" | "description";

/** Откуда взялось правило: выбор пользователя, подсказка модели, вывод из истории. */
export type ExpenseRuleOrigin = "manual" | "llm" | "learned";

export type ToolCallDescriptor = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          telegram_id: number | null;
          weight: number | null;
          height: number | null;
          age: number | null;
          gender: "male" | "female" | null;
          activity_level: number | null;
          body_fat_pct: number | null;
          /** Что есть из снаряжения; NULL = не использовать фильтр при сборке */
          swim_equipment: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["users"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      workouts: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          type: WorkoutType;
          body_weight: number | null;
          total_tonnage: number | null;
          total_distance: number | null;
          calories_estimated: number | null;
          duration_minutes: number | null;
          notes: string | null;
          status: "active" | "completed";
          created_at: string;
          deleted_at: string | null;
          deleted_reason: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["workouts"]["Row"],
          | "id"
          | "created_at"
          | "deleted_at"
          | "deleted_reason"
          | "status"
          | "duration_minutes"
        > & {
          status?: "active" | "completed";
          deleted_at?: string | null;
          deleted_reason?: string | null;
          duration_minutes?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["workouts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "workouts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      gym_exercises: {
        Row: {
          id: string;
          workout_id: string;
          exercise_name: string;
          order_index: number;
          sets: GymSet[];
          tonnage: number;
        };
        Insert: Omit<Database["public"]["Tables"]["gym_exercises"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["gym_exercises"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "gym_exercises_workout_id_fkey";
            columns: ["workout_id"];
            isOneToOne: false;
            referencedRelation: "workouts";
            referencedColumns: ["id"];
          },
        ];
      };
      gym_presets: {
        Row: {
          user_id: string;
          slot: number;
          label: string;
          exercises: { name: string; sets: GymSet[] }[];
          updated_at: string;
        };
        Insert: {
          user_id: string;
          slot: number;
          label?: string;
          exercises?: { name: string; sets: GymSet[] }[];
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["gym_presets"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "gym_presets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      swim_series: {
        Row: {
          id: string;
          workout_id: string;
          order_index: number;
          distance: number;
          description: string;
        };
        Insert: Omit<Database["public"]["Tables"]["swim_series"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["swim_series"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "swim_series_workout_id_fkey";
            columns: ["workout_id"];
            isOneToOne: false;
            referencedRelation: "workouts";
            referencedColumns: ["id"];
          },
        ];
      };
      swim_block_template: {
        Row: {
          id: string;
          user_id: string | null;
          slug: string;
          goal_tags: string[];
          equipment_tags: string[];
          phase: SwimBlockPhase;
          nominal_distance_m: number;
          min_m: number;
          max_m: number;
          scale_mode: string;
          body_text: string;
          source: SwimBlockSource;
          source_note: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          {
            id: string;
            user_id: string | null;
            slug: string;
            goal_tags: string[];
            equipment_tags?: string[];
            phase: SwimBlockPhase;
            nominal_distance_m: number;
            min_m: number;
            max_m: number;
            scale_mode: string;
            body_text: string;
            source: SwimBlockSource;
            source_note: string | null;
            active: boolean;
            created_at: string;
            updated_at: string;
          },
          "id" | "created_at" | "updated_at"
        > & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          user_id: string | null;
          slug: string;
          goal_tags: string[];
          equipment_tags: string[];
          phase: SwimBlockPhase;
          nominal_distance_m: number;
          min_m: number;
          max_m: number;
          scale_mode: string;
          body_text: string;
          source: SwimBlockSource;
          source_note: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [
          {
            foreignKeyName: "swim_block_template_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      workout_plans: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          day_of_week: number;
          exercises: PlanExercise[];
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["workout_plans"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["workout_plans"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "workout_plans_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          user_id: string;
          conversation_id: string;
          role: ChatRole;
          content: string;
          tool_calls: ToolCallDescriptor[] | null;
          tool_call_id: string | null;
          tool_name: string | null;
          embedding: number[] | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["chat_messages"]["Row"], "id" | "created_at"> & {
          embedding?: number[] | null;
        };
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "chat_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_accounts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          currency: string;
          is_archived: boolean;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["expense_accounts"]["Row"],
          "id" | "created_at"
        > & {
          currency?: string;
          is_archived?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["expense_accounts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "expense_accounts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_categories: {
        Row: {
          id: string;
          user_id: string;
          parent_id: string | null;
          name: string;
          kind: ExpenseKind;
          is_archived: boolean;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["expense_categories"]["Row"],
          "id" | "created_at"
        > & {
          is_archived?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["expense_categories"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "expense_categories_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_transactions: {
        Row: {
          id: string;
          user_id: string;
          occurred_at: string;
          posted_at: string | null;
          account_id: string;
          category_id: string | null;
          kind: ExpenseKind;
          amount: number;
          currency: string;
          description: string | null;
          merchant: string | null;
          mcc: string | null;
          source: ExpenseSource;
          external_id: string | null;
          linked_transaction_id: string | null;
          raw: Record<string, unknown> | null;
          pending: boolean;
          deleted_at: string | null;
          deleted_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["expense_transactions"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          posted_at?: string | null;
          currency?: string;
          description?: string | null;
          merchant?: string | null;
          mcc?: string | null;
          external_id?: string | null;
          linked_transaction_id?: string | null;
          raw?: Record<string, unknown> | null;
          pending?: boolean;
          deleted_at?: string | null;
          deleted_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["expense_transactions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "expense_transactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "expense_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_category_rules: {
        Row: {
          id: string;
          user_id: string;
          match_type: ExpenseRuleMatchType;
          pattern: string;
          kind: ExpenseKind;
          category_id: string;
          priority: number;
          origin: ExpenseRuleOrigin;
          hits: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["expense_category_rules"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          priority?: number;
          origin?: ExpenseRuleOrigin;
          hits?: number;
        };
        Update: Partial<Database["public"]["Tables"]["expense_category_rules"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "expense_category_rules_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_category_rules_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_imports: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          file_name: string | null;
          period_from: string | null;
          period_to: string | null;
          rows_total: number;
          rows_inserted: number;
          rows_skipped: number;
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["expense_imports"]["Row"],
          "id" | "created_at"
        > & {
          file_name?: string | null;
          period_from?: string | null;
          period_to?: string | null;
          rows_total?: number;
          rows_inserted?: number;
          rows_skipped?: number;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["expense_imports"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "expense_imports_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_context: {
        Row: {
          id: string;
          user_id: string;
          key: string;
          value: string;
          source: string | null;
          embedding: number[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["user_context"]["Row"], "id" | "created_at" | "updated_at"> & {
          embedding?: number[] | null;
        };
        Update: Partial<Database["public"]["Tables"]["user_context"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "user_context_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_oauth_tokens: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          access_token: string | null;
          refresh_token: string;
          expires_at: string | null;
          scope: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["integration_oauth_tokens"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          provider?: string;
          access_token?: string | null;
          expires_at?: string | null;
          scope?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["integration_oauth_tokens"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "integration_oauth_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      device_activity_sessions: {
        Row: {
          id: string;
          user_id: string;
          source: "huawei";
          external_id: string;
          started_at: string;
          ended_at: string | null;
          activity_type_raw: string | null;
          activity_type_mapped: "gym" | "swim" | "other" | null;
          calories_device: number | null;
          avg_heart_rate: number | null;
          duration_seconds: number | null;
          payload: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["device_activity_sessions"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          ended_at?: string | null;
          activity_type_raw?: string | null;
          activity_type_mapped?: "gym" | "swim" | "other" | null;
          calories_device?: number | null;
          avg_heart_rate?: number | null;
          duration_seconds?: number | null;
          payload?: Record<string, unknown> | null;
        };
        Update: Partial<Database["public"]["Tables"]["device_activity_sessions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "device_activity_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      workout_device_links: {
        Row: {
          id: string;
          workout_id: string;
          device_session_id: string;
          match_method: "auto" | "manual";
          confidence: number | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["workout_device_links"]["Row"],
          "id" | "created_at"
        > & {
          confidence?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["workout_device_links"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "workout_device_links_workout_id_fkey";
            columns: ["workout_id"];
            isOneToOne: false;
            referencedRelation: "workouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workout_device_links_device_session_id_fkey";
            columns: ["device_session_id"];
            isOneToOne: false;
            referencedRelation: "device_activity_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
