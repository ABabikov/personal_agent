/**
 * Справочник продуктов на 100 г: сырьё и готовое мясо, не карточки магазинов.
 * «Говядина тушёная, мясо» — тушёное мясо. Банка ищется только как «тушенка».
 * Цифры — типовые значения состава (концентрация после варки/тушения, без соуса).
 */

export type ReferenceFood = {
  id: string;
  name: string;
  aliases: string[];
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  /** Короткая пометка в поиске, например «не консервы». */
  note?: string;
  /** Группа для запросов «фрукты» и «овощи». */
  group?: "fruit" | "vegetable";
  /** Вес одной штуки, г. Яйцо — без скорлупы. */
  pieceGrams?: number;
  /** Вес одной столовой ложки, г. */
  tbspGrams?: number;
};

export const REFERENCE_FOODS: ReferenceFood[] = [
  { id: "beef-raw", name: "Говядина, мякоть", aliases: ["говядина сырая"], kcalPer100: 187, proteinPer100: 18.9, fatPer100: 12.4, carbsPer100: 0 },
  { id: "beef-boiled", name: "Говядина отварная", aliases: ["говядина вареная"], kcalPer100: 254, proteinPer100: 25.8, fatPer100: 16.8, carbsPer100: 0 },
  {
    id: "beef-braised",
    name: "Говядина тушёная, мясо",
    aliases: ["говядина тушеная", "тушеная говядина", "тушеное мясо говядина"],
    kcalPer100: 220,
    proteinPer100: 26,
    fatPer100: 13,
    carbsPer100: 0,
    note: "мясо, не банка",
  },
  {
    id: "beef-mince",
    name: "Фарш говяжий",
    aliases: ["говяжий фарш"],
    kcalPer100: 254,
    proteinPer100: 17.2,
    fatPer100: 20,
    carbsPer100: 0,
  },
  {
    id: "beef-canned",
    name: "Тушенка говяжья, консервы",
    aliases: ["тушенка", "говяжья тушенка"],
    kcalPer100: 232,
    proteinPer100: 16.8,
    fatPer100: 18.3,
    carbsPer100: 0,
    note: "банка",
  },
  { id: "pork-tender", name: "Свинина, вырезка", aliases: ["свинина сырая"], kcalPer100: 142, proteinPer100: 19.4, fatPer100: 7.1, carbsPer100: 0 },
  {
    id: "pork-braised",
    name: "Свинина тушёная, мясо",
    aliases: ["свинина тушеная", "тушеная свинина"],
    kcalPer100: 263,
    proteinPer100: 22,
    fatPer100: 19,
    carbsPer100: 0,
    note: "мясо, не банка",
  },
  { id: "chicken-breast-boiled", name: "Куриное филе", aliases: ["куриная грудка", "грудка отварная", "филе куриное"], kcalPer100: 137, proteinPer100: 29.8, fatPer100: 1.8, carbsPer100: 0.5, note: "отварное" },
  { id: "chicken-breast-raw", name: "Куриное филе сырое", aliases: ["куриная грудка сырая"], kcalPer100: 113, proteinPer100: 23.6, fatPer100: 1.9, carbsPer100: 0.4, note: "сырое" },
  { id: "chicken-thigh", name: "Куриное бедро без кожи", aliases: ["бедро куриное"], kcalPer100: 161, proteinPer100: 19.3, fatPer100: 9, carbsPer100: 0 },
  { id: "chicken-liver", name: "Печень куриная", aliases: ["куриная печень"], kcalPer100: 166, proteinPer100: 25, fatPer100: 6.5, carbsPer100: 0.9, note: "тушёная" },
  { id: "chicken-liver-raw", name: "Печень куриная сырая", aliases: ["печень сырая куриная"], kcalPer100: 136, proteinPer100: 20.4, fatPer100: 5.9, carbsPer100: 0.7, note: "сырая" },
  { id: "ham-venezia", name: "Ветчина Венеция", aliases: ["ветчина венеция", "венеция ветчина"], kcalPer100: 120, proteinPer100: 17, fatPer100: 4.5, carbsPer100: 2.5, note: "с упаковки" },
  { id: "turkey-breast", name: "Индейка, грудка", aliases: ["филе индейки"], kcalPer100: 114, proteinPer100: 23.6, fatPer100: 1.5, carbsPer100: 0 },
  { id: "egg", name: "Яйцо куриное", aliases: ["яйца", "яйцо"], kcalPer100: 157, proteinPer100: 12.7, fatPer100: 11.5, carbsPer100: 0.7, pieceGrams: 55, note: "1 шт ≈ 55 г" },
  { id: "egg-white", name: "Яичный белок", aliases: ["белок яйца"], kcalPer100: 44, proteinPer100: 11.1, fatPer100: 0, carbsPer100: 0.7 },
  { id: "pollock-boiled", name: "Минтай", aliases: ["минтай отварной", "филе минтая"], kcalPer100: 79, proteinPer100: 17.6, fatPer100: 1, carbsPer100: 0, note: "отварной" },
  { id: "pollock", name: "Минтай сырой", aliases: [], kcalPer100: 72, proteinPer100: 15.9, fatPer100: 0.9, carbsPer100: 0, note: "сырой" },
  { id: "herring-brine", name: "Сельдь в рассоле", aliases: ["селедка", "селедка в рассоле", "селедка в рассле", "сельдь соленая"], kcalPer100: 217, proteinPer100: 19.8, fatPer100: 15.4, carbsPer100: 0, note: "слабосолёная" },
  { id: "salmon", name: "Лосось", aliases: ["семга", "сёмга"], kcalPer100: 142, proteinPer100: 19.8, fatPer100: 6.3, carbsPer100: 0 },
  { id: "tuna-can", name: "Тунец в собственном соку", aliases: ["тунец консервы"], kcalPer100: 96, proteinPer100: 21, fatPer100: 1, carbsPer100: 0 },

  { id: "milk-25", name: "Молоко 2,5%", aliases: ["молоко"], kcalPer100: 52, proteinPer100: 2.8, fatPer100: 2.5, carbsPer100: 4.7 },
  { id: "milk-32", name: "Молоко 3,2%", aliases: [], kcalPer100: 60, proteinPer100: 2.9, fatPer100: 3.2, carbsPer100: 4.7 },
  { id: "kefir-1", name: "Кефир 1%", aliases: ["кефир"], kcalPer100: 40, proteinPer100: 3, fatPer100: 1, carbsPer100: 4 },
  { id: "cottage-0", name: "Творог обезжиренный", aliases: ["творог 0", "творог 0%", "творог нежирный"], kcalPer100: 71, proteinPer100: 16.5, fatPer100: 0.1, carbsPer100: 1.3 },
  { id: "cottage-5", name: "Творог 5%", aliases: ["творог"], kcalPer100: 121, proteinPer100: 16, fatPer100: 5, carbsPer100: 3 },
  { id: "cottage-9", name: "Творог 9%", aliases: [], kcalPer100: 159, proteinPer100: 16.7, fatPer100: 9, carbsPer100: 2 },
  { id: "sour-15", name: "Сметана 15%", aliases: ["сметана"], kcalPer100: 158, proteinPer100: 2.6, fatPer100: 15, carbsPer100: 3 },
  { id: "sour-20", name: "Сметана 20%", aliases: [], kcalPer100: 206, proteinPer100: 2.8, fatPer100: 20, carbsPer100: 3.2 },
  { id: "cheese-hard", name: "Сыр твёрдый", aliases: ["сыр"], kcalPer100: 356, proteinPer100: 26, fatPer100: 27, carbsPer100: 0 },
  { id: "yogurt-2", name: "Йогурт натуральный 2%", aliases: ["йогурт"], kcalPer100: 60, proteinPer100: 4, fatPer100: 2, carbsPer100: 6.2 },

  { id: "buckwheat-dry", name: "Гречка сухая", aliases: ["гречневая крупа", "гречка"], kcalPer100: 313, proteinPer100: 12.6, fatPer100: 3.3, carbsPer100: 62.1 },
  { id: "buckwheat-boiled", name: "Гречка отварная", aliases: ["гречка вареная"], kcalPer100: 110, proteinPer100: 4.2, fatPer100: 1.1, carbsPer100: 21.3 },
  { id: "rice-dry", name: "Рис сухой", aliases: ["рис крупа", "рис"], kcalPer100: 333, proteinPer100: 7, fatPer100: 1, carbsPer100: 74 },
  { id: "rice-boiled", name: "Рис отварной", aliases: ["рис вареный"], kcalPer100: 116, proteinPer100: 2.2, fatPer100: 0.5, carbsPer100: 24.9 },
  { id: "oats-dry", name: "Овсянка сухая", aliases: ["овсяные хлопья", "геркулес"], kcalPer100: 342, proteinPer100: 12.3, fatPer100: 6.1, carbsPer100: 59.5 },
  { id: "oats-boiled", name: "Овсянка на воде", aliases: ["овсяная каша"], kcalPer100: 88, proteinPer100: 3, fatPer100: 1.7, carbsPer100: 15 },
  { id: "pasta-dry", name: "Макароны сухие", aliases: ["паста сухая", "спагетти"], kcalPer100: 344, proteinPer100: 10.4, fatPer100: 1.1, carbsPer100: 71.5 },
  { id: "pasta-boiled", name: "Макароны отварные", aliases: ["паста отварная"], kcalPer100: 112, proteinPer100: 3.5, fatPer100: 0.4, carbsPer100: 23.2 },
  { id: "potato-boiled", name: "Картофель", aliases: ["картошка", "картофель отварной", "картошка вареная"], kcalPer100: 82, proteinPer100: 2, fatPer100: 0.4, carbsPer100: 16.7, note: "отварной" },
  { id: "potato-raw", name: "Картофель сырой", aliases: ["картошка сырая"], kcalPer100: 77, proteinPer100: 2, fatPer100: 0.4, carbsPer100: 16.3, note: "сырой" },
  { id: "bread-white", name: "Хлеб пшеничный", aliases: ["хлеб белый", "батон"], kcalPer100: 242, proteinPer100: 8.1, fatPer100: 1, carbsPer100: 48.8 },
  { id: "bread-rye", name: "Хлеб ржаной", aliases: ["хлеб черный", "бородинский"], kcalPer100: 174, proteinPer100: 6.6, fatPer100: 1.2, carbsPer100: 33.4 },
  { id: "flour", name: "Мука пшеничная", aliases: ["мука"], kcalPer100: 334, proteinPer100: 10.3, fatPer100: 1.1, carbsPer100: 68.9 },
  { id: "semolina", name: "Манка", aliases: ["манная крупа", "манка сухая"], kcalPer100: 333, proteinPer100: 10.3, fatPer100: 1, carbsPer100: 70.6, tbspGrams: 20, note: "1 ст. л. ≈ 20 г" },
  { id: "raisins", name: "Изюм", aliases: ["изюм кишмиш"], kcalPer100: 279, proteinPer100: 2.3, fatPer100: 0.5, carbsPer100: 65.8 },
  { id: "sugar", name: "Сахар", aliases: [], kcalPer100: 399, proteinPer100: 0, fatPer100: 0, carbsPer100: 99.8 },

  { id: "butter", name: "Масло сливочное 82,5%", aliases: ["сливочное масло", "масло"], kcalPer100: 748, proteinPer100: 0.5, fatPer100: 82.5, carbsPer100: 0.8 },
  { id: "oil-sun", name: "Масло подсолнечное", aliases: ["растительное масло", "подсолнечное масло"], kcalPer100: 899, proteinPer100: 0, fatPer100: 99.9, carbsPer100: 0 },
  { id: "oil-olive", name: "Масло оливковое", aliases: ["оливковое масло"], kcalPer100: 898, proteinPer100: 0, fatPer100: 99.8, carbsPer100: 0 },

  { id: "onion", name: "Лук репчатый", aliases: ["лук", "овощи"], kcalPer100: 41, proteinPer100: 1.4, fatPer100: 0.2, carbsPer100: 8.2, group: "vegetable" },
  { id: "onion-red", name: "Лук фиолетовый", aliases: ["лук красный", "красный лук", "овощи"], kcalPer100: 40, proteinPer100: 1.1, fatPer100: 0.1, carbsPer100: 9.3, group: "vegetable" },
  { id: "carrot", name: "Морковь", aliases: ["овощи"], kcalPer100: 35, proteinPer100: 1.3, fatPer100: 0.1, carbsPer100: 6.9, group: "vegetable" },
  { id: "tomato", name: "Помидор", aliases: ["томаты", "помидоры", "овощи"], kcalPer100: 20, proteinPer100: 0.6, fatPer100: 0.2, carbsPer100: 4.2, group: "vegetable" },
  { id: "cucumber", name: "Огурец", aliases: ["огурцы", "огурца", "огурец свежий", "овощи"], kcalPer100: 15, proteinPer100: 0.8, fatPer100: 0.1, carbsPer100: 2.8, group: "vegetable" },
  { id: "cabbage", name: "Капуста белокочанная", aliases: ["капуста", "овощи"], kcalPer100: 27, proteinPer100: 1.8, fatPer100: 0.1, carbsPer100: 4.7, group: "vegetable" },
  { id: "cabbage-napa", name: "Пекинская капуста", aliases: ["капуста пекинская", "китайская капуста", "овощи"], kcalPer100: 16, proteinPer100: 1.2, fatPer100: 0.2, carbsPer100: 2, group: "vegetable" },
  { id: "green-beans", name: "Фасоль стручковая", aliases: ["стручковая фасоль", "овощи"], kcalPer100: 31, proteinPer100: 1.8, fatPer100: 0.2, carbsPer100: 4.5, note: "отварная", group: "vegetable" },
  {
    id: "stewed-cabbage-beans",
    name: "Овощи тушёные",
    aliases: ["тушеные овощи", "тушеная капуста с фасолью", "капуста стручковая фасоль"],
    kcalPer100: 49,
    proteinPer100: 2.1,
    fatPer100: 1.8,
    carbsPer100: 6.6,
    note: "капуста и стручковая фасоль",
    group: "vegetable",
  },
  { id: "pepper", name: "Перец болгарский", aliases: ["перец сладкий", "овощи"], kcalPer100: 27, proteinPer100: 1.3, fatPer100: 0, carbsPer100: 5.3, group: "vegetable" },
  { id: "zucchini", name: "Кабачок", aliases: ["цукини", "овощи"], kcalPer100: 24, proteinPer100: 0.6, fatPer100: 0.3, carbsPer100: 4.6, group: "vegetable" },
  { id: "beet-boiled", name: "Свёкла отварная", aliases: ["свекла отварная", "свекла вареная", "свекла", "овощи"], kcalPer100: 49, proteinPer100: 1.7, fatPer100: 0.1, carbsPer100: 10.8, group: "vegetable" },
  { id: "beet", name: "Свёкла сырая", aliases: ["свекла сырая"], kcalPer100: 42, proteinPer100: 1.5, fatPer100: 0.1, carbsPer100: 8.8, note: "сырая", group: "vegetable" },
  { id: "garlic", name: "Чеснок", aliases: ["овощи"], kcalPer100: 143, proteinPer100: 6.5, fatPer100: 0.5, carbsPer100: 29.9, group: "vegetable" },

  { id: "apple", name: "Яблоко", aliases: ["яблоки", "фрукты"], kcalPer100: 47, proteinPer100: 0.4, fatPer100: 0.4, carbsPer100: 9.8, group: "fruit" },
  { id: "banana", name: "Банан", aliases: ["бананы", "фрукты"], kcalPer100: 96, proteinPer100: 1.5, fatPer100: 0.2, carbsPer100: 21, group: "fruit" },
  { id: "orange", name: "Апельсин", aliases: ["апельсины", "фрукты"], kcalPer100: 43, proteinPer100: 0.9, fatPer100: 0.2, carbsPer100: 8.1, group: "fruit" },
  { id: "pear", name: "Груша", aliases: ["груши", "фрукты"], kcalPer100: 47, proteinPer100: 0.4, fatPer100: 0.3, carbsPer100: 10.3, group: "fruit" },
  { id: "tangerine", name: "Мандарин", aliases: ["мандарины", "фрукты"], kcalPer100: 38, proteinPer100: 0.8, fatPer100: 0.2, carbsPer100: 7.5, group: "fruit" },
  { id: "grapes", name: "Виноград", aliases: ["фрукты"], kcalPer100: 69, proteinPer100: 0.6, fatPer100: 0.2, carbsPer100: 16.8, group: "fruit" },
  { id: "kiwi", name: "Киви", aliases: ["фрукты"], kcalPer100: 47, proteinPer100: 1, fatPer100: 0.5, carbsPer100: 8, group: "fruit" },

  { id: "lentil-green-boiled", name: "Чечевица зелёная", aliases: ["чечевица зеленая", "зеленая чечевица", "чечевица отварная"], kcalPer100: 116, proteinPer100: 9, fatPer100: 0.4, carbsPer100: 20, note: "отварная" },
  { id: "lentil-dry", name: "Чечевица зелёная сухая", aliases: ["чечевица сухая", "чечевица зеленая сухая"], kcalPer100: 295, proteinPer100: 24, fatPer100: 1.5, carbsPer100: 46, note: "сухая" },
  { id: "peas-boiled", name: "Горох", aliases: ["горох отварной", "горох вареный"], kcalPer100: 118, proteinPer100: 8.3, fatPer100: 0.4, carbsPer100: 21, note: "отварной" },
  { id: "peas-dry", name: "Горох сухой", aliases: ["горох крупа"], kcalPer100: 298, proteinPer100: 20.5, fatPer100: 2, carbsPer100: 49.5, note: "сухой" },
  { id: "chickpea-boiled", name: "Нут", aliases: ["нут отварной"], kcalPer100: 164, proteinPer100: 8.9, fatPer100: 2.6, carbsPer100: 27, note: "отварной" },
  { id: "chickpea-dry", name: "Нут сухой", aliases: [], kcalPer100: 364, proteinPer100: 19, fatPer100: 6, carbsPer100: 61, note: "сухой" },
  { id: "peas-canned", name: "Горошек консервированный", aliases: ["зеленый горошек", "горошек", "горошек зеленый", "горошка"], kcalPer100: 40, proteinPer100: 3.1, fatPer100: 0.2, carbsPer100: 6.5, note: "слитый" },
  { id: "beans-boiled", name: "Фасоль белая отварная", aliases: ["фасоль бобовая", "фасоль красная"], kcalPer100: 123, proteinPer100: 7.8, fatPer100: 0.5, carbsPer100: 21.5 },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-zа-я0-9%]+/i)
    .filter((token) => token.length > 1);
}

