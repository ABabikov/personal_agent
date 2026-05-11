/**
 * Маппинг исходных категорий Money Manager → унифицированные категории Expenses Tracker.
 *
 * Ключ — пара (mm_category_no_emoji, mm_subcategory_no_emoji). Значение — пара
 * (target_category, target_subcategory|null) + опциональный kindOverride.
 *
 * Если при импорте встретится пара, которой нет в этом маппинге, скрипт
 * остановится (по умолчанию) или подсветит её при `--print-unmapped`.
 *
 * Источник пар: реальные данные на 2026-05-11 (52 пары, 18 верхне-уровневых
 * категорий). Если экспортированный файл MM начнёт содержать новые пары —
 * добавлять сюда вручную.
 *
 * Подкатегории пишутся через "/" в значении формы "Категория / подкат", но для
 * хранения это разделяется на parent/child при создании записи expense_categories.
 */

import type { ExpenseKind } from "../../src/types/database";

type Target = {
  /** Имя родительской категории в нашей унифицированной системе. */
  category: string;
  /** Имя подкатегории (опц.). Если null — категория корневая. */
  subcategory?: string | null;
  /** Если нужно переопределить kind (например, кэшбэк = income, хотя в MM это "Расход"). */
  kindOverride?: ExpenseKind;
};

/** Ключ маппинга в виде "MM_category||MM_subcategory". MM_subcategory может быть "". */
export type MmKey = string;

export function mmKey(category: string, subcategory: string): MmKey {
  return `${category}||${subcategory}`;
}

