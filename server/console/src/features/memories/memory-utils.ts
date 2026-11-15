/**
 * 记忆模块的展示辅助函数（纯函数，不依赖 React）。
 */
import { formatDate, formatDateTime, formatRelative } from "@/lib/utils";
import type { Memory } from "./types";

/** 新建记忆时记住最近一次使用的 user_id，下次打开表单直接带出来。 */
export const LAST_USER_STORAGE_KEY = "mem0_console_last_memory_user_id";

export function readLastUserId(): string {
  try {
    return localStorage.getItem(LAST_USER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveLastUserId(value: string): void {
  try {
    if (value) localStorage.setItem(LAST_USER_STORAGE_KEY, value);
  } catch {
    // 隐私模式下 localStorage 不可用：忽略即可，不阻塞创建。
  }
}

/** 本地时区的 `YYYY-MM-DD`（不能用 toISOString，会和 UTC 差一天）。 */
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 今天 + offset 天的 `YYYY-MM-DD`，用于到期日快捷选择。 */
export function dateStringFromToday(offsetDays: number): string {
  return localDateString(new Date(Date.now() + offsetDays * 86_400_000));
}

export type ExpiryTone = "none" | "normal" | "soon" | "expired";

export interface ExpiryInfo {
  tone: ExpiryTone;
  label: string;
  expired: boolean;
  /** 剩余天数，负数表示已过期；null = 永不过期。 */
  daysLeft: number | null;
}

/** 距今天数；手写日期差避免 DST 造成的 ±1 天误差。 */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** 到期日语义：永不过期 / 即将到期（7 天内）/ 已过期。 */
export function expiryInfo(value: string | null | undefined): ExpiryInfo {
  if (!value) return { tone: "none", label: "永不过期", expired: false, daysLeft: null };
  const today = localDateString();
  const daysLeft = daysBetween(today, value.slice(0, 10));
  if (daysLeft < 0) {
    return { tone: "expired", label: `已过期 · ${formatDate(value)}`, expired: true, daysLeft };
  }
  if (daysLeft === 0) {
    return { tone: "soon", label: "今天到期", expired: false, daysLeft };
  }
  if (daysLeft <= 7) {
    return { tone: "soon", label: `${daysLeft} 天后到期`, expired: false, daysLeft };
  }
  return { tone: "normal", label: `到期 ${formatDate(value)}`, expired: false, daysLeft };
}

/** 记忆的分类列表（去空、去重，保持服务端顺序）。 */
export function categoriesOf(memory: Pick<Memory, "categories">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of memory.categories ?? []) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** metadata 展开成可读的 key/value 列表；嵌套值转成 JSON 字符串。 */
export function metadataEntries(metadata: Record<string, unknown> | null | undefined): [string, string][] {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => {
    if (value === null || value === undefined) return [key, "—"];
    if (typeof value === "string") return [key, value];
    if (typeof value === "number" || typeof value === "boolean") return [key, String(value)];
    try {
      return [key, JSON.stringify(value)];
    } catch {
      return [key, String(value)];
    }
  });
}

/** 历史事件的中文标签。 */
export function historyEventLabel(event: string): string {
  switch (event.toUpperCase()) {
    case "ADD":
      return "新增";
    case "UPDATE":
      return "更新";
    case "DELETE":
      return "删除";
    default:
      return event || "事件";
  }
}

/** 关键词过滤：匹配正文或分类名（不区分大小写）。 */
export function matchesKeyword(memory: Memory, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  if (memory.memory.toLowerCase().includes(needle)) return true;
  return categoriesOf(memory).some((name) => name.toLowerCase().includes(needle));
}

/** 记忆来源的摘要文案，例如「用户 hermes-user-1 · 代理 openclaw-main」。 */
export function entitySummary(memory: Memory): string {
  const parts: string[] = [];
  if (memory.user_id) parts.push(`用户 ${memory.user_id}`);
  if (memory.agent_id) parts.push(`代理 ${memory.agent_id}`);
  if (memory.run_id) parts.push(`运行 ${memory.run_id}`);
  return parts.join(" · ") || "无归属实体";
}

/** 时间摘要：相对时间 + 绝对时间，表格和卡片共用。 */
export function timeSummary(memory: Memory): { created: string; updated: string } {
  return {
    created: memory.created_at ? formatRelative(memory.created_at) : "—",
    updated: formatDateTime(memory.updated_at),
  };
}
