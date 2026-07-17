/**
 * Схлопывание операций импорта в группы.
 *
 * Смысл: в выписке за две недели ~60 строк, но мест — полтора десятка, и одному месту
 * почти всегда соответствует одна категория. Пользователь принимает решение по группе,
 * а не по строке; строку можно переопределить, раскрыв группу.
 */
import type { ExpenseKind } from "@/types/database";
import { normalizeMerchantKey, type SberParsedOperation } from "./sberXlsxImport";

export type ImportGroup = {
  key: string;
  kind: ExpenseKind;
  /** Что показываем пользователю: место или, если места нет, категория из файла */
  label: string;
  merchant: string | null;
  merchantKey: string;
  /** Самый частый MCC внутри группы */
  mcc: string | null;
  bankCategory: string;
  /** Пара описаний для контекста (в UI и в промпте модели) */
  sampleDescriptions: string[];
  operations: SberParsedOperation[];
  total: number;
};

function dominant(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      best = v;
    }
  }
  return best;
}

export function groupKeyFor(op: SberParsedOperation): string {
  const merchantKey = normalizeMerchantKey(op.merchant);
  if (merchantKey) return `${op.kind}|m:${merchantKey}`;
  const bankKey = op.bankCategory.trim().toLowerCase();
  return `${op.kind}|c:${bankKey}`;
}

export function groupOperations(operations: SberParsedOperation[]): ImportGroup[] {
  const buckets = new Map<string, SberParsedOperation[]>();
  for (const op of operations) {
    const key = groupKeyFor(op);
    const arr = buckets.get(key) ?? [];
    arr.push(op);
    buckets.set(key, arr);
  }

  const groups: ImportGroup[] = [];
  for (const [key, ops] of buckets) {
    const first = ops[0];
    const merchant = dominant(ops.map((o) => o.merchant));
    const descriptions = Array.from(
      new Set(ops.map((o) => o.description?.trim()).filter((d): d is string => !!d))
    ).slice(0, 3);

    groups.push({
      key,
      kind: first.kind,
      label: merchant ?? first.bankCategory,
      merchant,
      merchantKey: normalizeMerchantKey(merchant),
      mcc: dominant(ops.map((o) => o.mcc)),
      bankCategory: first.bankCategory,
      sampleDescriptions: descriptions,
      operations: [...ops].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      total: ops.reduce((sum, o) => sum + o.amount, 0),
    });
  }

  groups.sort((a, b) => b.total - a.total || b.operations.length - a.operations.length);
  return groups;
}
