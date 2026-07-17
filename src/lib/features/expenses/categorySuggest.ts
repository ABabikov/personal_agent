/**
 * Автоопределение категории операции «по истории» — без обращения к сети.
 *
 * Работает на трёх источниках, в порядке убывания доверия:
 *   1. правила (expense_category_rules) — то, что пользователь уже подтвердил в прошлых импортах;
 *   2. история операций — «этот мерчант / MCC раньше уходил в такую-то категорию»;
 *   3. справочник MCC — общий здравый смысл для первого импорта, когда истории ещё нет.
 *
 * Модуль намеренно чистый (никакого supabase-клиента и fetch): его вызывает и страница
 * импорта, и, в перспективе, агентский тул suggest_category.
 */
import type { ExpenseKind, ExpenseRuleMatchType } from "@/types/database";
import { extractMerchantAndMcc, normalizeMerchantKey } from "./sberXlsxImport";
import { mccHints } from "./mccCatalog";

export type SuggestionSource = "rule" | "history" | "mcc";

export type CategorySuggestion = {
  categoryId: string;
  source: SuggestionSource;
  /** 0..1 — насколько уверенно; показываем пользователю, слабые подсказки видно сразу */
  confidence: number;
  /** человекочитаемое обоснование, попадает в UI */
  reason: string;
};

export type SuggestCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: ExpenseKind;
  is_archived: boolean;
};

export type SuggestRule = {
  match_type: ExpenseRuleMatchType;
  pattern: string;
  kind: ExpenseKind;
  category_id: string;
  priority: number;
};

/** Прошлая операция с уже проставленной категорией — обучающий пример. */
export type SuggestHistoryTx = {
  category_id: string;
  kind: ExpenseKind;
  merchant: string | null;
  mcc: string | null;
  description: string | null;
  bank_category: string | null;
};

/** Операция, для которой ищем категорию (структурно совместима с SberParsedOperation). */
export type SuggestOperation = {
  kind: ExpenseKind;
  merchant: string | null;
  mcc: string | null;
  bankCategory: string;
  description: string | null;
};

/** Категории банка, которые ничего не сообщают: у Сбера 90% строк — «Прочие операции». */
const GENERIC_BANK_CATEGORIES = new Set([
  "прочие операции",
  "прочее",
  "без категории",
  "остальное",
]);

const DESCRIPTION_STOPWORDS = new Set([
  "операция",
  "операции",
  "карте",
  "карты",
  "дата",
  "создания",
  "транзакции",
  "место",
  "совершения",
  "mcc",
  "категория",
  "платеж",
  "платёж",
  "пользу",
  "счет",
  "счёт",
  "счета",
  "счетами",
  "между",
  "перевод",
  "внутрибанковский",
  "номер",
  "дог",
  "руб",
]);

type Votes = Map<string, Map<string, number>>;

export type SuggestionIndex = {
  categories: SuggestCategory[];
  categoryById: Map<string, SuggestCategory>;
  /** `${match_type}|${kind}|${pattern}` → правило */
  exactRules: Map<string, SuggestRule>;
  descriptionRules: SuggestRule[];
  merchantVotes: Votes;
  merchantHeadVotes: Votes;
  mccVotes: Votes;
  bankCategoryVotes: Votes;
  tokenVotes: Votes;
  historySize: number;
};

function voteKey(pattern: string, kind: ExpenseKind): string {
  return `${kind}|${pattern}`;
}

function addVote(votes: Votes, key: string, categoryId: string): void {
  const inner = votes.get(key) ?? new Map<string, number>();
  inner.set(categoryId, (inner.get(categoryId) ?? 0) + 1);
  votes.set(key, inner);
}

function topVote(
  votes: Votes,
  key: string
): { categoryId: string; count: number; total: number; share: number } | null {
  const inner = votes.get(key);
  if (!inner || inner.size === 0) return null;
  let bestId = "";
  let bestCount = 0;
  let total = 0;
  for (const [id, n] of inner) {
    total += n;
    if (n > bestCount) {
      bestCount = n;
      bestId = id;
    }
  }
  if (!bestId) return null;
  return { categoryId: bestId, count: bestCount, total, share: bestCount / total };
}

/** Первое слово названия места: «MAGNIT MM IOGAN» и «MAGNIT DOSTAVKA» — один и тот же магазин. */
function merchantHead(merchantKey: string): string {
  const head = merchantKey.split(" ")[0] ?? "";
  return head.length >= 4 ? head : "";
}

function meaningfulTokens(text: string | null): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !DESCRIPTION_STOPWORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Текст, по которому имеет смысл голосовать токенами: у операций по карте это название
 * места, у прочих — описание без служебной обвязки.
 */
