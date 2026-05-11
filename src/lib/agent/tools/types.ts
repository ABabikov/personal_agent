/**
 * Тип инструмента для агента: JSON-schema + исполняемая функция.
 * Параметры всегда в формате JSONSchema (object), как ожидает OpenRouter/OpenAI.
 */

export type ToolJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolContext = {
  /** ID пользователя в Supabase (всегда заполнен после resolveContext). */
  userId: string;
};

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type AgentTool = {
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  /** Чистая логика инструмента. Все запросы в БД — внутри. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};
