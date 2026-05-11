import { WebShell } from "./web-shell";

export default function WebLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WebShell>{children}</WebShell>;
}
