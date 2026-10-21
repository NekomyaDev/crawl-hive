// Память кошельков роя в SQLite (DATA_DIR/brain.db) вместо meta walletMem с потолком 8000 кошельков × 20 токенов.
// wallet_roles — роль кошелька в токене (одна на пару кошелёк+токен), op_members — группы связанных кошельков одного
// токена (оператор скана). Раз в 10 минут из групп собираются операторы между токенами: кошельки, которые оказывались
// в одной группе на 2+ разных токенах, сливаются (union-find) в постоянного оператора op_<хэш>.
// Встроенный node:sqlite: без нативных модулей. Не открылась база — memDb() вернёт null, и память читается из meta как раньше.
import "server-only";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

export type MemRole = "sniper" | "bundle" | "dev" | "funder" | "holder" | "linked";
export interface MemRow {
  wallet: string;
  token: string;
  chain: string;
  role: MemRole;
  at: number;
}

const OPS_EVERY = 10 * 60_000;
// Кошелёк, который был в группах больше чем на HUB_TOKENS токенах, скорее роутер или общий сервис, а не чей-то оператор.
const HUB_TOKENS = 60;
// Пары внутри огромной группы не строим: это уже не «свои» кошельки, а шум.
const GROUP_MAX = 60;

interface Db {
  db: DatabaseSync;
  put: StatementSync;
  member: StatementSync;
  byWallets: StatementSync;
  count: StatementSync;
}
const host = globalThis as unknown as { __crawlhiveMemDb?: Db | null; __crawlhiveOps?: Ops };
let opsTimer: ReturnType<typeof setInterval> | undefined;

