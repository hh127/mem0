/**
 * 记忆地图的纯计算层：分类计数、共现关系、d3-force 力导向布局。
 *
 * 这里不依赖 React，也不写任何颜色值——颜色/透明度全部由调用方用 CSS token
 * （`var(--c-accent)`、`currentColor`）渲染，因此自动适配深色模式。
 *
 * 布局是确定性的：节点初值由黄金角螺旋给出（不依赖 d3 的随机初值），
 * 固定迭代次数后等比缩放居中，同一份数据每次得到完全相同的位置。
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { CategoryCatalog } from "@/lib/types";
import { categoriesOf } from "@/features/memories/memory-utils";
import type { Memory } from "@/features/memories/types";

export const MAP_VIEW_WIDTH = 820;
export const MAP_VIEW_HEIGHT = 560;
/** 超过这个条数时只做聚合统计（本实现始终只渲染分类节点，不逐条渲染记忆）。 */
export const LARGE_DATASET_THRESHOLD = 200;

const MAP_PADDING = 76;
const ITERATIONS = 320;
const MIN_NODE_RADIUS = 7;
const MAX_NODE_RADIUS = 34;
/** 两个中心点之间的保留空隙，给分类名称留位置。 */
const NODE_GAP = 26;

export interface CategoryStat {
  name: string;
  count: number;
  description: string;
  enabled: boolean;
}

export interface CoOccurrenceLink {
  source: string;
  target: string;
  count: number;
}

export interface MemoryMapGraph {
  stats: CategoryStat[];
  links: CoOccurrenceLink[];
  total: number;
  uncategorized: number;
  classified: number;
  maxCount: number;
  maxLinkCount: number;
  /** 记忆条数超过阈值：只做聚合统计，不逐条渲染。 */
  largeDataset: boolean;
}

export interface MapNode extends CategoryStat {
  x: number;
  y: number;
  r: number;
}

export interface MapEdge extends CoOccurrenceLink {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  maxCount: number;
  maxLinkCount: number;
}

/**
 * 分类统计：目录里的分类即使 0 条也会保留（空分类在图上以虚线圈表示），
 * 记忆里出现但不在目录中的分类同样计入。
 */
