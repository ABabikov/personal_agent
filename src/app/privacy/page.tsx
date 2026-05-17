import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Personal Agent",
  description: "Обработка персональных данных в приложении Personal Agent",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="mb-6 text-2xl font-semibold">Политика конфиденциальности</h1>
      <p className="mb-4 text-muted-foreground">
        Действует для веб-приложения Personal Agent (
        <a
          href="https://personal-agent-zeta.vercel.app"
          className="text-primary underline"
        >
          personal-agent-zeta.vercel.app
        </a>
        ). Приложение предназначено для личного учёта тренировок.
      </p>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Какие данные обрабатываются</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Данные профиля: вес, рост, возраст, пол, уровень активности (по желанию).</li>
          <li>Журнал тренировок: зал, плавание, заметки, расчётные калории.</li>
          <li>
            При подключении Huawei Health — только после вашего согласия в OAuth:
            записи тренировок, длительность, калории с устройства, средний пульс (если
            доступны в API).
          </li>
          <li>Технические данные: cookie сессии при включённой защите паролем сайта.</li>
        </ul>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Зачем</h2>
        <p className="text-muted-foreground">
          Данные используются для отображения календаря тренировок, расчёта расхода
          калорий и сопоставления записей с данными с часов Huawei. Данные не
          продаются и не передаются третьим лицам в маркетинговых целях.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Хранение</h2>
        <p className="text-muted-foreground">
          Данные хранятся в облачной базе Supabase, выбранной владельцем приложения.
          Токены доступа Huawei Health хранятся на сервере приложения и не
          отображаются в интерфейсе браузера.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Huawei Health</h2>
        <p className="text-muted-foreground">
          Интеграция с Huawei Health Kit выполняется только после явного нажатия
          «Подключить» в профиле и согласия на стороне Huawei. Отключить доступ
          можно в приложении (кнопка «Отключить») и в настройках Huawei ID /
          Huawei Health.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Отзыв согласия</h2>
        <p className="text-muted-foreground">
          Вы можете прекратить обработку, отключив Huawei Health в профиле или
          удалив данные в Supabase через владельца инстанса приложения.
        </p>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-base font-medium">Контакты</h2>
        <p className="text-muted-foreground">
          По вопросам обработки данных обращайтесь к владельцу развёрнутого
          экземпляра приложения (оператор персональных данных для данного деплоя).
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        <Link href="/terms" className="text-primary underline">
          Пользовательское соглашение
        </Link>
        {" · "}
        <Link href="/" className="text-primary underline">
          На главную
        </Link>
      </p>
    </main>
  );
}
