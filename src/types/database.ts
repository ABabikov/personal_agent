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
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["workouts"]["Row"], "id" | "created_at">;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
