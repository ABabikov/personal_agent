/**
 * Диктовка: аудио → текст через Qwen3-ASR-Flash (DashScope).
 * Чат-модели qwen-plus речь не принимают. Ключ тот же, что у Qwen-чата.
 */

const ASR_MODEL = "qwen3-asr-flash";
const DASHSCOPE_INTL_ORIGIN = "https://dashscope-intl.aliyuncs.com";
/** Исходный файл. Base64 раздувает его примерно на треть, лимит модели — 10 МБ уже в data-URL. */
const MAX_AUDIO_BYTES = 7_000_000;

const GLOSSARY =
  "Дневник питания и тренировки. Слова: завтрак, обед, ужин, полдник, перекус, граммы, " +
  "овсяная каша, банан, говядина тушёная, рис, картофель запечённый, пекинская капуста, салат, " +
  "яблоко, апельсин, трицепс, бицепс, жим, тяга, присед, подход, плавание, кроль, брасс.";

function asrOrigin(): string {
  const override =
    process.env.LLM_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim() || "";
  if (override && /dashscope|aliyuncs|qwen|maas/i.test(override)) {
    try {
      return new URL(override).origin;
    } catch {
      return DASHSCOPE_INTL_ORIGIN;
    }
  }
  return DASHSCOPE_INTL_ORIGIN;
}

export function asrCredentials(): { endpoint: string; apiKey: string } | { error: string } {
  const apiKey =
    process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || "";
  if (!apiKey) {
    return {
      error:
        "Диктовка не настроена: нужен QWEN_API_KEY или DASHSCOPE_API_KEY (модель qwen3-asr-flash).",
    };
  }
  const endpoint = `${asrOrigin()}/api/v1/services/aigc/multimodal-generation/generation`;
  return { endpoint, apiKey };
}

function mimeForDataUrl(raw: string): string {
  const base = raw.split(";")[0]?.trim().toLowerCase() || "";
  if (base === "audio/webm" || base === "video/webm") return "audio/webm";
  if (base === "audio/ogg") return "audio/ogg";
  if (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") return "audio/mp4";
  if (base === "audio/wav" || base === "audio/x-wav") return "audio/wav";
  if (base === "audio/mpeg" || base === "audio/mp3") return "audio/mpeg";
  return "audio/webm";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

export async function transcribeAudio(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ text: string } | { error: string }> {
  if (bytes.byteLength < 800) {
    return { error: "Запись слишком короткая." };
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return { error: "Запись длиннее лимита. Разбей фразу на части." };
  }

  const creds = asrCredentials();
  if ("error" in creds) return creds;

  const dataUrl = `data:${mimeForDataUrl(mimeType)};base64,${Buffer.from(bytes).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(creds.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ASR_MODEL,
        input: {
          messages: [
            { role: "system", content: [{ text: GLOSSARY }] },
            { role: "user", content: [{ audio: dataUrl }] },
          ],
        },
        parameters: {
          result_format: "message",
          asr_options: { language: "ru", enable_itn: false },
        },
      }),
    });

    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const message =
        typeof raw?.message === "string"
          ? raw.message
          : typeof raw?.code === "string"
            ? raw.code
            : `HTTP ${response.status}`;
      return { error: `Расшифровка не удалась: ${message}` };
    }

    const output = raw?.output as { choices?: { message?: { content?: unknown } }[] } | undefined;
    const text = textFromContent(output?.choices?.[0]?.message?.content);
    if (!text) return { error: "Модель вернула пустую расшифровку." };
    return { text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(message)) return { error: "Расшифровка не успела ответить." };
    return { error: message };
  } finally {
    clearTimeout(timer);
  }
}
