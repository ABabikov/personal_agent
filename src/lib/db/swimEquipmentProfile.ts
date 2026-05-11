import { supabase } from "@/lib/db/supabase";

/**
 * NULL из БД = не фильтровать каталог по снаряжению.
 */
export async function fetchSwimEquipment(
  userId: string
): Promise<{ data: string[] | null } | { error: string }> {
  const { data, error } = await supabase
    .from("users")
    .select("swim_equipment")
    .eq("id", userId)
    .maybeSingle();

  if (error) return { error: error.message };
  const raw = data?.swim_equipment;
  if (raw == null) return { data: null };
  return { data: [...raw] };
}

/**
 * Сохранить инвентарь. Передайте `null`, чтобы отключить фильтрацию по снаряжению.
 */
export async function saveSwimEquipment(
  userId: string,
  swimEquipment: string[] | null
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("users")
    .update({
      swim_equipment: swimEquipment,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) return { error: error.message };
  return { ok: true };
}
