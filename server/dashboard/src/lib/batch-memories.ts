import { normalizeSelection } from "@/lib/memory-categories";

/**
 * 批量操作的纯逻辑：并发跑 N 个 API 调用 + 分类的三种语义。
 * 交互部分在组件里，这两块容易出错又难在浏览器里断言，所以单独放这里。
 */

export type CategoryOp = "replace" | "add" | "remove";

/**
 * 一次批量改分类的语义：
 * - replace：选中记忆的分类整体换成勾选的这几个（勾 0 个 = 清空分类）
 * - add：在原有分类上追加（不动原有标签）
 * - remove：从原有分类里摘掉勾选的这几个
 */
export function applyCategoryOp(
  current: string[],
  picked: string[],
  op: CategoryOp,
): string[] {
  const base = normalizeSelection(current ?? []);
  const chosen = normalizeSelection(picked ?? []);
  if (op === "replace") return chosen;
  if (op === "add") return normalizeSelection([...base, ...chosen]);
  const drop = new Set(chosen);
  return base.filter((name) => !drop.has(name));
}

/** 一次批量操作的结果。failed 保留原对象，方便把失败的重新勾上让用户重试。 */
export interface BatchResult<T> {
  succeeded: T[];
  failed: { item: T; error: unknown }[];
}

/**
 * 限并发地跑一批任务。串行太慢（几百条要几分钟）、无上限并发会被服务端限流，
 * 默认 4 是实测比较稳的档位。
 *
 * 注意：单个任务失败不中断整批 —— 记下来继续跑，最后把失败项交给调用方展示。
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchResult<T>> {
  const succeeded: T[] = [];
  const failed: { item: T; error: unknown }[] = [];
  const total = items.length;
  const size = Math.max(1, Math.min(limit, total));
  let cursor = 0;
  let done = 0;

  const runner = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= total) return;
      const item = items[index];
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
export function pruneSelection(
  selected: string[],
  alive: Set<string>,
): string[] {
  const next = selected.filter((id) => alive.has(id));
  return next.length === selected.length ? selected : next;
}
