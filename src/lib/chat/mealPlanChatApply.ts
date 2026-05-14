import type { MealPlanAgentPayload } from "@/lib/features/meal-plan/mealPlanMerge";
import { writeMealPlanSnapshotFromAgent } from "@/lib/features/meal-plan/storage";

type ToolCallLike = { name: string; ok: boolean; payload: unknown };

type StepLike = { toolCalls: ToolCallLike[] };

/** Ответ тула в UI: payload = полный ToolResult { ok, data? }. */
function extractMerged(toolResult: unknown): MealPlanAgentPayload | null {
  if (!toolResult || typeof toolResult !== "object") return null;
  const tr = toolResult as { ok?: boolean; data?: unknown };
  if (!tr.ok || tr.data == null || typeof tr.data !== "object") return null;
  const d = tr.data as Record<string, unknown>;
  const merged = d.merged;
  if (!merged || typeof merged !== "object") return null;
  return merged as MealPlanAgentPayload;
}

/** После ответа POST /api/chat: применить set_meal_plan_state к localStorage. */
export function applyMealPlanFromChatSteps(steps: StepLike[]): boolean {
  let applied = false;
  for (const step of steps) {
    for (const tc of step.toolCalls ?? []) {
      if (tc.name !== "set_meal_plan_state" || !tc.ok) continue;
      const merged = extractMerged(tc.payload);
      if (!merged) continue;
      writeMealPlanSnapshotFromAgent(merged);
      applied = true;
    }
  }
  return applied;
}