export function memDb(): Db | null {
  if (host.__crawlhiveMemDb !== undefined) return host.__crawlhiveMemDb;
  try {
    // getBuiltinModule, а не import: сборщик не трогает node:sqlite, а без него (старый Node) просто откатываемся на meta.
    const mod = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!mod) throw new Error("node:sqlite is not available in this Node version");
    const { DatabaseSync } = mod;
    const dir = process.env.DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "brain.db"));
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS wallet_roles (wallet TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (wallet, token)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS wallet_roles_token ON wallet_roles (token);
      CREATE TABLE IF NOT EXISTS op_members (token TEXT NOT NULL, grp TEXT NOT NULL, wallet TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (token, grp, wallet)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS op_members_wallet ON op_members (wallet);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS watch (owner TEXT NOT NULL, target TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (owner, target)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS watch_target ON watch (target);
      CREATE TABLE IF NOT EXISTS watch_alerts (owner TEXT NOT NULL, target TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (owner, target, token)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS watch_alerts_owner ON watch_alerts (owner, at);
    `);
    host.__crawlhiveMemDb = {
      db,
      put: db.prepare("INSERT INTO wallet_roles (wallet, token, chain, role, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (wallet, token) DO UPDATE SET chain = excluded.chain, role = excluded.role, at = excluded.at"),
      member: db.prepare("INSERT OR IGNORE INTO op_members (token, grp, wallet, at) VALUES (?, ?, ?, ?)"),
      byWallets: db.prepare("SELECT wallet, token, chain, role, at FROM wallet_roles WHERE wallet IN (SELECT value FROM json_each(?)) ORDER BY at"),
      count: db.prepare("SELECT COUNT(DISTINCT wallet) AS n FROM wallet_roles"),
    };
    opsTimer ??= setInterval(() => rebuildOperators(), OPS_EVERY);
    opsTimer.unref?.();
  } catch (e) {
    console.warn("[memory] SQLite unavailable, falling back to meta:", (e as Error).message);
    host.__crawlhiveMemDb = null;
  }
  return host.__crawlhiveMemDb;
}

function tx(db: DatabaseSync, fn: () => void) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Запись одного скана: роли кошельков и группы связанных кошельков (по 2+ кошелька).
export function writeScan(d: Db, token: string, chain: string, roles: Map<string, MemRole>, groups: string[][] = []) {
  const at = Date.now();
  tx(d.db, () => {
    for (const [w, r] of roles) d.put.run(w, token, chain, r, at);
    groups.forEach((g, i) => {
      const ws = [...new Set(g)];
      if (ws.length < 2 || ws.length > GROUP_MAX) return;
      for (const w of ws) d.member.run(token, `g${i}`, w, at);
    });
  });
}

export function rowsFor(d: Db, wallets: string[]): MemRow[] {
  if (!wallets.length) return [];
  return d.byWallets.all(JSON.stringify(wallets)) as unknown as MemRow[];
}

export const walletCount = (d: Db) => Number((d.count.get() as { n: number }).n);

// Перенос старой памяти из meta: idempotent, второй раз ничего не меняет. У старых записей нет времени и групп:
// время берём из Track Record (или 0), группой токена считаем его держателей, бандлы, спонсоров и девов. Снайперов
// в общую группу не кладём: одни и те же снайпер-боты есть почти на каждом токене, они склеили бы всех.
export function migrateLegacy(d: Db, legacy: Record<string, (string | { t: string; c: string; r: MemRole })[]>, timeOf: (token: string) => number) {
  const done = d.db.prepare("SELECT v FROM kv WHERE k = 'migrated_walletMem'").get() as { v: string } | undefined;
  if (done) return 0;
  const ins = d.db.prepare("INSERT OR IGNORE INTO wallet_roles (wallet, token, chain, role, at) VALUES (?, ?, ?, ?, ?)");
  const groups = new Map<string, Set<string>>();
  let n = 0;
  tx(d.db, () => {
    for (const [w, list] of Object.entries(legacy)) {
      for (const raw of list ?? []) {
        const e = typeof raw === "string" ? { t: raw, c: "solana", r: "linked" as MemRole } : raw;
        ins.run(w, e.t, e.c, e.r, timeOf(e.t));
        if (e.r === "holder" || e.r === "bundle" || e.r === "funder" || e.r === "dev") groups.set(e.t, (groups.get(e.t) ?? new Set()).add(w));
      }
      n++;
    }
    for (const [t, ws] of groups) if (ws.size >= 2 && ws.size <= GROUP_MAX) for (const w of ws) d.member.run(t, "legacy", w, timeOf(t));
    d.db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('migrated_walletMem', ?)").run(String(Date.now()));
  });
  console.log(`[memory] migrated ${n} wallets from meta walletMem`);
  return n;
}

// ---------- операторы между токенами ----------

export interface Operator {
  id: string;
  wallets: string[];
}
interface Ops {
  at: number;
  byWallet: Map<string, string>;
  byId: Map<string, Operator>;
}

// Кошельки, бывшие в одной группе на 2+ разных токенах, — одно ребро; компоненты связности — операторы.
// id — хэш наименьшего кошелька компоненты: стабилен, пока компонента не слилась с другой.
export function rebuildOperators(): Ops {
  const d = memDb();
  const empty: Ops = { at: Date.now(), byWallet: new Map(), byId: new Map() };
  if (!d) return (host.__crawlhiveOps = empty);
  try {
    const hubs = new Set(
      (d.db.prepare(`SELECT wallet FROM op_members GROUP BY wallet HAVING COUNT(DISTINCT token) > ${HUB_TOKENS}`).all() as { wallet: string }[]).map((r) => r.wallet),
    );
    const pairs = d.db
      .prepare(
        `SELECT a.wallet AS a, b.wallet AS b FROM op_members a JOIN op_members b ON a.token = b.token AND a.grp = b.grp AND a.wallet < b.wallet
         GROUP BY a.wallet, b.wallet HAVING COUNT(DISTINCT a.token) >= 2`,
      )
      .all() as { a: string; b: string }[];
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      while (parent.get(x) !== r) {
        const n = parent.get(x)!;
        parent.set(x, r);
        x = n;
      }
      return r;
    };
    for (const { a, b } of pairs) {
      if (hubs.has(a) || hubs.has(b)) continue;
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
    const comps = new Map<string, string[]>();
    for (const w of parent.keys()) comps.set(find(w), [...(comps.get(find(w)) ?? []), w]);
    const ops: Ops = { at: Date.now(), byWallet: new Map(), byId: new Map() };
    for (const [root, ws] of comps) {
      const id = `op_${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;
      ops.byId.set(id, { id, wallets: ws.sort() });
      for (const w of ws) ops.byWallet.set(w, id);
    }
    host.__crawlhiveOps = ops;
    return ops;
  } catch (e) {
    console.warn("[memory] operators:", (e as Error).message);
    return (host.__crawlhiveOps = host.__crawlhiveOps ?? empty);
  }
}

export function operators(): Ops {
  const o = host.__crawlhiveOps;
  return o && Date.now() - o.at < OPS_EVERY + 60_000 ? o : rebuildOperators();
}

// Токены, на которых кошельки оператора были вместе в группе (а не просто где-то по отдельности).
export function operatorTokens(d: Db, wallets: string[]): { token: string; at: number }[] {
  return d.db
    .prepare("SELECT token, MIN(at) AS at FROM op_members WHERE wallet IN (SELECT value FROM json_each(?)) GROUP BY token")
    .all(JSON.stringify(wallets)) as { token: string; at: number }[];
}

// ---------- watchlist кошельков (Pro): кто за кем следит и о чём уже предупредили ----------

export interface WatchRow { owner: string; target: string; label: string; at: number }
export interface WatchAlert { owner: string; target: string; token: string; chain: string; role: string; at: number }

export function watchAdd(d: Db, owner: string, target: string, label: string) {
  d.db.prepare("INSERT INTO watch (owner, target, label, at) VALUES (?, ?, ?, ?) ON CONFLICT (owner, target) DO UPDATE SET label = excluded.label").run(owner, target, label, Date.now());
}
export const watchRemove = (d: Db, owner: string, target: string) => Number(d.db.prepare("DELETE FROM watch WHERE owner = ? AND target = ?").run(owner, target).changes) > 0;
export const watchList = (d: Db, owner: string) => d.db.prepare("SELECT owner, target, label, at FROM watch WHERE owner = ? ORDER BY at").all(owner) as unknown as WatchRow[];
export const watchCount = (d: Db, owner: string) => Number((d.db.prepare("SELECT COUNT(*) AS n FROM watch WHERE owner = ?").get(owner) as { n: number }).n);
// Кто следит за этими кошельками: один индексный запрос на весь скан.
export function watchersOf(d: Db, targets: string[]): WatchRow[] {
  if (!targets.length) return [];
  return d.db.prepare("SELECT owner, target, label, at FROM watch WHERE target IN (SELECT value FROM json_each(?))").all(JSON.stringify(targets)) as unknown as WatchRow[];
}
// true — алерт новый (пары владелец+кошелёк+токен ещё не было), false — уже предупреждали.
export function alertOnce(d: Db, a: Omit<WatchAlert, "at">) {
  return Number(d.db.prepare("INSERT OR IGNORE INTO watch_alerts (owner, target, token, chain, role, at) VALUES (?, ?, ?, ?, ?, ?)").run(a.owner, a.target, a.token, a.chain, a.role, Date.now()).changes) > 0;
}
export const recentAlerts = (d: Db, owner: string, limit = 30) =>
  d.db.prepare("SELECT owner, target, token, chain, role, at FROM watch_alerts WHERE owner = ? ORDER BY at DESC LIMIT ?").all(owner, limit) as unknown as WatchAlert[];
