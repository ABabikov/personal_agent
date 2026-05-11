/**
 * Парсинг Excel-выписки Сбербанка (лента операций, экспорт .xlsx).
 * Формат может слегка отличаться — ищем колонки по подстрокам в шапке.
 */

export type SberParseIssue = { rowIndex: number; message: string };

export type SberParsedOperation = {
  /** 1-based номер строки в файле (после шапки), для отладки */
  sourceRow: number;
  occurredAt: string;
  kind: "expense" | "income" | "withdrawal" | "transfer";
  amount: number;
  description: string | null;
  merchant: string | null;
  mcc: string | null;
  /** Категория операции из выписки Сбера */
  bankCategory: string;
  externalId: string;
  rawRow: Record<string, string>;
};

export type SberParseResult = {
  operations: SberParsedOperation[];
  issues: SberParseIssue[];
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findColumnIndex(
  headers: string[],
  matchers: ((h: string) => boolean)[]
): number | null {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i]);
    if (!h) continue;
    for (const m of matchers) {
      if (m(h)) return i;
    }
  }
  return null;
}

function dateToLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

/** Excel serial (дни с 1899-12-30) → локальная метка времени */
function excelSerialToLocalIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  const fraction = serial - whole;
  const utcMs = (whole - 25569) * 86400000 + Math.round(fraction * 86400000);
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return dateToLocalIso(d);
}

/** DD.MM.YYYY HH:MM(:SS)? или только дата */
function parseRussianDateTime(s: string): string | null {
  const t = s.replace(/\u00a0/g, " ").trim();
  const m = t.match(
    /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MM, SS] = m;
  const h = HH ?? "12";
  const min = MM ?? "00";
  const sec = SS ?? "00";
  return `${yyyy}-${mm}-${dd}T${h.padStart(2, "0")}:${min}:${sec}`;
}

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.abs(raw);
  const s = String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Знак суммы: отрицательная строка → расход */
function signedAmount(raw: unknown): { abs: number; sign: 1 | -1 } | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const sign = raw < 0 ? -1 : 1;
    return { abs: Math.abs(raw), sign };
  }
  const s0 = String(raw ?? "").replace(/\u00a0/g, " ").trim();
  const neg = /^\(.+\)$/.test(s0) || s0.startsWith("-") || s0.includes("−");
  const n = parseAmount(s0.replace(/[()−-]/g, ""));
  if (n == null) return null;
  return { abs: n, sign: neg ? -1 : 1 };
}

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function inferKind(params: {
  signed: { abs: number; sign: 1 | -1 };
  bankCategory: string;
  description: string;
}): "expense" | "income" | "withdrawal" | "transfer" {
  const cat = params.bankCategory.toLowerCase();
  const desc = params.description.toLowerCase();
  if (
    cat.includes("снятие") ||
    cat.includes("наличн") ||
    desc.includes("снятие наличных") ||
    desc.includes("atm") ||
    desc.includes("банкомат")
  ) {
    return "withdrawal";
  }
  if (params.signed.sign < 0) return "expense";
  return "income";
}

