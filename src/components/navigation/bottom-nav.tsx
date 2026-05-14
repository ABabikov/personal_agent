"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Dumbbell,
  Waves,
  User,
  MessageSquare,
  Wallet,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Календарь",
    icon: CalendarDays,
  },
  {
    href: "/gym",
    label: "Зал",
    icon: Dumbbell,
  },
  {
    href: "/swim",
    label: "Плавание",
    icon: Waves,
  },
  {
    href: "/expenses",
    label: "Финансы",
    icon: Wallet,
  },
  {
    href: "/meal-plan",
    label: "Еда",
    icon: UtensilsCrossed,
  },
  {
    href: "/chat",
    label: "Чат",
    icon: MessageSquare,
  },
  {
    href: "/profile",
    label: "Профиль",
    icon: User,
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/70 bg-background/95 shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md supports-[backdrop-filter]:bg-background/90 safe-area-pb">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-all duration-300",
                isActive
                  ? "text-primary drop-shadow-[0_0_8px_var(--glow-primary)]"
                  : "text-muted-foreground hover:text-foreground hover:drop-shadow-[0_0_4px_var(--glow-primary)]"
              )}
            >
              {isActive && (
                <span className="absolute -top-0.5 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_10px_2px_var(--glow-primary)]" />
              )}
              <Icon
                className={cn(
                  "size-5 transition-all duration-300",
                  isActive && "scale-110"
                )}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
