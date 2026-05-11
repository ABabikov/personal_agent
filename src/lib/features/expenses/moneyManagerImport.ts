/**
 * Парсер экспорта приложения "Money Manager" (Android).
 *
 * Файл, который приложение называет ".xls", — это HTML-таблица. Структура:
 *   <html><head>...<table>
 *     <tr><td>Дата</td><td>Счет</td><td>Категория</td><td>Подкатегория</td>
 *         <td>Заметки</td><td>RUB</td><td>Доход/Расход</td><td>Детали</td>
 *         <td>Сумма</td><td>Валюта</td><td>Счет</td></tr>
 *     <tr>...</tr>
 *     ...
 *   </table></html>
 *
 * Дата — `DD/MM/YYYY HH:MM:SS`. Сумма всегда положительная, знак определяется
 * полем "Доход/Расход" (Расход / Доход / Снятие).
 *
 * Парсер не зависит от DOM: использует regex (HTML генерируется приложением
 * детерминированно). Если завтра формат изменится — переписать здесь.
 */

import { createHash } from "node:crypto";

export type MmKindRaw = "Расход" | "Доход" | "Снятие";

export type MmRow = {
  /** ISO 8601 с локальным временем без TZ, как пришло из MM. */
  occurredAt: string;
  account: string;
  /** "Категория" из MM без эмодзи/пробельных префиксов. */
  category: string;
  /** "Подкатегория" из MM, тоже очищенная (часто пустая). */
  subcategory: string;
  notes: string;
  amountRub: number;
  kindRaw: MmKindRaw;
  /** Стабильный хэш для дедупа. */
  externalId: string;
  /** Полная исходная строка (массив ячеек), для записи в `raw`. */
  rawCells: string[];
};

const ROW_RE = /<tr[\s\S]*?<\/tr>/gi;
const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, " ")
    .trim();
}

/** Срезать ведущие эмодзи/пиктограммы/пробелы. Не трогает Cyrillic / латиницу / цифры. */
export function stripLeadingEmoji(s: string): string {
  // Все коды символов из supplementary planes (>= U+1F000) считаем "иконкой" —
  // эмодзи, dingbat, символы погоды и т. п. Срезаем их, пока в начале строки.
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (cp == null) break;
    const isWS = cp === 0x20 || cp === 0xa0;
    const isEmojiLike =
      (cp >= 0x2600 && cp <= 0x27bf) || // symbols / dingbats
      (cp >= 0x1f000 && cp <= 0x1faff) || // pictographs, emoji blocks
      cp === 0xfe0f || // variation selector-16
      cp === 0x200d; // zero-width joiner
    if (!isWS && !isEmojiLike) break;
    i += cp > 0xffff ? 2 : 1;
  }
  return s.slice(i).trim();
}

function parseRow(rawCells: string[]): MmRow | null {
  // Заголовок: ['Дата', 'Счет', 'Категория', 'Подкатегория', 'Заметки', 'RUB',
  // 'Доход/Расход', 'Детали', 'Сумма', 'Валюта', 'Счет']
  if (rawCells.length < 7) return null;

  const [
    rawDate,
    rawAccount,
    rawCategory,
    rawSub,
    rawNotes,
    rawRub,
    rawKind,
  ] = rawCells;

  const account = rawAccount.trim();
  const category = stripLeadingEmoji(rawCategory);
  const subcategory = stripLeadingEmoji(rawSub);
  const notes = rawNotes.trim();
  const kind = rawKind.trim();

  if (kind !== "Расход" && kind !== "Доход" && kind !== "Снятие") return null;

  // DD/MM/YYYY HH:MM:SS → 2026-04-27T12:04:20
  const dt = rawDate.trim();
  const m = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MM, SS] = m;
  const occurredAt = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}`;

  const amountRub = Number(String(rawRub).replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(amountRub)) return null;

  const externalId = createHash("sha1")
    .update(
      [occurredAt, account, category, subcategory, notes, amountRub.toFixed(2), kind].join("|")
    )
    .digest("hex");

  return {
    occurredAt,
    account,
    category,
    subcategory,
    notes,
    amountRub,
    kindRaw: kind as MmKindRaw,
    externalId,
    rawCells,
  };
}

/** Парсит весь HTML-файл MM в массив строк. Шапку отбрасывает. */
export function parseMoneyManagerHtml(html: string): MmRow[] {
  const rows = html.match(ROW_RE);
  if (!rows) return [];

  const out: MmRow[] = [];
  let seenHeader = false;

  for (const tr of rows) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    CELL_RE.lastIndex = 0;
    while ((cm = CELL_RE.exec(tr)) != null) {
      cells.push(stripHtml(cm[1]));
    }
    if (cells.length === 0) continue;

    // Заголовок: первая строка, где [0] == 'Дата' и [2] == 'Категория'.
    if (!seenHeader) {
      if (cells[0] === "Дата" && cells[2] === "Категория") {
        seenHeader = true;
      }
      continue;
    }

    const parsed = parseRow(cells);
    if (parsed) out.push(parsed);
  }

  return out;
}

export function mmKindToInternal(k: MmKindRaw): "expense" | "income" | "withdrawal" {
  if (k === "Расход") return "expense";
  if (k === "Доход") return "income";
  return "withdrawal";
}