export function buildCategoryStats(
  memories: readonly Memory[],
  catalog?: CategoryCatalog | null,
): CategoryStat[] {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    for (const name of categoriesOf(memory)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const meta = new Map<string, { description: string; enabled: boolean }>();
  for (const entry of catalog?.custom_categories ?? []) {
    meta.set(entry.name, {
      description: entry.description ?? "",
      enabled: entry.enabled !== false,
    });
  }

  const names = new Set<string>(catalog?.names ?? []);
  for (const name of counts.keys()) names.add(name);

  return [...names]
    .map((name) => ({
      name,
      count: counts.get(name) ?? 0,
      description: meta.get(name)?.description ?? "",
      enabled: meta.get(name)?.enabled ?? true,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"));
}

/** 分类共现：同一条记忆的 categories 两两配对，每出现一次 +1。 */
export function buildCoOccurrence(memories: readonly Memory[]): CoOccurrenceLink[] {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    const names = categoriesOf(memory).sort((left, right) => left.localeCompare(right, "zh-CN"));
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const source = names[i];
        const target = names[j];
        if (source === undefined || target === undefined) continue;
        const key = `${source}\u0000${target}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [source = "", target = ""] = key.split("\u0000");
      return { source, target, count };
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.source.localeCompare(right.source, "zh-CN") ||
        left.target.localeCompare(right.target, "zh-CN"),
    );
}

export function buildMapGraph(
  memories: readonly Memory[],
  catalog?: CategoryCatalog | null,
): MemoryMapGraph {
  const stats = buildCategoryStats(memories, catalog);
  const links = buildCoOccurrence(memories);
  let uncategorized = 0;
  for (const memory of memories) {
    if (categoriesOf(memory).length === 0) uncategorized += 1;
  }
  const maxCount = stats.reduce((max, stat) => Math.max(max, stat.count), 0);
  const maxLinkCount = links.reduce((max, link) => Math.max(max, link.count), 0);
  return {
    stats,
    links,
    total: memories.length,
    uncategorized,
    classified: memories.length - uncategorized,
    maxCount,
    maxLinkCount,
    largeDataset: memories.length > LARGE_DATASET_THRESHOLD,
  };
}

/** 半径 ≈ √条数：圆面积正比于记忆条数，小分类也保留可见的最小半径。 */
export function radiusFor(count: number): number {
  return count > 0 ? 8 + Math.sqrt(count) * 6 : 9;
}

/** 节点填充深浅：条数越多越深（0 条 = 不填充，只画虚线圈）。 */
export function nodeFillOpacity(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return 0.18 + 0.55 * Math.min(count / maxCount, 1);
}

/** 连线粗细与共现强度成正比。 */
export function edgeWidthFor(count: number, maxLinkCount: number): number {
  if (maxLinkCount <= 0) return 1;
  return 1 + 4 * Math.min(count / maxLinkCount, 1);
}

/** 连线透明度与共现强度成正比。 */
export function edgeOpacityFor(count: number, maxLinkCount: number): number {
  if (maxLinkCount <= 0) return 0.3;
  return 0.25 + 0.5 * Math.min(count / maxLinkCount, 1);
}

/** 某个分类的共现邻居，按共现次数降序。 */
export function neighborsOf(
  links: readonly CoOccurrenceLink[],
  name: string,
): { name: string; count: number }[] {
  const neighbors: { name: string; count: number }[] = [];
  for (const link of links) {
    if (link.source === name) neighbors.push({ name: link.target, count: link.count });
    else if (link.target === name) neighbors.push({ name: link.source, count: link.count });
  }
  return neighbors.sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"),
  );
}

interface SimNode extends CategoryStat {
  r: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  index?: number;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  count: number;
  index?: number;
}

function endpointNode(endpoint: string | SimNode): SimNode | null {
  return typeof endpoint === "string" ? null : endpoint;
}

/**
 * 用 d3-force 计算布局。节点初值由黄金角螺旋确定，因此不依赖 Math.random，
 * 同一份数据的结果可复现（单测直接断言两次调用结果一致）。
 */
export function buildLayout(
  stats: readonly CategoryStat[],
  links: readonly CoOccurrenceLink[],
): MapLayout {
  const centerX = MAP_VIEW_WIDTH / 2;
  const centerY = MAP_VIEW_HEIGHT / 2;
  const nodes: SimNode[] = stats.map((stat) => ({
    ...stat,
    r: radiusFor(stat.count),
    x: 0,
    y: 0,
  }));

  if (nodes.length === 0) return { nodes: [], edges: [], maxCount: 0, maxLinkCount: 0 };

  const byName = new Map(nodes.map((node) => [node.name, node]));

  [...nodes]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"))
    .forEach((node, index) => {
      const angle = index * 2.39996;
      const distance = 36 + 30 * Math.sqrt(index);
      node.x = centerX + distance * Math.cos(angle);
      node.y = centerY + distance * Math.sin(angle);
    });

  const simLinks: SimLink[] = links
    .filter((link) => byName.has(link.source) && byName.has(link.target))
    .map((link) => ({ source: link.source, target: link.target, count: link.count }));

  const simulation = forceSimulation<SimNode>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.name)
        .distance((link) => {
          const source = endpointNode(link.source);
          const target = endpointNode(link.target);
          return 120 + ((source?.r ?? MIN_NODE_RADIUS) + (target?.r ?? MIN_NODE_RADIUS)) * 1.6;
        })
        .strength((link) => Math.min(0.15 + link.count * 0.12, 0.85)),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength((node) => -320 - node.r * 12)
        .distanceMax(900),
    )
    .force("collide", forceCollide<SimNode>().radius((node) => node.r + NODE_GAP).strength(0.9))
    .force("center", forceCenter<SimNode>(centerX, centerY).strength(0.06))
    .stop();

  for (let step = 0; step < ITERATIONS; step += 1) simulation.tick();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    maxX = Math.max(maxX, node.x + node.r);
    minY = Math.min(minY, node.y - node.r);
    maxY = Math.max(maxY, node.y + node.r);
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(
    (MAP_VIEW_WIDTH - MAP_PADDING * 2) / spanX,
    (MAP_VIEW_HEIGHT - MAP_PADDING * 2) / spanY,
    1.2,
  );
  const offsetX = (MAP_VIEW_WIDTH - spanX * scale) / 2 - minX * scale;
  const offsetY = (MAP_VIEW_HEIGHT - spanY * scale) / 2 - minY * scale;

  const mapNodes: MapNode[] = nodes.map((node) => ({
    name: node.name,
    count: node.count,
    description: node.description,
    enabled: node.enabled,
    x: node.x * scale + offsetX,
    y: node.y * scale + offsetY,
    r: Math.min(Math.max(node.r * scale, MIN_NODE_RADIUS), MAX_NODE_RADIUS),
  }));

  const nodeByName = new Map(mapNodes.map((node) => [node.name, node]));
  const edges: MapEdge[] = [];
  for (const link of links) {
    const source = nodeByName.get(link.source);
    const target = nodeByName.get(link.target);
    if (!source || !target) continue;
    edges.push({
      source: link.source,
      target: link.target,
      count: link.count,
      ax: source.x,
      ay: source.y,
      bx: target.x,
      by: target.y,
    });
  }

  const maxCount = mapNodes.reduce((max, node) => Math.max(max, node.count), 0);
  const maxLinkCount = edges.reduce((max, edge) => Math.max(max, edge.count), 0);
  return { nodes: mapNodes, edges, maxCount, maxLinkCount };
}
