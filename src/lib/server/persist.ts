// Хранение на диске: живые краулеры, их сигналы, использованные платёжные транзакции, балансы.
// Демо-сеть не сохраняется — она детерминированно пересоздаётся при старте.
// Пишем один JSON атомарно (tmp + rename) с задержкой, чтобы не дёргать диск на каждый тик.
import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Crawler, Signal } from "../types";

export interface Snapshot {
  version: 1;
  crawlers: Crawler[];
  signals: Signal[];
  usedSigs: string[];
  balances: Record<string, number>;
  burnedBy: Record<string, number>;
  meta: Record<string, string>;
}

const EMPTY: Snapshot = { version: 1, crawlers: [], signals: [], usedSigs: [], balances: {}, burnedBy: {}, meta: {} };

function file() {
  const dir = process.env.DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
  return { dir, file: path.join(dir, "state.json") };
}

export function loadSnapshot(): Snapshot {
  const { file: f } = file();
  try {
    if (!existsSync(f)) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(f, "utf8")) };
  } catch (e) {
    console.error("persist: failed to read state, starting empty", e);
    return structuredClone(EMPTY);
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

// getSnapshot вызывается в момент записи, а не в момент пометки — пишем самое свежее.
export function scheduleSave(getSnapshot: () => Snapshot, delayMs = 2000) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      const { dir, file: f } = file();
      mkdirSync(dir, { recursive: true });
      const tmp = `${f}.tmp`;
      writeFileSync(tmp, JSON.stringify(getSnapshot()));
      renameSync(tmp, f);
    } catch (e) {
      console.error("persist: failed to write state", e);
    }
  }, delayMs);
}
