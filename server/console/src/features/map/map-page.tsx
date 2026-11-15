/**
 * 记忆地图：分类分布 + 共现关系力导向图。
 *
 * 纯布局在 `./map-layout`（d3-force，确定性、可单测）。SVG 里的颜色全部来自
 * CSS token（`var(--c-accent)` / `fill-ink` 等），因此深色模式自动适配。
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Info, Library, Network, RefreshCw } from "lucide-react";
import { useSession } from "@/lib/session";
import { cn, errorMessage, formatNumber } from "@/lib/utils";
import { Badge, Button, Card } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { fetchCategoryCatalog, fetchMemories, memoryKeys } from "@/features/memories/memory-api";
import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  buildLayout,
  buildMapGraph,
  edgeOpacityFor,
  edgeWidthFor,
  neighborsOf,
  nodeFillOpacity,
} from "./map-layout";

export function MapPage() {
  const { user, isAdmin } = useSession();
  const navigate = useNavigate();

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

  const graph = useMemo(
    () => buildMapGraph(memoriesQuery.data ?? [], catalogQuery.data),
    [memoriesQuery.data, catalogQuery.data],
  );
  const layout = useMemo(() => buildLayout(graph.stats, graph.links), [graph]);

  const [activeName, setActiveName] = useState<string | null>(null);
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
  const emptyCategoryCount = graph.stats.filter((stat) => stat.count === 0).length;

  const openCategory = (name: string) => navigate(`/memories?category=${encodeURIComponent(name)}`);

  const isLoading = memoriesQuery.isLoading || catalogQuery.isLoading;
  const error = memoriesQuery.error ?? catalogQuery.error;
  const refetchAll = () => {
    void memoriesQuery.refetch();
    void catalogQuery.refetch();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="记忆"
        title="记忆地图"
        description="按分类分布与共现关系浏览记忆；圆圈越大记忆越多，连线越粗共现越频繁。"
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
        <span>记忆 {formatNumber(graph.total)} 条</span>
        {graph.largeDataset ? (
          <span className="flex items-center gap-1 text-warn">
            <Info className="size-3.5" />
            数据量较大（{formatNumber(graph.total)} 条），地图只按分类聚合，不逐条渲染
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div role="status" aria-label="正在加载记忆地图" className="flex flex-col gap-3 lg:flex-row">
          <div className="h-[420px] flex-1 animate-pulse rounded-[var(--radius-card)] border border-line bg-panel-2/50" />
          <div className="h-[420px] w-full animate-pulse rounded-[var(--radius-card)] border border-line bg-panel-2/50 lg:w-80" />
        </div>
      ) : error ? (
        <ErrorState message={errorMessage(error, "记忆地图加载失败")} onRetry={refetchAll} />
      ) : graph.total === 0 ? (
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
                    return (
                      <g
                        key={node.name}
                        tabIndex={0}
                        role="link"
                        aria-label={`${node.name}，${node.count} 条记忆`}
                        className="cursor-pointer outline-none"
                        opacity={faded ? 0.25 : 1}
                        onMouseEnter={() => setActiveName(node.name)}
                        onMouseLeave={() => setActiveName(null)}
                        onFocus={() => setActiveName(node.name)}
                        onBlur={() => setActiveName(null)}
                        onClick={() => openCategory(node.name)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openCategory(node.name);
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
                        <text
                          x={node.x}
                          y={node.y + node.r + 15}
                          textAnchor="middle"
                          fontSize={12}
                          className={cn("font-medium", isActive ? "fill-ink" : "fill-ink-soft")}
                        >
                          {node.name}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
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
                          onClick={() => openCategory(neighbor.name)}
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
                    <dt className="text-ink-faint">总记忆</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(graph.total)}</dd>
                    <dt className="text-ink-faint">已归类</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(graph.classified)}</dd>
                    <dt className="text-ink-faint">未归类</dt>
                    <dd className="text-right tabular-nums text-ink">{formatNumber(graph.uncategorized)}</dd>
                    <dt className="text-ink-faint">空分类</dt>
                    <dd className="text-right tabular-nums text-ink">
                      {emptyCategoryCount} / {graph.stats.length}
                    </dd>
                    <dt className="text-ink-faint">最大分类</dt>
                    <dd className="text-right tabular-nums text-ink">{graph.maxCount} 条</dd>
                  </dl>
                  <p className="text-xs leading-5 text-ink-faint">
                    悬停或聚焦分类圆圈可查看描述与共现关系；点击圆圈跳到该分类的记忆列表。
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
                          onClick={() => openCategory(stat.name)}
                          onMouseEnter={() => setActiveName(stat.name)}
                          onMouseLeave={() => setActiveName(null)}
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
