import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Пользовательское соглашение — Personal Agent",
  description: "Условия использования Personal Agent",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="mb-6 text-2xl font-semibold">Пользовательское соглашение</h1>
      <p className="mb-4 text-muted-foreground">
        Используя Personal Agent (
        <a
          href="https://personal-agent-zeta.vercel.app"
          className="text-primary underline"
        >
          personal-agent-zeta.vercel.app
        </a>
        ), вы соглашаетесь с условиями ниже.
      </p>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Назначение сервиса</h2>
        <p className="text-muted-foreground">
          Приложение — личный дневник тренировок (силовые, плавание), расчёт
          калорий и опциональная синхронизация с Huawei Health. Это не медицинский
          сервис и не замена консультации врача.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Точность данных</h2>
        <p className="text-muted-foreground">
          Показатели с часов и расчётные калории (MET) носят справочный характер.
          Владелец деплоя не гарантирует полноту и точность данных из сторонних API.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Huawei Health</h2>
        <p className="text-muted-foreground">
          Доступ к данным Huawei предоставляется сервисами Huawei по их правилам.
          Вы отвечаете за безопасность своего Huawei ID и устройств.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-base font-medium">Ограничение ответственности</h2>
        <p className="text-muted-foreground">
          Сервис предоставляется «как есть». Владелец инстанса не несёт
          ответственности за решения, принятые на основе данных приложения.
        </p>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-base font-medium">Изменения</h2>
        <p className="text-muted-foreground">
          Условия могут обновляться при изменении функциональности. Актуальная
          версия публикуется на этой странице.
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        <Link href="/privacy" className="text-primary underline">
          Политика конфиденциальности
        </Link>
        {" · "}
        <Link href="/" className="text-primary underline">
          На главную
        </Link>
      </p>
    </main>
  );
}
