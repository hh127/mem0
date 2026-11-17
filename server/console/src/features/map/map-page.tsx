/**
 * 记忆地图：分类分布 + 共现关系力导向图。
 *
 * 纯布局在 `./map-layout`（d3-force，确定性、可单测）。SVG 里的颜色全部来自
 * CSS token（`var(--c-accent)` / `fill-ink` 等），因此深色模式自动适配。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Library, Network, RefreshCw } from "lucide-react";
import { useSession } from "@/lib/session";
import { cn, errorMessage, formatNumber } from "@/lib/utils";
import { Badge, Button, Card, Checkbox } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import {
  MEMORY_FETCH_LIMIT,
  fetchCategoryCatalog,
  fetchMemories,
  memoryKeys,
} from "@/features/memories/memory-api";
import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  buildLayout,
  buildMapGraph,
  edgeOpacityFor,
  edgeWidthFor,
  neighborsOf,
  nodeFillOpacity,
  placeLabels,
  splitRecallable,
} from "./map-layout";

export function MapPage() {
  const { user, isAdmin } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const scopeUserId = !isAdmin ? user?.memory_scope ?? user?.id ?? "" : "";
  const filters = useMemo(() => (scopeUserId ? { user_id: scopeUserId } : {}), [scopeUserId]);

  const memoriesQuery = useQuery({
    queryKey: memoryKeys.list(filters, true),
    queryFn: ({ signal }) => fetchMemories(filters, true, signal),
  });
  const catalogQuery = useQuery({
    queryKey: memoryKeys.categories,
    queryFn: ({ signal }) => fetchCategoryCatalog(signal),
  });

  const isLoading = memoriesQuery.isLoading || catalogQuery.isLoading;
  const error = memoriesQuery.error ?? catalogQuery.error;
  const refetchAll = () => {
    void memoriesQuery.refetch();
    void catalogQuery.refetch();
  };

  const allMemories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);
  const recall = useMemo(() => splitRecallable(allMemories), [allMemories]);

  const [onlyRecallable, setOnlyRecallable] = useState(true);
  const [showEmptyCategories, setShowEmptyCategories] = useState(false);
  const [pinnedName, setPinnedName] = useState<string | null>(() => searchParams.get("focus"));
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  const graph = useMemo(
    () => buildMapGraph(onlyRecallable ? recall.recallable : allMemories, catalogQuery.data),
    [onlyRecallable, recall, allMemories, catalogQuery.data],
  );

  const emptyCategoryCount = useMemo(
    () => graph.stats.filter((stat) => stat.count === 0).length,
    [graph.stats],
  );
  const layoutStats = useMemo(
    () => (showEmptyCategories ? graph.stats : graph.stats.filter((stat) => stat.count > 0)),
    [graph.stats, showEmptyCategories],
  );
  const layout = useMemo(() => buildLayout(layoutStats, graph.links), [layoutStats, graph.links]);
  const labelByName = useMemo(() => {
    const labels = placeLabels(layout.nodes);
    return new Map(labels.map((label) => [label.name, label]));
  }, [layout.nodes]);

  const activeName = hoveredName ?? pinnedName;
  const activeNode = layout.nodes.find((node) => node.name === activeName) ?? null;
  const neighbors = useMemo(
    () => (activeName ? neighborsOf(graph.links, activeName) : []),
    [activeName, graph.links],
  );
  const isNeighbor = (name: string) =>
    activeName === name || neighbors.some((neighbor) => neighbor.name === name);

  const topCategories = useMemo(
    () => graph.stats.filter((stat) => stat.count > 0).slice(0, 8),
    [graph.stats],
  );

  const openCategory = (name: string) => navigate(`/memories?category=${encodeURIComponent(name)}`);
  const togglePinned = (name: string) =>
    setPinnedName((current) => (current === name ? null : name));

  // URL 里的 focus 只作初始值；数据就绪后若分类已不在当前布局里就丢弃。
  useEffect(() => {
    if (isLoading) return;
    if (pinnedName && !layout.nodes.some((node) => node.name === pinnedName)) {
      setPinnedName(null);
    }
  }, [isLoading, layout.nodes, pinnedName]);

  // 选中态写回 URL：值相同不重复 set，避免死循环；只增删 focus，不动其它参数。
  useEffect(() => {
    const current = searchParams.get("focus");
    if (pinnedName === current) return;
    const next = new URLSearchParams(searchParams);
    if (pinnedName) next.set("focus", pinnedName);
    else next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [pinnedName, searchParams, setSearchParams]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinnedName(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectionAnnouncement = activeNode
    ? `已选中：${activeNode.name}，${activeNode.count} 条记忆，${neighbors.length} 个共现分类`
    : "";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="记忆"
        title="记忆地图"
        description="按分类分布与共现关系浏览记忆；圆圈越大记忆越多，连线越粗共现越频繁。默认只统计已通过且未过期的可召回记忆，可在下方切换为全部记忆。"
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate("/memories")}>
              <Library className="size-4" />
              返回记忆库
            </Button>
            <Button variant="ghost" size="icon" aria-label="刷新记忆地图" disabled={memoriesQuery.isFetching} onClick={refetchAll}>
              <RefreshCw className={cn("size-4", memoriesQuery.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded-full border border-accent bg-accent/20" />
          圆圈大小 = 该分类记忆条数
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-1 w-6 rounded-full bg-accent/60" />
          连线粗细/深浅 = 共现次数
        </span>
        <span>分类 {graph.stats.length} 个 · 共现连线 {graph.links.length} 条</span>
        <span>
          {onlyRecallable ? "可召回记忆" : "记忆"} {formatNumber(graph.total)} 条
        </span>
        {allMemories.length >= MEMORY_FETCH_LIMIT ? (
          <span className="text-warn">
            已达单次拉取上限 {MEMORY_FETCH_LIMIT} 条，统计基于这批抽样
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-soft">
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={onlyRecallable}
            onChange={(event) => setOnlyRecallable(event.target.checked)}
          />
          只统计可召回（已通过 + 未过期）
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={showEmptyCategories}
            onChange={(event) => setShowEmptyCategories(event.target.checked)}
          />
          显示空分类（{emptyCategoryCount}）
        </label>
      </div>

      {isLoading ? (
        <div role="status" aria-label="正在加载记忆地图" className="flex flex-col gap-3 lg:flex-row">
          <div className="h-[420px] flex-1 animate-pulse rounded-[var(--radius-card)] border border-line bg-panel-2/50" />
          <div className="h-[420px] w-full animate-pulse rounded-[var(--radius-card)] border border-line bg-panel-2/50 lg:w-80" />
        </div>
      ) : error ? (
        <ErrorState message={errorMessage(error, "记忆地图加载失败")} onRetry={refetchAll} />
      ) : allMemories.length === 0 ? (
        <EmptyState
          icon={Network}
          title="还没有记忆数据"
          description="写入记忆后，这里会显示分类分布与共现关系。"
          action={
            <Button variant="primary" size="sm" onClick={() => navigate("/memories")}>
              去记忆库
            </Button>
          }
        />
      ) : onlyRecallable && recall.recallable.length === 0 && allMemories.length > 0 ? (
        <EmptyState
          icon={Network}
          title="当前没有可召回的已通过记忆"
          description="待审核、已驳回、已过期的记忆会被排除在可召回口径之外，因此地图暂时为空。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {isAdmin ? (
                <Button variant="primary" size="sm" onClick={() => navigate("/review")}>
                  去审核
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => navigate("/memories")}>
                查看全部记忆
              </Button>
            </div>
          }
        />
      ) : graph.stats.length === 0 ? (
        <EmptyState
          icon={Network}
          title="记忆还没有分类"
          description="当前记忆均未归类，先在记忆库中为它们设置分类，地图就会显示分布。"
          action={
            <Button variant="primary" size="sm" onClick={() => navigate("/memories")}>
              去记忆库设置分类
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <Card className="min-w-0 flex-1">
            <div className="p-2 sm:p-3">
              <svg
                viewBox={`0 0 ${MAP_VIEW_WIDTH} ${MAP_VIEW_HEIGHT}`}
                className="h-auto w-full select-none"
                role="img"
                aria-label="记忆地图：分类的记忆分布与共现关系"
              >
                <g>
                  {layout.edges.map((edge) => {
                    const highlighted =
                      activeName === null || edge.source === activeName || edge.target === activeName;
                    return (
                      <line
                        key={`${edge.source}\u0000${edge.target}`}
                        x1={edge.ax}
                        y1={edge.ay}
                        x2={edge.bx}
                        y2={edge.by}
                        stroke="var(--c-accent)"
                        strokeOpacity={highlighted ? edgeOpacityFor(edge.count, layout.maxLinkCount) : 0.06}
                        strokeWidth={highlighted ? edgeWidthFor(edge.count, layout.maxLinkCount) : 0.8}
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>

                <g>
                  {layout.nodes.map((node) => {
                    const isActive = activeName === node.name;
                    const faded = activeName !== null && !isNeighbor(node.name);
                    const isEmpty = node.count === 0;
                    const label = labelByName.get(node.name);
                    return (
                      <g
                        key={node.name}
                        tabIndex={0}
                        role="button"
                        aria-pressed={pinnedName === node.name}
                        aria-label={`${node.name}，${node.count} 条记忆`}
                        className="cursor-pointer outline-none"
                        opacity={faded ? 0.25 : 1}
                        onMouseEnter={() => setHoveredName(node.name)}
                        onMouseLeave={() => setHoveredName(null)}
                        onFocus={() => setHoveredName(node.name)}
                        onBlur={() => setHoveredName(null)}
                        onClick={() => togglePinned(node.name)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            togglePinned(node.name);
                          }
                        }}
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r}
                          fill="var(--c-accent)"
                          fillOpacity={isEmpty ? 0 : nodeFillOpacity(node.count, layout.maxCount)}
                          stroke={isEmpty ? "var(--c-line-strong)" : "var(--c-accent)"}
                          strokeOpacity={isActive ? 1 : 0.7}
                          strokeWidth={isActive ? 2.4 : 1.4}
                          strokeDasharray={isEmpty ? "5 4" : undefined}
                        />
                        {node.r >= 16 && !isEmpty ? (
                          <text
                            x={node.x}
                            y={node.y + 4}
                            textAnchor="middle"
                            fontSize={Math.max(Math.min(node.r * 0.6, 14), 10)}
                            className="fill-ink font-mono"
                          >
                            {node.count}
                          </text>
                        ) : null}
                        {label && !label.hidden ? (
                          <text
                            x={label.x}
                            y={label.y + 4}
                            textAnchor="middle"
                            fontSize={12}
                            className={cn("font-medium", isActive ? "fill-ink" : "fill-ink-soft")}
                          >
                            {node.name}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              </svg>
              <p className="sr-only" aria-live="polite">
                {selectionAnnouncement}
              </p>
            </div>
          </Card>

          <aside className="w-full shrink-0 lg:w-80">
            <Card className="h-full p-4">
              {activeNode ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-display text-lg text-ink">{activeNode.name}</h2>
                    <Badge tone="accent">{activeNode.count} 条</Badge>
                  </div>
                  {activeNode.description ? (
                    <p className="text-xs leading-5 text-ink-soft">{activeNode.description}</p>
                  ) : (
                    <p className="text-xs text-ink-faint">分类目录中没有该分类的描述。</p>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-ink-soft">最常同时出现的分类</p>
                    {neighbors.length === 0 ? (
                      <p className="text-xs text-ink-faint">没有与其他分类共现的记忆。</p>
                    ) : (
                      neighbors.slice(0, 5).map((neighbor) => (
                        <button
                          key={neighbor.name}
                          type="button"
                          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-ink-soft hover:bg-panel-2"
                          onClick={() => togglePinned(neighbor.name)}
                          onMouseEnter={() => setHoveredName(neighbor.name)}
                          onMouseLeave={() => setHoveredName(null)}
                        >
                          <span className="truncate">{neighbor.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-ink-faint">
                            <span aria-hidden className="inline-block h-1 w-4 rounded-full bg-accent/60" />
                            共现 {neighbor.count}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => openCategory(activeNode.name)}>
                    查看该类记忆
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <h2 className="font-display text-base text-ink">概览</h2>
                  <dl className="grid grid-cols-2 gap-y-2 text-xs">
                    <dt className="text-ink-faint">可召回</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(recall.recallable.length)}</dd>
                    <dt className="text-ink-faint">待审核</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(recall.pending)}</dd>
                    <dt className="text-ink-faint">已驳回</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(recall.rejected)}</dd>
                    <dt className="text-ink-faint">已过期</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(recall.expired)}</dd>
                  </dl>
                  {isAdmin ? (
                    <Button variant="secondary" size="sm" className="w-full" onClick={() => navigate("/review")}>
                      去审核待审核记忆
                    </Button>
                  ) : null}
                  <dl className="grid grid-cols-2 gap-y-2 border-t border-line pt-3 text-xs">
                    <dt className="text-ink-faint">空分类</dt>
                    <dd className="text-right tabular-nums text-ink">
                      {emptyCategoryCount} / {graph.stats.length}
                    </dd>
                    <dt className="text-ink-faint">最大分类</dt>
                    <dd className="text-right tabular-nums text-ink">{graph.maxCount} 条</dd>
                  </dl>
                  <p className="text-xs leading-5 text-ink-faint">
                    悬停可预览分类；点击圆圈或列表可固定选中，再次点击或按 Esc 取消。跳转请用「查看该类记忆」。
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-ink-soft">记忆最多的分类</p>
                    {topCategories.length === 0 ? (
                      <p className="text-xs text-ink-faint">暂无分类计数。</p>
                    ) : (
                      topCategories.map((stat) => (
                        <button
                          key={stat.name}
                          type="button"
                          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-ink-soft hover:bg-panel-2"
                          onClick={() => togglePinned(stat.name)}
                          onMouseEnter={() => setHoveredName(stat.name)}
                          onMouseLeave={() => setHoveredName(null)}
                        >
                          <span className="truncate">{stat.name}</span>
                          <span className="shrink-0 tabular-nums text-ink-faint">{stat.count}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
