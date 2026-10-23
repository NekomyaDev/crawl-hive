// Слежка за группами, где стоит бот: кто кого назначил админом, какие права выдал, кто добавил бота, кого разжаловали.
// Каждое событие сразу уходит админам проекта в личку (без троттлинга: такие события редкие и важные).
// Telegram присылает chat_member только если бот сам админ группы и chat_member есть в allowed_updates.
import "server-only";
import { adminRecipients } from "./admin";
import { esc, send } from "./telegram";

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
const IN = new Set(["member", "administrator", "creator", "restricted"]);

const who = (u: TgUser) => `${u.is_bot ? "🤖 " : ""}<b>${esc(u.first_name ?? "?")}</b>${u.username ? ` @${esc(u.username)}` : ""} <code>${u.id}</code>`;
const rightsOf = (m: Member) => RIGHTS.filter(([k]) => m[k] === true);
const fmtRights = (rs: typeof RIGHTS) => (rs.length ? rs.map(([, l, r]) => (r ? `⚠️ ${l}` : l)).join(", ") : "none");

function notify(c: ChatMemberUpdate["chat"], lines: string[]) {
  const head = `🛡 <b>${esc(c.title ?? "group")}</b>`;
  const text = [head, ...lines].join("\n");
  for (const chat of adminRecipients()) send(chat, text);
  console.log(`[group-watch] ${c.title ?? c.id}: ${lines[0].replace(/<[^>]+>/g, "")}`);
}

export function onChatMember(u: ChatMemberUpdate) {
  if (u.chat.type === "private" || u.chat.type === "channel") return;
  const o = u.old_chat_member;
  const n = u.new_chat_member;
  const by = u.from.id === n.user.id ? "themselves" : who(u.from);
  if (n.status === "creator" && o.status !== "creator") return notify(u.chat, [`🚨 <b>Ownership moved</b> to ${who(n.user)}`, `by ${by}`]);
  if (ADMIN.has(n.status) && !ADMIN.has(o.status)) {
    return notify(u.chat, [`${n.user.is_bot ? "🤖 <b>Bot promoted to admin</b>" : "👮 <b>New admin</b>"}: ${who(n.user)}`, `by ${by}`, `Rights: ${fmtRights(rightsOf(n))}`]);
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
  if (n.user.is_bot && IN.has(n.status) && !IN.has(o.status)) return notify(u.chat, [`🤖 <b>Bot added</b>: ${who(n.user)}`, `by ${by}`]);
}

// Наш бот сам: если его сняли с админки или выкинули, слежка в этой группе перестаёт работать, об этом надо знать.
export function onMyChatMember(u: ChatMemberUpdate) {
  if (u.chat.type === "private" || u.chat.type === "channel") return;
  const o = u.old_chat_member.status;
  const n = u.new_chat_member.status;
  if (ADMIN.has(o) && !ADMIN.has(n)) notify(u.chat, [`⚠️ <b>CrawlHive bot lost admin</b> (now ${esc(n)})`, `by ${who(u.from)}`, "Admin and bot changes in this group are no longer watched."]);
  else if (!ADMIN.has(o) && ADMIN.has(n)) notify(u.chat, ["✅ <b>CrawlHive bot is admin</b>: admin and bot changes in this group are now watched.", `by ${who(u.from)}`]);
}
