"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/navigation/header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { GlobalChat } from "@/components/chat/global-chat";
import { PageChatProvider } from "@/contexts/page-chat-context";
import { FuturisticBackground } from "@/components/ui/futuristic-background";

export function WebShell({ children }: { children: ReactNode }) {
  return (
    <PageChatProvider>
      <FuturisticBackground />
      <div className="flex min-h-dvh flex-col bg-transparent relative z-0">
        <Header />
        <main className="flex-1 px-4 pb-20 pt-4">
          <div className="mx-auto max-w-lg">{children}</div>
        </main>
        <BottomNav />
        <GlobalChat />
      </div>
    </PageChatProvider>
  );
}
