/**
 * Собирает JSON из CSV в docs/.../resources для бандла и предзаполнения UI.
 * Запуск: npm run build:seed
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseGymCsv,
  parseSwimCsv,
  type ParsedGymWorkout,
  type ParsedSwimWorkout,
} from "../src/lib/features/workouts/csvImport";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const res = join(
  root,
  "docs/features/workout-tracker/current_stat/resources"
);

const GYM_FILES: Record<string, string> = {
  pn: "тренировки.xlsx - пн (1).csv",
  sr: "тренировки.xlsx - ср.csv",
  pt: "тренировки.xlsx - пт.csv",
};

const SWIM_FILES: Record<string, string> = {
  vt: "тренировки.xlsx - вт.csv",
  cht: "тренировки.xlsx - чт.csv",
  sb: "тренировки.xlsx - сб.csv",
};

const gym: Record<string, ParsedGymWorkout[]> = {};
for (const [key, fname] of Object.entries(GYM_FILES)) {
  const text = readFileSync(join(res, fname), "utf-8");
  gym[key] = parseGymCsv(text);
  console.log(`gym ${key}: ${gym[key].length} тренировок`);
}

const swim: Record<string, ParsedSwimWorkout[]> = {};
for (const [key, fname] of Object.entries(SWIM_FILES)) {
  const text = readFileSync(join(res, fname), "utf-8");
  swim[key] = parseSwimCsv(text);
  console.log(`swim ${key}: ${swim[key].length} тренировок`);
}

const outDir = join(root, "public/data");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "workout-seed.json");
writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), gym, swim }, null, 2),
  "utf-8"
);
console.log("written", outPath);
