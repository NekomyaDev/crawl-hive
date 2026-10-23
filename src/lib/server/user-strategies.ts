// Strategy builder: личные бумажные стратегии холдеров $CRAWLHIVE. Строки в user_strategies (таблица в paper-engine.ts),
// движок гоняет их рядом со стратегиями проекта под id u<число>. Здесь: список, создание, правка, удаление и лимит
// активных стратегий по тарифу (TIER_LIMITS.strategies). Только бумага: ни одной настоящей сделки отсюда не уходит.
import "server-only";
import { ApiError } from "./store";
import { TIER_LIMITS, tierOf, type Tier } from "./tiers";
import { invalidateUserStrategies, paperDb, userStrategyId, type UserStrategyRow } from "./paper-engine";
import { cleanStrategyName, normalizeUserConfig, userConfigError, type UserStrategyConfig } from "../user-strategy-config";

// Сохранённых (включая выключенные) не больше этого на кошелёк: лимит тарифа считает только активные.
const MAX_SAVED = 30;
const TIER_CHECK_MS = 10 * 60_000;

function db() {
  const d = paperDb();
  if (!d) throw new ApiError("Paper engine storage is unavailable right now, try again later", 503);
  return d;
}

export interface MyStrategy {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  config: UserStrategyConfig;
}

const view = (r: UserStrategyRow): MyStrategy => {
  let raw: unknown = {};
  try {
    raw = JSON.parse(r.config);
  } catch {
    // битый конфиг покажем нормализованным
  }
  return { id: userStrategyId(r.id), name: r.name, enabled: !!r.enabled, createdAt: r.created_at, config: normalizeUserConfig(raw) };
};

const rowsOf = (owner: string) => db().prepare("SELECT * FROM user_strategies WHERE owner = ? ORDER BY id").all(owner) as unknown as UserStrategyRow[];
const activeCount = (owner: string) => (db().prepare("SELECT COUNT(*) AS n FROM user_strategies WHERE owner = ? AND enabled = 1").get(owner) as { n: number }).n;

// u12 -> строка владельца. Чужая или несуществующая: 404, не выдаём, что такой id есть.
function ownRow(owner: string, rawId: unknown): UserStrategyRow {
  const m = /^u(\d{1,12})$/.exec(String(rawId ?? "").trim());
  const row = m ? (db().prepare("SELECT * FROM user_strategies WHERE id = ? AND owner = ?").get(Number(m[1]), owner) as unknown as UserStrategyRow | undefined) : undefined;
  if (!row) throw new ApiError("Strategy not found", 404);
  return row;
}

function limitError(tier: Tier, max: number) {
  return new ApiError(
    max === 0
      ? "Saving strategies is for $CRAWLHIVE holders. See crawlhive.xyz/pricing"
      : `Your ${tier} plan runs up to ${max} active strategies. Pause one first or upgrade on crawlhive.xyz/pricing`,
    402,
  );
}

function parseConfig(raw: unknown) {
  const config = normalizeUserConfig(raw);
  const err = userConfigError(config);
  if (err) throw new ApiError(err, 400);
  return config;
}

export async function myStrategies(owner: string) {
  const { tier } = await tierOf(owner);
  const max = TIER_LIMITS[tier].strategies;
  const list = rowsOf(owner).map(view);
  return { tier, max, active: list.filter((x) => x.enabled).length, saved: list.length, maxSaved: MAX_SAVED, list };
}

