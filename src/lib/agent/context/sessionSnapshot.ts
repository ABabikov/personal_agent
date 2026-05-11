/**
 * Краткий снимок пользователя для системного промпта — без вызова LLM внутри recall.
 * Дополняет семантический recall фактами «здесь и сейчас» из БД.
 */

import { loadUserProfile } from "@/lib/db/profile";
import { fetchWorkoutsInDateRange } from "@/lib/db/listWorkouts";
import { supabase } from "@/lib/db/supabase";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Компактный текст для блока СНИМОК СЕССИИ в system prompt.
 */
export async function buildSessionSnapshot(userId: string): Promise<string> {
  const chunks: string[] = [];

  const prof = await loadUserProfile(userId);
  if ("error" in prof) {
    chunks.push(`Профиль: не удалось загрузить (${prof.error}).`);
  } else if (!prof.data) {
    chunks.push("Профиль в приложении не заполнен.");
  } else {
    const p = prof.data;
    const parts: string[] = [];
    if (p.weight != null) parts.push(`${p.weight} кг`);
    if (p.height != null) parts.push(`рост ${p.height} см`);
    if (p.age != null) parts.push(`${p.age} лет`);
    if (p.gender) parts.push(p.gender === "male" ? "муж." : "жен.");
    if (p.activity_level != null) parts.push(`активность ×${p.activity_level}`);
    if (p.body_fat_pct != null) parts.push(`жир ~${p.body_fat_pct}%`);
    chunks.push(`Профиль: ${parts.length ? parts.join(", ") : "поля пустые"}.`);
  }

  const start = isoDaysAgo(13);
  const end = todayIso();
  const wr = await fetchWorkoutsInDateRange(userId, start, end);
  if ("error" in wr) {
    chunks.push(`Тренировки за ~14 дней: ошибка загрузки (${wr.error}).`);
  } else {
    let gym = 0;
    let swim = 0;
    let dist = 0;
    let ton = 0;
    for (const w of wr.data) {
      if (w.type === "gym") {
        gym++;
        if (w.total_tonnage != null) ton += w.total_tonnage;
      } else if (w.type === "swim") {
        swim++;
        if (w.total_distance != null) dist += w.total_distance;
      }
    }
    chunks.push(
      `За последние 14 дней (по дате тренировки): всего ${wr.data.length} записей — зал ${gym}, плавание ${swim}; суммарно ~${Math.round(ton)} кг×повт (тоннаж), ${dist} м в бассейне.`
    );
  }

  const { data: facts, error: fErr } = await supabase
    .from("user_context")
    .select("key, value")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(15);

  if (fErr) {
    chunks.push(`Долговременные факты: не загрузились (${fErr.message}).`);
  } else if (facts && facts.length > 0) {
    const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
    const lines = facts.map(
      (f) => `  - ${f.key}: ${cap(String(f.value ?? ""), 220)}`
    );
    chunks.push(`Последние сохранённые факты (до 15 шт., без семантического отбора):\n${lines.join("\n")}`);
  } else {
    chunks.push("Долговременные факты в памяти агента пока не сохранены.");
  }

  return chunks.join("\n");
}
