"use client";

import { CalendarClock, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 选中多条记忆后浮在页面底部的操作条。
 * 只负责收集意图（改分类/设到期日/删除/退出），真正的请求由页面统一跑，便于显示进度和失败统计。
 */
export function BatchSelectionBar({
  selectedCount,
  filteredCount,
  pageCount,
  allPageSelected,
  busy,
  progress,
  onTogglePage,
  onSelectAllFiltered,
  onClear,
  onEditCategories,
  onEditExpiry,
  onDelete,
  onExit,
}: {
  selectedCount: number;
  filteredCount: number;
  pageCount: number;
  allPageSelected: boolean;
  busy: boolean;
  progress: { done: number; total: number } | null;
  onTogglePage: () => void;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  onEditCategories: () => void;
  onEditExpiry: () => void;
  onDelete: () => void;
  onExit: () => void;
}) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="sticky bottom-4 z-20 mx-auto flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-memBorder-primary bg-surface-default-primary/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium tabular-nums">
          已选 {selectedCount} 条
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || pageCount === 0}
          onClick={onTogglePage}
        >
          {allPageSelected ? "取消本页" : `全选本页（${pageCount}）`}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={
            busy || filteredCount === 0 || selectedCount === filteredCount
          }
          onClick={onSelectAllFiltered}
        >
          全选筛选结果（{filteredCount}）
        </Button>
        {hasSelection && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={onClear}
          >
            清空
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {busy && progress && (
          <span className="text-xs tabular-nums text-onSurface-default-tertiary">
            处理中 {progress.done}/{progress.total}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!hasSelection || busy}
          onClick={onEditCategories}
        >
          <Tag className="mr-1 size-3.5" />
          改分类
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasSelection || busy}
          onClick={onEditExpiry}
        >
          <CalendarClock className="mr-1 size-3.5" />
          设到期日
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-onSurface-danger-primary"
          disabled={!hasSelection || busy}
          onClick={onDelete}
        >
          <Trash2 className="mr-1 size-3.5" />
          删除
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onExit}>
          <X className="mr-1 size-3.5" />
          退出选择
        </Button>
      </div>
    </div>
  );
}

/** 批量删除的二次确认：数量写在大字里，避免「以为只删了一条」。 */
export function BatchDeleteDialog({
  open,
  count,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>删除 {count} 条记忆</DialogTitle>
        <DialogDescription>
          这些记忆会从库里永久删除，无法撤销。
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "删除中…" : `确认删除 ${count} 条`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
