/**
 * ReAct-цикл агента: модель → tool_calls → исполнение тулов → новый запрос модели → ... → текст.
 * Без стриминга. После каждого шага сохраняем сообщение в БД (`chat_messages`).
 */

import {
  chatCompletion,
  type ChatCompletionResult,
  type ChatMessageForApi,
} from "@/lib/agent/llm/openrouter";
import { getAgentMaxCompletionTokens } from "@/lib/agent/llm/models";
import { runTool, toolsToSpecs } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/prompts/system";
import {
  loadConversation,
  saveAssistantMessage,
  saveToolMessage,
  saveUserMessage,
  toApiMessages,
} from "@/lib/agent/memory/store";
import { recallContext } from "@/lib/agent/memory/recall";
import { buildSessionSnapshot } from "@/lib/agent/context/sessionSnapshot";
import type { ToolCallDescriptor } from "@/types/database";

export type AgentRunInput = {
  userId: string;
  conversationId: string;
  userMessage: string;
  /** Текстовый снимок экрана (маршрут, видимые данные) — усиливает персонализацию ответа. */
  pageContext?: string;
  /** Снимок раздела «Питание» с клиента (localStorage) — для тулов get/set_meal_plan_state. */
  mealPlanClient?: import("@/lib/features/meal-plan/mealPlanMerge").MealPlanAgentPayload | null;
  /** Жёсткий потолок шагов в ReAct-цикле. */
  maxIterations?: number;
};

export type AgentRunStep = {
  iteration: number;
  modelUsed: string;
  toolCalls: { name: string; args: string; result: { ok: boolean; payload: unknown } }[];
  assistantText: string | null;
  finishReason?: string;
  attempts: ChatCompletionResult["attempts"];
};

export type AgentRunResult = {
  conversationId: string;
  finalAnswer: string;
  steps: AgentRunStep[];
};

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const maxIterations = input.maxIterations ?? 8;

  // 1) Загружаем историю текущего conversation_id (до этого сообщения).
  const prior = await loadConversation(input.userId, input.conversationId);

  // 2) Параллельно: семантический recall + детерминированный снимок профиля/нагрузки/фактов.
  const [recall, sessionSnapshot] = await Promise.all([
    recallContext({
      userId: input.userId,
      queryText: input.userMessage,
      excludeConversationId: input.conversationId,
      messagesLimit: 8,
      factsLimit: 8,
    }),
    buildSessionSnapshot(input.userId),
  ]);

  // 3) Сохраняем user-сообщение СРАЗУ — оно появится в истории даже если LLM упал.
  await saveUserMessage({
    userId: input.userId,
    conversationId: input.conversationId,
    content: input.userMessage,
  });

  // 4) Собираем messages для модели.
  const nowIso = new Date().toISOString();
  const messages: ChatMessageForApi[] = [
    {
      role: "system",
      content: buildSystemPrompt(recall, nowIso, input.pageContext, sessionSnapshot),
    },
    ...toApiMessages(prior),
    { role: "user", content: input.userMessage },
  ];

  const tools = toolsToSpecs();
  const steps: AgentRunStep[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const completion = await chatCompletion({
      messages,
      tools,
      toolChoice: "auto",
      temperature: 0.3,
      maxTokens: getAgentMaxCompletionTokens(),
    });

    const step: AgentRunStep = {
      iteration: i + 1,
      modelUsed: completion.modelUsed,
      toolCalls: [],
      assistantText: completion.content,
      finishReason: completion.finishReason,
      attempts: completion.attempts,
    };

    // Если модель вернула tool_calls — кладём assistant-сообщение со связью на них и идём исполнять.
    if (completion.toolCalls.length > 0) {
      const assistantMsg: ChatMessageForApi = {
        role: "assistant",
        content: completion.content ?? "",
        tool_calls: completion.toolCalls,
      };
      messages.push(assistantMsg);
      await saveAssistantMessage({
        userId: input.userId,
        conversationId: input.conversationId,
        content: completion.content ?? "",
        toolCalls: completion.toolCalls,
      });

      for (const tc of completion.toolCalls) {
        const result = await runTool(tc.function.name, tc.function.arguments, {
          userId: input.userId,
          mealPlanClient: input.mealPlanClient ?? null,
        });
        const payloadStr = JSON.stringify(result);
        step.toolCalls.push({
          name: tc.function.name,
          args: tc.function.arguments,
          result: { ok: result.ok, payload: result },
        });
        // Кладём tool-сообщение для следующего витка.
        messages.push({
          role: "tool",
          content: payloadStr,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
        await saveToolMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          toolCallId: tc.id,
          toolName: tc.function.name,
          content: payloadStr,
        });
      }

      steps.push(step);
      continue;
    }

    // Иначе — финальный текстовый ответ.
    const final = completion.content ?? "";
    await saveAssistantMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      content: final,
    });
    steps.push(step);
    return { conversationId: input.conversationId, finalAnswer: final, steps };
  }

  // Лимит итераций — попросим модель завершить, но возвращаем как есть.
  const fallback =
    "Не удалось закрыть запрос за отведённое число шагов — попробуй переформулировать или сузить вопрос.";
  await saveAssistantMessage({
    userId: input.userId,
    conversationId: input.conversationId,
    content: fallback,
  });
  return { conversationId: input.conversationId, finalAnswer: fallback, steps };
}
