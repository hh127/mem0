/**
 * 记忆详情弹窗：编辑正文、维护分类与到期日、查看 metadata 和历史、删除、复制。
 *
 * 所有写操作都走 `PUT /memories/{id}`（服务端对正文会重新分类），
 * 读最新详情用 `GET /memories/{id}`，历史用 `GET /memories/{id}/history`。
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Pencil, Trash2, X } from "lucide-react";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Modal } from "@/ui/modal";
import { Badge, Button, Field, Input, Select, Textarea } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { normalizeCategories } from "./batch";
import {
  fetchCategoryCatalog,
  fetchMemoryDetail,
  fetchMemoryHistory,
  memoryKeys,
  updateMemory,
} from "./memory-api";
import { categoriesOf, expiryInfo, historyEventLabel, metadataEntries } from "./memory-utils";
import type { Memory } from "./types";

export function MemoryDetailModal({
  memory,
  open,
  onClose,
  onRequestDelete,
}: {
  memory: Memory | null;
  open: boolean;
  onClose: () => void;
  onRequestDelete: (memory: Memory) => void;
}) {
  const memoryId = memory?.id ?? null;
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const detailQuery = useQuery({
    queryKey: memoryKeys.detail(memoryId ?? ""),
    queryFn: ({ signal }) => fetchMemoryDetail(memoryId as string, signal),
    enabled: open && Boolean(memoryId),
  });
  const detail = detailQuery.data ?? memory;

  const historyQuery = useQuery({
    queryKey: memoryKeys.history(memoryId ?? ""),
    queryFn: ({ signal }) => fetchMemoryHistory(memoryId as string, signal),
    enabled: open && Boolean(memoryId),
  });

  const catalogQuery = useQuery({
    queryKey: memoryKeys.categories,
    queryFn: ({ signal }) => fetchCategoryCatalog(signal),
    enabled: open,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<string[] | null>(null);
  const [customCategory, setCustomCategory] = useState("");
  const [expiryDraft, setExpiryDraft] = useState("");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    setIsEditing(false);
    setCategoryDraft(null);
    setCustomCategory("");
  }, [memoryId, open]);

  useEffect(() => {
    setExpiryDraft(detail?.expiration_date ?? "");
  }, [detail?.id, detail?.expiration_date]);

  const textMutation = useMutation({
    mutationFn: async (input: { id: string; text: string; before: string[] }) => {
      await updateMemory(input.id, { text: input.text });
      const refreshed = await fetchMemoryDetail(input.id).catch(() => null);
      return { before: input.before, refreshed };
    },
    onSuccess: async ({ before, refreshed }) => {
      setIsEditing(false);
      if (refreshed) queryClient.setQueryData<Memory>(memoryKeys.detail(refreshed.id), refreshed);
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      success("正文已更新");
      if (refreshed) {
        const after = categoriesOf(refreshed);
        if (after.join("|") !== before.join("|")) {
          success(
            after.length > 0
              ? `服务端已按新内容重新分类：${after.join("、")}`
              : "服务端已按新内容重新分类：暂无匹配分类",
          );
        }
      }
    },
    onError: (error) => toastError(errorMessage(error, "保存正文失败")),
  });

  const categoriesMutation = useMutation({
    mutationFn: async (input: { id: string; categories: string[] }) => {
      await updateMemory(input.id, { categories: input.categories });
      return input;
    },
    onSuccess: async ({ id, categories }) => {
      queryClient.setQueryData<Memory>(memoryKeys.detail(id), (current) =>
        current ? { ...current, categories } : current,
      );
      setCategoryDraft(null);
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      success("分类已更新");
    },
    onError: (error) => toastError(errorMessage(error, "保存分类失败")),
  });

  const expiryMutation = useMutation({
    mutationFn: async (input: { id: string; value: string | null }) => {
      await updateMemory(input.id, { expiration_date: input.value });
      return input;
    },
    onSuccess: async ({ id, value }) => {
      setExpiryDraft(value ?? "");
      queryClient.setQueryData<Memory>(memoryKeys.detail(id), (current) =>
        current ? { ...current, expiration_date: value } : current,
      );
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      success(value ? `到期日已设为 ${value}` : "已设为永不过期");
    },
    onError: (error) => toastError(errorMessage(error, "更新到期日失败")),
  });

  const copyText = async () => {
    if (!detail) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(detail.memory);
      success("正文已复制到剪贴板");
    } catch {
      toastError("复制失败：浏览器未授予剪贴板权限，请手动选择文本复制");
    } finally {
      setCopying(false);
    }
  };

  const categories = detail ? categoriesOf(detail) : [];
  const currentCategories = categoryDraft ?? categories;
  const catalogNames = catalogQuery.data?.names ?? [];
  const availableCategories = catalogNames.filter((name) => !currentCategories.includes(name));
  const expiry = expiryInfo(detail?.expiration_date);
  const expiryTone =
    expiry.tone === "expired"
      ? "danger"
      : expiry.tone === "soon"
        ? "warn"
        : expiry.tone === "none"
          ? "outline"
          : "neutral";
  const metadata = metadataEntries(detail?.metadata);
  const categoriesDirty = categoryDraft !== null;

  const addCategory = (name: string) => {
    setCategoryDraft(normalizeCategories([...currentCategories, name]));
  };

  const addCustomCategory = () => {
    const name = customCategory.trim();
    if (!name) return;
    addCategory(name);
    setCustomCategory("");
  };

  const saveText = () => {
    if (!detail) return;
    const text = textDraft.trim();
    if (!text) {
      toastError("记忆内容不能为空");
      return;
    }
    if (text === detail.memory) {
      setIsEditing(false);
      return;
    }
    textMutation.mutate({ id: detail.id, text, before: categories });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="记忆详情"
      description={detail ? `ID ${detail.id}` : "正在加载记忆…"}
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger hover:bg-danger-soft"
            disabled={!detail}
            onClick={() => {
              if (detail) onRequestDelete(detail);
            }}
          >
            <Trash2 className="size-4" />
            删除
          </Button>
          <Button variant="secondary" loading={copying} disabled={!detail} onClick={() => void copyText()}>
            <Copy className="size-4" />
            复制正文
          </Button>
          <Button variant="primary" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {!detail ? (
        detailQuery.isError ? (
          <div className="flex flex-col items-start gap-3 py-10">
            <p className="text-sm text-danger">记忆加载失败：{errorMessage(detailQuery.error)}</p>
            <Button variant="secondary" size="sm" onClick={() => void detailQuery.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-10 text-sm text-ink-soft">
            <Loader2 className="size-4 animate-spin" />
            正在加载记忆…
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            <Badge tone={expiryTone}>{expiry.label}</Badge>
            {typeof detail.score === "number" ? (
              <Badge tone="accent" className="font-mono">
                相关度 {detail.score.toFixed(3)}
              </Badge>
            ) : null}
            <span className="font-mono">{detail.hash ?? "无 hash"}</span>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">正文</h3>
              {isEditing ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setTextDraft(detail.memory);
                    setIsEditing(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                  编辑正文
                </Button>
              )}
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="记忆正文"
                  rows={5}
                  value={textDraft}
                  autoFocus
                  onChange={(event) => setTextDraft(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={textMutation.isPending}
                    onClick={saveText}
                  >
                    保存
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={textMutation.isPending}
                    onClick={() => setIsEditing(false)}
                  >
                    取消
                  </Button>
                  <span className="text-[11px] text-ink-faint">保存后服务端会按当前分类目录重新打标。</span>
                </div>
              </div>
            ) : (
              <p className="prose-memory rounded-lg border border-line bg-panel-2/40 p-3 text-sm text-ink">
                {detail.memory}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">分类</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {currentCategories.length === 0 ? (
                <span className="text-xs text-ink-faint">尚未归类</span>
              ) : null}
              {currentCategories.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full border border-transparent bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                >
                  {name}
                  <button
                    type="button"
                    aria-label={`移除分类 ${name}`}
                    className="text-accent/70 hover:text-accent"
                    onClick={() => setCategoryDraft(currentCategories.filter((item) => item !== name))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="添加已有分类"
                className="h-8 w-40 text-xs"
                value=""
                onChange={(event) => {
                  const name = event.target.value;
                  if (name) addCategory(name);
                }}
              >
                <option value="">选择已有分类…</option>
                {availableCategories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="自定义分类"
                className="h-8 w-36 text-xs"
                placeholder="自定义分类"
                value={customCategory}
                onChange={(event) => setCustomCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomCategory();
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={!customCategory.trim()}
                onClick={addCustomCategory}
              >
                添加
              </Button>
            </div>
            {categoriesDirty ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={categoriesMutation.isPending}
                  onClick={() => categoriesMutation.mutate({ id: detail.id, categories: currentCategories })}
                >
                  保存分类
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCategoryDraft(null)}>
                  重置
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-ink-faint">可直接移除或添加分类；保存后写入服务端。</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">到期日</h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="到期日期" htmlFor="detail-expiry" hint="空 = 永不过期" className="w-48">
                <Input
                  id="detail-expiry"
                  type="date"
                  value={expiryDraft}
                  onChange={(event) => setExpiryDraft(event.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                size="sm"
                loading={expiryMutation.isPending}
                disabled={(detail.expiration_date ?? "") === expiryDraft}
                onClick={() => expiryMutation.mutate({ id: detail.id, value: expiryDraft || null })}
              >
                保存
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={expiryMutation.isPending || !detail.expiration_date}
                onClick={() => expiryMutation.mutate({ id: detail.id, value: null })}
              >
                设为永不过期
              </Button>
            </div>
            <p className="text-[11px] text-ink-faint">
              到期后记忆会从默认列表与搜索中隐藏，数据仍在库中；清空日期即可恢复。
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">归属与时间</h3>
            <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              {[
                ["user_id", detail.user_id ?? "—"],
                ["agent_id", detail.agent_id ?? "—"],
                ["run_id", detail.run_id ?? "—"],
                ["hash", detail.hash ?? "—"],
                ["创建时间", formatDateTime(detail.created_at)],
                ["更新时间", formatDateTime(detail.updated_at)],
              ].map(([label, value]) => (
                <div key={label} className="space-y-0.5">
                  <dt className="text-ink-faint">{label}</dt>
                  <dd className="break-all font-mono text-ink-soft">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              元数据（只读 JSON）
            </h3>
            {metadata.length === 0 ? (
              <p className="text-xs text-ink-faint">无元数据。</p>
            ) : (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-panel-2/40 p-3 font-mono text-[11px] leading-5 text-ink-soft">
                {JSON.stringify(detail.metadata ?? {}, null, 2)}
              </pre>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">历史记录</h3>
              {historyQuery.isFetching ? <Loader2 className="size-3.5 animate-spin text-ink-faint" /> : null}
            </div>
            {historyQuery.isError ? (
              <p className="text-xs text-danger">历史加载失败：{errorMessage(historyQuery.error)}</p>
            ) : historyQuery.isLoading ? (
              <p className="text-xs text-ink-faint">正在加载历史…</p>
            ) : (historyQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-ink-faint">暂无历史记录。</p>
            ) : (
              <ol className="space-y-2">
                {(historyQuery.data ?? []).map((entry, index) => (
                  <li
                    key={entry.id ?? `${entry.event}-${index}`}
                    className="rounded-lg border border-line bg-panel-2/40 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                      <Badge tone={entry.event === "ADD" ? "ok" : entry.event === "DELETE" ? "danger" : "neutral"}>
                        {historyEventLabel(entry.event)}
                      </Badge>
                      <span>{formatDateTime(entry.created_at)}</span>
                    </div>
                    {entry.old_memory && entry.old_memory !== entry.new_memory ? (
                      <p className="mt-1 break-words text-xs leading-5 text-ink-faint line-through">
                        {entry.old_memory}
                      </p>
                    ) : null}
                    {entry.new_memory ? (
                      <p className="mt-1 break-words text-xs leading-5 text-ink-soft">{entry.new_memory}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
