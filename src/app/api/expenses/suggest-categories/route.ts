/**
 * Автокатегоризация импорта моделью (второй движок на экране импорта; первый — «по истории»).
 *
 * На вход приходят ГРУППЫ операций, а не строки: выписка на 300 операций схлопывается
 * в ~20 мест, поэтому одного запроса хватает и он остаётся дешёвым.
 * Категории берём из БД по userId, а модели показываем короткие индексы вместо uuid —
 * так меньше токенов и не из чего галлюцинировать несуществующий id.
 */
import { NextResponse } from "next/server";
import { chatCompletion } from "@/lib/agent/llm/openrouter";
import { getSupabaseServer } from "@/lib/db/supabase-server";
import type { ExpenseKind } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GROUPS = 200;
const CHUNK_SIZE = 40;

const KIND_RU: Record<ExpenseKind, string> = {
  expense: "расход",
  income: "доход",
  withdrawal: "снятие наличных",
  transfer: "перевод",
};

type IncomingGroup = {
  key: string;
  kind: ExpenseKind;
  label: string;
  merchant: string | null;
  mcc: string | null;
  bankCategory: string;
  sampleDescriptions: string[];
  count: number;
  total: number;
};

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: ExpenseKind;
};

function isKind(v: unknown): v is ExpenseKind {
  return v === "expense" || v === "income" || v === "withdrawal" || v === "transfer";
}

function parseGroups(raw: unknown): IncomingGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingGroup[] = [];
  for (const item of raw.slice(0, MAX_GROUPS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.key !== "string" || !isKind(o.kind)) continue;
    out.push({
      key: o.key,
      kind: o.kind,
      label: typeof o.label === "string" ? o.label.slice(0, 120) : "",
      merchant: typeof o.merchant === "string" ? o.merchant.slice(0, 120) : null,
      mcc: typeof o.mcc === "string" ? o.mcc.slice(0, 8) : null,
      bankCategory: typeof o.bankCategory === "string" ? o.bankCategory.slice(0, 120) : "",
      sampleDescriptions: Array.isArray(o.sampleDescriptions)
        ? o.sampleDescriptions
            .filter((d): d is string => typeof d === "string")
            .slice(0, 2)
            .map((d) => d.slice(0, 300))
        : [],
      count: typeof o.count === "number" ? o.count : 0,
      total: typeof o.total === "number" ? o.total : 0,
    });
  }
  return out;
}

function categoryLabel(cat: CategoryRow, byId: Map<string, CategoryRow>): string {
  const parent = cat.parent_id ? byId.get(cat.parent_id) : null;
  return parent ? `${parent.name} / ${cat.name}` : cat.name;
}

/** Модель отвечает JSON-массивом; иногда заворачивает его в ```-блок или в пояснения. */
function extractJsonArray(content: string | null): unknown[] {
  if (!content) return [];
  const text = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = [
  "Ты классифицируешь банковские операции по личным категориям расходов пользователя.",
  "Тебе дают список категорий с номерами и список групп операций (одна группа — одно место трат).",
  "Для каждой группы выбери ОДНУ наиболее подходящую категорию ИЗ СПИСКА.",
  "Названия мест написаны транслитом (MAGNIT, YARCHE, PYATEROCHKA — продуктовые магазины;",
  "SOLNECHNYJ DEN, PIK-REST — кафе и общепит). MCC — стандартный код типа мерчанта.",
  "Категория обязана совпадать по типу операции (расход/доход/снятие) с группой.",
  "Если подходящей категории нет или ты не уверен — верни category для этой группы как null.",
  "Отвечай ТОЛЬКО JSON-массивом, без пояснений и markdown:",
  '[{"group": 1, "category": 12, "confidence": 0.9}]',
  "confidence — число от 0 до 1.",
].join("\n");

export async function POST(req: Request) {
  const { hasLlmApiKey } = await import("@/lib/agent/llm/models");
  if (!hasLlmApiKey()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Автокатегоризация моделью не настроена: задайте DASHSCOPE_API_KEY или OPENROUTER_API_KEY на сервере. Вариант «по истории» работает без ключа.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const userId = typeof o.userId === "string" ? o.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Не передан userId" }, { status: 400 });
  }

  const groups = parseGroups(o.groups);
  if (groups.length === 0) {
    return NextResponse.json({ ok: true, data: { suggestions: [], modelUsed: null } });
  }

  const supabase = getSupabaseServer();
  const { data: catData, error: catErr } = await supabase
    .from("expense_categories")
    .select("id, parent_id, name, kind")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .limit(1000);
  if (catErr) {
    return NextResponse.json({ ok: false, error: catErr.message }, { status: 500 });
  }

  const categories = (catData ?? []) as CategoryRow[];
  if (categories.length === 0) {
    return NextResponse.json(
      { ok: false, error: "У вас ещё нет категорий — создайте хотя бы одну." },
      { status: 400 }
    );
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const categoryLines = categories.map(
    (c, i) => `${i + 1}. ${categoryLabel(c, byId)} (${KIND_RU[c.kind]})`
  );

  const suggestions: {
    key: string;
    categoryId: string;
    confidence: number;
    reason: string;
  }[] = [];
  let modelUsed: string | null = null;

  for (let start = 0; start < groups.length; start += CHUNK_SIZE) {
    const chunk = groups.slice(start, start + CHUNK_SIZE);
    const groupLines = chunk.map((g, i) => {
      const bits = [
        `место: ${g.merchant ?? "не указано"}`,
        `категория банка: ${g.bankCategory || "нет"}`,
        g.mcc ? `MCC: ${g.mcc}` : null,
        `тип: ${KIND_RU[g.kind]}`,
        `операций: ${g.count}, сумма: ${Math.round(g.total)} ₽`,
        g.sampleDescriptions[0] ? `описание: ${g.sampleDescriptions[0]}` : null,
      ].filter(Boolean);
      return `${i + 1}. ${bits.join("; ")}`;
    });

    const userPrompt = [
      "КАТЕГОРИИ:",
      categoryLines.join("\n"),
      "",
      "ГРУППЫ ОПЕРАЦИЙ:",
      groupLines.join("\n"),
    ].join("\n");

    let content: string | null = null;
    try {
      const res = await chatCompletion({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        maxTokens: 2000,
      });
      content = res.content;
      modelUsed = res.modelUsed;
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }

    for (const item of extractJsonArray(content)) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const groupIdx = Number(r.group);
      const categoryIdx = Number(r.category);
      if (!Number.isInteger(groupIdx) || groupIdx < 1 || groupIdx > chunk.length) continue;
      if (!Number.isInteger(categoryIdx) || categoryIdx < 1 || categoryIdx > categories.length) {
        continue;
      }

      const group = chunk[groupIdx - 1];
      const category = categories[categoryIdx - 1];
      // Модель может предложить категорию не того типа — такую подсказку молча отбрасываем.
      if (category.kind !== group.kind) continue;

      const rawConfidence = Number(r.confidence);
      const confidence = Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0.7;

      suggestions.push({
        key: group.key,
        categoryId: category.id,
        confidence,
        reason: `ИИ: ${group.merchant ?? group.bankCategory} → ${categoryLabel(category, byId)}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      suggestions,
      modelUsed,
      requested: groups.length,
      resolved: suggestions.length,
    },
  });
}
