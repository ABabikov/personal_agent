import { supabase } from "@/lib/db/supabase";
import type { SwimCatalogBlock } from "@/lib/features/swimming/buildWorkoutFromCatalog";

/**
 * Активные шаблоны: системные (user_id null) и при появлении — пользовательские.
 */
export async function fetchSwimBlockTemplates(): Promise<
  { data: SwimCatalogBlock[] } | { error: string }
> {
  const { data, error } = await supabase
    .from("swim_block_template")
    .select(
      "slug, phase, goal_tags, equipment_tags, nominal_distance_m, min_m, max_m, scale_mode, body_text, active"
    )
    .eq("active", true);

  if (error) return { error: error.message };

  const rows = (data ?? []) as SwimCatalogBlock[];
  return { data: rows };
}
