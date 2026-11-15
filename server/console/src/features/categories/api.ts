import { api } from "@/lib/api";
import type { CategoryCatalog, CategoryEntry } from "@/lib/types";

/** 分类测试接口返回的单个候选。 */
export interface CategoryCandidate {
  name: string;
  confidence: number;
  reason?: string | null;
}

/** POST /api/categories/test 的返回结构。 */
export interface CategoryTestResult {
  candidates: CategoryCandidate[];
  top: string | null;
  conflict: boolean;
  error: string | null;
  catalog_size: number;
}

/** 管理页草稿里的一条分类（description 在草稿里始终是字符串，便于编辑）。 */
export interface CategoryDraftEntry {
  name: string;
  description: string;
  enabled: boolean;
}

export interface CategoryDraft {
  entries: CategoryDraftEntry[];
  rules: string[];
}

export interface CategorySavePayload {
  custom_categories: CategoryDraftEntry[];
  custom_category_rules: string[];
}

export const categoryQueryKeys = {
  catalog: ["categories", "catalog"] as const,
};

export function fetchCategoryCatalog(): Promise<CategoryCatalog> {
  return api.get<CategoryCatalog>("/categories");
}

export function saveCategoryCatalog(
  payload: CategorySavePayload,
): Promise<CategoryCatalog> {
  return api.post<CategoryCatalog>("/categories", payload);
}

export function testCategoryText(text: string): Promise<CategoryTestResult> {
  return api.post<CategoryTestResult>("/categories/test", { text });
}

/** 把服务端目录转成可编辑草稿；`enabled` 缺省视为启用（服务端语义）。 */
export function catalogToDraft(catalog: CategoryCatalog): CategoryDraft {
  return {
    entries: catalog.custom_categories.map(
      (entry: CategoryEntry): CategoryDraftEntry => ({
        name: entry.name,
        description: entry.description ?? "",
        enabled: entry.enabled !== false,
      }),
    ),
    rules: [...catalog.custom_category_rules],
  };
}

export function draftSignature(draft: CategoryDraft): string {
  return JSON.stringify({
    entries: draft.entries.map((entry) => ({
      name: entry.name.trim(),
      description: entry.description.trim(),
      enabled: entry.enabled,
    })),
    rules: draft.rules.map((rule) => rule.trim()),
  });
}
