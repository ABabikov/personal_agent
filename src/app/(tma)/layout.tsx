export default function TmaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-4">
      <main>{children}</main>
    </div>
  );
}
