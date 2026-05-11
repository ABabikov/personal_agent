import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface QuickActionProps {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  variant?: "gym" | "swim";
  className?: string;
}

export function QuickAction({
  href,
  icon: Icon,
  title,
  subtitle,
  variant = "gym",
  className,
}: QuickActionProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-border p-4 transition-all active:scale-[0.98]",
        variant === "gym" && "bg-gym/10 hover:bg-gym/15 border-gym/20",
        variant === "swim" && "bg-swim/10 hover:bg-swim/15 border-swim/20",
        className
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full transition-transform group-hover:scale-110",
          variant === "gym" && "bg-gym text-gym-foreground",
          variant === "swim" && "bg-swim text-swim-foreground"
        )}
      >
        <Icon className="size-5" />
      </div>
      <span className="text-sm font-medium">{title}</span>
      {subtitle && (
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      )}
    </Link>
  );
}
