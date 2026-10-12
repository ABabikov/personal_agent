"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_MS = 5 * 60 * 1000;

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

export function DictationButton({
  disabled,
  onText,
}: {
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const onTextRef = useRef(onText);
  const aliveRef = useRef(true);
  onTextRef.current = onText;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder) recorder.onstop = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function stopRecording() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  async function upload(blob: Blob) {
    setPhase("transcribing");
    setError(null);
    try {
      const body = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      body.set("audio", blob, `dictation.${ext}`);
      const res = await fetch("/api/chat/transcribe", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const text = data?.text?.trim() ?? "";
      if (!text) throw new Error("Пустая расшифровка.");
      if (aliveRef.current) onTextRef.current(text);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setPhase("idle");
    }
  }

  async function start() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("В этом браузере нет записи с микрофона.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        void upload(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
      timerRef.current = window.setTimeout(stopRecording, MAX_MS);
    } catch {
      setError("Нет доступа к микрофону.");
      setPhase("idle");
    }
  }

  const busy = phase === "transcribing";
  const recording = phase === "recording";

  return (
    <div className="flex shrink-0 flex-col items-center">
      <Button
        type="button"
        variant={recording ? "destructive" : "outline"}
        size="icon"
        disabled={disabled || busy}
        aria-pressed={recording}
        aria-label={recording ? "Остановить диктовку" : "Диктовать"}
        title={error ?? (recording ? "Остановить" : busy ? "Расшифровка…" : "Диктовать")}
        onClick={() => {
          if (recording) stopRecording();
          else void start();
        }}
      >
        {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
      </Button>
      {error && (
        <p className="mt-1 max-w-40 text-center text-[10px] leading-tight text-destructive">{error}</p>
      )}
    </div>
  );
}
