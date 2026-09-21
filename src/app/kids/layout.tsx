import type { ReactNode } from "react";

export default function KidsLayout({ children }: { children: ReactNode }) {
  return <div className="kids-shell min-h-dvh bg-[#f3efe6] text-stone-900">{children}</div>;
}