export async function parseSberXlsxArrayBuffer(buf: ArrayBuffer): Promise<SberParseResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { operations: [], issues: [{ rowIndex: 0, message: "В файле нет листов" }] };
  }
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];

  let headerRowIdx = -1;
  let colDate: number | null = null;
  let colAmount: number | null = null;
  let colDesc: number | null = null;
  let colCategory: number | null = null;
  let colMcc: number | null = null;

  for (let r = 0; r < Math.min(matrix.length, 40); r++) {
    const row = matrix[r] ?? [];
    const headers = row.map((c) => String(c ?? ""));
    const normalized = headers.map((h) => normalizeHeader(h));

    const hasDateHeader = normalized.some(
      (h) =>
        h.includes("дата операции") ||
        h.includes("дата транзакции") ||
        (h.startsWith("дата") && h.length <= 20)
    );
    if (!hasDateHeader) continue;

    const tryDate = findColumnIndex(headers, [
      (h) => h.includes("дата операции"),
      (h) => h.includes("дата транзакции"),
      (h) => h === "дата" || h.startsWith("дата "),
    ]);
    const tryAmount = findColumnIndex(headers, [
      (h) => h.includes("сумма в валюте счёта") || h.includes("сумма в валюте счета"),
      (h) => h.includes("сумма операции") && h.includes("валюте счёта"),
      (h) => h.includes("сумма в рублях"),
      (h) => h.includes("сумма операции в валюте счёта"),
      (h) => h === "сумма" || h.includes("сумма платежа"),
    ]);
    if (tryDate == null || tryAmount == null) continue;

    headerRowIdx = r;
    colDate = tryDate;
    colAmount = tryAmount;
    colDesc =
      findColumnIndex(headers, [
        (h) => h.includes("описание"),
        (h) => h.includes("назначение платежа"),
        (h) => h.includes("детали операции"),
      ]) ?? null;
    colCategory =
      findColumnIndex(headers, [
        (h) => h.includes("категория"),
        (h) => h.includes("тип операции"),
      ]) ?? null;
    colMcc =
      findColumnIndex(headers, [(h) => h === "мсс" || h.includes("mcc")]) ?? null;
    break;
  }

  if (headerRowIdx < 0 || colDate == null || colAmount == null) {
    return {
      operations: [],
      issues: [
        {
          rowIndex: 0,
          message:
            "Не удалось найти шапку таблицы (нужны колонки «Дата операции» и сумма в валюте счёта). Откройте экспорт ленты операций Сбербанка (.xlsx).",
        },
      ],
    };
  }

  const operations: SberParsedOperation[] = [];
  const issues: SberParseIssue[] = [];

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rowObj: Record<string, string> = {};
    const headerCells = matrix[headerRowIdx] ?? [];
    for (let c = 0; c < headerCells.length; c++) {
      const key = String(headerCells[c] ?? "").trim() || `col_${c}`;
      rowObj[key] = String(row[c] ?? "").trim();
    }

    const rawDate = row[colDate];
    const rawAmt = row[colAmount];
    const bankCategory =
      colCategory != null
        ? String(row[colCategory] ?? "").trim() || "Без категории"
        : "Без категории";
    const description = colDesc != null ? String(row[colDesc] ?? "").trim() || null : null;
    const mccRaw = colMcc != null ? String(row[colMcc] ?? "").trim() : "";
    const mcc = mccRaw.length > 0 ? mccRaw : null;

    if (!String(rawDate ?? "").trim() && !String(rawAmt ?? "").trim()) continue;

    let occurredAt: string | null = null;
    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
      occurredAt = dateToLocalIso(rawDate);
    } else if (typeof rawDate === "number") {
      occurredAt = excelSerialToLocalIso(rawDate);
    }
    if (!occurredAt) {
      occurredAt = parseRussianDateTime(String(rawDate ?? "").trim());
    }
    if (!occurredAt) {
      issues.push({ rowIndex: r + 1, message: `Строка ${r + 1}: непонятная дата «${rawDate}»` });
      continue;
    }

    const signed = signedAmount(rawAmt);
    if (!signed || signed.abs === 0) {
      issues.push({ rowIndex: r + 1, message: `Строка ${r + 1}: нет суммы` });
      continue;
    }

    const kind = inferKind({
      signed,
      bankCategory,
      description: description ?? "",
    });

    const amount = signed.abs;
    const externalId = await sha1Hex(
      ["sber_v1", occurredAt, amount.toFixed(2), kind, bankCategory, description ?? "", mcc ?? ""].join(
        "|"
      )
    );

    operations.push({
      sourceRow: r + 1,
      occurredAt,
      kind,
      amount,
      description,
      merchant: null,
      mcc,
      bankCategory,
      externalId,
      rawRow: rowObj,
    });
  }

  return { operations, issues };
}

export function countByBankCategory(ops: SberParsedOperation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of ops) {
    m.set(o.bankCategory, (m.get(o.bankCategory) ?? 0) + 1);
  }
  return m;
}
