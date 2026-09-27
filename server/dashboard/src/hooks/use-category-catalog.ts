"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/hooks/use-api-query";
import { countByCategory } from "@/lib/category-utils";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS, MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import type { CategoryCatalog, CategoryEntry, Memory } from "@/types/api";

// Keep in sync with ALL_MEMORIES_LIMIT in server/main.py.
export const MEMORY_FETCH_LIMIT = 1000;

export interface CategoryStat extends CategoryEntry {
  count: number;
}

interface CatalogSnapshot {
  catalog: CategoryCatalog | null;
  memories: Memory[];
}

/**
 * The category catalog plus every memory, so pages can count tags without an extra
 * endpoint. Counts are computed over the newest MEMORY_FETCH_LIMIT memories — the same
 * window the memories page lists.
 */
export function useCategoryCatalog() {
  const { data, isLoading, refetch } = useApiQuery<CatalogSnapshot>(
    async () => {
      const [catalogResponse, memoriesResponse] = await Promise.all([
        api.get(CATEGORY_ENDPOINTS.BASE),
        api.get(MEMORY_ENDPOINTS.BASE, {
          params: { top_k: MEMORY_FETCH_LIMIT },
        }),
      ]);
      const raw = memoriesResponse.data?.results ?? memoriesResponse.data ?? [];
      return {
        catalog: (catalogResponse.data as CategoryCatalog) ?? null,
        memories: Array.isArray(raw) ? (raw as Memory[]) : [],
      };
    },
    {
      errorToast: "分类数据加载失败",
      initialData: { catalog: null, memories: [] },
    },
  );

  const catalog = data?.catalog ?? null;
  const memories = data?.memories ?? [];

  const stats = useMemo<CategoryStat[]>(() => {
    const counts = countByCategory(memories);
    return (catalog?.custom_categories ?? []).map((entry) => ({
      ...entry,
      count: counts.get(entry.name) ?? 0,
    }));
  }, [catalog, memories]);

  const uncategorized = useMemo(
    () => memories.filter((memory) => (memory.categories ?? []).length === 0).length,
    [memories],
  );

  return {
    catalog,
    rules: catalog?.custom_category_rules ?? [],
    stats,
    memories,
    uncategorized,
    totalMemories: memories.length,
    isLoading,
    refetch,
  };
}
