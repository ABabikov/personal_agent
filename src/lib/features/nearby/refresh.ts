import { collectNearbyCandidates } from "@/lib/features/nearby/collect";
import { interestTerms } from "@/lib/features/nearby/defaults";
import { rankNearbyCandidates } from "@/lib/features/nearby/rank";
import { addIsoDays, moscowToday } from "@/lib/features/nearby/window";
import { loadNearby, replaceVisibleNearbyEvents } from "@/lib/db/nearby";
import type { NearbyFeed } from "@/lib/features/nearby/types";

export type NearbyRefreshResult = {
  feed: NearbyFeed;
  notes: string[];
  webSearch: boolean;
  rankedByModel: boolean;
};

export async function refreshNearbyFeed(userId: string): Promise<{ result: NearbyRefreshResult } | { error: string }> {
  const loaded = await loadNearby(userId);
  if ("error" in loaded) return loaded;

  const { settings, interests } = loaded.feed;
  if (!settings.cityLabel) return { error: "Сначала выбери город." };
  const enabled = interests.filter((interest) => interest.enabled);
  if (enabled.length === 0) return { error: "Включи хотя бы один интерес." };

  const today = moscowToday();
  const until = addIsoDays(today, settings.horizonDays);
  const interestInputs = enabled.map((interest) => ({
    label: interest.label,
    terms: interestTerms(interest.label),
  }));

  const collected = await collectNearbyCandidates({
    cityLabel: settings.cityLabel,
    citySlug: settings.citySlug,
    today,
    until,
    interests: interestInputs,
  });
  const ranked = await rankNearbyCandidates({
    cityLabel: settings.cityLabel,
    today,
    until,
    interests: interestInputs,
    candidates: collected.candidates,
  });

  const saved = await replaceVisibleNearbyEvents(userId, ranked.picks, ranked.digest);
  if ("error" in saved) return saved;

  const again = await loadNearby(userId);
  if ("error" in again) return again;

  const notes = [...collected.notes];
  if (!ranked.rankedByModel && collected.candidates.length > 0) {
    notes.push("Модель недоступна, в ленте прямые совпадения с интересами.");
  }

  return {
    result: {
      feed: again.feed,
      notes,
      webSearch: collected.webSearch,
      rankedByModel: ranked.rankedByModel,
    },
  };
}
