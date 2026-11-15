/**
 * 批量操作的纯逻辑：并发跑 N 个 API 调用 + 分类操作的三种语义。
 *
 * 服务端没有批量接口，只能逐条 PUT/DELETE，所以这一层负责：
 * 限并发、逐条收集失败、报告进度（供底部操作条显示 12/30）。
 */

export type CategoryOp = "replace" | "add" | "remove";

/** 规整分类选择：去空、去重、保持顺序。 */
export function normalizeCategories(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 一次批量改分类的语义：
 * - replace：选中记忆的分类整体换成勾选的这几个（勾 0 个 = 清空分类）
 * - add：在原有分类上追加（不动原有标签）
 * - remove：从原有分类里摘掉勾选的这几个
 */
export function applyCategoryOp(current: readonly string[], picked: readonly string[], op: CategoryOp): string[] {
  const base = normalizeCategories(current);
  const chosen = normalizeCategories(picked);
  if (op === "replace") return chosen;
  if (op === "add") return normalizeCategories([...base, ...chosen]);
  const drop = new Set(chosen);
  return base.filter((name) => !drop.has(name));
}

/** 一次批量操作的结果。failed 保留原对象，便于把失败项重新勾上重试。 */
export interface BatchResult<T> {
  succeeded: T[];
  failed: { item: T; error: unknown }[];
}

/**
 * 限并发地跑一批任务。单个任务失败不中断整批——记下来继续跑，
 * 最后把失败项交给调用方展示。默认并发 4，是服务端比较稳的档位。
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchResult<T>> {
  const total = items.length;
  const succeeded: T[] = [];
  const failed: { item: T; error: unknown }[] = [];
  if (total === 0) return { succeeded, failed };

  const size = Math.max(1, Math.min(limit, total));
  let cursor = 0;
  let done = 0;

  const runner = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      const item = items[index];
      if (item === undefined) return;
      try {
        await worker(item, index);
        succeeded.push(item);
      } catch (error) {
        failed.push({ item, error });
      } finally {
        done += 1;
        onProgress?.(done, total);
      }
    }
  };

  await Promise.all(Array.from({ length: size }, runner));
  return { succeeded, failed };
}

/** 选中集合里还剩多少条仍然存在（列表刷新后可能有记忆被删/被筛掉）。 */
export function pruneSelection(selected: readonly string[], alive: ReadonlySet<string>): string[] {
  const next = selected.filter((id) => alive.has(id));
  return next.length === selected.length ? (selected as string[]) : next;
}

/** 批量结果的一句话摘要，success toast 与 error toast 共用。 */
export function batchSummary(label: string, result: BatchResult<unknown>): string {
  const total = result.succeeded.length + result.failed.length;
  if (result.failed.length === 0) return `${label}完成：共 ${total} 条`;
  return `${label}：成功 ${result.succeeded.length} 条，失败 ${result.failed.length} 条`;
}
