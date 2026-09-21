import { supabase } from "@/lib/db/supabase";
import type { KidId } from "@/lib/features/kids-schedule/config";
import type { Database } from "@/types/database";

export type KidLesson = Database["public"]["Tables"]["kid_lessons"]["Row"];
export type KidActivity = Database["public"]["Tables"]["kid_activities"]["Row"];
export type KidHomework = Database["public"]["Tables"]["kid_homework"]["Row"];
export type KidGrade = Database["public"]["Tables"]["kid_grades"]["Row"];
export type KidChatMessage = Database["public"]["Tables"]["kid_chat_messages"]["Row"];
export type KidChatAttachment = Database["public"]["Tables"]["kid_chat_attachments"]["Row"];

export type KidsState = {
  lessons: KidLesson[];
  activities: KidActivity[];
  homework: KidHomework[];
  grades: KidGrade[];
  messages: (KidChatMessage & { attachments: KidChatAttachment[] })[];
};

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Ошибка Supabase");
}

export async function loadKidsState(): Promise<KidsState> {
  const [lessons, activities, homework, grades, messages, attachments] = await Promise.all([
    supabase.from("kid_lessons").select("*").order("start_time"),
    supabase.from("kid_activities").select("*").order("start_time"),
    supabase.from("kid_homework").select("*").order("due_date"),
    supabase.from("kid_grades").select("*").order("graded_on", { ascending: false }),
    supabase.from("kid_chat_messages").select("*").order("sent_at", { ascending: true }),
    supabase.from("kid_chat_attachments").select("*"),
  ]);

  if (lessons.error) fail(lessons.error);
  if (activities.error) fail(activities.error);
  if (homework.error) fail(homework.error);
  if (grades.error) fail(grades.error);
  if (messages.error) fail(messages.error);
  if (attachments.error) fail(attachments.error);

  const byMessage = new Map<string, KidChatAttachment[]>();
  for (const row of attachments.data ?? []) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }

  return {
    lessons: lessons.data ?? [],
    activities: activities.data ?? [],
    homework: homework.data ?? [],
    grades: grades.data ?? [],
    messages: (messages.data ?? []).map((row) => ({
      ...row,
      attachments: byMessage.get(row.id) ?? [],
    })),
  };
}

export async function insertKidLesson(input: {
  childId: KidId;
  weekday: number;
  start: string;
  end: string;
  subject: string;
  room?: string;
}) {
  const { error } = await supabase.from("kid_lessons").insert({
    child_id: input.childId,
    weekday: input.weekday,
    start_time: input.start,
    end_time: input.end,
    subject: input.subject,
    room: input.room || null,
  });
  if (error) fail(error);
}

export async function insertKidActivity(input: {
  childId: KidId;
  weekday?: number;
  date?: string;
  start: string;
  end: string;
  title: string;
  place?: string;
}) {
  const { error } = await supabase.from("kid_activities").insert({
    child_id: input.childId,
    weekday: input.weekday ?? null,
    on_date: input.date || null,
    start_time: input.start,
    end_time: input.end,
    title: input.title,
    place: input.place || null,
  });
  if (error) fail(error);
}

export async function insertKidHomework(input: {
  childId: KidId;
  subject: string;
  title: string;
  dueDate: string;
}) {
  const { error } = await supabase.from("kid_homework").insert({
    child_id: input.childId,
    subject: input.subject,
    title: input.title,
    due_date: input.dueDate,
    done: false,
  });
  if (error) fail(error);
}

export async function insertKidGrade(input: {
  childId: KidId;
  subject: string;
  value: string;
  date: string;
  comment?: string;
}) {
  const { error } = await supabase.from("kid_grades").insert({
    child_id: input.childId,
    subject: input.subject,
    value: input.value,
    graded_on: input.date,
    comment: input.comment || null,
  });
  if (error) fail(error);
}

export async function setKidHomeworkDone(id: string, done: boolean) {
  const { error } = await supabase.from("kid_homework").update({ done }).eq("id", id);
  if (error) fail(error);
}

export async function deleteKidItem(
  type: "lesson" | "activity" | "homework" | "grade",
  id: string,
) {
  const table =
    type === "lesson"
      ? "kid_lessons"
      : type === "activity"
        ? "kid_activities"
        : type === "homework"
          ? "kid_homework"
          : "kid_grades";
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) fail(error);
}

export async function upsertKidChatMessage(input: {
  childId: KidId;
  maxChatId: string;
  messageId: string;
  fromId?: string;
  fromName: string;
  body: string;
  sentAt: string;
  status?: "edited" | "removed" | null;
  raw?: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from("kid_chat_messages")
    .upsert(
      {
        child_id: input.childId,
        max_chat_id: input.maxChatId,
        message_id: input.messageId,
        from_id: input.fromId ?? null,
        from_name: input.fromName,
        body: input.body,
        sent_at: input.sentAt,
        status: input.status ?? null,
        raw: input.raw ?? null,
      },
      { onConflict: "max_chat_id,message_id" },
    )
    .select("id")
    .single();
  if (error) fail(error);
  return data;
}
