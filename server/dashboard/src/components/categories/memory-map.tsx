"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { coOccurrence } from "@/lib/category-utils";
import { buildLayout, VIEW_H, VIEW_W } from "@/lib/memory-map-layout";
import type { CategoryStat } from "@/hooks/use-category-catalog";
import type { Memory } from "@/types/api";

export function MemoryMap({
  stats,
  memories,
  uncategorized,
}: {
  stats: CategoryStat[];
  memories: Memory[];
  uncategorized: number;
}) {
  const router = useRouter();
  const links = useMemo(() => coOccurrence(memories), [memories]);
  const { nodes, edges } = useMemo(
    () => buildLayout(stats, links),
    [stats, links],
  );
  const [active, setActive] = useState<string | null>(null);

  const activeNode = nodes.find((node) => node.name === active) ?? null;
  const neighbors = useMemo(() => {
    if (!active) return [];
    return links
      .filter((link) => link.source === active || link.target === active)
      .map((link) => ({
        name: link.source === active ? link.target : link.source,
        count: link.count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [active, links]);

  /** 高亮某个节点时，其余节点和无关连线压暗 */
  const dimOthers = active !== null;
  const isNeighbor = (name: string) =>
    active === name || neighbors.some((neighbor) => neighbor.name === name);

  const maxCount = nodes.reduce((max, node) => Math.max(max, node.count), 0);
  const emptyCount = nodes.filter((node) => node.count === 0).length;
  const classified = memories.length - uncategorized;

  const openCategory = (name: string) =>
    router.push(`/dashboard/memories?category=${encodeURIComponent(name)}`);

  return (
    <div className="space-y-3">
      {/* 说明 + 概览 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-onSurface-default-tertiary">
        <span className="flex items-center gap-1">
          <Info className="size-3.5" />
          圈的面积 = 该类记忆条数
        </span>
        <span>连线 = 同一条记忆同时命中两类（越粗共现越多）</span>
        <span>灰色虚线圈 = 空分类</span>
        <span className="tabular-nums">共现连线 {links.length} 条</span>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <Card className="min-w-0 flex-1 border-memBorder-primary">
          <CardContent className="p-2 sm:p-3">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="h-auto w-full select-none"
              role="img"
              aria-label="记忆地图：分类的记忆分布与共现关系"
            >
              {/* 共现连线 */}
              <g>
                {edges.map((edge) => {
                  const highlighted =
                    !dimOthers ||
                    edge.source === active ||
                    edge.target === active;
                  return (
                    <line
                      key={`${edge.source}-${edge.target}`}
                      x1={edge.ax}
                      y1={edge.ay}
                      x2={edge.bx}
                      y2={edge.by}
                      stroke="var(--surface-default-brand)"
                      strokeWidth={1 + edge.count * 0.7}
                      strokeLinecap="round"
                      opacity={
                        highlighted
                          ? Math.min(0.18 + edge.count * 0.16, 0.7)
                          : 0.05
                      }
                    />
                  );
                })}
              </g>

              {/* 分类节点 */}
              <g>
                {nodes.map((node) => {
                  const isEmpty = node.count === 0;
                  const isActive = active === node.name;
                  const faded = dimOthers && !isNeighbor(node.name);
                  return (
                    <g
                      key={node.name}
                      tabIndex={0}
                      role="link"
                      aria-label={`${node.name}，${node.count} 条记忆`}
                      className="cursor-pointer outline-none"
                      opacity={faded ? 0.25 : 1}
                      onMouseEnter={() => setActive(node.name)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(node.name)}
                      onBlur={() => setActive(null)}
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
                        fill={
                          isEmpty
                            ? "transparent"
                            : "var(--surface-default-brand)"
                        }
                        fillOpacity={isActive ? 0.34 : isEmpty ? 0 : 0.15}
                        stroke={
                          isEmpty
                            ? "var(--on-surface-default-tertiary)"
                            : "var(--surface-default-brand)"
                        }
                        strokeWidth={isActive ? 2.4 : 1.6}
                        strokeDasharray={isEmpty ? "5 4" : undefined}
                      />
                      {node.r >= 22 && !isEmpty && (
                        <text
                          x={node.x}
                          y={node.y + 4}
                          textAnchor="middle"
                          className="font-mono"
                          fontSize={Math.max(node.r * 0.55, 11)}
                          fill="var(--on-surface-default-secondary)"
                        >
                          {node.count}
                        </text>
                      )}
                      <text
                        x={node.x}
                        y={node.y + node.r + 15}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={isActive ? 600 : 500}
                        fill={
                          isEmpty
                            ? "var(--on-surface-default-tertiary)"
                            : "var(--on-surface-default-primary)"
                        }
                      >
                        {node.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </CardContent>
        </Card>

        {/* 右侧：悬停/聚焦详情，没选中时显示概览 */}
        <aside className="w-full lg:w-80 shrink-0">
          <Card className="border-memBorder-primary h-full">
            <CardContent className="p-4 space-y-3">
              {activeNode ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{activeNode.name}</h3>
                    <span className="shrink-0 text-xs tabular-nums text-onSurface-default-tertiary">
                      {activeNode.count} 条
                    </span>
                  </div>
                  {activeNode.count === 0 && (
                    <p className="text-xs text-onSurface-default-tertiary">
                      这个分类下还没有记忆。要么确实没有这类内容，要么
                      description 写得不够清楚，模型没往上靠。
                    </p>
                  )}
                  <p className="text-xs leading-5 text-onSurface-default-secondary">
                    {activeNode.description}
                  </p>

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-onSurface-default-tertiary">
                      最常同现的分类
                    </p>
                    {neighbors.length === 0 ? (
                      <p className="text-xs text-onSurface-default-tertiary">
                        没有与其他分类共现的记忆。
                      </p>
                    ) : (
                      neighbors.slice(0, 3).map((neighbor) => (
                        <button
                          key={neighbor.name}
                          type="button"
                          onClick={() => openCategory(neighbor.name)}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-surface-default-secondary-hover"
                        >
                          <span>{neighbor.name}</span>
                          <span className="tabular-nums text-onSurface-default-tertiary">
                            共现 {neighbor.count}
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => openCategory(activeNode.name)}
                  >
                    查看该类记忆
                    <ArrowUpRight className="size-3.5 ml-1" />
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold">概览</h3>
                  <dl className="grid grid-cols-2 gap-y-2 text-xs">
                    <dt className="text-onSurface-default-tertiary">总记忆</dt>
                    <dd className="text-right tabular-nums">
                      {memories.length}
                    </dd>
                    <dt className="text-onSurface-default-tertiary">已归类</dt>
                    <dd className="text-right tabular-nums">{classified}</dd>
                    <dt className="text-onSurface-default-tertiary">未归类</dt>
                    <dd className="text-right tabular-nums">{uncategorized}</dd>
                    <dt className="text-onSurface-default-tertiary">空分类</dt>
                    <dd className="text-right tabular-nums">
                      {emptyCount} / {nodes.length}
                    </dd>
                    <dt className="text-onSurface-default-tertiary">
                      最大分类
                    </dt>
                    <dd className="text-right tabular-nums">{maxCount} 条</dd>
                  </dl>
                  <p className="text-xs leading-5 text-onSurface-default-tertiary">
                    鼠标移到圈上看该分类的描述与共现关系；点击圈跳到该分类的记忆列表。
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-onSurface-default-tertiary">
                      记忆最多的分类
                    </p>
                    {[...nodes]
                      .filter((node) => node.count > 0)
                      .sort(
                        (a, b) =>
                          b.count - a.count || a.name.localeCompare(b.name),
                      )
                      .slice(0, 5)
                      .map((node) => (
                        <button
                          key={node.name}
                          type="button"
                          onClick={() => openCategory(node.name)}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-surface-default-secondary-hover"
                          onMouseEnter={() => setActive(node.name)}
                          onMouseLeave={() => setActive(null)}
                        >
                          <span>{node.name}</span>
                          <span className="tabular-nums text-onSurface-default-tertiary">
                            {node.count}
                          </span>
                        </button>
                      ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
