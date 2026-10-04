import type { AgentTool } from "@/lib/agent/tools/types";
import {
  loadNearby,
  replaceNearbyInterests,
  saveNearbyCity,
} from "@/lib/db/nearby";
import { NEARBY_CITIES } from "@/lib/features/nearby/cities";
import { refreshNearbyFeed } from "@/lib/features/nearby/refresh";

function compactFeed(feed: Awaited<ReturnType<typeof loadNearby>>) {
  if ("error" in feed) return feed;
  const { settings, interests, events, stale } = feed.feed;
  return {
    city: settings.cityLabel,
    citySlug: settings.citySlug,
    horizonDays: settings.horizonDays,
    refreshedAt: settings.refreshedAt,
    stale,
    digest: settings.lastDigest,
    interests: interests.map((interest) => ({ label: interest.label, enabled: interest.enabled })),
    events: events.slice(0, 12).map((event) => ({
      id: event.id,
      title: event.title,
      startsOn: event.startsOn,
      place: event.place,
      why: event.why,
      url: event.url,
      interest: event.interestLabel,
    })),
  };
}

export const getNearbyFeedTool: AgentTool = {
  name: "get_nearby_feed",
  description:
    "Личная лента событий рядом (/nearby): город, интересы, короткий разбор и события со ссылками. Ничего не ищет заново. Если stale=true или лента пустая, а пользователь хочет актуальное — вызови refresh_nearby_feed. Не выдумывай события.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const feed = await loadNearby(ctx.userId);
    if ("error" in feed) return { ok: false, error: feed.error };
    return { ok: true, data: compactFeed(feed) };
  },
};

export const refreshNearbyFeedTool: AgentTool = {
  name: "refresh_nearby_feed",
  description:
    "Заново собирает ленту событий рядом: KudaGo и веб-поиск по включённым интересам, затем отбор. Пишет кэш ленты. Вызывай, когда пользователь просит, что происходит рядом, или get_nearby_feed вернул пустую или устаревшую ленту. Город и интересы должны быть уже заданы.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const refreshed = await refreshNearbyFeed(ctx.userId);
    if ("error" in refreshed) return { ok: false, error: refreshed.error };
    return {
      ok: true,
      data: {
        ...compactFeed({ feed: refreshed.result.feed }),
        notes: refreshed.result.notes,
        webSearch: refreshed.result.webSearch,
        rankedByModel: refreshed.result.rankedByModel,
      },
    };
  },
};

export const setNearbyCityTool: AgentTool = {
  name: "set_nearby_city",
  description:
    "Сохраняет город ленты «Рядом». Только после явного подтверждения. city_slug: msk, spb, ekb, kzn, nnv. Для другого города передай city_label без slug — тогда источник только веб, без KudaGo.",
  parameters: {
    type: "object",
    properties: {
      city_slug: {
        type: "string",
        enum: NEARBY_CITIES.map((city) => city.slug),
        description: "Город KudaGo. Не передавай, если город не из списка.",
      },
      city_label: {
        type: "string",
        description: "Название, если города нет в списке KudaGo.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const slug = typeof args.city_slug === "string" ? args.city_slug : null;
    const label = typeof args.city_label === "string" ? args.city_label : null;
    const saved = await saveNearbyCity(ctx.userId, slug, label);
    if ("error" in saved) return { ok: false, error: saved.error };
    return { ok: true, data: saved.settings };
  },
};

export const setNearbyInterestsTool: AgentTool = {
  name: "set_nearby_interests",
  description:
    "Заменяет весь список интересов ленты «Рядом». Только после явного подтверждения: сначала покажи новый список. От 1 до 8 коротких формулировок, например «плавание», «гонка героев».",
  parameters: {
    type: "object",
    properties: {
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Новый список интересов",
      },
    },
    required: ["labels"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const labels = Array.isArray(args.labels) ? args.labels.filter((item): item is string => typeof item === "string") : [];
    const saved = await replaceNearbyInterests(ctx.userId, labels);
    if ("error" in saved) return { ok: false, error: saved.error };
    return { ok: true, data: saved };
  },
};
