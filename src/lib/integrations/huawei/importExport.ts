import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mapMotionPathToSession, type HuaweiMotionPathRecord } from "@/lib/integrations/huawei/parseMotionPath";
import { upsertDeviceSession } from "@/lib/integrations/huawei/storage";
import { autoLinkSessionsForUser } from "@/lib/integrations/huawei/linkSessions";

export type ExportImportResult = {
  filesScanned: number;
  filesParsed: number;
  filesSkipped: number;
  sessionsFound: number;
  upserted: number;
  linked: number;
  errors: string[];
};

const MOTION_DIR = "Motion path detail data & description";

function loadMotionPathJson(filePath: string): HuaweiMotionPathRecord[] | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as HuaweiMotionPathRecord[];
  } catch {
    return null;
  }
}

/**
 * Imports workout sessions from Huawei personal data export (motion path JSON only).
 * Does not import «Sport per minute» — those are per-minute fragments, not sessions.
 */
export async function importHuaweiMotionPathExport(
  userId: string,
  exportRootDir: string
): Promise<ExportImportResult> {
  const motionDir = join(exportRootDir, MOTION_DIR);
  if (!existsSync(motionDir)) {
    throw new Error(`Нет папки: ${motionDir}`);
  }

  const result: ExportImportResult = {
    filesScanned: 0,
    filesParsed: 0,
    filesSkipped: 0,
    sessionsFound: 0,
    upserted: 0,
    linked: 0,
    errors: [],
  };

  const sessionIds: string[] = [];
  const seenExternal = new Set<string>();

  const files = readdirSync(motionDir).filter(
    (f) => f.toLowerCase().endsWith(".json") && f.toLowerCase().includes("motion path")
  );

  for (const file of files) {
    result.filesScanned++;
    const fp = join(motionDir, file);
    const rows = loadMotionPathJson(fp);
    if (!rows) {
      result.filesSkipped++;
      result.errors.push(`skip (invalid JSON): ${file}`);
      continue;
    }
    result.filesParsed++;

    for (const row of rows) {
      result.sessionsFound++;
      const mapped = mapMotionPathToSession(row);
      if (!mapped) continue;
      if (seenExternal.has(mapped.external_id)) continue;
      seenExternal.add(mapped.external_id);

      try {
        const saved = await upsertDeviceSession(userId, mapped);
        sessionIds.push(saved.id);
        result.upserted++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`${file} ${mapped.external_id}: ${msg}`);
      }
    }
  }

  result.linked = await autoLinkSessionsForUser(userId, sessionIds);
  return result;
}
