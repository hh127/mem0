"use client";

import Link from "next/link";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { MemoryMap } from "@/components/categories/memory-map";
import { useCategoryCatalog } from "@/hooks/use-category-catalog";

/**
 * 记忆地图 — 「记忆长什么样」的一屏全貌。
 * 与「分类浏览」的分工：那边是列表看局部细节，这边看图看结构
 * （哪块最重、哪些分类是空的、谁跟谁老是分不开）。
 */
export default function MemoryMapPage() {
  const { stats, memories, uncategorized, isLoading } = useCategoryCatalog();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold font-fustat">记忆地图</h1>
          <p className="text-sm text-onSurface-default-tertiary mt-1">
            一屏看清记忆压在哪些领域、哪些分类还空着、哪两类总是分不开。
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/categories">
            <Tag className="size-3.5 mr-1" />
            分类浏览
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : memories.length === 0 ? (
        <EmptyState
          title="暂无记忆"
          description="写入记忆后，这里会按分类画出分布与共现关系。"
        />
      ) : (
        <MemoryMap
          stats={stats}
          memories={memories}
          uncategorized={uncategorized}
        />
      )}
    </div>
  );
}
