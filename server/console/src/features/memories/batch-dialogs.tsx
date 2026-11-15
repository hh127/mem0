/**
 * 批量操作对话框：批量设置分类、批量设置到期日。
 *
 * 服务端没有批量接口，这里只收集「要改成什么」，真正的逐条并发由页面执行。
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Modal } from "@/ui/modal";
import { Button, Checkbox, Field, Input } from "@/ui/primitives";
import type { CategoryOp } from "./batch";
import { dateStringFromToday } from "./memory-utils";

const OP_OPTIONS: { value: CategoryOp; label: string; hint: string }[] = [
  { value: "add", label: "追加", hint: "保留原有分类，添加上勾选的分类" },
  { value: "replace", label: "替换", hint: "把分类整体换成勾选项（一个都不勾 = 清空分类）" },
  { value: "remove", label: "移除", hint: "从原有分类里摘掉勾选的分类" },
];

export function BatchCategoryDialog({
  open,
  onClose,
  onApply,
  categoryNames,
  count,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (op: CategoryOp, names: string[]) => void;
  categoryNames: readonly string[];
  count: number;
  busy: boolean;
}) {
  const [op, setOp] = useState<CategoryOp>("add");
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!open) return;
    setOp("add");
    setPicked([]);
    setCustom("");
  }, [open]);

  const options = useMemo(() => {
    const names = new Set(categoryNames);
    for (const name of picked) names.add(name);
    return [...names].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [categoryNames, picked]);

  const toggle = (name: string) => {
    setPicked((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const addCustom = () => {
    const name = custom.trim();
    if (!name) return;
    setPicked((current) => (current.includes(name) ? current : [...current, name]));
    setCustom("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="批量设置分类"
      description={`将修改选中的 ${count} 条记忆；逐条提交，单条失败不会中断其余条目。`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => onApply(op, picked)}>
            应用
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">操作方式</legend>
          {OP_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 hover:bg-panel-2/50"
            >
              <input
                type="radio"
                name="batch-category-op"
                className="mt-1 size-4 accent-[var(--c-accent)]"
                checked={op === option.value}
                onChange={() => setOp(option.value)}
              />
              <span className="space-y-0.5">
                <span className="block text-sm text-ink">{option.label}</span>
                <span className="block text-xs text-ink-faint">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">分类</p>
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
            {options.length === 0 ? (
              <p className="px-1 py-2 text-xs text-ink-faint">分类目录为空，可在下方输入自定义分类。</p>
            ) : (
              options.map((name) => (
                <label
                  key={name}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-panel-2"
                >
                  <Checkbox checked={picked.includes(name)} onChange={() => toggle(name)} aria-label={`选择分类 ${name}`} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <Field label="自定义分类" htmlFor="batch-custom-category" hint="不在目录里的分类也可以直接输入。">
          <div className="flex gap-2">
            <Input
              id="batch-custom-category"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="例如：项目背景"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button variant="secondary" onClick={addCustom} disabled={!custom.trim()}>
              添加
            </Button>
          </div>
        </Field>

        <p className="rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs leading-5 text-ink-soft">
          已勾选 {picked.length} 个分类。
          {op === "replace" && picked.length === 0 ? " 替换模式且未勾选任何分类 = 清空这些记忆的分类。" : null}
        </p>
      </div>
    </Modal>
  );
}

export function BatchExpiryDialog({
  open,
  onClose,
  onApply,
  count,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (value: string | null) => void;
  count: number;
  busy: boolean;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="批量设置到期日"
      description={`将修改选中的 ${count} 条记忆的到期日；逐条提交，单条失败不会中断其余条目。`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => onApply(value ? value : null)}>
            应用
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="到期日" htmlFor="batch-expiry-date" hint="留空并应用 = 设为永不过期。">
          <Input
            id="batch-expiry-date"
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "一周后", days: 7 },
            { label: "30 天后", days: 30 },
            { label: "90 天后", days: 90 },
          ].map((item) => (
            <Button
              key={item.label}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setValue(dateStringFromToday(item.days))}
            >
              {item.label}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setValue("")}>
            清空（永不过期）
          </Button>
        </div>
        <p className="flex items-start gap-1.5 rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs leading-5 text-ink-soft">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
          到期后记忆会从默认列表与搜索中隐藏，数据仍在库中；清空日期即可恢复。
        </p>
      </div>
    </Modal>
  );
}
