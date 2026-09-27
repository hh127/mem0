import type { Memory } from "@/types/api";

/** Tags of a memory; the field is absent on records written before categorization. */
export function categoriesOf(memory: Memory): string[] {
  return memory.categories ?? [];
}

/** How many memories carry each tag (a memory with several tags counts once per tag). */
export function countByCategory(memories: Memory[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    for (const category of categoriesOf(memory)) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return counts;
}

/** Memories carrying a given tag, newest first. */
export function memoriesWithCategory(
  memories: Memory[],
  category: string,
): Memory[] {
  return memories
    .filter((memory) => categoriesOf(memory).includes(category))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse "3 个月前" style label — cards show recency at a glance, not exact stamps. */
export function relativeTime(iso?: string | null): string {
  if (!iso) return "时间未知";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "时间未知";
  const diff = Date.now() - then;
  if (diff < MINUTE) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))} 个月前`;
  return `${Math.floor(diff / (365 * DAY))} 年前`;
}

/** 到期状态：无日期 = 长期记忆；过了今天 = 已过期（列表里会被隐藏）。 */
export function expiryLabel(memory: Memory): {
  text: string;
  expired: boolean;
  longTerm: boolean;
} {
  const value = memory.expiration_date;
  if (!value)
    return { text: "长期", expired: false, longTerm: true };
  const today = new Date().toISOString().slice(0, 10);
  return { text: value, expired: value < today, longTerm: false };
}

/** Where the memory came from, using the identifiers the REST API accepts. */
export function sourceLabel(memory: Memory): string {
  if (memory.user_id) return `用户 ${memory.user_id}`;
  if (memory.agent_id) return `代理 ${memory.agent_id}`;
  return "未知来源";
}