function tokenSource(merchant: string | null, description: string | null): string[] {
  if (merchant) return meaningfulTokens(merchant);
  return meaningfulTokens(description).slice(0, 12);
}

function normalizeBankCategory(bankCategory: string | null): string {
  return (bankCategory ?? "").trim().toLowerCase();
}

/** «Прочие операции» в правило превращать бессмысленно — под неё попадает почти всё. */
export function isGenericBankCategory(bankCategory: string | null): boolean {
  const key = normalizeBankCategory(bankCategory);
  return key.length === 0 || GENERIC_BANK_CATEGORIES.has(key);
}

/** У истории (и у прошлых импортов) merchant/mcc в БД часто пустые — достаём их из описания. */
function historySignals(tx: SuggestHistoryTx): {
  merchant: string | null;
  mcc: string | null;
} {
  const fromDescription = extractMerchantAndMcc(tx.description);
  return {
    merchant: tx.merchant ?? fromDescription.merchant,
    mcc: tx.mcc ?? fromDescription.mcc,
  };
}

export function buildSuggestionIndex(params: {
  categories: SuggestCategory[];
  rules: SuggestRule[];
  history: SuggestHistoryTx[];
}): SuggestionIndex {
  const categories = params.categories.filter((c) => !c.is_archived);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const exactRules = new Map<string, SuggestRule>();
  const descriptionRules: SuggestRule[] = [];
  for (const r of params.rules) {
    if (!categoryById.has(r.category_id)) continue;
    if (r.match_type === "description") {
      descriptionRules.push(r);
      continue;
    }
    const key = `${r.match_type}|${r.kind}|${r.pattern}`;
    const prev = exactRules.get(key);
    if (!prev || r.priority < prev.priority) exactRules.set(key, r);
  }
  descriptionRules.sort((a, b) => a.priority - b.priority);

  const merchantVotes: Votes = new Map();
  const merchantHeadVotes: Votes = new Map();
  const mccVotes: Votes = new Map();
  const bankCategoryVotes: Votes = new Map();
  const tokenVotes: Votes = new Map();

  for (const tx of params.history) {
    if (!tx.category_id || !categoryById.has(tx.category_id)) continue;
    const { merchant, mcc } = historySignals(tx);

    const merchantKey = normalizeMerchantKey(merchant);
    if (merchantKey) {
      addVote(merchantVotes, voteKey(merchantKey, tx.kind), tx.category_id);
      const head = merchantHead(merchantKey);
      if (head) addVote(merchantHeadVotes, voteKey(head, tx.kind), tx.category_id);
    }

    if (mcc) addVote(mccVotes, voteKey(mcc, tx.kind), tx.category_id);

    if (!isGenericBankCategory(tx.bank_category)) {
      addVote(
        bankCategoryVotes,
        voteKey(normalizeBankCategory(tx.bank_category), tx.kind),
        tx.category_id
      );
    }

    for (const token of tokenSource(merchant, tx.description)) {
      addVote(tokenVotes, voteKey(token, tx.kind), tx.category_id);
    }
  }

  return {
    categories,
    categoryById,
    exactRules,
    descriptionRules,
    merchantVotes,
    merchantHeadVotes,
    mccVotes,
    bankCategoryVotes,
    tokenVotes,
    historySize: params.history.length,
  };
}

function categoryLabelIn(index: SuggestionIndex, categoryId: string): string {
  const cat = index.categoryById.get(categoryId);
  if (!cat) return "?";
  const parent = cat.parent_id ? index.categoryById.get(cat.parent_id) : null;
  return parent ? `${parent.name} / ${cat.name}` : cat.name;
}

