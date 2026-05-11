import { Header } from "@/components/navigation/header";
import { BottomNav } from "@/components/navigation/bottom-nav";

export default function WebLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Header />
      <main className="flex-1 px-4 pb-20 pt-4">
        <div className="mx-auto max-w-lg">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
