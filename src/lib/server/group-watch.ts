// Слежка за группами, где стоит бот: кто кого назначил админом, какие права выдал, кто добавил бота, кого разжаловали.
// Каждое событие сразу уходит админам проекта в личку (без троттлинга: такие события редкие и важные).
// Telegram присылает chat_member только если бот сам админ группы и chat_member есть в allowed_updates.
import "server-only";
import { adminRecipients, isAdmin } from "./admin";
import { call, esc, send } from "./telegram";

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
type Member = { user: TgUser; status: string } & Partial<Record<string, boolean | number | string | TgUser>>;
export interface ChatMemberUpdate {
  chat: { id: number; title?: string; type: string; username?: string };
  from: TgUser;
  date: number;
  old_chat_member: Member;
  new_chat_member: Member;
}

// Права админа в порядке важности; risky: то, что даёт захватить или подменить группу.
const RIGHTS: [key: string, label: string, risky?: boolean][] = [
  ["can_promote_members", "Add new admins", true],
  ["can_change_info", "Change group info", true],
  ["is_anonymous", "Remain anonymous", true],
  ["can_restrict_members", "Ban users"],
  ["can_delete_messages", "Delete messages"],
  ["can_invite_users", "Add users"],
  ["can_pin_messages", "Pin messages"],
  ["can_manage_topics", "Manage topics"],
  ["can_manage_video_chats", "Video chats"],
  ["can_post_stories", "Post stories"],
  ["can_edit_stories", "Edit stories"],
  ["can_delete_stories", "Delete stories"],
];
const ADMIN = new Set(["administrator", "creator"]);

// Проверка бота: юзернеймы в Telegram уникальны, поэтому точное совпадение с известным ботом значит «настоящий».
// Подделки берут похожие имена (Safeguard_bot, SafeguardVerify, MissRose_Bot1): если имя или юзернейм похожи на
// известный бренд, а юзернейм не из списка, это тревога. Свои доверенные можно дописать в GROUP_WATCH_TRUSTED_BOTS.
const TRUSTED: Record<string, string> = {
  safeguard: "Safeguard",
  safeguardrobot: "Safeguard",
  missrose_bot: "Rose",
  combot: "Combot",
  shieldy_bot: "Shieldy",
  grouphelpbot: "GroupHelp",
  crawlhivebot: "CrawlHive",
  raidar: "Raidar",
};
const BRANDS = ["safeguard", "safe guard", "saveguard", "save guard", "rose", "combot", "shieldy", "grouphelp", "crawlhive", "crawl hive", "raidar", "trending", "verify", "captcha"];
const trusted = () => {
  const extra = (process.env.GROUP_WATCH_TRUSTED_BOTS ?? "").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return new Set([...Object.keys(TRUSTED), ...extra]);
};
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/0/g, "o").replace(/1/g, "l");
function botCheck(u: TgUser): string {
  const un = (u.username ?? "").toLowerCase();
  if (un && trusted().has(un)) return `✅ Known bot: ${esc(TRUSTED[un] ?? "@" + un)} (exact username)`;
  const text = norm(`${u.first_name ?? ""} ${u.username ?? ""}`);
  const brand = BRANDS.find((b) => text.includes(norm(b)) || text.replace(/ /g, "").includes(norm(b).replace(/ /g, "")));
  if (brand) return `🚨 <b>LOOKS FAKE</b>: name looks like "${esc(brand)}" but @${esc(u.username ?? "?")} is not the real bot. Remove it now and check who added it.`;
  return "⚠️ Unknown bot: not on the trusted list. Check it before it gets any rights.";
}
const IN = new Set(["member", "administrator", "creator", "restricted"]);

const who = (u: TgUser) => `${u.is_bot ? "🤖 " : ""}<b>${esc(u.first_name ?? "?")}</b>${u.username ? ` @${esc(u.username)}` : ""} <code>${u.id}</code>`;
const rightsOf = (m: Member) => RIGHTS.filter(([k]) => m[k] === true);
const fmtRights = (rs: typeof RIGHTS) => (rs.length ? rs.map(([, l, r]) => (r ? `⚠️ ${l}` : l)).join(", ") : "none");

