"use client";

import { Activity } from "lucide-react";

interface HeaderProps {
  title?: string;
  showLogo?: boolean;
}

export function Header({ title, showLogo = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-glow-primary/20 bg-card/60 backdrop-blur-xl shadow-lg shadow-glow-primary/5">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          {showLogo && (
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary shadow-lg shadow-glow-primary/30 ring-1 ring-glow-primary/50">
                <Activity className="size-4 text-primary-foreground" />
              </div>
              <span className="font-semibold tracking-tight bg-gradient-to-r from-primary to-glow-secondary bg-clip-text text-transparent">Jarvis</span>
            </div>
          )}
          {title && !showLogo && (
            <h1 className="text-lg font-semibold">{title}</h1>
          )}
        </div>
        <a
          href="/api/auth/logout"
          className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Выйти
        </a>
      </div>
    </header>
  );
}