export async function createStrategy(owner: string, b: { name?: unknown; config?: unknown; enabled?: unknown }) {
  const { tier } = await tierOf(owner);
  const max = TIER_LIMITS[tier].strategies;
  if (max === 0) throw limitError(tier, max);
  const name = cleanStrategyName(b.name);
  if (!name) throw new ApiError("Give the strategy a name", 400);
  const config = parseConfig(b.config);
  if (rowsOf(owner).length >= MAX_SAVED) throw new ApiError(`Up to ${MAX_SAVED} saved strategies per wallet. Delete an old one first`, 400);
  // Сохранить можно и выключенной; включённой только в пределах лимита тарифа.
  const enabled = b.enabled !== false;
  if (enabled && activeCount(owner) >= max) throw limitError(tier, max);
  const r = db()
    .prepare("INSERT INTO user_strategies (owner, name, config, enabled, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(owner, name, JSON.stringify(config), enabled ? 1 : 0, Date.now());
  invalidateUserStrategies();
  console.log(`[paper] user strategy u${r.lastInsertRowid} created by ${owner.slice(0, 6)} (${tier})`);
  return view(db().prepare("SELECT * FROM user_strategies WHERE id = ?").get(Number(r.lastInsertRowid)) as unknown as UserStrategyRow);
}

// Правка: имя, включение и параметры. Новые параметры действуют на новые входы; открытые позиции дальше идут
// по новым выходам (как у стратегий проекта при правке правил).
export async function updateStrategy(owner: string, b: { id?: unknown; name?: unknown; config?: unknown; enabled?: unknown }) {
  const row = ownRow(owner, b.id);
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (b.name !== undefined) {
    const name = cleanStrategyName(b.name);
    if (!name) throw new ApiError("Give the strategy a name", 400);
    sets.push("name = ?");
    args.push(name);
  }
  if (b.config !== undefined) {
    sets.push("config = ?");
    args.push(JSON.stringify(parseConfig(b.config)));
  }
  if (b.enabled !== undefined) {
    const on = b.enabled === true;
    if (on && !row.enabled) {
      const { tier } = await tierOf(owner);
      const max = TIER_LIMITS[tier].strategies;
      if (activeCount(owner) >= max) throw limitError(tier, max);
    }
    sets.push("enabled = ?");
    args.push(on ? 1 : 0);
  }
  if (!sets.length) return view(row);
  db().prepare(`UPDATE user_strategies SET ${sets.join(", ")} WHERE id = ? AND owner = ?`).run(...args, row.id, owner);
  invalidateUserStrategies();
  return view(db().prepare("SELECT * FROM user_strategies WHERE id = ?").get(row.id) as unknown as UserStrategyRow);
}

// Удаление: строка уходит, движок на следующем тике закрывает её позиции по рынку с причиной «removed»
// и снимает ожидающие входы. Закрытые сделки остаются в paper_trades, но владельцу больше не показываются.
export function deleteStrategy(owner: string, rawId: unknown) {
  const row = ownRow(owner, rawId);
  db().prepare("DELETE FROM user_strategies WHERE id = ? AND owner = ?").run(row.id, owner);
  invalidateUserStrategies();
  console.log(`[paper] user strategy u${row.id} deleted by ${owner.slice(0, 6)}`);
  return { removed: userStrategyId(row.id) };
}

// Тариф мог упасть после включения: продал токены или кончился Pro. Раз в TIER_CHECK_MS у каждого владельца
// с активными стратегиями сверяем тариф и выключаем лишние, начиная с самых новых. Баланс не узнали (сбой RPC):
// не трогаем, иначе один сбой выключил бы всех.
const tc = globalThis as unknown as { __crawlhiveStratTierCheck?: { at: number; busy: boolean } };
export async function enforceStrategyTierLimits() {
  const s = (tc.__crawlhiveStratTierCheck ??= { at: 0, busy: false });
  if (s.busy || Date.now() - s.at < TIER_CHECK_MS) return;
  s.busy = true;
  s.at = Date.now();
  try {
    const d = paperDb();
    if (!d) return;
    const owners = d.prepare("SELECT owner, COUNT(*) AS n FROM user_strategies WHERE enabled = 1 GROUP BY owner").all() as unknown as { owner: string; n: number }[];
    let changed = false;
    for (const o of owners) {
      const t = await tierOf(o.owner).catch(() => null);
      if (!t || (t.balance === null && !t.proUntil)) continue;
      const max = TIER_LIMITS[t.tier].strategies;
      if (o.n <= max) continue;
      const extra = d.prepare("SELECT id FROM user_strategies WHERE owner = ? AND enabled = 1 ORDER BY id DESC LIMIT ?").all(o.owner, o.n - max) as unknown as { id: number }[];
      for (const x of extra) d.prepare("UPDATE user_strategies SET enabled = 0 WHERE id = ?").run(x.id);
      changed = true;
      console.log(`[paper] ${o.owner.slice(0, 6)} is ${t.tier} now: paused ${extra.length} user strategies over the limit of ${max}`);
    }
    if (changed) invalidateUserStrategies();
  } finally {
    s.busy = false;
  }
}
