"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toIata } from "@/lib/features/travel/search";

const POINTS: Record<string, { lat: number; lng: number }> = {
  OVB: { lat: 55.00901, lng: 82.667 },
  MOW: { lat: 55.7558, lng: 37.6173 },
  LED: { lat: 59.9343, lng: 30.3351 },
  AER: { lat: 43.448, lng: 39.956 },
  KZN: { lat: 55.796, lng: 49.106 },
  SVX: { lat: 56.838, lng: 60.597 },
  VVO: { lat: 43.116, lng: 131.885 },
  DXB: { lat: 25.253, lng: 55.365 },
  IST: { lat: 41.008, lng: 28.978 },
};

function widgetSrc(input: {
  origin: string;
  lat: number;
  lng: number;
  width: number;
  height: number;
  zoom: string;
  scroll: boolean;
}): string {
  const marker = process.env.NEXT_PUBLIC_TRAVELPAYOUTS_MARKER?.trim() || "676296";
  const trs = process.env.NEXT_PUBLIC_TRAVELPAYOUTS_TRS?.trim() || "463276";
  const params = new URLSearchParams({
    currency: "rub",
    trs,
    shmarker: marker,
    lat: String(input.lat),
    lng: String(input.lng),
    powered_by: "true",
    search_host: "www.aviasales.ru/search",
    locale: "ru",
    origin: input.origin,
    value_min: "0",
    value_max: "1000000",
    round_trip: "true",
    only_direct: "false",
    radius: "1",
    draggable: "true",
    disable_zoom: "false",
    show_logo: "false",
    scrollwheel: input.scroll ? "true" : "false",
    primary: "#3FABDB",
    secondary: "#3FABDB",
    light: "#ffffff",
    width: String(input.width),
    height: String(input.height),
    zoom: input.zoom,
    promo_id: "4054",
    campaign_id: "100",
  });
  return `https://tpwgt.com/content?${params.toString()}`;
}

function mountWidget(
  container: HTMLDivElement,
  input: Parameters<typeof widgetSrc>[0],
  onDone: () => void
) {
  container.replaceChildren();
  const script = document.createElement("script");
  script.async = true;
  script.charset = "utf-8";
  script.src = widgetSrc(input);
  script.onload = onDone;
  script.onerror = onDone;
  container.appendChild(script);
  return script;
}

export function AviasalesMap({ originCity }: { originCity: string }) {
  const iata = toIata(originCity) ?? "OVB";
  const point = POINTS[iata] ?? POINTS.OVB;
  const boxRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = boxRef.current;
    if (!container) return;
    const width = Math.max(320, Math.min(container.clientWidth || 350, 720));
    const timer = window.setTimeout(() => setLoading(false), 8000);
    setLoading(true);
    setFailed(false);
    const script = mountWidget(
      container,
      { origin: iata, lat: point.lat, lng: point.lng, width, height: 460, zoom: "2", scroll: false },
      () => {
        window.clearTimeout(timer);
        setLoading(false);
      }
    );
    script.onerror = () => {
      window.clearTimeout(timer);
      setLoading(false);
      setFailed(true);
    };
    return () => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
  }, [iata, point.lat, point.lng]);

  useEffect(() => {
    if (!open) return;
    const container = modalRef.current;
    if (!container) return;
    const width = Math.max(320, Math.min(window.innerWidth - 32, 1100));
    const height = Math.max(420, Math.min(window.innerHeight - 96, 800));
    mountWidget(
      container,
      { origin: iata, lat: point.lat, lng: point.lng, width, height, zoom: "2.5", scroll: true },
      () => {}
    );
  }, [open, iata, point.lat, point.lng]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Вылет из {originCity.trim() || iata}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Maximize2 />
          Развернуть
        </Button>
      </div>
      <div className="relative min-h-[460px] overflow-hidden rounded-lg bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-sm text-neutral-600">
            Загрузка карты цен…
          </div>
        )}
        {failed && !loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-4 text-center text-sm text-neutral-600">
            Карта Aviasales не загрузилась. Нужен интернет и доступ к tpwgt.com.
          </div>
        )}
        <div ref={boxRef} className="min-h-[460px]" suppressHydrationWarning />
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative flex h-[92vh] w-[96vw] flex-col overflow-hidden rounded-lg bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 text-neutral-900">
              <p className="text-sm font-semibold">Карта цен · {iata}</p>
              <Button type="button" variant="secondary" size="icon" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            <div ref={modalRef} className="min-h-0 flex-1" suppressHydrationWarning />
          </div>
        </div>
      )}
    </div>
  );
}
