import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { errorMessage } from "@/lib/utils";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Textarea,
  buttonClass,
} from "@/ui/primitives";
import { ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { useToast } from "@/ui/toast";
import {
  catalogToDraft,
  categoryQueryKeys,
  draftSignature,
  fetchCategoryCatalog,
  saveCategoryCatalog,
} from "./api";
import type { CategoryDraftEntry } from "./api";

const EMPTY_ENTRY: CategoryDraftEntry = {
  name: "",
  description: "",
  enabled: true,
};

export function CategoryManagePage() {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: categoryQueryKeys.catalog,
    queryFn: fetchCategoryCatalog,
  });

  const [entries, setEntries] = useState<CategoryDraftEntry[]>([]);
  const [rules, setRules] = useState<string[]>([]);
  const [baseline, setBaseline] = useState("");

  useEffect(() => {
    if (!data) return;
    const draft = catalogToDraft(data);
    setEntries(draft.entries);
    setRules(draft.rules);
    setBaseline(draftSignature(draft));
  }, [data]);

  const dirty = useMemo(
    () => draftSignature({ entries, rules }) !== baseline,
    [entries, rules, baseline],
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const validationErrors = useMemo(() => {
    const issues: string[] = [];
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const name = entry.name.trim();
      const label = name || `第 ${index + 1} 行`;
      if (!name) issues.push(`第 ${index + 1} 行：分类名称不能为空`);
      else if (seen.has(name)) issues.push(`分类名称「${name}」重复`);
      if (name) seen.add(name);
      if (!entry.description.trim()) {
        issues.push(`分类「${label}」的描述不能为空，分类器依赖描述判断边界`);
      }
    });
    return issues;
  }, [entries]);

  const resetDraft = () => {
    if (!data) return;
    const draft = catalogToDraft(data);
    setEntries(draft.entries);
    setRules(draft.rules);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveCategoryCatalog({
        custom_categories: entries.map((entry) => ({
          name: entry.name.trim(),
          description: entry.description.trim(),
          enabled: entry.enabled,
        })),
        custom_category_rules: rules
          .map((rule) => rule.trim())
          .filter((rule) => rule.length > 0),
      }),
    onSuccess: (catalog) => {
      queryClient.setQueryData(categoryQueryKeys.catalog, catalog);
      const draft = catalogToDraft(catalog);
      setEntries(draft.entries);
      setRules(draft.rules);
      setBaseline(draftSignature(draft));
      success("分类目录已保存");
    },
    onError: (err) => toastError(errorMessage(err, "保存分类目录失败")),
  });

  const handleSave = () => {
    if (validationErrors.length > 0) {
      toastError(validationErrors[0] ?? "请先修正分类草稿");
      return;
    }
    if (!dirty) return;
    saveMutation.mutate();
  };

  const updateEntry = (index: number, patch: Partial<CategoryDraftEntry>) => {
    setEntries((current) =>
      current.map((entry, currentIndex) =>
        currentIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  };

  const removeEntry = (index: number) => {
    setEntries((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const updateRule = (index: number, value: string) => {
    setRules((current) =>
      current.map((rule, currentIndex) => (currentIndex === index ? value : rule)),
    );
  };

  const removeRule = (index: number) => {
    setRules((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const moveRule = (index: number, delta: number) => {
    setRules((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item === undefined) return current;
      next.splice(target, 0, item);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="分类"
        title="分类管理"
        description="编辑分类目录与判定规则。保存后服务端会重新归一化目录（去重、去空格、丢弃无效条目）。"
        actions={
          <>
            <Link to="/categories" className={buttonClass("secondary", "md")}>
              <ArrowLeft className="size-4" />
              返回总览
            </Link>
            <Button
              variant="secondary"
              onClick={resetDraft}
              disabled={!dirty || saveMutation.isPending}
            >
              <RotateCcw className="size-4" />
              撤销修改
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saveMutation.isPending}
              disabled={!dirty}
            >
              <Save className="size-4" />
              保存目录
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取分类目录")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载分类目录…
        </div>
      ) : (
        <>
          {dirty ? (
            <p className="inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn-soft px-3 py-1 text-xs text-warn">
              有未保存的修改
            </p>
          ) : null}

          {validationErrors.length > 0 ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft/40 p-4 text-sm text-ink-soft"
            >
              <p className="font-medium text-danger">草稿还有 {validationErrors.length} 个问题</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
                {validationErrors.slice(0, 6).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">分类列表</p>
                <p className="text-xs text-ink-faint">
                  共 {entries.length} 个分类，停用的分类仍保留在目录中，但不会参与分类判定。
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEntries((current) => [...current, { ...EMPTY_ENTRY }])}
              >
                <Plus className="size-3.5" />
                新增分类
              </Button>
            </div>

            {entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
                还没有分类，点击「新增分类」开始配置。
              </p>
            ) : (
              <div className="space-y-2">
                {entries.map((entry, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-line bg-panel-2/40 p-3"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start">
                      <div className="flex items-center gap-2 md:w-28 md:pt-1.5">
                        <Checkbox
                          id={`category-enabled-${index}`}
                          checked={entry.enabled}
                          onChange={(event) =>
                            updateEntry(index, { enabled: event.target.checked })
                          }
                        />
                        <label
                          htmlFor={`category-enabled-${index}`}
                          className="text-xs text-ink-soft"
                        >
                          {entry.enabled ? "已启用" : "已停用"}
                        </label>
                      </div>
                      <div className="flex-1 space-y-2">
                        <Input
                          aria-label={`第 ${index + 1} 个分类的名称`}
                          value={entry.name}
                          placeholder="分类名称（必填）"
                          onChange={(event) =>
                            updateEntry(index, { name: event.target.value })
                          }
                        />
                        <Textarea
                          aria-label={`第 ${index + 1} 个分类的描述`}
                          className="min-h-[4.5rem] text-xs leading-5"
                          value={entry.description}
                          placeholder="分类描述（必填）：说明什么内容属于该分类、什么内容不属于它"
                          onChange={(event) =>
                            updateEntry(index, { description: event.target.value })
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`删除分类 ${entry.name || index + 1}`}
                        className="text-danger hover:text-danger"
                        onClick={() => removeEntry(index)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">判定规则</p>
                <p className="text-xs text-ink-faint">
                  按从上到下的顺序注入分类提示词，用来消解容易混淆的分类边界。
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRules((current) => [...current, ""])}
              >
                <Plus className="size-3.5" />
                新增规则
              </Button>
            </div>

            {rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
                暂无判定规则。规则可选，但对相近分类很有帮助。
              </p>
            ) : (
              <div className="space-y-2">
                {rules.map((rule, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-faint">
                      {index + 1}
                    </span>
                    <Input
                      aria-label={`第 ${index + 1} 条判定规则`}
                      value={rule}
                      placeholder="例如：涉及长期喜好的表述归入「个人偏好」，不要归入「行为习惯」"
                      onChange={(event) => updateRule(index, event.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="上移规则"
                      disabled={index === 0}
                      onClick={() => moveRule(index, -1)}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="下移规则"
                      disabled={index === rules.length - 1}
                      onClick={() => moveRule(index, 1)}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="删除规则"
                      className="text-danger hover:text-danger"
                      onClick={() => removeRule(index)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
