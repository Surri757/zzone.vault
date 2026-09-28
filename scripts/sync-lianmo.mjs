/**
 * 炼墨同步：把本地教学工作区（D:\agent 学习）的课程资产
 * 复制进 public/lianmo/，随 `npm run deploy` 一起上线。
 *
 * 用法：npm run sync:lianmo
 * 之后再执行 npm run deploy 即完成线上更新。
 */
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = "D:/agent 学习";
const DEST = join(here, "..", "public", "lianmo");
const ITEMS = ["index.html", "lessons", "reference"];

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

for (const item of ITEMS) {
  cpSync(join(SRC, item), join(DEST, item), { recursive: true });
}

console.log(`✓ 炼墨已同步：${ITEMS.join(", ")} → public/lianmo/`);
console.log("  下一步：npm run deploy 上线");
