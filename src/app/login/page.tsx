"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next")?.startsWith("/") ? searchParams.get("next")! : "/";
  const errParam = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    errParam === "config" ? "Сервер: задайте SITE_AUTH_SECRET вместе с SITE_PASSWORD." : null
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      window.location.href = nextPath;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Вход</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Введите пароль, чтобы открыть приложение.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw">Пароль</Label>
            <Input
              id="pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
              required
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Вход…" : "Войти"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Загрузка…</div>}>
      <LoginForm />
    </Suspense>
  );
}
