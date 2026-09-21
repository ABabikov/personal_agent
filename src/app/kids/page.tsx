import type { Metadata } from "next";
import { KidsApp } from "@/components/kids/kids-app";

export const metadata: Metadata = {
  title: "Расписание детей",
};

export default function KidsPage() {
  return <KidsApp />;
}
