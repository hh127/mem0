"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CategoryTag } from "@/components/categories/category-tag";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import {
  buildCategoryChoices,
  categoriesChanged,
  normalizeSelection,
  toggleCategory,
} from "@/lib/memory-categories";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS, MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import type { CategoryCatalog, Memory } from "@/types/api";

/**
 * 手工改一条记忆的分类标签。
 *
 * 自动打标只在写入时跑一次，之后标签是只读的 —— 模型判断错了（或者分类目录后来改了），
 * 以前只能在库里手改 payload。这里补上 UI：勾选/取消 → PUT /memories/{id} {categories}。
 * 目录里已经删掉的老标签不会丢：它们单独列在「目录外的标签」里，可以保留或取消。
 */
export function MemoryCategoriesEditor({
  memory,
  onSaved,
}: {
  memory: Memory;
  onSaved?: (next: string[]) => void;
}) {
  const current = useMemo(() => memory.categories ?? [], [memory.categories]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(current);
  const [isSaving, setIsSaving] = useState(false);

  // 切到另一条记忆时重置草稿
  useEffect(() => {
    setEditing(false);
    setSelected(current);
  }, [memory.id, current]);

  const { data: catalog } = useApiQuery<CategoryCatalog>(async () => {
    const response = await api.get(CATEGORY_ENDPOINTS.BASE);
    return response.data as CategoryCatalog;
  });
  const entries = useMemo(() => catalog?.custom_categories ?? [], [catalog]);
  // 目录里的分类 + 目录外的历史标签（分类被删除/停用后仍挂在记忆上）
  const choices = useMemo(
    () => buildCategoryChoices(current, entries),
    [current, entries],
  );

  const toggle = (name: string) =>
    setSelected((list) => toggleCategory(list, name));

  const dirty = categoriesChanged(current, selected);

  const save = async () => {
    const next = normalizeSelection(selected);
    setIsSaving(true);
    try {
      await api.put(MEMORY_ENDPOINTS.BY_ID(memory.id), {
        categories: next,
      });
      setSelected(next);
      setEditing(false);
      onSaved?.(next);
      toast({
        title: next.length ? `已改为 ${next.length} 个分类` : "已清空分类",
        description: next.join(" / ") || "这条记忆现在没有分类标签。",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "分类保存失败",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-onSurface-default-tertiary">分类</span>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => {
              setSelected(current);
              setEditing(true);
            }}
          >
            <Pencil className="size-3" />
            修改分类
          </Button>
        )}
      </div>

      {!editing ? (
        current.length ? (
          <div className="flex flex-wrap gap-1">
            {current.map((name) => (
              <CategoryTag
                key={name}
                name={name}
                muted={!catalog?.names.includes(name)}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-onSurface-default-tertiary">
            还没有分类标签。可以手动指定，也可以改完正文后让模型下次写入时重打。
          </p>
        )
      ) : (
        <div className="space-y-2 rounded-md border border-memBorder-primary p-2">
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {choices.map((choice) => (
              <label
                key={choice.name}
                className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-surface-default-secondary-hover"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.includes(choice.name)}
                  onCheckedChange={() => toggle(choice.name)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span className="truncate">{choice.name}</span>
                    {choice.stale ? (
                      <span className="shrink-0 rounded bg-surface-tertiary px-1 text-[10px] text-onSurface-default-tertiary">
                        目录外
                      </span>
                    ) : (
                      choice.enabled === false && (
                        <span className="shrink-0 rounded bg-surface-tertiary px-1 text-[10px] text-onSurface-default-tertiary">
                          已停用
                        </span>
                      )
                    )}
                  </span>
                  {choice.description && (
                    <span className="line-clamp-2 text-[11px] leading-4 text-onSurface-default-tertiary">
                      {choice.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={isSaving || !dirty}
              onClick={() => void save()}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                  保存中…
                </>
              ) : (
                <>
                  <Check className="mr-1 size-3.5" />
                  保存分类
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSaving}
              onClick={() => {
                setSelected(current);
                setEditing(false);
              }}
            >
              <X className="mr-1 size-3.5" />
              取消
            </Button>
            <span className="text-xs tabular-nums text-onSurface-default-tertiary">
              已选 {selected.length}
            </span>
          </div>
          <p className="text-[11px] leading-4 text-onSurface-default-tertiary">
            手工分类会覆盖模型的判断；下次改正文或重新写入时，模型可能再打一次标签。
          </p>
        </div>
      )}
    </div>
  );
}
