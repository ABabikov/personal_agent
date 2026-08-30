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

/**
 * Достаёт место и MCC из описания операции.
 *
 * Сбер кладёт в «Описание» строку вида
 *   «Операция по карте: 220015******1048, дата создания транзакции: 25-04-2026,
 *    место совершения операции: RU/Novosibirsk/MAGNIT MM IOGAN, MCC: 5411»
 * — то есть мерчант и MCC там есть, просто не отдельными колонками. Это главный сигнал
 * для автокатегоризации: колонка «Категория» у 90% строк выписки — «Прочие операции».
 *
 * Платежи по реквизитам выглядят иначе: «…Платеж … в пользу МТС,+7913+++7526,…».
 *
 * Экспортируется, чтобы тем же разбором вытаскивать мерчанта из описаний уже
 * импортированных операций (в БД у них merchant = null, но текст описания сохранён).
 */
/**
 * У Сбера / Яндекса / Сбера Pay иногда MCC вшит в имя точки:
 *   «YANDEX 5411 LAVKARIT», «SBER 5411 SAMOKAT», «YANDEX 4121 GO».
 * Тогда колоночный MCC часто «3990/3991» (агрегатор) и бесполезен.
 */
function unwrapEmbeddedMccMerchant(raw: string): {
  merchant: string;
  embeddedMcc: string | null;
} {
  const m = raw.match(
    /^(YANDEX|SBER|YA\.|YM)\s+(\d{4})\s+(.+)$/i
  );
  if (m) {
    const brand = m[1].toUpperCase().startsWith("YA") ? "YANDEX" : m[1].toUpperCase();
    return { merchant: `${brand} ${m[3].trim()}`, embeddedMcc: m[2] };
  }
  return { merchant: raw, embeddedMcc: null };
}

export function extractMerchantAndMcc(description: string | null): {
  merchant: string | null;
  mcc: string | null;
} {
  const text = (description ?? "").replace(/\u00a0/g, " ").trim();
  if (!text) return { merchant: null, mcc: null };

  // «MCC: 5411» или слитно «MCC5300» (возвраты в старом формате)
  const mccMatch = text.match(/MCC:?\s*(\d{4})/i);
  let mcc = mccMatch ? mccMatch[1] : null;

  let merchant: string | null = null;

  const place = text.match(/место совершения операции:\s*([^,]+)/i);
  if (place) {
    const segments = place[1]
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    merchant = segments[segments.length - 1] ?? null;
  }

  // Возврат/старый формат: «...\RU\MOSCOW\OZON RETAIL ... MCC5300»
  if (!merchant) {
    const legacy = text.match(/\\[A-Z]{2}\\([^\\]+)\\([^\\]+?)(?:\s{2,}|\s+\d)/);
    if (legacy) {
      merchant = legacy[2].trim() || null;
    }
  }

  if (!merchant) {
    // СБП C2B: «…в Сдэк Кривощековская через Систему быстрых платежей»
    // (\b не используем — в JS граница слова не работает с кириллицей)
    const sbpC2b = text.match(
      /в\s+(.+?)\s+через\s+систему\s+быстрых\s+платежей/i
    );
    if (sbpC2b) merchant = sbpC2b[1].replace(/^ПАО\s+/i, "").replace(/^["«]|["»]$/g, "").trim() || null;
  }

  if (!merchant) {
    const payee = text.match(/в пользу\s+([^,.;]+)/i);
    if (payee) merchant = payee[1].trim() || null;
  }

  if (!merchant) {
    // Альфа/Сбер перевод человеку: «Перевод клиенту ИМЯ Ф. по номеру…»
    const person = text.match(
      /перевод клиенту\s+(.+?)\s+по номеру/i
    );
    if (person) merchant = person[1].replace(/\s+/g, " ").trim() || null;
  }

  if (!merchant) {
    const phone = text.match(
      /(?:на|от)\s+(\+7[\d\s()\-]{10,20}|\+7\d{10})/i
    );
    if (phone) merchant = `СБП ${phone[1].replace(/\s+/g, "")}`;
  }

  if (!merchant) {
    // Зарплата / аванс по договору
    if (/зарплата|аванс/i.test(text) && /договор/i.test(text)) {
      merchant = /аванс/i.test(text) ? "Зарплата (аванс)" : "Зарплата";
    }
  }

  if (merchant) {
    const unwrapped = unwrapEmbeddedMccMerchant(merchant);
    merchant = unwrapped.merchant;
    if (unwrapped.embeddedMcc) mcc = unwrapped.embeddedMcc;
  }

  if (merchant && merchant.length > 120) merchant = merchant.slice(0, 120);
  return { merchant, mcc };
}

/** Ключ мерчанта для сравнения: регистр, пунктуация и лишние пробелы не важны. */
export function normalizeMerchantKey(merchant: string | null): string {
  return (merchant ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function inferKind(params: {
  signed: { abs: number; sign: 1 | -1 };
  bankCategory: string;
  description: string;
  mcc: string | null;
}): "expense" | "income" | "withdrawal" | "transfer" {
  const cat = params.bankCategory.toLowerCase();
  const desc = params.description.toLowerCase();
  const mcc = (params.mcc ?? "").trim();

  // Переводы между своими счетами / погашение кредита / пополнение карты — не расход/доход.
  if (
    desc.includes("внутрибанковский перевод между счетами") ||
    desc.includes("погашение од") ||
    desc.includes("погашение процентов") ||
    desc.includes("погашение задолженности") ||
    (/\bпогашение\b/.test(desc) &&
      (/\bдог\b/.test(desc) ||
        /\bдоговор\b/.test(desc) ||
        desc.includes("pumcar") ||
        desc.includes("кредит")))
  ) {
    return "transfer";
  }

  if (
    cat.includes("снятие") ||
    cat.includes("наличн") ||
    desc.includes("снятие наличных") ||
    desc.includes("atm") ||
    desc.includes("банкомат") ||
    // Сбер часто пишет «Прочие операции», но MCC 6010/6011 = ATM
    mcc === "6010" ||
    mcc === "6011"
  ) {
    return "withdrawal";
  }

  // Внесение наличных в банкомат — пополнение счёта, не «доход».
  if (
    desc.includes("внесение средств") ||
    desc.includes("внесение наличных") ||
    desc.includes("cashin")
  ) {
    return "transfer";
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
    const mccFromColumn = mccRaw.length > 0 ? mccRaw : null;
    const fromDescription = extractMerchantAndMcc(description);
    const mcc = mccFromColumn ?? fromDescription.mcc;
    const merchant = fromDescription.merchant;

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
      // Подвал выписки («Страница 1 из 1», подпись сотрудника) попадает в колонку даты.
      // Это не операции: жалуемся только если в строке есть сумма, иначе молча пропускаем.
      if (String(rawAmt ?? "").trim()) {
        issues.push({ rowIndex: r + 1, message: `Строка ${r + 1}: непонятная дата «${rawDate}»` });
      }
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
      mcc,
    });

    const amount = signed.abs;
    // В хеш идёт mcc из колонки, а не выведенный из описания: external_id — арбитр дедупа
    // (user_id, source, external_id), и любое изменение формулы заставило бы уже
    // импортированные операции задвоиться при повторном импорте того же файла.
    const externalId = await sha1Hex(
      [
        "sber_v1",
        occurredAt,
        amount.toFixed(2),
        kind,
        bankCategory,
        description ?? "",
        mccFromColumn ?? "",
      ].join("|")
    );

    operations.push({
      sourceRow: r + 1,
      occurredAt,
      kind,
      amount,
      description,
      merchant,
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