// Следим только за своими группами: владелец (creator) должен быть админом проекта. Наш бот стоит админом и в чужих
// группах (сканы токенов), их кадровые дела нас не касаются. Владельца кэшируем на час, запрос раз на событие.
const owners = new Map<number, { at: number; ours: boolean }>();
async function ours(chatId: number) {
  const hit = owners.get(chatId);
  if (hit && Date.now() - hit.at < 3600_000) return hit.ours;
  const admins = await call<{ status: string; user: TgUser }[]>("getChatAdministrators", { chat_id: chatId }).catch(() => null);
  const owner = admins?.find((a) => a.status === "creator")?.user;
  const v = !!owner && isAdmin({ id: owner.id, username: owner.username });
  if (admins) owners.set(chatId, { at: Date.now(), ours: v });
  return v;
}

async function notify(c: ChatMemberUpdate["chat"], lines: string[], force = false) {
  if (!force && !(await ours(c.id))) return;
  const head = `🛡 <b>${esc(c.title ?? "group")}</b>`;
  const text = [head, ...lines].join("\n");
  for (const chat of adminRecipients()) send(chat, text);
  // В лог пишем всё событие, включая «кто сделал»: по логу потом разбираемся, кто кого назначил.
  console.log(`[group-watch] ${c.title ?? c.id}: ${lines.map((l) => l.replace(/<[^>]+>/g, "")).join(" | ")}`);
}

export async function onChatMember(u: ChatMemberUpdate) {
  if (u.chat.type === "private" || u.chat.type === "channel") return;
  const o = u.old_chat_member;
  const n = u.new_chat_member;
  const by = u.from.id === n.user.id ? "themselves" : who(u.from);
  // Смена владельца: группа уже может числиться «не нашей», поэтому шлём, если наш админ был владельцем или им стал.
  if (n.status === "creator" && o.status !== "creator") {
    owners.delete(u.chat.id);
    return notify(u.chat, [`🚨 <b>Ownership moved</b> to ${who(n.user)}`, `by ${by}`], isAdmin(n.user) || isAdmin(u.from));
  }
  if (o.status === "creator" && n.status !== "creator") {
    owners.delete(u.chat.id);
    return notify(u.chat, [`🚨 <b>Owner lost ownership</b>: ${who(n.user)} (now ${esc(n.status)})`, `by ${by}`], isAdmin(o.user));
  }
  if (ADMIN.has(n.status) && !ADMIN.has(o.status)) {
    return notify(u.chat, [
      `${n.user.is_bot ? "🤖 <b>Bot promoted to admin</b>" : "👮 <b>New admin</b>"}: ${who(n.user)}`,
      `by ${by}`,
      `Rights: ${fmtRights(rightsOf(n))}`,
      ...(n.user.is_bot ? [botCheck(n.user)] : []),
    ]);
  }
  if (ADMIN.has(o.status) && !ADMIN.has(n.status)) {
    return notify(u.chat, [`➖ <b>Admin removed</b>: ${who(n.user)} (now ${esc(n.status)})`, `by ${by}`]);
  }
  if (ADMIN.has(o.status) && ADMIN.has(n.status)) {
    const before = new Set(rightsOf(o).map(([k]) => k));
    const after = new Set(rightsOf(n).map(([k]) => k));
    const added = RIGHTS.filter(([k]) => after.has(k) && !before.has(k));
    const removed = RIGHTS.filter(([k]) => before.has(k) && !after.has(k));
    if (!added.length && !removed.length) return;
    return notify(u.chat, [
      `✏️ <b>Admin rights changed</b>: ${who(n.user)}`,
      `by ${by}`,
      ...(added.length ? [`Added: ${fmtRights(added)}`] : []),
      ...(removed.length ? [`Removed: ${fmtRights(removed)}`] : []),
    ]);
  }
  if (n.user.is_bot && IN.has(n.status) && !IN.has(o.status)) return notify(u.chat, [`🤖 <b>Bot added</b>: ${who(n.user)}`, `by ${by}`, botCheck(n.user)]);
}

// Наш бот сам: если его сняли с админки или выкинули, слежка в этой группе перестаёт работать, об этом надо знать.
export async function onMyChatMember(u: ChatMemberUpdate) {
  if (u.chat.type === "private" || u.chat.type === "channel") return;
  const o = u.old_chat_member.status;
  const n = u.new_chat_member.status;
  if (ADMIN.has(o) && !ADMIN.has(n)) notify(u.chat, [`⚠️ <b>CrawlHive bot lost admin</b> (now ${esc(n)})`, `by ${who(u.from)}`, "Admin and bot changes in this group are no longer watched."]);
  else if (!ADMIN.has(o) && ADMIN.has(n)) notify(u.chat, ["✅ <b>CrawlHive bot is admin</b>: admin and bot changes in this group are now watched.", `by ${who(u.from)}`]);
}
