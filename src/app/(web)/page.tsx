import Link from "next/link";
import { Dumbbell, Waves, CalendarDays } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5" />
        <h2 className="text-xl font-semibold">Спортивный календарь</h2>
      </div>

      {/* Статистика недели (заглушки) */}
      <div className="grid grid-cols-3 gap-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold">0</p>
            <p className="text-xs text-muted-foreground mt-0.5">тренировок</p>
            <p className="text-xs text-muted-foreground">на этой неделе</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold">0</p>
            <p className="text-xs text-muted-foreground mt-0.5">кг тоннаж</p>
            <p className="text-xs text-muted-foreground">за неделю</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold">0</p>
            <p className="text-xs text-muted-foreground mt-0.5">м метраж</p>
            <p className="text-xs text-muted-foreground">за неделю</p>
          </CardContent>
        </Card>
      </div>

      {/* Быстрые действия */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/gym"
          className={cn(
            buttonVariants({ size: "lg", variant: "default" }),
            "h-auto py-4 flex-col gap-1"
          )}
        >
          <Dumbbell className="size-5" />
          <span>Добавить</span>
          <span className="text-xs opacity-80 font-normal">силовую</span>
        </Link>
        <Link
          href="/swim"
          className={cn(
            buttonVariants({ size: "lg", variant: "outline" }),
            "h-auto py-4 flex-col gap-1"
          )}
        >
          <Waves className="size-5" />
          <span>Добавить</span>
          <span className="text-xs opacity-70 font-normal">плавание</span>
        </Link>
      </div>

      {/* Пустое состояние */}
      <Card>
        <CardHeader>
          <CardTitle>История тренировок</CardTitle>
          <CardDescription>
            Здесь будут отображаться все тренировки в хронологическом порядке.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            Тренировок пока нет.
            <br />
            Добавьте первую тренировку через кнопки выше.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
