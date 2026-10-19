// «Операторы» вместо кошельков: топ-держатели, снайперы и инсайдеры склеиваются в одного владельца по любой связи —
// общий спонсор (не биржа), деньги от создателя, сам создатель. Скан показывает не «12 кошельков», а «2 оператора,
// один держит 31% и он же снайпил на запуске». Плюс память кошельков между сканами: какие кошельки уже снайпили,
// бандлили или были у дева на других токенах и сколько тех токенов потом рухнули (по Track Record).
import "server-only";
import type { Connection } from "@solana/web3.js";
import { getMeta, setMeta } from "./store";
import { cachedFunding, EXCHANGE_SOL, funderSol, type BundleReport } from "./scan-bundles";
import type { SniperReport } from "./scan-snipers";
import { trackOutcomes } from "./track";

export type Role = "bundle" | "dev" | "sniper";
export interface Operator {
  wallets: number;
  pct: number; // сколько держит сейчас: топ-держатели плюс остаток снайперов
  roles: Role[];
  devLinked: boolean; // связан с создателем
}
// Бабл-карта: кошельки (держатели, снайперы, дев и их общие спонсоры) с долями, группой-владельцем и связями.
// g — номер оператора (как в operators, по убыванию доли), -1 — одиночный кошелёк; hub — спонсор без своей доли.
export interface BubbleNode {
  w: string;
  pct: number;
  g: number;
  roles: Role[];
  hub?: boolean;
}
export interface BubbleMap {
  nodes: BubbleNode[];
  links: [number, number][];
}
export interface OperatorReport {
  operators: Operator[]; // только группы из 2+ кошельков или связанные с девом
  map?: BubbleMap;
  devSnipers: number; // снайперы, которых профинансировал создатель
  history?: { wallets: number; tokens: number; dumped: number }; // память: эти кошельки на других токенах
}

const SNIPER_TRACE = 8;

export async function buildOperators(conn: Connection, opts: { bundles?: BundleReport; snipers?: SniperReport; creator?: string; mint: string }): Promise<OperatorReport | undefined> {
  const { bundles, snipers, creator } = opts;
  if (!bundles?.wallets?.length && !snipers?.buyers?.length) return undefined;
  const exchanges = new Set(bundles?.exchanges ?? []);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  const held = new Map<string, number>();
  const roles = new Map<string, Set<Role>>();
  const role = (w: string, r: Role) => roles.set(w, (roles.get(w) ?? new Set()).add(r));
  const edges: [string, string][] = [];

  for (const w of bundles?.wallets ?? []) held.set(w.wallet, (held.get(w.wallet) ?? 0) + w.pct);
  for (const l of bundles?.links ?? []) {
    if (exchanges.has(l.funder)) continue;
    join(l.wallet, l.funder);
    edges.push([l.wallet, l.funder]);
    if (creator && l.funder === creator) role(l.wallet, "dev");
  }
  for (const c of bundles?.clusters ?? []) role(c.funder, "bundle");
  // Снайперы: кто их пополнил (кэш на сутки, только крупнейшие), остаток — в долю оператора.
  const buyers = (snipers?.buyers ?? []).slice(0, SNIPER_TRACE);
  const funded = await Promise.all(buyers.map((b) => cachedFunding(conn, b.wallet).catch(() => null)));
  let devSnipers = 0;
  for (let i = 0; i < buyers.length; i++) {
    const b = buyers[i];
    role(b.wallet, "sniper");
    if (!held.has(b.wallet)) held.set(b.wallet, b.leftPct);
    const f = funded[i]?.funder;
    if (!f) continue;
    if (f === creator) devSnipers++;
    const big = exchanges.has(f) || (await funderSol(conn, f).catch(() => 0)) > EXCHANGE_SOL;
    if (!big) {
      join(b.wallet, f);
      edges.push([b.wallet, f]);
    }
  }
  if (creator) role(creator, "dev");

  const groups = new Map<string, string[]>();
  for (const w of new Set([...held.keys(), ...parent.keys()])) {
    const r = find(w);
    groups.set(r, [...(groups.get(r) ?? []), w]);
  }
  const ops: (Operator & { root: string })[] = [];
  for (const [root, ws] of groups) {
    const members = ws.filter((w) => held.has(w) || w === creator);
    const rs = new Set<Role>();
    for (const w of ws) for (const r of roles.get(w) ?? []) rs.add(r);
    // Роль «бандл» у группы — если в ней 2+ держателя с общим спонсором.
    if (members.filter((w) => held.has(w)).length >= 2 && !rs.has("sniper")) rs.add("bundle");
    const devLinked = !!creator && ws.includes(creator);
    if (devLinked) rs.add("dev");
    const pct = Math.round(members.reduce((a, w) => a + (held.get(w) ?? 0), 0) * 100) / 100;
    if ((members.length >= 2 || devLinked) && pct > 0) ops.push({ wallets: members.length, pct, roles: [...rs], devLinked, root });
  }
  ops.sort((a, b) => b.pct - a.pct);
  const map = bubbleMap({ ops, held, roles, edges, find, creator });
  const history = walletHistory([...held.keys()], opts.mint);
  rememberWallets(opts.mint, { snipers: buyers.map((b) => b.wallet), bundles: (bundles?.links ?? []).filter((l) => !exchanges.has(l.funder)).map((l) => l.wallet), dev: creator ? [creator, ...(bundles?.links ?? []).filter((l) => l.funder === creator).map((l) => l.wallet)] : [] });
  return { operators: ops.slice(0, 5).map((o) => ({ wallets: o.wallets, pct: o.pct, roles: o.roles, devLinked: o.devLinked })), devSnipers, ...(history ? { history } : {}), ...(map ? { map } : {}) };
}

