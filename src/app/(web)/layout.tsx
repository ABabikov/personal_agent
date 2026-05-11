import Link from "next/link";

export default function WebLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Personal Agent</h1>
        <nav className="mt-2 flex gap-4 text-sm">
          <Link href="/" className="hover:underline">Календарь</Link>
          <Link href="/gym" className="hover:underline">Зал</Link>
          <Link href="/swim" className="hover:underline">Плавание</Link>
          <Link href="/profile" className="hover:underline">Профиль</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
