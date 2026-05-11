"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

export type ChatBubble =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; steps?: AssistantStep[] }
  | { role: "error"; text: string };

export type AssistantStep = {
  iteration: number;
  modelUsed: string;
  toolCalls: { name: string; args: string; ok: boolean; payload: unknown }[];
};

export function ChatBubbleView({ bubble }: { bubble: ChatBubble }) {
  if (bubble.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">
          {bubble.text}
        </div>
      </div>
    );
  }
  if (bubble.role === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
          Ошибка: {bubble.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">
        {bubble.steps && bubble.steps.some((s) => s.toolCalls.length > 0) && (
          <ToolTrace steps={bubble.steps} />
        )}
        <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {bubble.text}
        </div>
      </div>
    </div>
  );
}

function ToolTrace({ steps }: { steps: AssistantStep[] }) {
  const [open, setOpen] = useState(false);
  const totalCalls = steps.reduce((a, s) => a + s.toolCalls.length, 0);
  return (
    <div className="rounded-xl border bg-card text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Wrench className="size-3" />
        Tool calls: {totalCalls}
        <span className="ml-auto">{steps[steps.length - 1]?.modelUsed}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {steps.map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Шаг {s.iteration} · {s.modelUsed}
              </div>
              {s.toolCalls.map((tc, j) => (
                <details key={j} className="rounded-md bg-muted/50 px-2 py-1">
                  <summary
                    className={`cursor-pointer font-mono ${
                      tc.ok ? "text-foreground" : "text-destructive"
                    }`}
                  >
                    {tc.name}
                    {!tc.ok && " (error)"}
                  </summary>
                  <div className="mt-1 space-y-1">
                    <div>
                      <div className="text-muted-foreground">args:</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                        {tc.args}
                      </pre>
                    </div>
                    <div>
                      <div className="text-muted-foreground">result:</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(tc.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
