import type { CategoryEntry } from "@/types/api";

/**
 * 改分类弹窗的纯逻辑。
 *
 * 弹窗是 Radix Sheet 里的客户端交互，无头环境下点不到 —— 所以判定「选了哪些、变没变、
 * 脏不脏」这些容易出错的部分放这里，用 node 直接跑断言（见 bin 里的 mem0-categories-test）。
 */

export interface CategoryChoice extends CategoryEntry {
  /** true = 分类目录里已经删掉，但这条记忆上还挂着。 */
  stale: boolean;
}

/**
 * 候选列表 = 目录里的分类（保持目录顺序）+ 目录外的历史标签（追加在后面）。
 * 目录外的标签必须显示出来：否则一保存就把用户看不见的标签清掉了。
 */
export function buildCategoryChoices(
  current: string[],
  catalog: CategoryEntry[],
): CategoryChoice[] {
  const known = new Set(catalog.map((entry) => entry.name));
  const fromCatalog: CategoryChoice[] = catalog.map((entry) => ({
    ...entry,
    stale: false,
  }));
  const staleEntries: CategoryChoice[] = current
    .filter((name) => !known.has(name))
    .map((name) => ({
      name,
      description: "当前分类目录里已经没有这个分类。",
      enabled: false,
      stale: true,
    }));
  return [...fromCatalog, ...staleEntries];
}

/** 勾上/取消一个分类，保持勾选顺序（不排序：用户的勾选顺序更直观）。 */
export function toggleCategory(selected: string[], name: string): string[] {
  return selected.includes(name)
    ? selected.filter((item) => item !== name)
    : [...selected, name];
}

/** 与当前标签相比有没有变化 —— 用集合比较，顺序不同不算改动。 */
export function categoriesChanged(
  current: string[],
  selected: string[],
): boolean {
  if (current.length !== selected.length) return true;
  const currentSet = new Set(current);
  return selected.some((name) => !currentSet.has(name));
}

/** 提交前归一化，跟服务端 _normalize_manual_categories 保持一致：去空白、去重、丢空串。 */
export function normalizeSelection(selected: string[]): string[] {
  const cleaned: string[] = [];
  for (const item of selected) {
    const name = item.trim();
    if (!name || cleaned.includes(name)) continue;
    cleaned.push(name);
  }
  return cleaned;
}
