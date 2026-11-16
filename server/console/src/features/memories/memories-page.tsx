/**
 * 记忆库：旗舰页面。
 *
 * 数据面：管理员可浏览全量（最多 1000 条）并按实体过滤；普通用户由服务端强制
 * 限定在 `memory_scope`。语义搜索走 `POST /search`，浏览态走 `GET /memories`，
 * 两者共用同一套本地筛选（分类）、分页与批量操作。
 *
 * URL 查询参数：`category`（可重复）、`user_id` / `agent_id` / `run_id`、`q`。
 * 从记忆地图或其它页面跳转过来时，筛选会直接生效。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  FilterX,
  Info,
  LayoutGrid,
  Library,
  List,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareCheckBig,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn, errorMessage, formatNumber } from "@/lib/utils";
import { ConfirmDialog } from "@/ui/modal";
import { Button, Card, Checkbox, Input, Select, buttonClass } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Pagination } from "@/ui/table";
import { useToast } from "@/ui/toast";
import { BatchCategoryDialog, BatchExpiryDialog } from "./batch-dialogs";
import { applyCategoryOp, batchSummary, pruneSelection, runWithConcurrency, type CategoryOp } from "./batch";
import { CheckboxPopover } from "./checkbox-popover";
import { CreateMemoryModal } from "./create-memory-modal";
import { MemoryCard } from "./memory-card";
import { MemoryDetailModal } from "./memory-detail-modal";
import { MemoryListSkeleton } from "./memory-skeleton";
import { MemoryTable } from "./memory-table";
import {
  GLOBAL_SEARCH_MAX_TARGETS,
  deleteMemory,
  fetchCategoryCatalog,
  fetchEntities,
  fetchMemories,
  hasEntityFilter,
  memoryKeys,
  searchMemories,
  updateMemory,
} from "./memory-api";
import {
  categoriesOf,
  localDateString,
  matchesKeyword,
  matchesReviewView,
  reviewStatusOf,
  type ReviewView,
} from "./memory-utils";
import type { Memory, MemoryFilters } from "./types";

const REVIEW_VIEW_OPTIONS: { value: ReviewView; label: string }[] = [
  { value: "visible", label: "全部（不含驳回）" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

const ENTITY_TYPE_LABELS = { user: "用户", agent: "代理", run: "运行" } as const;
type EntityTypeValue = "" | "user" | "agent" | "run";

export function MemoriesPage() {
  const { user, isAdmin } = useSession();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // ------------------------------------------------------------ URL 状态
  const activeCategories = useMemo(
    () => searchParams.getAll("category").filter((name) => name.length > 0),
    [searchParams],
  );
  const categoryKey = activeCategories.join("\u0000");
  const urlUserId = searchParams.get("user_id") ?? "";
  const urlAgentId = searchParams.get("agent_id") ?? "";
  const urlRunId = searchParams.get("run_id") ?? "";
  const urlQuery = (searchParams.get("q") ?? "").trim();

  // ------------------------------------------------------------ 本地状态
  const [queryInput, setQueryInput] = useState(urlQuery);
  const [searchMode, setSearchMode] = useState<"semantic" | "keyword">("semantic");
  const [rerank, setRerank] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [reviewView, setReviewView] = useState<ReviewView>("visible");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [expiryDialogOpen, setExpiryDialogOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [detailMemory, setDetailMemory] = useState<Memory | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [entityType, setEntityType] = useState<EntityTypeValue>(
    urlUserId ? "user" : urlAgentId ? "agent" : urlRunId ? "run" : "",
  );
  const [entityValue, setEntityValue] = useState(urlUserId || urlAgentId || urlRunId);

  // URL 被外部改变（地图跳转、浏览器前进/后退）时同步回本地控件。
  useEffect(() => {
    setQueryInput(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const nextType: EntityTypeValue = urlUserId ? "user" : urlAgentId ? "agent" : urlRunId ? "run" : "";
    setEntityType(nextType);
    setEntityValue(urlUserId || urlAgentId || urlRunId);
  }, [urlUserId, urlAgentId, urlRunId]);

  useEffect(() => {
    setPage(1);
  }, [categoryKey, urlQuery, urlUserId, urlAgentId, urlRunId, showExpired, searchMode, rerank]);

  // ------------------------------------------------------------ 数据查询
  const scopeUserId = !isAdmin ? user?.memory_scope ?? user?.id ?? "" : "";

  const filters = useMemo<MemoryFilters>(() => {
    const base: MemoryFilters = scopeUserId ? { user_id: scopeUserId } : {};
    if (!entityValue) return base;
    if (entityType === "user") return { user_id: scopeUserId || entityValue };
    if (entityType === "agent") return { ...base, agent_id: entityValue };
    if (entityType === "run") return { ...base, run_id: entityValue };
    return base;
  }, [entityType, entityValue, scopeUserId]);

  const listQuery = useQuery({
    queryKey: memoryKeys.list(filters, showExpired),
    queryFn: ({ signal }) => fetchMemories(filters, showExpired, signal),
  });

  const semanticActive = searchMode === "semantic" && urlQuery.length > 0;
  // mem0 的 /search 要求 filters 至少带一个实体。管理员没选实体时按实体扇出搜索并合并。
  const globalSearchActive = isAdmin && semanticActive && !hasEntityFilter(filters);
  const searchQuery = useQuery({
    queryKey: memoryKeys.search(urlQuery, filters, rerank, showExpired),
    queryFn: ({ signal }) =>
      searchMemories({
        query: urlQuery,
        filters,
        rerank,
        showExpired,
        signal,
        globalFallback: isAdmin,
      }),
    enabled: semanticActive,
  });

  const entitiesQuery = useQuery({
    queryKey: memoryKeys.entities,
    queryFn: ({ signal }) => fetchEntities(signal),
  });

  const catalogQuery = useQuery({
    queryKey: memoryKeys.categories,
    queryFn: ({ signal }) => fetchCategoryCatalog(signal),
  });

  // ------------------------------------------------------------ 派生数据
  const baseMemories = useMemo(() => {
    const source = semanticActive ? searchQuery.data ?? [] : listQuery.data ?? [];
    if (showExpired) return source;
    // 管理员的「全量」接口是原始列表，可能包含已过期记忆；这里补一层本地过滤，
    // 让「显示已过期」开关对管理员同样生效。
    const today = localDateString();
    return source.filter(
      (memory) => !memory.expiration_date || memory.expiration_date.slice(0, 10) >= today,
    );
  }, [semanticActive, searchQuery.data, listQuery.data, showExpired]);

  const keyword = searchMode === "keyword" ? urlQuery : "";

  const filteredMemories = useMemo(() => {
    let rows = baseMemories.filter((memory) => matchesReviewView(memory, reviewView));
    if (activeCategories.length > 0) {
      rows = rows.filter((memory) => {
        const names = categoriesOf(memory);
        return activeCategories.some((name) => names.includes(name));
      });
    }
    if (keyword) rows = rows.filter((memory) => matchesKeyword(memory, keyword));
    return rows;
  }, [baseMemories, activeCategories, keyword, reviewView]);

  const reviewTally = useMemo(() => {
    let pending = 0;
    let rejected = 0;
    for (const memory of baseMemories) {
      const status = reviewStatusOf(memory);
      if (status === "pending") pending += 1;
      else if (status === "rejected") rejected += 1;
    }
    return { pending, rejected };
  }, [baseMemories]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const memory of baseMemories) {
      for (const name of categoriesOf(memory)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  }, [baseMemories]);

  const categoryOptions = useMemo(() => {
    const names = new Set<string>(catalogQuery.data?.names ?? []);
    for (const name of categoryCounts.keys()) names.add(name);
    return [...names]
      .map((name) => ({ value: name, label: name, count: categoryCounts.get(name) ?? 0 }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
  }, [catalogQuery.data, categoryCounts]);

  const entityOptions = useMemo(() => {
    if (!entityType) return [];
    return (entitiesQuery.data ?? [])
      .filter((entity) => entity.type === entityType)
      .sort(
        (left, right) =>
          right.total_memories - left.total_memories || left.id.localeCompare(right.id),
      );
  }, [entitiesQuery.data, entityType]);

  const pageCount = Math.max(1, Math.ceil(filteredMemories.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedMemories = useMemo(
    () => filteredMemories.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredMemories, currentPage, pageSize],
  );

  // ------------------------------------------------------------ 选择状态
  const aliveIds = useMemo(() => new Set(baseMemories.map((memory) => memory.id)), [baseMemories]);
  useEffect(() => {
    setSelectedIds((previous) => pruneSelection(previous, aliveIds));
  }, [aliveIds]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMemories = useMemo(
    () => baseMemories.filter((memory) => selectedSet.has(memory.id)),
    [baseMemories, selectedSet],
  );
  const pageIds = useMemo(() => pagedMemories.map((memory) => memory.id), [pagedMemories]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  const isLoading = semanticActive ? searchQuery.isLoading : listQuery.isLoading;
  const activeError = semanticActive ? searchQuery.error : listQuery.error;
  const isRefreshing = semanticActive ? searchQuery.isFetching : listQuery.isFetching;
  const isForbidden = activeError instanceof ApiError && activeError.status === 403;

  const refetchActive = () => {
    if (semanticActive) void searchQuery.refetch();
    else void listQuery.refetch();
  };

  // ------------------------------------------------------------ URL 写入
  const updateSearchParams = (patch: Record<string, string | string[] | null>) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          next.delete(key);
          if (Array.isArray(value)) {
            for (const item of value) if (item) next.append(key, item);
          } else if (value) {
            next.set(key, value);
          }
        }
        return next;
      },
      { replace: true },
    );
  };

  const submitSearch = () => {
    updateSearchParams({ q: queryInput.trim() || null });
    setPage(1);
  };

  const resetFiltersAndSearch = () => {
    setQueryInput("");
    setEntityType("");
    setEntityValue("");
    setShowExpired(false);
    setReviewView("visible");
    updateSearchParams({ q: null, category: null, user_id: null, agent_id: null, run_id: null });
    setPage(1);
  };

  const setCategories = (names: string[]) => {
    updateSearchParams({ category: names.length > 0 ? names : null });
    setPage(1);
  };

  const changeEntityType = (next: EntityTypeValue) => {
    setEntityType(next);
    setEntityValue("");
    updateSearchParams({ user_id: null, agent_id: null, run_id: null });
    setPage(1);
  };

  const changeEntityValue = (next: string) => {
    setEntityValue(next);
    updateSearchParams({
      user_id: entityType === "user" ? next || null : null,
      agent_id: entityType === "agent" ? next || null : null,
      run_id: entityType === "run" ? next || null : null,
    });
    setPage(1);
  };

  // ------------------------------------------------------------ 批量操作
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };

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

  const runBatch = async (label: string, items: readonly Memory[], worker: (memory: Memory) => Promise<unknown>) => {
    if (items.length === 0 || batchBusy) return;
    setBatchBusy(true);
    setBatchProgress({ done: 0, total: items.length });
    try {
      const result = await runWithConcurrency(items, 4, worker, (done, total) =>
        setBatchProgress({ done, total }),
      );
      // 只保留失败项：用户可以直接再点一次重试，成功的不会重复执行。
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

  const applyBatchCategories = (op: CategoryOp, names: string[]) => {
    setCategoryDialogOpen(false);
    void runBatch("批量设置分类", selectedMemories, (memory) =>
      updateMemory(memory.id, { categories: applyCategoryOp(categoriesOf(memory), names, op) }),
    );
  };

  const applyBatchExpiry = (value: string | null) => {
    setExpiryDialogOpen(false);
    void runBatch("批量设置到期日", selectedMemories, (memory) =>
      updateMemory(memory.id, { expiration_date: value }),
    );
  };

  const applyBatchDelete = () => {
    setBatchDeleteOpen(false);
    void runBatch("批量删除", selectedMemories, (memory) => deleteMemory(memory.id));
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDetailMemory(null);
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      success("记忆已删除");
    },
    onError: (error) => toastError(errorMessage(error, "删除记忆失败")),
  });

  // ------------------------------------------------------------ 渲染
  const hasActiveFilters = activeCategories.length > 0 || Boolean(entityValue) || reviewView !== "visible";
  const entityTypeLabel = entityType ? ENTITY_TYPE_LABELS[entityType] : "实体";

  return (
    <div className={cn("space-y-4", selectedIds.length > 0 && "pb-24")}>
      <PageHeader
        eyebrow="记忆"
        title="记忆库"
        description="浏览、语义检索、编辑与清理记忆。"
        actions={
          <>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新建记忆
            </Button>
            <Button
              variant={selectMode ? "accent-soft" : "secondary"}
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              <SquareCheckBig className="size-4" />
              批量选择
            </Button>
            <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5">
              <button
                type="button"
                aria-pressed={view === "cards"}
                className={buttonClass(view === "cards" ? "secondary" : "ghost", "sm")}
                onClick={() => setView("cards")}
              >
                <LayoutGrid className="size-3.5" />
                卡片
              </button>
              <button
                type="button"
                aria-pressed={view === "table"}
                className={buttonClass(view === "table" ? "secondary" : "ghost", "sm")}
                onClick={() => setView("table")}
              >
                <List className="size-3.5" />
                表格
              </button>
            </div>
            <Button variant="ghost" size="icon" aria-label="刷新记忆列表" disabled={isRefreshing} onClick={refetchActive}>
              <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
            </Button>
          </>
        }
      />

      {!isAdmin ? (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-panel-2/60 px-3 py-2 text-xs text-ink-soft">
          <Info className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <span>
            当前账号是普通用户，只能查看记忆作用域「{scopeUserId || "未配置"}」内的记忆；管理员可浏览全量记忆。
          </span>
        </div>
      ) : null}

      {isAdmin && reviewTally.pending > 0 && reviewView !== "pending" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft/50 px-3 py-2 text-xs text-ink-soft">
          <ShieldCheck className="size-3.5 shrink-0 text-warn" />
          <span>
            有 {formatNumber(reviewTally.pending)} 条记忆还没人工审核；通过后会归档到记忆库。
          </span>
          <Link to="/review" className="font-medium text-accent hover:underline">
            去审核
          </Link>
          <button
            type="button"
            className="ml-auto text-ink-faint hover:text-ink"
            onClick={() => setReviewView("pending")}
          >
            只看待审核
          </button>
        </div>
      ) : null}

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="实体类型"
            className="h-8 w-28 text-xs"
            value={entityType}
            onChange={(event) => changeEntityType(event.target.value as EntityTypeValue)}
          >
            <option value="">全部实体</option>
            <option value="user">用户</option>
            <option value="agent">代理</option>
            <option value="run">运行</option>
          </Select>
          <Select
            aria-label={`按${entityTypeLabel}筛选`}
            className="h-8 w-52 text-xs"
            value={entityValue}
            onChange={(event) => changeEntityValue(event.target.value)}
            disabled={!entityType}
          >
            <option value="">全部{entityType ? entityTypeLabel : "实体"}</option>
            {entityOptions.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.id}（{entity.total_memories} 条）
              </option>
            ))}
          </Select>

          <CheckboxPopover
            label="分类"
            options={categoryOptions}
            selected={activeCategories}
            onChange={setCategories}
            emptyText="分类目录为空"
          />

          <Select
            aria-label="审核状态"
            className="h-8 w-40 text-xs"
            value={reviewView}
            onChange={(event) => {
              setReviewView(event.target.value as ReviewView);
              setPage(1);
            }}
          >
            {REVIEW_VIEW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              aria-label="搜索记忆"
              className="h-8 pl-8 text-xs"
              placeholder={
                searchMode === "semantic"
                  ? "语义搜索：描述你要找的内容，回车执行"
                  : "关键词搜索：在已加载的记忆中过滤"
              }
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch();
                }
              }}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={submitSearch}>
            <Search className="size-3.5" />
            搜索
          </Button>

          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="搜索模式">
            <button
              type="button"
              aria-pressed={searchMode === "semantic"}
              className={buttonClass(searchMode === "semantic" ? "secondary" : "ghost", "sm")}
              onClick={() => setSearchMode("semantic")}
            >
              语义
            </button>
            <button
              type="button"
              aria-pressed={searchMode === "keyword"}
              className={buttonClass(searchMode === "keyword" ? "secondary" : "ghost", "sm")}
              onClick={() => setSearchMode("keyword")}
            >
              关键词
            </button>
          </div>

          {searchMode === "semantic" ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
              <Checkbox
                checked={rerank}
                onChange={() => setRerank((value) => !value)}
                aria-label="语义搜索使用重排"
              />
              使用重排
            </label>
          ) : null}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
            <Checkbox
              checked={showExpired}
              onChange={() => setShowExpired((value) => !value)}
              aria-label="显示已过期记忆"
            />
            显示已过期
          </label>
          {urlQuery || hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={resetFiltersAndSearch}>
              <FilterX className="size-3.5" />
              清除筛选
            </Button>
          ) : null}
        </div>

        {activeCategories.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-faint">分类筛选：</span>
            {activeCategories.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-transparent bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
              >
                {name}
                <button
                  type="button"
                  aria-label={`移除分类筛选 ${name}`}
                  className="text-accent/70 hover:text-accent"
                  onClick={() => setCategories(activeCategories.filter((item) => item !== name))}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="text-[11px] text-ink-faint hover:text-ink"
              onClick={() => setCategories([])}
            >
              清除分类
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
          <span>共 {formatNumber(baseMemories.length)} 条</span>
          {reviewTally.pending > 0 ? (
            <span>待审核 {formatNumber(reviewTally.pending)} 条</span>
          ) : null}
          {reviewTally.rejected > 0 ? (
            <span>已驳回 {formatNumber(reviewTally.rejected)} 条</span>
          ) : null}
          <span>当前视图 {formatNumber(filteredMemories.length)} 条</span>
          {urlQuery ? (
            <span>
              {searchMode === "semantic" ? `语义搜索「${urlQuery}」· 按相关度排序` : `关键词「${urlQuery}」· 本地匹配`}
              {searchMode === "semantic" ? (rerank ? " · 已重排" : " · 未重排") : ""}
              {globalSearchActive
                ? ` · 未选实体，已按实体逐个搜索并合并（最多 ${GLOBAL_SEARCH_MAX_TARGETS} 个）`
                : ""}
            </span>
          ) : null}
          {!isAdmin && scopeUserId ? <span>作用域 {scopeUserId}</span> : null}
        </div>
      </Card>

      {selectMode ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs text-ink-soft">
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={allPageSelected} onChange={toggleSelectPage} aria-label="全选当前页" />
            全选当前页
          </label>
          <span>已选 {selectedIds.length} 条</span>
          <button type="button" className="text-accent hover:underline" onClick={() => setSelectedIds(filteredMemories.map((memory) => memory.id))}>
            全选筛选结果（{filteredMemories.length}）
          </button>
          <button type="button" className="text-ink-faint hover:text-ink" onClick={() => setSelectedIds([])}>
            清空选择
          </button>
          <button type="button" className="ml-auto text-ink-faint hover:text-ink" onClick={exitSelectMode}>
            退出批量选择
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <MemoryListSkeleton view={view} />
      ) : activeError ? (
        isForbidden ? (
          <ErrorState
            title="没有访问权限"
            message="当前账号是普通用户，服务端只允许查询分配给自己的记忆。请用上方的用户/实体筛选指定作用域，或联系管理员提升权限。"
            onRetry={refetchActive}
          />
        ) : (
          <ErrorState message={errorMessage(activeError, "记忆加载失败")} onRetry={refetchActive} />
        )
      ) : filteredMemories.length === 0 ? (
        <EmptyState
          icon={Library}
          title={
            urlQuery ? "没有匹配的记忆" : hasActiveFilters ? "没有符合条件的记忆" : "暂无记忆"
          }
          description={
            urlQuery
              ? searchMode === "semantic"
                ? `语义搜索「${urlQuery}」没有命中，换个说法或关闭重排再试。`
                : `关键词「${urlQuery}」在已加载的记忆里没有命中。`
              : hasActiveFilters
                ? "当前筛选条件下没有记忆，清除筛选或调整条件后再试。"
                : "写入记忆后，这里会显示正文、分类、归属实体与到期信息。"
          }
          action={
            urlQuery || hasActiveFilters ? (
              <Button variant="secondary" size="sm" onClick={resetFiltersAndSearch}>
                清除全部筛选
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" />
                新建第一条记忆
              </Button>
            )
          }
        />
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pagedMemories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              selectMode={selectMode}
              selected={selectedSet.has(memory.id)}
              onToggleSelect={toggleSelect}
              onOpen={setDetailMemory}
            />
          ))}
        </div>
      ) : (
        <MemoryTable
          memories={pagedMemories}
          selectMode={selectMode}
          selectedIds={selectedSet}
          allPageSelected={allPageSelected}
          onToggleSelect={toggleSelect}
          onTogglePage={toggleSelectPage}
          onOpen={setDetailMemory}
        />
      )}

      {!isLoading && !activeError && filteredMemories.length > 0 ? (
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={filteredMemories.length}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}

      {selectedIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(56rem,calc(100vw-2rem))] flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/95 px-4 py-3 shadow-2xl backdrop-blur">
          <span className="text-sm font-medium text-ink">已选 {selectedIds.length} 条</span>
          {batchProgress ? (
            <span className="text-xs text-ink-soft">
              处理中 {batchProgress.done}/{batchProgress.total}
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={batchBusy} onClick={() => setCategoryDialogOpen(true)}>
              <Tags className="size-3.5" />
              设置分类
            </Button>
            <Button variant="secondary" size="sm" disabled={batchBusy} onClick={() => setExpiryDialogOpen(true)}>
              <CalendarClock className="size-3.5" />
              设置到期日
            </Button>
            <Button variant="danger" size="sm" disabled={batchBusy} onClick={() => setBatchDeleteOpen(true)}>
              <Trash2 className="size-3.5" />
              批量删除
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={batchBusy}
              onClick={() => {
                setSelectedIds([]);
                setSelectMode(false);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <CreateMemoryModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => setPage(1)} />

      <MemoryDetailModal
        memory={detailMemory}
        open={Boolean(detailMemory)}
        onClose={() => setDetailMemory(null)}
        onRequestDelete={(memory) => setDeleteTarget(memory)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        title="删除记忆"
        description="删除后无法恢复，确定要删除这条记忆吗？"
        confirmLabel="删除"
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={applyBatchDelete}
        title={`批量删除 ${selectedIds.length} 条记忆`}
        description="将逐条删除选中的记忆，单条失败不会中断其余条目；此操作不可撤销。"
        confirmLabel="删除"
      />

      <BatchCategoryDialog
        open={categoryDialogOpen}
        onClose={() => setCategoryDialogOpen(false)}
        onApply={applyBatchCategories}
        categoryNames={catalogQuery.data?.names ?? []}
        count={selectedIds.length}
        busy={batchBusy}
      />

      <BatchExpiryDialog
        open={expiryDialogOpen}
        onClose={() => setExpiryDialogOpen(false)}
        onApply={applyBatchExpiry}
        count={selectedIds.length}
        busy={batchBusy}
      />
    </div>
  );
}
