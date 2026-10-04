import type { NearbyEventSource } from "@/types/database";

export type NearbyCandidate = {
  key: string;
  source: NearbyEventSource;
  title: string;
  url: string;
  snippet: string;
  place: string | null;
  startsOn: string | null;
  interestLabel: string;
};

export type NearbySettingsView = {
  citySlug: string | null;
  cityLabel: string | null;
  horizonDays: number;
  lastDigest: string | null;
  refreshedAt: string | null;
};

export type NearbyInterestView = {
  id: string;
  label: string;
  enabled: boolean;
};

export type NearbyEventView = {
  id: string;
  source: NearbyEventSource;
  title: string;
  url: string;
  startsOn: string | null;
  place: string | null;
  why: string | null;
  score: number;
  interestLabel: string | null;
};

export type NearbyFeed = {
  settings: NearbySettingsView;
  interests: NearbyInterestView[];
  events: NearbyEventView[];
  stale: boolean;
};

export type ScoredNearbyEvent = {
  candidate: NearbyCandidate;
  score: number;
  why: string;
  startsOn: string | null;
  title: string;
  place: string | null;
};
