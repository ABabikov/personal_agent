"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/navigation/header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { GlobalChat } from "@/components/chat/global-chat";
import { PageChatProvider } from "@/contexts/page-chat-context";

export function WebShell({ children }: { children: ReactNode }) {
  return (
    <PageChatProvider>
      <div className="flex min-h-dvh flex-col bg-background">
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
