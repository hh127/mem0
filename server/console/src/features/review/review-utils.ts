/**
 * 记忆审核的纯逻辑：分页前的筛选、统计与排序。
 *
 * 审核状态不单独存表，而是从 `metadata.review_status` 派生（缺失 = 待审核），
 * 所以这里所有判断都复用 `memory-utils.ts` 里的同一套规则。
 */
import {
  categoriesOf,
  matchesKeyword,
  memoryKindOf,
  reviewStatusOf,
} from "@/features/memories/memory-utils";
import { normalizeCategories } from "@/features/memories/batch";
import type { Memory, MemoryKind, MemoryPatch } from "@/features/memories/types";

/** 审核页的两个页签：待审核 / 已驳回（已通过的不再出现在审核列表里）。 */
export type ReviewTab = "pending" | "rejected";

export type KindFilter = "all" | MemoryKind;

export interface ReviewFilterState {
  tab: ReviewTab;
  kind: KindFilter;
  categories: readonly string[];
  keyword: string;
}

export function filterReviewMemories(
  memories: readonly Memory[],
  filter: ReviewFilterState,
): Memory[] {
  const keyword = filter.keyword.trim();
  return memories.filter((memory) => {
    if (reviewStatusOf(memory) !== filter.tab) return false;
    if (filter.kind !== "all" && memoryKindOf(memory) !== filter.kind) return false;
    if (filter.categories.length > 0) {
      const names = categoriesOf(memory);
      if (!filter.categories.some((name) => names.includes(name))) return false;
    }
    return keyword ? matchesKeyword(memory, keyword) : true;
  });
}

function createdAtValue(memory: Memory): number {
  if (!memory.created_at) return 0;
  const value = new Date(memory.created_at).getTime();
  return Number.isFinite(value) ? value : 0;
}

/** 新的在前；时间相同按 id 兜底，保证排序稳定。 */
export function sortByCreatedDesc(memories: readonly Memory[]): Memory[] {
  return [...memories].sort(
    (left, right) => createdAtValue(right) - createdAtValue(left) || left.id.localeCompare(right.id),
  );
}

export interface ReviewCounts {
  pending: number;
  approved: number;
  rejected: number;
  pendingTemporary: number;
  pendingPermanent: number;
}

export function reviewCounts(memories: readonly Memory[]): ReviewCounts {
  const counts: ReviewCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    pendingTemporary: 0,
    pendingPermanent: 0,
  };
  for (const memory of memories) {
    const status = reviewStatusOf(memory);
    counts[status] += 1;
    if (status !== "pending") continue;
    if (memoryKindOf(memory) === "temporary") counts.pendingTemporary += 1;
    else counts.pendingPermanent += 1;
  }
  return counts;
}

/** 分类筛选的可选项与计数，待审核/已驳回两个页签各自统计。 */
export function categoryOptionsFor(
  memories: readonly Memory[],
  tab: ReviewTab,
  catalogNames: readonly string[] = [],
): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    if (reviewStatusOf(memory) !== tab) continue;
    for (const name of categoriesOf(memory)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const names = new Set<string>(catalogNames);
  for (const name of counts.keys()) names.add(name);
  return [...names]
    .map((name) => ({ value: name, label: name, count: counts.get(name) ?? 0 }))
    .sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"),
    );
}

/** 审核页编辑弹窗的表单状态。空的到期日表示永久记忆。 */
export interface ReviewDraft {
  text: string;
  categories: string[];
  expirationDate: string;
}

export function reviewDraftFrom(memory: Memory): ReviewDraft {
  return {
    text: memory.memory,
    categories: categoriesOf(memory),
    expirationDate: (memory.expiration_date ?? "").slice(0, 10),
  };
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * 把表单差异收敛成 PUT /memories/{id} 的最小补丁；没有改动返回 null。
 *
 * 只提交改过的字段：正文没变就不触发服务端重新分类，到期日没变就不动临时/永久归属。
 */
export function buildReviewPatch(memory: Memory, draft: ReviewDraft): MemoryPatch | null {
  const patch: MemoryPatch = {};

  const text = draft.text.trim();
  if (text && text !== memory.memory) patch.text = text;

  const categories = normalizeCategories(draft.categories);
  if (!sameList(categories, categoriesOf(memory))) patch.categories = categories;

  const expirationDate = draft.expirationDate.trim();
  if (expirationDate !== (memory.expiration_date ?? "").slice(0, 10)) {
    patch.expiration_date = expirationDate || null;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
