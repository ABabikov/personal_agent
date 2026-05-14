/**
 * Реестр всех инструментов агента: единая точка входа для loop.ts и api-роута.
 */

import type { AgentTool, ToolContext, ToolResult } from "@/lib/agent/tools/types";
import type { ToolSpec } from "@/lib/agent/llm/openrouter";
import {
  getProfileTool,
  saveProfileTool,
  computeBmrTdeeTool,
} from "@/lib/agent/tools/profile";
import {
  getLastGymWorkoutTool,
  getLastSwimWorkoutTool,
  getRecentWorkoutsTool,
  getWorkoutsInRangeTool,
  getCurrentWeekStatsTool,
  getLastGymWorkoutForWeekdayTool,
  getWorkoutDetailsTool,
} from "@/lib/agent/tools/workouts_read";
import {
  getPeriodStatsTool,
  listExercisesTool,
  getExerciseDynamicsTool,
  getTonnageByWeekdayTool,
} from "@/lib/agent/tools/analytics";
import {
  saveGymWorkoutTool,
  saveSwimWorkoutTool,
  suggestNextGymSetsTool,
  estimateGymCaloriesTool,
} from "@/lib/agent/tools/workouts_write";
import {
  deleteWorkoutTool,
  restoreWorkoutTool,
  listDeletedWorkoutsTool,
  updateWorkoutTool,
  updateGymExercisesTool,
  updateSwimSeriesTool,
} from "@/lib/agent/tools/workouts_edit";
import {
  rememberFactTool,
  listFactsTool,
  forgetFactTool,
} from "@/lib/agent/tools/memory";
import { webSearchTool } from "@/lib/agent/tools/web_search";
import {
  getExpensesSummaryTool,
  getExpensesCategoryBreakdownTool,
  listExpenseTransactionsTool,
  listExpenseCategoriesTool,
} from "@/lib/agent/tools/expenses_read";
import { getMealPlanStateTool, setMealPlanStateTool } from "@/lib/agent/tools/meal_plan";

export const AGENT_TOOLS: AgentTool[] = [
  // профиль
  getProfileTool,
  saveProfileTool,
  computeBmrTdeeTool,
  // чтение тренировок
  getLastGymWorkoutTool,
  getLastSwimWorkoutTool,
  getLastGymWorkoutForWeekdayTool,
  getRecentWorkoutsTool,
  getWorkoutsInRangeTool,
  getCurrentWeekStatsTool,
  getWorkoutDetailsTool,
  // аналитика
  getPeriodStatsTool,
  listExercisesTool,
  getExerciseDynamicsTool,
  getTonnageByWeekdayTool,
  // запись и вспомогательное
  saveGymWorkoutTool,
  saveSwimWorkoutTool,
  suggestNextGymSetsTool,
  estimateGymCaloriesTool,
  // редактирование и удаление (soft delete)
  updateWorkoutTool,
  updateGymExercisesTool,
  updateSwimSeriesTool,
  deleteWorkoutTool,
  restoreWorkoutTool,
  listDeletedWorkoutsTool,
  // долговременная память
  rememberFactTool,
  listFactsTool,
  forgetFactTool,
  // финансы (только чтение)
  getExpensesSummaryTool,
  getExpensesCategoryBreakdownTool,
  listExpenseTransactionsTool,
  listExpenseCategoriesTool,
  // питание (снимок с клиента mealPlan в POST /api/chat)
  getMealPlanStateTool,
  setMealPlanStateTool,
  // внешний контекст
  webSearchTool,
];

const TOOLS_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

/** Преобразует тулы в OpenAI-style спецификации для OpenRouter. */
export function toolsToSpecs(): ToolSpec[] {
  return AGENT_TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Безопасный вызов тула по имени с парсингом arguments-строки. */
export async function runTool(
  name: string,
  argumentsJson: string,
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  let parsed: Record<string, unknown> = {};
  if (argumentsJson && argumentsJson.trim().length > 0) {
    try {
      parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    } catch (e) {
      return {
        ok: false,
        error: `Bad arguments JSON: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  try {
    return await tool.execute(parsed, ctx);
  } catch (e) {
    return {
      ok: false,
      error: `Tool ${name} threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export { AgentTool, ToolContext, ToolResult };