/** Подбирает существующую категорию пользователя по названию-кандидату из справочника MCC. */
function resolveByName(
  index: SuggestionIndex,
  name: string,
  kind: ExpenseKind
): SuggestCategory | null {
  const want = name.trim().toLowerCase();
  const matching = index.categories.filter(
    (c) => c.kind === kind && c.name.trim().toLowerCase() === want
  );
  if (matching.length === 0) return null;
  // Верхнеуровневая категория предпочтительнее одноимённой вложенной.
  return matching.find((c) => c.parent_id == null) ?? matching[0];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Подсказка категории для одной операции. Правила проверяются раньше истории,
 * история — раньше справочника MCC; первое совпадение выигрывает (так подсказку
 * можно объяснить одной фразой).
 */
export function suggestCategory(
  op: SuggestOperation,
  index: SuggestionIndex
): CategorySuggestion | null {
  const merchantKey = normalizeMerchantKey(op.merchant);
  const bankKey = normalizeBankCategory(op.bankCategory);
  const mcc = op.mcc?.trim() || null;

  // 1. Правила, подтверждённые пользователем
  if (merchantKey) {
    const rule = index.exactRules.get(`merchant|${op.kind}|${merchantKey}`);
    if (rule) {
      return {
        categoryId: rule.category_id,
        source: "rule",
        confidence: 1,
        reason: `правило: место «${op.merchant}»`,
      };
    }
  }
  if (mcc) {
    const rule = index.exactRules.get(`mcc|${op.kind}|${mcc}`);
    if (rule) {
      return {
        categoryId: rule.category_id,
        source: "rule",
        confidence: 0.97,
        reason: `правило: MCC ${mcc}`,
      };
    }
  }
  if (!isGenericBankCategory(op.bankCategory)) {
    const rule = index.exactRules.get(`bank_category|${op.kind}|${bankKey}`);
    if (rule) {
      return {
        categoryId: rule.category_id,
        source: "rule",
        confidence: 0.93,
        reason: `правило: категория банка «${op.bankCategory}»`,
      };
    }
  }
  const descriptionHaystack = `${op.merchant ?? ""} ${op.description ?? ""}`.toLowerCase();
  for (const rule of index.descriptionRules) {
    if (rule.kind !== op.kind) continue;
    if (rule.pattern && descriptionHaystack.includes(rule.pattern)) {
      return {
        categoryId: rule.category_id,
        source: "rule",
        confidence: 0.9,
        reason: `правило: описание содержит «${rule.pattern}»`,
      };
    }
  }

  // 2. История: тот же мерчант / тот же MCC / та же категория банка
  if (merchantKey) {
    const vote = topVote(index.merchantVotes, voteKey(merchantKey, op.kind));
    if (vote) {
      return {
        categoryId: vote.categoryId,
        source: "history",
        confidence: clamp(0.6 + 0.35 * vote.share, 0, 0.95),
        reason: `история: «${op.merchant}» → ${categoryLabelIn(index, vote.categoryId)} (${vote.count} из ${vote.total})`,
      };
    }

    const head = merchantHead(merchantKey);
    if (head) {
      const headVote = topVote(index.merchantHeadVotes, voteKey(head, op.kind));
      if (headVote) {
        return {
          categoryId: headVote.categoryId,
          source: "history",
          confidence: clamp(0.5 + 0.3 * headVote.share, 0, 0.85),
          reason: `история: похожее место «${head}» → ${categoryLabelIn(index, headVote.categoryId)} (${headVote.count} из ${headVote.total})`,
        };
      }
    }
  }

  if (mcc) {
    const vote = topVote(index.mccVotes, voteKey(mcc, op.kind));
    if (vote && vote.total >= 2) {
      return {
        categoryId: vote.categoryId,
        source: "history",
        confidence: clamp(0.45 + 0.35 * vote.share, 0, 0.85),
        reason: `история: MCC ${mcc} → ${categoryLabelIn(index, vote.categoryId)} (${vote.count} из ${vote.total})`,
      };
    }
  }

  if (!isGenericBankCategory(op.bankCategory)) {
    const vote = topVote(index.bankCategoryVotes, voteKey(bankKey, op.kind));
    if (vote && vote.total >= 2) {
      return {
        categoryId: vote.categoryId,
        source: "history",
        confidence: clamp(0.4 + 0.3 * vote.share, 0, 0.8),
        reason: `история: категория банка «${op.bankCategory}» → ${categoryLabelIn(index, vote.categoryId)}`,
      };
    }
  }

  // 3. Справочник MCC — общий здравый смысл, когда истории по этому месту ещё нет
  for (const hint of mccHints(mcc)) {
    const cat = resolveByName(index, hint, op.kind);
    if (cat) {
      return {
        categoryId: cat.id,
        source: "mcc",
        confidence: 0.5,
        reason: `MCC ${mcc}: обычно это «${hint}»`,
      };
    }
  }

  // 4. Слабая аналогия по словам описания
  const tokens = tokenSource(op.merchant, op.description);
  if (tokens.length > 0) {
    const scores = new Map<string, number>();
    for (const token of tokens) {
      const vote = topVote(index.tokenVotes, voteKey(token, op.kind));
      if (!vote || vote.total < 3) continue;
      scores.set(vote.categoryId, (scores.get(vote.categoryId) ?? 0) + vote.share);
    }
    let bestId = "";
    let bestScore = 0;
    for (const [id, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (bestId) {
      return {
        categoryId: bestId,
        source: "history",
        confidence: clamp(0.3 + 0.15 * bestScore, 0, 0.55),
        reason: `история: похожие описания → ${categoryLabelIn(index, bestId)}`,
      };
    }
  }

  return null;
}
