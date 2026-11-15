/**
 * 一个用 `<details>` 实现的复选下拉：用于分类多选。
 *
 * 不引入新的弹层依赖：`<details>/<summary>` 自带键盘展开/收起与焦点管理，
 * 面板里的复选框保持打开状态，方便连续勾选。
 */
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox, buttonClass } from "@/ui/primitives";

export interface CheckboxOption {
  value: string;
  label: string;
  /** 右侧的计数（如该类记忆条数）。 */
  count?: number;
}

export function CheckboxPopover({
  label,
  options,
  selected,
  onChange,
  emptyText = "暂无可选项",
  disabled = false,
  align = "left",
}: {
  label: string;
  options: readonly CheckboxOption[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  emptyText?: string;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const selectedSet = new Set(selected);

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <details className={cn("relative", disabled && "pointer-events-none opacity-50")}>
      <summary
        className={buttonClass("secondary", "sm", "max-w-full cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden")}
        aria-label={label}
      >
        <SlidersHorizontal className="size-3.5" />
        <span>{label}</span>
        {selected.length > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-medium leading-4 text-accent">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="size-3.5 text-ink-faint" />
      </summary>
      <div
        className={cn(
          "absolute top-[calc(100%+0.4rem)] z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel p-2 shadow-xl",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-[11px] text-ink-faint">共 {options.length} 项</span>
          <button
            type="button"
            className="text-[11px] text-accent hover:underline disabled:opacity-40"
            disabled={selected.length === 0}
            onClick={() => onChange([])}
          >
            清空
          </button>
        </div>
        {options.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-ink-faint">{emptyText}</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-ink hover:bg-panel-2"
              >
                <Checkbox
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
                  aria-label={`筛选分类 ${option.label}`}
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {typeof option.count === "number" ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{option.count}</span>
                ) : null}
              </label>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
