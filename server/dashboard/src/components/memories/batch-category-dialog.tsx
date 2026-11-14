"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildCategoryChoices,
  normalizeSelection,
  toggleCategory,
} from "@/lib/memory-categories";
import type { CategoryOp } from "@/lib/batch-memories";
import type { CategoryEntry, Memory } from "@/types/api";

const OP_LABELS: Record<CategoryOp, { title: string; hint: string }> = {
  replace: {
    title: "替换为",
    hint: "选中记忆的分类整体换成勾选的这几个；一个都不勾 = 清空分类。",
  },
  add: {
    title: "追加",
    hint: "在每条记忆原有的分类上补上勾选的这几个，原有标签不动。",
  },
  remove: {
    title: "移除",
    hint: "从每条记忆的分类里摘掉勾选的这几个，其余保留。",
  },
};

/**
 * 批量改分类。语义有心智负担（替换 vs 追加 vs 移除，勾 0 个的含义三者都不同），
 * 所以把影响范围写死在弹窗里：条数、三种语义的说明、以及提交前的实际效果预览。
 */
export function BatchCategoryDialog({
  open,
  selected,
  catalog,
  busy,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  selected: Memory[];
  catalog: CategoryEntry[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (op: CategoryOp, names: string[]) => void;
}) {
  const [op, setOp] = useState<CategoryOp>("replace");
  const [picked, setPicked] = useState<string[]>([]);
  const [customName, setCustomName] = useState("");

  // 每次打开都从干净状态开始，避免上一轮的勾选被无意带过来
  useEffect(() => {
    if (open) {
      setOp("replace");
      setPicked([]);
      setCustomName("");
    }
  }, [open]);

  // 候选 = 分类目录 + 选中记忆身上挂着的目录外标签（不显示出来就会被「替换」悄悄清掉）
  const onSelected = useMemo(() => {
    const names: string[] = [];
    for (const memory of selected) {
      for (const name of memory.categories ?? []) {
        if (!names.includes(name)) names.push(name);
      }
    }
    return names;
  }, [selected]);

  const choices = useMemo(() => {
    const base = buildCategoryChoices(onSelected, catalog);
    const known = new Set(base.map((choice) => choice.name));
    const extra = picked
      .filter((name) => !known.has(name))
      .map((name) => ({
        name,
        description: "手动输入的标签（不在当前分类目录里）。",
        enabled: false,
        stale: true,
      }));
    return [...base, ...extra];
  }, [onSelected, catalog, picked]);

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    setPicked((list) => (list.includes(name) ? list : [...list, name]));
    setCustomName("");
  };

  const cleaned = normalizeSelection(picked);
  const requiresPick = op !== "replace";
  const canSubmit =
    !busy && selected.length > 0 && (!requiresPick || cleaned.length > 0);
  const clearing = op === "replace" && cleaned.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>批量改分类</DialogTitle>
        <DialogDescription>
          将作用于已选的 {selected.length} 条记忆。
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <RadioGroup
            value={op}
            onValueChange={(value) => setOp(value as CategoryOp)}
            className="gap-1"
          >
            {(Object.keys(OP_LABELS) as CategoryOp[]).map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-default-secondary-hover"
              >
                <RadioGroupItem value={key} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {OP_LABELS[key].title}
                  </span>
                  <span className="block text-xs text-onSurface-default-tertiary">
                    {OP_LABELS[key].hint}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <div className="space-y-1.5">
            <Label className="text-xs text-onSurface-default-tertiary">
              分类（可多选）
            </Label>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-memBorder-primary p-2">
              {choices.length === 0 && (
                <p className="px-1 py-2 text-xs text-onSurface-default-tertiary">
                  分类目录是空的，可以直接在下面输入一个分类名。
                </p>
              )}
              {choices.map((choice) => (
                <label
                  key={choice.name}
                  className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-surface-default-secondary-hover"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={picked.includes(choice.name)}
                    onCheckedChange={() =>
                      setPicked((list) => toggleCategory(list, choice.name))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="truncate">{choice.name}</span>
                      {choice.stale && (
                        <span className="shrink-0 rounded bg-surface-tertiary px-1 text-[10px] text-onSurface-default-tertiary">
                          目录外
                        </span>
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
              <Input
                value={customName}
                placeholder="输入一个分类名，回车添加"
                onChange={(event) => setCustomName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustom();
                  }
                }}
                className="h-8 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!customName.trim()}
                onClick={addCustom}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          <p className="text-xs text-onSurface-default-tertiary">
            {op === "replace" &&
              (clearing
                ? `将清空这 ${selected.length} 条记忆的全部分类。`
                : `将把这 ${selected.length} 条记忆的分类设为：${cleaned.join(" / ")}`)}
            {op === "add" &&
              `将给这 ${selected.length} 条记忆补上：${cleaned.join(" / ") || "（还没选）"}`}
            {op === "remove" &&
              `将从这 ${selected.length} 条记忆里移除：${cleaned.join(" / ") || "（还没选）"}`}
          </p>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <X className="mr-1 size-3.5" />
              取消
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={() => onApply(op, cleaned)}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                  处理中…
                </>
              ) : (
                <>
                  <Check className="mr-1 size-3.5" />
                  应用到 {selected.length} 条
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