const MAP_NODES = 40;

// Граф для бабл-карты: все кошельки с долей, дев и спонсоры, через которых связаны кошельки одного оператора.
function bubbleMap(x: {
  ops: { root: string }[];
  held: Map<string, number>;
  roles: Map<string, Set<Role>>;
  edges: [string, string][];
  find: (w: string) => string;
  creator?: string;
}): BubbleMap | undefined {
  const group = new Map(x.ops.map((o, i) => [o.root, i]));
  const g = (w: string) => group.get(x.find(w)) ?? -1;
  const ids = new Map<string, number>();
  const nodes: BubbleNode[] = [];
  const add = (w: string, hub = false) => {
    if (ids.has(w) || nodes.length >= MAP_NODES) return ids.get(w);
    ids.set(w, nodes.length);
    const pct = Math.round((x.held.get(w) ?? 0) * 100) / 100;
    nodes.push({ w, pct, g: g(w), roles: [...(x.roles.get(w) ?? [])], ...(hub ? { hub: true } : {}) });
    return ids.get(w);
  };
  for (const [w] of [...x.held].sort((a, b) => b[1] - a[1])) add(w);
  if (x.creator) add(x.creator, !x.held.has(x.creator));
  const links: [number, number][] = [];
  for (const [a, b] of x.edges) {
    // Спонсора рисуем, только если он связывает кошельки одного оператора: одиночные пополнения не шумят.
    if (!ids.has(b) && g(b) < 0) continue;
    const i = ids.get(a) ?? add(a, true);
    const j = ids.get(b) ?? add(b, true);
    if (i !== undefined && j !== undefined && i !== j) links.push([i, j]);
  }
  return nodes.length >= 2 ? { nodes, links } : undefined;
}

// ---------- память кошельков ----------
// meta walletMem: { кошелёк: [токены] } — на каких токенах кошелёк был снайпером, бандлом или у дева.
const MEM_KEY = "walletMem";
const MEM_WALLETS = 8000;
const MEM_TOKENS = 20;
let memCache: { at: number; m: Record<string, string[]> } | null = null;
const loadMem = (): Record<string, string[]> => {
  if (memCache && Date.now() - memCache.at < 60_000) return memCache.m;
  let m: Record<string, string[]> = {};
  try {
    m = JSON.parse(getMeta(MEM_KEY) ?? "{}");
  } catch {}
  memCache = { at: Date.now(), m };
  return m;
};

function rememberWallets(mint: string, w: { snipers: string[]; bundles: string[]; dev: string[] }) {
  const m = loadMem();
  for (const x of new Set([...w.snipers, ...w.bundles, ...w.dev])) {
    const list = (m[x] ?? []).filter((t) => t !== mint);
    list.push(mint);
    delete m[x]; // переставляем в конец: свежие записи живут дольше
    m[x] = list.slice(-MEM_TOKENS);
  }
  const keys = Object.keys(m);
  if (keys.length > MEM_WALLETS) for (const k of keys.slice(0, keys.length - MEM_WALLETS)) delete m[k];
  setMeta(MEM_KEY, JSON.stringify(m));
  memCache = { at: Date.now(), m };
}

// Эти кошельки на ДРУГИХ токенах: сколько токенов и сколько из них рухнули (только закрытые исходы).
function walletHistory(wallets: string[], mint: string) {
  const m = loadMem();
  const out = trackOutcomes();
  const tokens = new Set<string>();
  let seen = 0;
  for (const w of wallets) {
    const list = (m[w] ?? []).filter((t) => t !== mint);
    if (list.length) seen++;
    for (const t of list) tokens.add(t);
  }
  if (!tokens.size) return undefined;
  const dumped = [...tokens].filter((t) => out.get(t)?.dumped).length;
  return { wallets: seen, tokens: tokens.size, dumped };
}
