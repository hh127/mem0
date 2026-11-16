import { describe, expect, it } from "vitest";
import {
  buildReviewPatch,
  categoryOptionsFor,
  filterReviewMemories,
  reviewCounts,
  reviewDraftFrom,
  sortByCreatedDesc,
} from "@/features/review/review-utils";
import {
  matchesReviewView,
  memoryKindOf,
  reviewInfo,
  reviewStatusOf,
} from "@/features/memories/memory-utils";
import type { Memory } from "@/features/memories/types";

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m-1",
    memory: "用户偏好简体中文回复。",
    user_id: "hermes-user-1",
    agent_id: null,
    run_id: null,
    expiration_date: null,
    categories: ["个人偏好"],
    metadata: {},
    created_at: "2026-11-01T08:00:00+08:00",
    updated_at: "2026-11-01T08:00:00+08:00",
    ...overrides,
  };
}

const pending = memory({ id: "pending", metadata: {} });
const approved = memory({ id: "approved", metadata: { review_status: "approved" } });
const rejected = memory({
  id: "rejected",
  metadata: { review_status: "rejected", review_note: "重复内容" },
});
const temporary = memory({
  id: "temporary",
  expiration_date: "2026-12-01",
  metadata: {},
  categories: ["短期任务"],
});
const unknownStatus = memory({ id: "unknown", metadata: { review_status: "whatever" } });

describe("reviewStatusOf", () => {
  it("treats a missing or unknown review_status as pending", () => {
    expect(reviewStatusOf({ metadata: {} })).toBe("pending");
    expect(reviewStatusOf({ metadata: null })).toBe("pending");
    expect(reviewStatusOf({})).toBe("pending");
    expect(reviewStatusOf(unknownStatus)).toBe("pending");
  });

  it("reads approved and rejected", () => {
    expect(reviewStatusOf(approved)).toBe("approved");
    expect(reviewStatusOf(rejected)).toBe("rejected");
  });
});

describe("memoryKindOf", () => {
  it("derives the kind from the expiration date", () => {
    expect(memoryKindOf(memory())).toBe("permanent");
    expect(memoryKindOf(memory({ expiration_date: null }))).toBe("permanent");
    expect(memoryKindOf(memory({ expiration_date: "2026-12-01" }))).toBe("temporary");
  });
});

describe("reviewInfo", () => {
  it("exposes labels, kind and review trace", () => {
    expect(reviewInfo(pending).label).toBe("待审核");
    expect(reviewInfo(approved).label).toBe("已通过");
    expect(reviewInfo(rejected).label).toBe("已驳回");
    expect(reviewInfo(temporary).kindLabel).toBe("临时记忆");
    expect(reviewInfo(rejected).note).toBe("重复内容");
    expect(reviewInfo({ ...approved, metadata: { review_status: "approved", reviewed_by: "admin@example.com", reviewed_at: "2026-11-02T10:00:00Z" } })).toMatchObject({
      reviewedBy: "admin@example.com",
      reviewedAt: "2026-11-02T10:00:00Z",
    });
  });
});

describe("matchesReviewView", () => {
  it("hides rejected memories from the default library view", () => {
    expect(matchesReviewView(pending, "visible")).toBe(true);
    expect(matchesReviewView(approved, "visible")).toBe(true);
    expect(matchesReviewView(rejected, "visible")).toBe(false);
  });

  it("filters by one exact status", () => {
    expect(matchesReviewView(rejected, "rejected")).toBe(true);
    expect(matchesReviewView(approved, "rejected")).toBe(false);
  });
});

describe("filterReviewMemories", () => {
  const rows = [pending, approved, rejected, temporary, unknownStatus];

  it("keeps only the selected queue", () => {
    expect(filterReviewMemories(rows, { tab: "pending", kind: "all", categories: [], keyword: "" }).map((row) => row.id)).toEqual([
      "pending",
      "temporary",
      "unknown",
    ]);
    expect(filterReviewMemories(rows, { tab: "rejected", kind: "all", categories: [], keyword: "" }).map((row) => row.id)).toEqual([
      "rejected",
    ]);
  });

  it("filters temporary and permanent memories", () => {
    const temporaryOnly = filterReviewMemories(rows, {
      tab: "pending",
      kind: "temporary",
      categories: [],
      keyword: "",
    });
    expect(temporaryOnly.map((row) => row.id)).toEqual(["temporary"]);

    const permanentOnly = filterReviewMemories(rows, {
      tab: "pending",
      kind: "permanent",
      categories: [],
      keyword: "",
    });
    expect(permanentOnly.map((row) => row.id)).toEqual(["pending", "unknown"]);
  });

  it("matches any selected category and the keyword", () => {
    expect(
      filterReviewMemories(rows, { tab: "pending", kind: "all", categories: ["短期任务"], keyword: "" }).map(
        (row) => row.id,
      ),
    ).toEqual(["temporary"]);
    expect(
      filterReviewMemories(rows, { tab: "pending", kind: "all", categories: [], keyword: "简体中文" }).map(
        (row) => row.id,
      ),
    ).toEqual(["pending", "temporary", "unknown"]);
    expect(
      filterReviewMemories(rows, { tab: "pending", kind: "all", categories: [], keyword: "个人偏好" }).map(
        (row) => row.id,
      ),
    ).toEqual(["pending", "unknown"]);
  });
});