export const CATEGORY_MAP: Record<MmKey, Target> = {
  // ── Продукты ──────────────────────────────────────────────────────────────
  [mmKey("Продукты", "")]: { category: "Продукты" },

  // ── Питание вне дома ──────────────────────────────────────────────────────
  [mmKey("Питание обеды", "")]: { category: "Еда вне дома" },
  [mmKey("Питание обеды", "обед")]: { category: "Еда вне дома", subcategory: "обед" },
  [mmKey("Питание обеды", "завтрак")]: { category: "Еда вне дома", subcategory: "завтрак" },
  [mmKey("Питание обеды", "ужин")]: { category: "Еда вне дома", subcategory: "ужин" },
  [mmKey("Питание обеды", "Рестораны и кафе")]: { category: "Еда вне дома", subcategory: "рестораны и кафе" },
  [mmKey("Питание обеды", "кофе/напитки/алкоголь")]: { category: "Еда вне дома", subcategory: "кофе и напитки" },

  // ── Алкоголь ──────────────────────────────────────────────────────────────
  [mmKey("Алкоголь", "")]: { category: "Алкоголь" },

  // ── Транспорт ─────────────────────────────────────────────────────────────
  [mmKey("Транспортные", "автомобиль")]: { category: "Транспорт", subcategory: "автомобиль" },
  [mmKey("Транспортные", "Tакси")]: { category: "Транспорт", subcategory: "такси" },
  [mmKey("Транспортные", "Такси")]: { category: "Транспорт", subcategory: "такси" },
  [mmKey("Транспортные", "Автобус")]: { category: "Транспорт", subcategory: "общественный" },
  [mmKey("Транспортные", "Метро")]: { category: "Транспорт", subcategory: "общественный" },

  // ── Быт / дом ─────────────────────────────────────────────────────────────
  [mmKey("Бытовые", "")]: { category: "Дом" },
  [mmKey("Бытовые", "мелочной товар")]: { category: "Дом", subcategory: "мелочи" },
  [mmKey("Бытовые", "коммуналка")]: { category: "Дом", subcategory: "коммуналка" },
  [mmKey("Бытовые", "комуналка")]: { category: "Дом", subcategory: "коммуналка" }, // опечатка в MM
  [mmKey("Бытовые", "аренда кв")]: { category: "Дом", subcategory: "аренда" },
  [mmKey("Бытовые", "техника")]: { category: "Дом", subcategory: "техника" },
  [mmKey("Бытовые", "для квартиры")]: { category: "Дом", subcategory: "обустройство" },
  [mmKey("Бытовые", "мебель")]: { category: "Дом", subcategory: "мебель" },
  [mmKey("Бытовые", "туалетные принадлежности")]: { category: "Дом", subcategory: "гигиена" },
  [mmKey("Бытовые", "кухня")]: { category: "Дом", subcategory: "кухня" },
  [mmKey("Бытовые", "гараж")]: { category: "Дом", subcategory: "гараж" },

  // ── Семья / жизнь / друзья / развлечения ─────────────────────────────────
  [mmKey("жизнь", "дети доп")]: { category: "Семья и дети", subcategory: "дети" },
  [mmKey("жизнь", "сборы")]: { category: "Семья и дети", subcategory: "сборы" },
  [mmKey("жизнь", "детям карманные")]: { category: "Семья и дети", subcategory: "карманные" },
  [mmKey("жизнь", "друг")]: { category: "Друзья" },
  [mmKey("жизнь", "братство")]: { category: "Друзья", subcategory: "братство" },
  [mmKey("жизнь", "развлечения")]: { category: "Развлечения" },
  [mmKey("жизнь", "отношения")]: { category: "Отношения" },

  // ── Праздники ─────────────────────────────────────────────────────────────
  [mmKey("Праздники", "")]: { category: "Праздники" },
  [mmKey("Праздники", "каталка")]: { category: "Развлечения", subcategory: "каталка" },
  [mmKey("Праздники", "события")]: { category: "Праздники" },
  [mmKey("Праздники", "встречи с друзьями")]: { category: "Друзья", subcategory: "встречи" },

  // ── Здоровье ──────────────────────────────────────────────────────────────
  [mmKey("Здоровье", "медицина")]: { category: "Здоровье", subcategory: "медицина" },
  [mmKey("Здоровье", "больница")]: { category: "Здоровье", subcategory: "медицина" },
  [mmKey("Здоровье", "Здоровье")]: { category: "Здоровье", subcategory: "прочее" },
  [mmKey("Здоровье", "спорт спортзал")]: { category: "Спорт", subcategory: "зал" },
  [mmKey("Здоровье", "спорт басик")]: { category: "Спорт", subcategory: "бассейн" },

  // ── Одежда ────────────────────────────────────────────────────────────────
  [mmKey("Одежда", "")]: { category: "Одежда" },
  [mmKey("Одежда", "Одежда")]: { category: "Одежда" },
  [mmKey("Одежда", "обувь")]: { category: "Одежда", subcategory: "обувь" },

  // ── Красота ───────────────────────────────────────────────────────────────
  [mmKey("Красота", "Красота")]: { category: "Красота" },
  [mmKey("Красота", "косметика")]: { category: "Красота", subcategory: "косметика" },

  // ── Прочее (расходы) ──────────────────────────────────────────────────────
  [mmKey("Др.", "")]: { category: "Прочее" },
  [mmKey("путешествия", "")]: { category: "Путешествия" },
  [mmKey("Культура", "")]: { category: "Культура" }, // TODO: review — пары не было в верхушке топа

  // ── Доходы ────────────────────────────────────────────────────────────────
  [mmKey("Зарплата", "")]: { category: "Зарплата", kindOverride: "income" },
  [mmKey("Финам", "")]: { category: "Зарплата", subcategory: "Финам", kindOverride: "income" }, // TODO: review
  [mmKey("Тинвест", "")]: { category: "Инвестиции", subcategory: "Тинвест", kindOverride: "income" }, // TODO: review
  [mmKey("Кипр", "")]: { category: "Зарплата", subcategory: "Кипр", kindOverride: "income" }, // TODO: review
  [mmKey("дивиденды, проценты, кэшбэк", "")]: {
    category: "Инвестиции",
    subcategory: "дивиденды и кэшбэк",
    kindOverride: "income",
  },
};

/** Унифицированное соответствие для известного "Снятие". Применяем после маппинга. */
export function withdrawalTarget(): Target {
  return { category: "Снятие наличных" };
}

/**
 * Найти таргет. Возвращает undefined если пары нет в маппинге.
 * Шаг fallback: попробовать (category, "") если (category, sub) не найдено.
 */
export function lookupMapping(category: string, subcategory: string): Target | undefined {
  const direct = CATEGORY_MAP[mmKey(category, subcategory)];
  if (direct) return direct;
  if (subcategory.length > 0) {
    const parentOnly = CATEGORY_MAP[mmKey(category, "")];
    if (parentOnly) {
      // Подкатегория не замаплена явно — переносим как есть в lowercase.
      return { ...parentOnly, subcategory: subcategory.toLowerCase() };
    }
  }
  return undefined;
}
