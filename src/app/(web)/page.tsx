import { Dumbbell, Waves, Flame, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { QuickAction } from "@/components/dashboard/quick-action";
import { WorkoutItem } from "@/components/dashboard/workout-item";

export default function HomePage() {
  // Mock data - will be replaced with real data from Supabase
  const weeklyStats = {
    workouts: 0,
    tonnage: 0,
    distance: 0,
    calories: 0,
  };

  const recentWorkouts: {
    id: string;
    type: "gym" | "swim";
    date: string;
    value: number;
    unit: string;
    exercises?: number;
  }[] = [];

  return (
    <div className="space-y-6">
      {/* Week stats */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Эта неделя
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={TrendingUp}
            label="Тренировок"
            value={weeklyStats.workouts}
            variant="default"
          />
          <StatCard
            icon={Flame}
            label="Калорий"
            value={weeklyStats.calories}
            unit="ккал"
            variant="default"
          />
          <StatCard
            icon={Dumbbell}
            label="Тоннаж"
            value={weeklyStats.tonnage.toLocaleString("ru")}
            unit="кг"
            variant="gym"
          />
          <StatCard
            icon={Waves}
            label="Метраж"
            value={weeklyStats.distance.toLocaleString("ru")}
            unit="м"
            variant="swim"
          />
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Добавить тренировку
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction
            href="/gym"
            icon={Dumbbell}
            title="Силовая"
            subtitle="Зал"
            variant="gym"
          />
          <QuickAction
            href="/swim"
            icon={Waves}
            title="Плавание"
            subtitle="Бассейн"
            variant="swim"
          />
        </div>
      </section>

      {/* Recent workouts */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          История тренировок
        </h2>
        {recentWorkouts.length > 0 ? (
          <div className="space-y-2">
            {recentWorkouts.map((workout) => (
              <WorkoutItem
                key={workout.id}
                type={workout.type}
                date={workout.date}
                value={workout.value}
                unit={workout.unit}
                exercises={workout.exercises}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
              <TrendingUp className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Тренировок пока нет
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Добавьте первую тренировку через кнопки выше
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