describe("reviewCounts", () => {
  it("counts each status and the temporary/permanent split of the pending queue", () => {
    const counts = reviewCounts([pending, approved, rejected, temporary, unknownStatus]);
    expect(counts).toEqual({
      pending: 3,
      approved: 1,
      rejected: 1,
      pendingTemporary: 1,
      pendingPermanent: 2,
    });
  });
});

describe("sortByCreatedDesc", () => {
  it("puts the newest first and tolerates invalid dates", () => {
    const older = memory({ id: "older", created_at: "2026-10-01T00:00:00Z" });
    const newer = memory({ id: "newer", created_at: "2026-11-10T00:00:00Z" });
    const broken = memory({ id: "broken", created_at: "not-a-date" });
    expect(sortByCreatedDesc([older, broken, newer]).map((row) => row.id)).toEqual([
      "newer",
      "older",
      "broken",
    ]);
  });
});

describe("categoryOptionsFor", () => {
  it("counts only the selected queue and includes catalog names", () => {
    const options = categoryOptionsFor(
      [pending, rejected, memory({ id: "other", categories: ["技术技能"], metadata: {} })],
      "pending",
      ["个人信息"],
    );
    const byName = new Map(options.map((option) => [option.value, option.count]));
    expect(options).toHaveLength(3);
    expect(byName.get("个人信息")).toBe(0);
    expect(byName.get("个人偏好")).toBe(1);
    expect(byName.get("技术技能")).toBe(1);
    expect(byName.has("未出现的分类")).toBe(false);
  });
});

describe("buildReviewPatch", () => {
  it("returns null when nothing changed", () => {
    const original = memory({ categories: ["个人偏好"], expiration_date: "2026-12-01" });
    expect(buildReviewPatch(original, reviewDraftFrom(original))).toBeNull();
  });

  it("sends only the changed text", () => {
    const original = memory();
    expect(
      buildReviewPatch(original, { ...reviewDraftFrom(original), text: "用户更喜欢深色界面。" }),
    ).toEqual({ text: "用户更喜欢深色界面。" });
  });

  it("ignores whitespace-only text edits", () => {
    const original = memory();
    expect(
      buildReviewPatch(original, { ...reviewDraftFrom(original), text: `  ${original.memory}  ` }),
    ).toBeNull();
  });

  it("normalizes categories and supports clearing them", () => {
    const original = memory({ categories: ["个人偏好", "技术技能"] });
    expect(
      buildReviewPatch(original, {
        ...reviewDraftFrom(original),
        categories: [" 技术技能 ", "技术技能", "自定义分类"],
      }),
    ).toEqual({ categories: ["技术技能", "自定义分类"] });
    expect(buildReviewPatch(original, { ...reviewDraftFrom(original), categories: [] })).toEqual({
      categories: [],
    });
  });

  it("switches between temporary and permanent via the expiration date", () => {
    const permanent = memory({ expiration_date: null });
    expect(
      buildReviewPatch(permanent, { ...reviewDraftFrom(permanent), expirationDate: "2026-12-31" }),
    ).toEqual({ expiration_date: "2026-12-31" });

    const temporary = memory({ expiration_date: "2026-12-01" });
    expect(
      buildReviewPatch(temporary, { ...reviewDraftFrom(temporary), expirationDate: "" }),
    ).toEqual({ expiration_date: null });
  });

  it("combines text, category and expiration edits", () => {
    const original = memory({ categories: ["个人偏好"], expiration_date: null });
    expect(
      buildReviewPatch(original, {
        text: "用户希望所有回复使用简体中文。",
        categories: ["AI助手设置"],
        expirationDate: "2026-12-31",
      }),
    ).toEqual({
      text: "用户希望所有回复使用简体中文。",
      categories: ["AI助手设置"],
      expiration_date: "2026-12-31",
    });
  });
});
