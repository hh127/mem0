import { describe, expect, it } from "vitest";
import {
  cn,
  compactNumber,
  errorMessage,
  formatDate,
  formatDateTime,
  formatRelative,
  truncate,
} from "@/lib/utils";

describe("cn", () => {
  it("merges tailwind classes with later overrides", () => {
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4");
    expect(cn("", null, undefined, "text-ink")).toBe("text-ink");
  });
});

describe("date formatting", () => {
  it("formats ISO strings and rejects invalid input", () => {
    expect(formatDate("2026-11-15T08:30:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatDateTime("2026-11-15T08:30:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatRelative("not-a-date")).toBe("—");
  });
});

describe("numbers", () => {
  it("compacts thousands and millions", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1500)).toBe("1.5k");
    expect(compactNumber(2000)).toBe("2k");
    expect(compactNumber(2_500_000)).toBe("2.5M");
    expect(compactNumber(null)).toBe("0");
  });
});

describe("truncate", () => {
  it("keeps short text and adds an ellipsis for long text", () => {
    expect(truncate("记忆", 10)).toBe("记忆");
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
  });
});

describe("errorMessage", () => {
  it("prefers Error messages and falls back", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(undefined, "兜底")).toBe("兜底");
  });
});
