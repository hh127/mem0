import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  try {
    const parsed = parseISO(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return format(date, "yyyy-MM-dd HH:mm", { locale: zhCN });
}

export function formatDate(
  value: string | number | Date | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return format(date, "yyyy-MM-dd", { locale: zhCN });
}

export function formatRelative(
  value: string | number | Date | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "—";
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
}

export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function errorMessage(error: unknown, fallback = "出了点问题"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function pluralize(count: number, unit: string): string {
  return `${count} ${unit}`;
}