/** Срезает окончание, чтобы «тушеная» совпала с «тушеное», а «творога» — с «творог». «Тушенка» остаётся другим словом. */
function stem(token: string): string {
  const adj = token.replace(/(ого|его|ому|ему|ыми|ими|ая|яя|ый|ий|ое|ее|ые|ие|ую|юю|ой)$/u, "");
  if (adj !== token && adj.length >= 3) return adj;
  const noun = token.replace(/(ами|ями|ов|ев|ах|ях|ом|ем|ой|ей|ам|ям|а|я|ы|и|у|ю|о|е)$/u, "");
  if (noun !== token && noun.length >= 3) return noun;
  return token;
}

function wordsMatch(queryWord: string, nameWord: string): boolean {
  if (stem(queryWord) === stem(nameWord)) return true;
  if (queryWord.length < 4 || !nameWord.startsWith(queryWord)) return false;
  const tail = nameWord.slice(queryWord.length);
  return /^(а|я|ы|и|е|у|ой|ка|ки|ок)$/u.test(tail);
}

export function foodQueryMatches(query: string, text: string): boolean {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return false;
  const hay = tokens(text);
  return queryTokens.every((word) => hay.some((nameWord) => wordsMatch(word, nameWord)));
}

function foodTokens(food: ReferenceFood): string[] {
  return tokens([food.name, ...food.aliases].join(" "));
}

export function searchReferenceFoods(query: string, limit = 8): ReferenceFood[] {
  const normalized = normalize(query).trim();
  if (normalized === "фрукты" || normalized === "фрукт") {
    return REFERENCE_FOODS.filter((food) => food.group === "fruit").slice(0, Math.max(limit, 20));
  }
  if (normalized === "овощи" || normalized === "овощ") {
    return REFERENCE_FOODS.filter((food) => food.group === "vegetable").slice(0, Math.max(limit, 20));
  }
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return [];
  const ranked = REFERENCE_FOODS.flatMap((food) => {
    const hay = foodTokens(food);
    const ok = queryTokens.every((word) => hay.some((nameWord) => wordsMatch(word, nameWord)));
    if (!ok) return [];
    const nameHits = tokens(food.name).filter((nameWord) =>
      queryTokens.some((word) => wordsMatch(word, nameWord))
    ).length;
    return [{ food, score: nameHits * 10 - tokens(food.name).length }];
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map((row) => row.food);
}
