/**
 * Tools для работы с профилем пользователя.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import { loadUserProfile, saveUserProfile, type Gender } from "@/lib/db/profile";
import {
  calculateBMR,
  calculateBMRKatchMcArdle,
  calculateTDEE,
} from "@/lib/features/workouts/calories";

const GENDERS: Gender[] = ["male", "female"];

export const getProfileTool: AgentTool = {
  name: "get_profile",
  description: [
    "Возвращает текущий профиль пользователя: вес (кг), рост (см), возраст,",
    "пол, коэффициент активности и опционально % жира. Если профиль ещё не заведён —",
    "вернёт data:null.",
    "",
    "Кейсы использования:",
    "— «сколько мне ккал в день?» (нужны параметры → считаешь BMR/TDEE),",
    "— «какой у меня сейчас вес?»,",
    "— перед сохранением тренировки, если пользователь не указал свой вес.",
    "Дополнительно возвращает посчитанные bmr и tdee, если данных хватает.",
  ].join(" "),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const r = await loadUserProfile(ctx.userId);
    if ("error" in r) return { ok: false, error: r.error };
    if (!r.data) return { ok: true, data: { profile: null, bmr: null, tdee: null } };
    const p = r.data;
    let bmr: number | null = null;
    if (p.body_fat_pct != null && p.weight != null) {
      bmr = Math.round(calculateBMRKatchMcArdle(p.weight, p.body_fat_pct));
    } else if (p.weight && p.height && p.age && p.gender) {
      bmr = Math.round(calculateBMR(p.weight, p.height, p.age, p.gender));
    }
    const tdee = bmr != null ? Math.round(calculateTDEE(bmr, p.activity_level)) : null;
    return { ok: true, data: { profile: p, bmr, tdee } };
  },
};

export const saveProfileTool: AgentTool = {
  name: "save_profile",
  description: [
    "Сохраняет/обновляет профиль пользователя (upsert по user_id).",
    "Все поля опциональные — что передал, то и обновится; чего не передал — оставит как было,",
    "**кроме** activity_level: если не передан, останется текущим (или 1.55 для нового профиля).",
    "",
    "Кейсы:",
    "— «я теперь вешу 78 кг» → save_profile({weight: 78}),",
    "— «у меня жир 14%» → save_profile({body_fat_pct: 14}),",
    "— первичная настройка профиля.",
    "Перед изменением частичного поля разумно сперва вызвать get_profile, чтобы знать текущие значения.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      weight: { type: "number", description: "Вес в кг", minimum: 20, maximum: 300 },
      height: { type: "number", description: "Рост в см", minimum: 100, maximum: 250 },
      age: { type: "integer", description: "Возраст", minimum: 5, maximum: 120 },
      gender: { type: "string", enum: ["male", "female"], description: "Пол" },
      activity_level: {
        type: "number",
        description: "Коэффициент активности (1.2 / 1.375 / 1.55 / 1.725 / 1.9)",
        minimum: 1.0,
        maximum: 2.5,
      },
      body_fat_pct: {
        type: "number",
        description: "% жира (если знаешь — позволяет Katch-McArdle BMR)",
        minimum: 2,
        maximum: 60,
      },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const cur = await loadUserProfile(ctx.userId);
    if ("error" in cur) return { ok: false, error: cur.error };
    const base = cur.data ?? {
      weight: null,
      height: null,
      age: null,
      gender: null,
      activity_level: 1.55,
      body_fat_pct: null,
    };
    const next = { ...base };
    if (typeof args.weight === "number") next.weight = args.weight;
    if (typeof args.height === "number") next.height = args.height;
    if (typeof args.age === "number") next.age = Math.round(args.age);
    if (typeof args.gender === "string" && GENDERS.includes(args.gender as Gender)) {
      next.gender = args.gender as Gender;
    }
    if (typeof args.activity_level === "number") next.activity_level = args.activity_level;
    if (typeof args.body_fat_pct === "number") next.body_fat_pct = args.body_fat_pct;

    const r = await saveUserProfile(ctx.userId, next);
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: { profile: r.data } };
  },
};

export const computeBmrTdeeTool: AgentTool = {
  name: "compute_bmr_tdee",
  description: [
    "What-if калькулятор BMR и TDEE без обращения в БД. Удобен, когда пользователь",
    "хочет «прикинуть, а сколько ккал мне нужно при другом весе/активности», не меняя профиль.",
    "Если задан body_fat_pct и weight — используется Katch-McArdle, иначе Mifflin-St Jeor",
    "(нужны weight+height+age+gender).",
    "",
    "Кейсы:",
    "— «сколько мне понадобится ккал, если я похудею до 75 кг?»,",
    "— «а если я буду тренироваться 6 раз в неделю (1.725)?».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      weight: { type: "number" },
      height: { type: "number" },
      age: { type: "integer" },
      gender: { type: "string", enum: ["male", "female"] },
      activity_level: { type: "number", default: 1.55 },
      body_fat_pct: { type: "number" },
    },
    required: ["weight"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const weight = Number(args.weight);
    const activity = typeof args.activity_level === "number" ? args.activity_level : 1.55;
    let bmr: number | null = null;
    let method: "katch-mcardle" | "mifflin-st-jeor" | null = null;
    if (typeof args.body_fat_pct === "number") {
      bmr = calculateBMRKatchMcArdle(weight, args.body_fat_pct);
      method = "katch-mcardle";
    } else if (
      typeof args.height === "number" &&
      typeof args.age === "number" &&
      (args.gender === "male" || args.gender === "female")
    ) {
      bmr = calculateBMR(weight, args.height, args.age, args.gender);
      method = "mifflin-st-jeor";
    }
    if (bmr == null) {
      return {
        ok: false,
        error:
          "Недостаточно данных: либо передай body_fat_pct + weight, либо weight + height + age + gender.",
      };
    }
    const tdee = calculateTDEE(bmr, activity);
    return {
      ok: true,
      data: { bmr: Math.round(bmr), tdee: Math.round(tdee), method, activity_level: activity },
    };
  },
};
