/**
 * 记忆审核：管理员按「待审核 / 已驳回」两个队列处理记忆。
 *
 * 审核状态写在记忆 metadata 的 `review_status` 里：没有这个字段 = 待审核。
 * 通过后记忆进入记忆库（不再出现在审核列表），驳回后从记忆库和语义检索中隐藏，
 * 但仍保留在库里，可恢复或彻底删除。
 *
 * 队列同时支持按「临时记忆 / 永久记忆」（有无到期日）和分类筛选。
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FilterX,
  Inbox,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn, errorMessage, formatNumber } from "@/lib/utils";
import { ConfirmDialog, Modal } from "@/ui/modal";
import { Button, Card, Input, Select, Textarea, buttonClass } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Pagination } from "@/ui/table";
import { useToast } from "@/ui/toast";
import { CheckboxPopover } from "@/features/memories/checkbox-popover";
import { batchSummary, pruneSelection, runWithConcurrency } from "@/features/memories/batch";
import {
  deleteMemory,
  fetchCategoryCatalog,
  fetchMemories,
  memoryKeys,
  reviewMemory,
  type ReviewAction,
} from "@/features/memories/memory-api";
import type { Memory } from "@/features/memories/types";
import { ReviewCard } from "./review-card";
import { ReviewEditModal } from "./review-edit-modal";
import {
  categoryOptionsFor,
  filterReviewMemories,
  reviewCounts,
  sortByCreatedDesc,
  type KindFilter,
  type ReviewTab,
} from "./review-utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

const REVIEW_TABS: { value: ReviewTab; label: string }[] = [
  { value: "pending", label: "待审核" },
  { value: "rejected", label: "已驳回" },
];

export function ReviewPage() {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<ReviewTab>("pending");
  const [kind, setKind] = useState<KindFilter>("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [approveRequest, setApproveRequest] = useState<Memory[] | null>(null);
  const [rejectRequest, setRejectRequest] = useState<Memory[] | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [deleteRequest, setDeleteRequest] = useState<Memory[] | null>(null);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);

  // 管理员全量拉取（最多 1000 条），待审核/已驳回在本地分流。
  const listQuery = useQuery({
    queryKey: [...memoryKeys.list({}, true), "review"],
    queryFn: ({ signal }) => fetchMemories({}, true, signal),
  });

  const catalogQuery = useQuery({
    queryKey: memoryKeys.categories,
    queryFn: ({ signal }) => fetchCategoryCatalog(signal),
  });

  const memories = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const counts = useMemo(() => reviewCounts(memories), [memories]);

  const filtered = useMemo(() => {
    const rows = filterReviewMemories(memories, { tab, kind, categories, keyword });
    return sortByCreatedDesc(rows);
  }, [memories, tab, kind, categories, keyword]);

  const categoryOptions = useMemo(
    () => categoryOptionsFor(memories, tab, catalogQuery.data?.names ?? []),
    [memories, tab, catalogQuery.data],
  );

  useEffect(() => {
    setPage(1);
  }, [tab, kind, categories, keyword]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  const aliveIds = useMemo(() => new Set(filtered.map((memory) => memory.id)), [filtered]);
  useEffect(() => {
    setSelectedIds((previous) => pruneSelection(previous, aliveIds));
  }, [aliveIds]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMemories = useMemo(
    () => filtered.filter((memory) => selectedSet.has(memory.id)),
    [filtered, selectedSet],
  );
  const pageIds = useMemo(() => paged.map((memory) => memory.id), [paged]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleSelectPage = () => {
    setSelectedIds((current) =>
      allPageSelected
        ? current.filter((id) => !pageIds.includes(id))
        : Array.from(new Set([...current, ...pageIds])),
    );
  };

  const refresh = () => void listQuery.refetch();

  // ------------------------------------------------------------ 单条审核
  const singleReview = useMutation({
    mutationFn: (input: { id: string; action: ReviewAction; note?: string }) =>
      reviewMemory(input.id, input.action, input.note),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      success(input.action === "approve" ? "已通过，记忆已进入记忆库" : "已驳回");
    },
    onError: (error) => toastError(errorMessage(error, "审核失败")),
  });

  // ------------------------------------------------------------ 批量审核
  const runBatch = async (
    label: string,
    items: readonly Memory[],
    worker: (memory: Memory) => Promise<unknown>,
  ) => {
    if (items.length === 0 || batchBusy) return;
    setBatchBusy(true);
    setBatchProgress({ done: 0, total: items.length });
    try {
      const result = await runWithConcurrency(items, 4, worker, (done, total) =>
        setBatchProgress({ done, total }),
      );
      setSelectedIds(result.failed.map((failure) => failure.item.id));
      if (result.failed.length === 0) {
        success(batchSummary(label, result));
      } else {
        toastError(
          `${batchSummary(label, result)}。首个错误：${errorMessage(result.failed[0]?.error, "未知错误")}`,
        );
      }
    } finally {
      setBatchBusy(false);
      setBatchProgress(null);
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
    }
  };

  const approveMany = (items: readonly Memory[]) => {
    setApproveRequest(null);
    void runBatch(tab === "pending" ? "批量通过" : "批量恢复", items, (memory) =>
      reviewMemory(memory.id, "approve"),
    );
  };

  const openReject = (items: readonly Memory[]) => {
    setRejectNote("");
    setRejectRequest([...items]);
  };

  const confirmReject = () => {
    const items = rejectRequest ?? [];
    setRejectRequest(null);
    void runBatch("驳回", items, (memory) => reviewMemory(memory.id, "reject", rejectNote));
  };

  const confirmDelete = () => {
    const items = deleteRequest ?? [];
    setDeleteRequest(null);
    void runBatch("彻底删除", items, (memory) => deleteMemory(memory.id));
  };

  // ------------------------------------------------------------ 渲染
  const isRefreshing = listQuery.isFetching;
  const isForbidden = listQuery.error instanceof ApiError && listQuery.error.status === 403;
  const hasFilters = kind !== "all" || categories.length > 0 || keyword.trim().length > 0;
  const busy = batchBusy || singleReview.isPending;

  return (
    <div className={cn("space-y-4", selectedIds.length > 0 && "pb-4")}>
      <PageHeader
        eyebrow="记忆"
        title="记忆审核"
        description="逐条确认 AI 写入的记忆：有问题可以直接编辑或删除；通过后归档到记忆库，驳回后从记忆库和语义检索中隐藏。"
        actions={
          <Button variant="ghost" size="icon" aria-label="刷新审核列表" disabled={isRefreshing} onClick={refresh}>
            <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs text-ink-faint">待审核</p>
            <p className="font-display text-2xl text-ink">{formatNumber(counts.pending)}</p>
          </div>
          <ShieldCheck className="size-6 text-warn" />
        </Card>
        <Card className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs text-ink-faint">待审核 · 临时记忆</p>
            <p className="font-display text-2xl text-ink">
              {formatNumber(counts.pendingTemporary)}
            </p>
          </div>
          <span className="text-[11px] text-ink-faint">有到期日</span>
        </Card>
        <Card className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs text-ink-faint">待审核 · 永久记忆</p>
            <p className="font-display text-2xl text-ink">
              {formatNumber(counts.pendingPermanent)}
            </p>
          </div>
          <span className="text-[11px] text-ink-faint">永不过期</span>
        </Card>
      </div>

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5"
            role="group"
            aria-label="审核队列"
          >
            {REVIEW_TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={tab === item.value}
                className={buttonClass(tab === item.value ? "secondary" : "ghost", "sm")}
                onClick={() => setTab(item.value)}
              >
                {item.label}
                <span className="tabular-nums text-ink-faint">
                  {formatNumber(item.value === "pending" ? counts.pending : counts.rejected)}
                </span>
              </button>
            ))}
          </div>

          <Select
            aria-label="记忆类型"
            className="h-8 w-36 text-xs"
            value={kind}
            onChange={(event) => setKind(event.target.value as KindFilter)}
          >
            <option value="all">全部类型</option>
            <option value="temporary">临时记忆</option>
            <option value="permanent">永久记忆</option>
          </Select>

          <CheckboxPopover
            label="分类"
            options={categoryOptions}
            selected={categories}
            onChange={setCategories}
            emptyText="分类目录为空"
          />

          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              aria-label="搜索待审核记忆"
              className="h-8 pl-8 text-xs"
              placeholder="按正文或分类过滤"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>

          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setKind("all");
                setCategories([]);
                setKeyword("");
              }}
            >
              <FilterX className="size-3.5" />
              清除筛选
            </Button>
          ) : null}

          <Button variant="secondary" size="sm" onClick={toggleSelectPage} disabled={pageIds.length === 0}>
            {allPageSelected ? "取消本页全选" : "全选本页"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
          <span>
            {tab === "pending" ? "待审核" : "已驳回"} {formatNumber(filtered.length)} 条
          </span>
          {hasFilters ? <span>（已筛选）</span> : null}
          <span>已选 {selectedIds.length} 条</span>
          <span className="text-ink-faint">审核是后台动作：未审核的记忆仍可被 AI 检索。</span>
        </div>
      </Card>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2/60 px-3 py-2 text-xs text-ink-soft">
          <span>已选 {selectedIds.length} 条</span>
          {tab === "pending" ? (
            <>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => setApproveRequest(selectedMemories)}>
                <Check className="size-3.5" />
                批量通过
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => openReject(selectedMemories)}>
                <X className="size-3.5" />
                批量驳回
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger-soft"
                disabled={busy}
                onClick={() => setDeleteRequest(selectedMemories)}
              >
                <Trash2 className="size-3.5" />
                彻底删除
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setApproveRequest(selectedMemories)}>
                <Check className="size-3.5" />
                批量恢复通过
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger-soft"
                disabled={busy}
                onClick={() => setDeleteRequest(selectedMemories)}
              >
                <Trash2 className="size-3.5" />
                彻底删除
              </Button>
            </>
          )}
          <button
            type="button"
            className="ml-auto text-ink-faint hover:text-ink"
            onClick={() => setSelectedIds([])}
          >
            清空选择
          </button>
          {batchProgress ? (
            <span className="tabular-nums text-ink-faint">
              处理中 {batchProgress.done}/{batchProgress.total}
            </span>
          ) : null}
        </div>
      ) : null}

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center rounded-[var(--radius-card)] border border-line bg-panel py-16 text-sm text-ink-soft">
          正在加载待审核记忆…
        </div>
      ) : listQuery.isError ? (
        isForbidden ? (
          <ErrorState
            title="没有访问权限"
            message="记忆审核只对管理员开放。普通用户可以在记忆库查看自己作用域内的记忆。"
            onRetry={refresh}
          />
        ) : (
          <ErrorState
            title="审核列表加载失败"
            message={errorMessage(listQuery.error)}
            onRetry={refresh}
          />
        )
      ) : filtered.length === 0 ? (
        hasFilters || keyword.trim() ? (
          <EmptyState
            icon={Search}
            title="没有匹配的记忆"
            description="当前筛选条件下没有结果，换个类型或分类试试。"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setKind("all");
                  setCategories([]);
                  setKeyword("");
                }}
              >
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title={tab === "pending" ? "待审核队列已清空" : "没有已驳回的记忆"}
            description={
              tab === "pending"
                ? "新写入的记忆会自动出现在这里；有问题可以直接编辑或删除，确认无误后通过。"
                : "被驳回的记忆会保留在库里，可以编辑修正后恢复，或者彻底删除。"
            }
          />
        )
      ) : (
        <div className="space-y-2">
          {paged.map((memory) => (
            <ReviewCard
              key={memory.id}
              memory={memory}
              selected={selectedSet.has(memory.id)}
              onToggleSelect={toggleSelect}
              onApprove={(item) => singleReview.mutate({ id: item.id, action: "approve" })}
              onReject={(item) => openReject([item])}
              onEdit={(item) => setEditTarget(item)}
              onDelete={(item) => setDeleteRequest([item])}
              busy={busy}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 ? (
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={filtered.length}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={approveRequest !== null}
        onClose={() => setApproveRequest(null)}
        onConfirm={() => approveMany(approveRequest ?? [])}
        title={`${tab === "pending" ? "通过" : "恢复通过"}所选 ${approveRequest?.length ?? 0} 条记忆？`}
        description={
          tab === "pending"
            ? "通过后这些记忆会进入记忆库，不再出现在待审核队列；正文和分类不会改变。"
            : "恢复后这些记忆会重新进入记忆库，并从已驳回队列中移除。"
        }
        confirmLabel={tab === "pending" ? "确认通过" : "确认恢复"}
        danger={false}
      />

      <Modal
        open={rejectRequest !== null}
        onClose={() => setRejectRequest(null)}
        title={`驳回所选 ${rejectRequest?.length ?? 0} 条记忆？`}
        description="驳回后记忆会从记忆库和语义检索中隐藏，但仍保留在库里，可随时恢复。"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectRequest(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={confirmReject}>
              确认驳回
            </Button>
          </>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-soft">驳回理由（可选，最多 500 字）</span>
          <Textarea
            rows={3}
            maxLength={500}
            placeholder="例如：内容重复 / 信息不准确 / 不该长期保留"
            value={rejectNote}
            onChange={(event) => setRejectNote(event.target.value)}
          />
        </label>
      </Modal>

      <ConfirmDialog
        open={deleteRequest !== null}
        onClose={() => setDeleteRequest(null)}
        onConfirm={confirmDelete}
        title={`彻底删除所选 ${deleteRequest?.length ?? 0} 条记忆？`}
        description="删除后无法恢复：向量与历史记录都会从库里移除。建议先确认这些记忆确实不需要保留。"
        confirmLabel="彻底删除"
      />

      <ReviewEditModal
        memory={editTarget}
        catalogNames={catalogQuery.data?.names ?? []}
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}
