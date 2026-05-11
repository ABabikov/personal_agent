"use client";

import { Activity } from "lucide-react";

interface HeaderProps {
  title?: string;
  showLogo?: boolean;
}

export function Header({ title, showLogo = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-lg">
      <div className="flex h-14 items-center gap-3 px-4">
        {showLogo && (
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Activity className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">Jarvis</span>
          </div>
        )}
        {title && !showLogo && (
          <h1 className="text-lg font-semibold">{title}</h1>
        )}
      </div>
    </header>
  );
}
