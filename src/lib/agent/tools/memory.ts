/**
 * Tools для долговременной памяти агента: явное сохранение фактов о пользователе.
 * Под капотом — таблица user_context (key/value + embedding), upsert по (user_id, key).
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import { supabase } from "@/lib/db/supabase";
import { embedText } from "@/lib/agent/llm/embeddings";

export const rememberFactTool: AgentTool = {
  name: "remember_fact",
  description: [
    "Сохраняет в долгую память факт о пользователе — пара ключ/значение.",
    "Используй для устойчивых, не-сессионных вещей, которые помогут лучше помогать дальше:",
    "цели, предпочтения, особенности здоровья, рабочие веса, рекорды, любимые упражнения, целевой темп в бассейне, и т. п.",
    "",
    "Ключ — короткий машинный идентификатор (snake_case), value — человекочитаемое содержимое.",
    "Примеры:",
    "— remember_fact({key:'goal_2026', value:'набор 4 кг сухой массы к августу'}),",
    "— remember_fact({key:'injury_left_shoulder', value:'жим лёжа делает осторожно, не выше 12 повт.'}),",
    "— remember_fact({key:'swim_pace_target', value:'100 м кролем за 1:40, 8 повторений'}).",
    "",
    "Сохранение идёт через upsert по ключу — повторный вызов с тем же key обновит value.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "snake_case, не длиннее 80 символов" },
      value: { type: "string" },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const key = String(args.key).trim();
    const value = String(args.value).trim();
    if (!key || !value) return { ok: false, error: "key и value не могут быть пустыми" };

    const emb = await embedText(`${key}: ${value}`);
    const { error } = await supabase
      .from("user_context")
      .upsert(
        {
          user_id: ctx.userId,
          key,
          value,
          source: "tool:remember_fact",
          embedding: emb?.embedding ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,key" }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { saved: true, key } };
  },
};

export const listFactsTool: AgentTool = {
  name: "list_facts",
  description: [
    "Возвращает все сохранённые факты о пользователе (user_context) — пары key/value.",
    "Полезно когда нужно «вспомнить всё, что я знаю об этом человеке» или провести инвентаризацию",
    "перед тем, как добавить/обновить факт.",
  ].join(" "),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const { data, error } = await supabase
      .from("user_context")
      .select("key, value, source, updated_at")
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { facts: data ?? [], count: data?.length ?? 0 } };
  },
};

export const forgetFactTool: AgentTool = {
  name: "forget_fact",
  description: [
    "Удаляет сохранённый факт по ключу. Вызывай явно, например если пользователь сказал",
    "«забудь, что у меня было плечо» или «я уже не на сушке».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: { key: { type: "string" } },
    required: ["key"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const key = String(args.key).trim();
    if (!key) return { ok: false, error: "Пустой key" };
    const { error } = await supabase
      .from("user_context")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("key", key);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { deleted: true, key } };
  },
};
