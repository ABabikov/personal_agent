import { MessageSquare, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15">
          <MessageSquare className="size-5 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">Чат с Jarvis</h1>
      </div>

      {/* Coming soon */}
      <Card>
        <CardContent className="py-12 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Скоро</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
            AI-ассистент для анализа прогресса и корректировки программы тренировок
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              "Проанализируй мой прогресс",
              "Как улучшить жим?",
              "Статистика за месяц",
            ].map((hint) => (
              <span
                key={hint}
                className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground"
              >
                {hint}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
