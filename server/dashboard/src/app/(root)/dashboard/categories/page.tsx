"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FlaskConical, Search, Settings2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import { CategoryTag } from "@/components/categories/category-tag";
import { MemoryCard } from "@/components/categories/memory-card";
import { useCategoryCatalog } from "@/hooks/use-category-catalog";
import { memoriesWithCategory } from "@/lib/category-utils";
import type { CategoryStat } from "@/hooks/use-category-catalog";

/**
 * 分类浏览 — "记忆属于什么领域". Cards are the entry point; the detail panel shows the
 * description (which *is* the classifier's rule) and the memories already tagged with it.
 */
export default function CategoriesBrowsePage() {
  const { catalog, rules, stats, memories, uncategorized, isLoading } = useCategoryCatalog();
  const [filter, setFilter] = useState("");
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [selected, setSelected] = useState<CategoryStat | null>(null);

  const visible = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    return stats
      .filter((stat) => includeDisabled || stat.enabled !== false)
      .filter(
        (stat) =>
          !keyword ||
          stat.name.toLowerCase().includes(keyword) ||
          stat.description.toLowerCase().includes(keyword),
      )
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [stats, filter, includeDisabled]);

  const selectedMemories = selected ? memoriesWithCategory(memories, selected.name) : [];
  const selectedRules = selected
    ? rules.filter((rule) => rule.includes(selected.name))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold font-fustat">分类浏览</h1>
          <p className="text-sm text-onSurface-default-tertiary mt-1">
            记忆按领域归类，标签在写入时由分类模型自动打上。
            {catalog && ` 当前目录 ${catalog.names.length} 个分类，启用 ${catalog.enabled_count} 个。`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/categories/test">
              <FlaskConical className="size-3.5 mr-1" />
              分类测试
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/categories/manage">
              <Settings2 className="size-3.5 mr-1" />
              分类管理
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜索分类名称或描述…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="w-72"
        />
        <label className="flex items-center gap-1.5 text-xs text-onSurface-default-tertiary select-none">
          <Switch checked={includeDisabled} onCheckedChange={setIncludeDisabled} />
          显示已停用分类
        </label>
        <span className="text-xs text-onSurface-default-tertiary">
          共 {visible.length} 个分类
        </span>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} columns={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="没有匹配的分类"
          description="换个关键词，或到「分类管理」新建一个分类。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((stat) => (
            <Card
              key={stat.name}
              className="border-memBorder-primary cursor-pointer transition-colors hover:border-onSurface-default-brand/40"
              onClick={() => setSelected(stat)}
            >
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tag className="size-3.5 shrink-0 text-onSurface-default-tertiary" />
                    <span className="truncate text-sm font-medium">{stat.name}</span>
                  </div>
                  {stat.enabled === false ? (
                    <span className="shrink-0 typo-caption-sm text-onSurface-default-tertiary">
                      已停用
                    </span>
                  ) : (
                    <span className="shrink-0 text-lg font-semibold tabular-nums">
                      {stat.count}
                    </span>
                  )}
                </div>
                <p className="line-clamp-3 text-xs leading-relaxed text-onSurface-default-tertiary">
                  {stat.description || "（无描述）"}
                </p>
              </CardContent>
            </Card>
          ))}

          <Card
            className="border-dashed border-memBorder-primary cursor-pointer transition-colors hover:border-onSurface-default-brand/40"
            onClick={() => setSelected(null)}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-onSurface-default-secondary">
                  尚未归类
                </span>
                <span className="text-lg font-semibold tabular-nums text-onSurface-default-secondary">
                  {uncategorized}
                </span>
              </div>
              <p className="text-xs text-onSurface-default-tertiary">
                这些记忆没有命中任何分类：可能是目录里缺一个分类，也可能是写入时分类模型没能判定。
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selected?.name}
            </SheetTitle>
            <SheetDescription>
              已有记忆 {selectedMemories.length} 条
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="mt-6 space-y-5">
              <div className="space-y-1.5">
                <Label className="text-xs text-onSurface-default-tertiary">
                  分类描述（分类模型的判断依据）
                </Label>
                <div className="rounded-md border border-memBorder-primary bg-surface-default-secondary p-3 text-sm leading-relaxed">
                  {selected.description || "（无描述）"}
                </div>
              </div>

              {selectedRules.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-onSurface-default-tertiary">
                    判定规则（目录规则中指向该分类的条目）
                  </Label>
                  <ul className="space-y-1.5">
                    {selectedRules.map((rule) => (
                      <li
                        key={rule}
                        className="rounded-md border border-memBorder-primary bg-surface-default-secondary px-3 py-2 text-xs leading-relaxed"
                      >
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-onSurface-default-tertiary">
                    该分类下的记忆
                  </Label>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                    <Link href={`/dashboard/memories?category=${encodeURIComponent(selected.name)}`}>
                      在记忆页打开
                    </Link>
                  </Button>
                </div>
                {selectedMemories.length === 0 ? (
                  <p className="text-xs text-onSurface-default-tertiary">
                    还没有记忆属于这个分类。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedMemories.slice(0, 20).map((memory) => (
                      <MemoryCard key={memory.id} memory={memory} />
                    ))}
                    {selectedMemories.length > 20 && (
                      <p className="text-xs text-onSurface-default-tertiary">
                        仅显示最近 20 条，其余请到记忆页查看。
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/categories/manage?edit=${encodeURIComponent(selected.name)}`}>
                  <Settings2 className="size-3.5 mr-1" />
                  编辑该分类
                </Link>
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
