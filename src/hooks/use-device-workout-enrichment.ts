"use client";

import { useEffect, useState } from "react";
import {
  fetchDeviceEnrichmentForWorkout,
  type DeviceWorkoutEnrichment,
} from "@/lib/db/deviceWorkoutEnrichment";

export function useDeviceWorkoutEnrichment(
  workoutId: string | null | undefined
): DeviceWorkoutEnrichment | null {
  const [device, setDevice] = useState<DeviceWorkoutEnrichment | null>(null);

  useEffect(() => {
    if (!workoutId) {
      setDevice(null);
      return;
    }
    let cancelled = false;
    void fetchDeviceEnrichmentForWorkout(workoutId).then((d) => {
      if (!cancelled) setDevice(d);
    });
    return () => {
      cancelled = true;
    };
  }, [workoutId]);

  return device;
}
