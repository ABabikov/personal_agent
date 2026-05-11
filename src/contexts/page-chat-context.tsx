"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type PageChatContextValue = {
  pathname: string;
  /** Явный заголовок экрана (если страница его задала) */
  pageTitle: string;
  /** Текстовое описание того, что пользователь видит */
  pageSummary: string;
  setPageContext: (title: string, summary: string) => void;
};

const PageChatContext = createContext<PageChatContextValue | null>(null);

export function PageChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pageTitle, setPageTitle] = useState("");
  const [pageSummary, setPageSummary] = useState("");

  const setPageContext = useCallback((title: string, summary: string) => {
    setPageTitle(title);
    setPageSummary(summary);
  }, []);

  const value = useMemo(
    () => ({
      pathname,
      pageTitle,
      pageSummary,
      setPageContext,
    }),
    [pathname, pageTitle, pageSummary, setPageContext]
  );

  return (
    <PageChatContext.Provider value={value}>{children}</PageChatContext.Provider>
  );
}

export function usePageChatContext(): PageChatContextValue {
  const ctx = useContext(PageChatContext);
  if (!ctx) {
    throw new Error("usePageChatContext должен вызываться внутри PageChatProvider");
  }
  return ctx;
}

/**
 * Передаёт в глобальный чат заголовок и краткое описание содержимого экрана.
 */
export function useRegisterPageChatContext(title: string, summary: string) {
  const { setPageContext } = usePageChatContext();
  useLayoutEffect(() => {
    setPageContext(title, summary);
  }, [title, summary, setPageContext]);
}
