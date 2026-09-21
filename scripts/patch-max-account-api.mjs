/**
 * max-account-api 0.1.1 шлёт HELLO как Android 26.15.1 (июнь 2026).
 * Сейчас Max отвечает client.unsupported-version — патчим версию на 26.32.1 / 6831
 * той же длины, чтобы msgpack-шаблон HELLO не разъехался.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "node_modules/max-account-api/dist");
const files = {
  raw: resolve(root, "raw-transport.js"),
  auth: resolve(root, "auth.js"),
};

if (!existsSync(files.raw)) {
  console.warn("[patch-max-account-api] пакет не установлен, пропускаю");
  process.exit(0);
}

function patch(file, replacements) {
  let text = readFileSync(file, "utf8");
  let changed = 0;
  for (const [from, to] of replacements) {
    if (text.includes(to) && !text.includes(from)) continue;
    if (!text.includes(from)) continue;
    text = text.split(from).join(to);
    changed += 1;
  }
  if (changed > 0) writeFileSync(file, text, "utf8");
  return changed;
}

const rawChanged = patch(files.raw, [
  ["a732362e31352e31", "a732362e33322e31"],
  ["ab6275696c644e756d626572cd1a22", "ab6275696c644e756d626572cd1aaf"],
  ["v26.15.1 (build 6690)", "v26.32.1 (build 6831)"],
]);

const authChanged = existsSync(files.auth)
  ? patch(files.auth, [["appVersion: '26.5.5'", "appVersion: '26.32.1'"]])
  : 0;

console.log(`[patch-max-account-api] raw=${rawChanged} auth=${authChanged}`);
