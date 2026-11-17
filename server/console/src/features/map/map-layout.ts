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
import { categoriesOf, expiryInfo, reviewStatusOf } from "@/features/memories/memory-utils";
import type { Memory } from "@/features/memories/types";

export const MAP_VIEW_WIDTH = 820;
export const MAP_VIEW_HEIGHT = 560;

const MAP_PADDING = 76;
const ITERATIONS = 320;
const MIN_NODE_RADIUS = 7;
const MAX_NODE_RADIUS = 34;
/** 两个中心点之间的保留空隙，给分类名称留位置。 */
const NODE_GAP = 26;
/** 标签高度固定，宽度按字符估算：CJK/全角 12px、ASCII 7px。 */
const LABEL_HEIGHT = 14;
/** 标签与所属节点圆之间的空隙。 */
const LABEL_GAP = 4;
/** 标签与其它节点圆之间保留的内边距。 */
const LABEL_NODE_PADDING = 6;

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

export interface RecallBreakdown {
  recallable: Memory[];
  pending: number;
  rejected: number;
  expired: number;
}

/**
 * 可召回口径分桶：未过期且审核通过才算可召回。
 * 每条记忆只进一个桶，优先级 expired > rejected > pending；可召回的不计入任何桶。
 */
export function splitRecallable(memories: readonly Memory[]): RecallBreakdown {
  const recallable: Memory[] = [];
  let pending = 0;
  let rejected = 0;
  let expired = 0;
  for (const memory of memories) {
    if (expiryInfo(memory.expiration_date).expired) {
      expired += 1;
      continue;
    }
    const status = reviewStatusOf(memory);
    if (status === "approved") {
      recallable.push(memory);
    } else if (status === "rejected") {
      rejected += 1;
    } else {
      pending += 1;
    }
  }
  return { recallable, pending, rejected, expired };
}

/** 时间窗口选项；`all` 表示不按时间过滤。 */
export type MapTimeWindow = "all" | "7d" | "30d" | "90d";

export const TIME_WINDOW_DAYS: Record<Exclude<MapTimeWindow, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** 近 30 天新增用于节点外环。 */
export const RECENT_RING_DAYS = 30;

/** 一天的毫秒数，时间窗口计算共用。 */
const DAY_MS = 86_400_000;

export interface TimeWindowResult {
  memories: Memory[];
  /** 没有可用 created_at 的记忆条数（无法归入任何时间窗）。 */
  undated: number;
}

/** 取记忆的时间戳；空字符串、缺省或无法解析都返回 null。 */
function createdAtMs(memory: Memory): number | null {
  if (!memory.created_at) return null;
  const ms = new Date(memory.created_at).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 按时间窗口筛选记忆：`all` 返回全部；其余窗口保留时间戳不早于
 * `now - days * 一天` 的记忆（等于边界也算保留）。无时间的记忆不计入结果。
 */
export function filterByTimeWindow(
  memories: readonly Memory[],
  window: MapTimeWindow,
  now: number = Date.now(),
): TimeWindowResult {
  const result: Memory[] = [];
  let undated = 0;
  const cutoff =
    window === "all" ? null : now - TIME_WINDOW_DAYS[window] * DAY_MS;

  for (const memory of memories) {
    const ms = createdAtMs(memory);
    if (ms === null) {
      undated += 1;
      if (cutoff === null) result.push(memory);
      continue;
    }
    if (cutoff === null || ms >= cutoff) result.push(memory);
  }

  return { memories: result, undated };
}

/** 每个分类在最近 days 天内新增的条数；没有命中的分类不出现在 Map 里。 */
export function countRecentByCategory(
  memories: readonly Memory[],
  days: number,
  now: number = Date.now(),
): Map<string, number> {
  const cutoff = now - days * DAY_MS;
  const counts = new Map<string, number>();
  for (const memory of memories) {
    const ms = createdAtMs(memory);
    if (ms === null || ms < cutoff) continue;
    for (const name of categoriesOf(memory)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

/** 近 30 天新增占该分类总数的比例，用于节点外环；结果夹在 [0, 1]。 */
export function recentShare(recent: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(recent / total, 0), 1);
}

export interface PlacedLabel {
  name: string;
  x: number;
  y: number;
  hidden: boolean;
}

interface LabelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** CJK、韩文与全角字符按 12px 估算，其余按 7px。 */
function labelCharWidth(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 12;
  }
  return 7;
}

function measureLabel(name: string): number {
  let width = 0;
  for (const char of name) width += labelCharWidth(char.codePointAt(0) ?? 0);
  return width;
}

function rectAt(x: number, y: number, halfWidth: number, halfHeight: number): LabelRect {
  return {
    left: x - halfWidth,
    top: y - halfHeight,
    right: x + halfWidth,
    bottom: y + halfHeight,
  };
}

/** 下方 → 上方 → 右侧 → 左侧。 */
function candidateRects(node: MapNode, width: number): [LabelRect, LabelRect, LabelRect, LabelRect] {
  const halfWidth = width / 2;
  const halfHeight = LABEL_HEIGHT / 2;
  return [
    rectAt(node.x, node.y + node.r + LABEL_GAP + halfHeight, halfWidth, halfHeight),
    rectAt(node.x, node.y - node.r - LABEL_GAP - halfHeight, halfWidth, halfHeight),
    rectAt(node.x + node.r + LABEL_GAP + halfWidth, node.y, halfWidth, halfHeight),
    rectAt(node.x - node.r - LABEL_GAP - halfWidth, node.y, halfWidth, halfHeight),
  ];
}

function rectsOverlap(left: LabelRect, right: LabelRect): boolean {
  return (
    left.left < right.right &&
    right.left < left.right &&
    left.top < right.bottom &&
    right.top < left.bottom
  );
}

function rectHitsCircle(rect: LabelRect, node: MapNode): boolean {
  const radius = node.r + LABEL_NODE_PADDING;
  const nearestX = Math.min(Math.max(node.x, rect.left), rect.right);
  const nearestY = Math.min(Math.max(node.y, rect.top), rect.bottom);
  const dx = node.x - nearestX;
  const dy = node.y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * 标签避让布局：按条数从多到少依次占位，参照已放置标签与其它节点圆。
 * 四个候选都放不下时标记 hidden，坐标回落到下方候选位置；结果顺序与入参一致。
 */
export function placeLabels(
  nodes: readonly MapNode[],
  options?: { viewWidth?: number; viewHeight?: number },
): PlacedLabel[] {
  const viewWidth = options?.viewWidth ?? MAP_VIEW_WIDTH;
  const viewHeight = options?.viewHeight ?? MAP_VIEW_HEIGHT;
  const placedRects: LabelRect[] = [];
  const byName = new Map<string, PlacedLabel>();

  const order = [...nodes].sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"),
  );

  for (const node of order) {
    const candidates = candidateRects(node, measureLabel(node.name));
    let chosen = null as { rect: LabelRect } | null;
    for (const rect of candidates) {
      if (rect.left < 0 || rect.top < 0 || rect.right > viewWidth || rect.bottom > viewHeight) {
        continue;
      }
      if (placedRects.some((other) => rectsOverlap(rect, other))) continue;
      if (nodes.some((other) => other !== node && rectHitsCircle(rect, other))) continue;
      chosen = { rect };
      break;
    }

    if (chosen) {
      placedRects.push(chosen.rect);
      byName.set(node.name, {
        name: node.name,
        x: (chosen.rect.left + chosen.rect.right) / 2,
        y: (chosen.rect.top + chosen.rect.bottom) / 2,
        hidden: false,
      });
    } else {
      const below = candidates[0];
      byName.set(node.name, {
        name: node.name,
        x: (below.left + below.right) / 2,
        y: (below.top + below.bottom) / 2,
        hidden: true,
      });
    }
  }

  return nodes.map(
    (node) =>
      byName.get(node.name) ?? {
        name: node.name,
        x: node.x,
        y: node.y + node.r + LABEL_GAP + LABEL_HEIGHT / 2,
        hidden: true,
      },
  );
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

export interface SimilarCategoryPair {
  a: string;
  b: string;
  /** 两个名字共有的字符，按 a 的字符顺序去重排列，例如「技术」。 */
  sharedChars: string;
  /** 这两个分类在同一条记忆里同时出现的次数；0 表示从未共现。 */
  coOccurrence: number;
}

/** 孤岛分类：条数达到 minCount（默认 2）但没有任何共现连线。 */
export function findIslandCategories(
  stats: readonly CategoryStat[],
  links: readonly CoOccurrenceLink[],
  minCount = 2,
): CategoryStat[] {
  const connected = new Set<string>();
  for (const link of links) {
    connected.add(link.source);
    connected.add(link.target);
  }
  return stats
    .filter((stat) => stat.count >= minCount && !connected.has(stat.name))
    .sort(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"),
    );
}

/** 按 a 的字符顺序取两个名字共有的字符并去重。 */
function sharedCharsOf(a: string, b: string): string {
  const pool = new Set(Array.from(b));
  const seen = new Set<string>();
  let shared = "";
  for (const char of Array.from(a)) {
    if (pool.has(char) && !seen.has(char)) {
      seen.add(char);
      shared += char;
    }
  }
  return shared;
}

/** 疑似近义分类对：名字共有字符数达到 minSharedChars（默认 2）且两者都有记忆。 */
export function findSimilarCategoryPairs(
  stats: readonly CategoryStat[],
  links: readonly CoOccurrenceLink[],
  options?: { minSharedChars?: number },
): SimilarCategoryPair[] {
  const minSharedChars = options?.minSharedChars ?? 2;
  const candidates = stats.filter((stat) => stat.count > 0);
  const pairs: SimilarCategoryPair[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const first = candidates[i];
      const second = candidates[j];
      if (!first || !second) continue;

      const [a, b] =
        first.name.localeCompare(second.name, "zh-CN") <= 0
          ? [first.name, second.name]
          : [second.name, first.name];

      const sharedChars = sharedCharsOf(a, b);
      if (sharedChars.length < minSharedChars) continue;

      let coOccurrence = 0;
      for (const link of links) {
        if (
          (link.source === a && link.target === b) ||
          (link.source === b && link.target === a)
        ) {
          coOccurrence += link.count;
        }
      }

      pairs.push({ a, b, sharedChars, coOccurrence });
    }
  }

  return pairs.sort(
    (left, right) =>
      right.sharedChars.length - left.sharedChars.length ||
      right.coOccurrence - left.coOccurrence ||
      left.a.localeCompare(right.a, "zh-CN") ||
      left.b.localeCompare(right.b, "zh-CN"),
  );
}

interface SimNode extends CategoryStat {
  r: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
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

export interface LayoutOptions {
  /** 上一轮布局的节点。提供则复用坐标，只给新节点找位置。 */
  previous?: readonly MapNode[];
}

/** 把新节点的坐标夹取到画布的可视区域内。 */
function clampToViewX(x: number): number {
  return Math.min(Math.max(x, MAP_PADDING), MAP_VIEW_WIDTH - MAP_PADDING);
}

function clampToViewY(y: number): number {
  return Math.min(Math.max(y, MAP_PADDING), MAP_VIEW_HEIGHT - MAP_PADDING);
}

/**
 * 用 d3-force 计算布局。节点初值由黄金角螺旋确定，因此不依赖 Math.random，
 * 同一份数据的结果可复现（单测直接断言两次调用结果一致）。
 *
 * 传入 `options.previous` 且至少有一个同名节点可复用时进入稳定模式：复用节点
 * 锁定在上一轮坐标上并跳过等比缩放，只让新节点参与排布。
 */
export function buildLayout(
  stats: readonly CategoryStat[],
  links: readonly CoOccurrenceLink[],
  options?: LayoutOptions,
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
  const previousByName = new Map<string, MapNode>();
  for (const node of options?.previous ?? []) previousByName.set(node.name, node);

  const reusable = nodes.filter((node) => previousByName.has(node.name));
  const stable = reusable.length > 0;

  if (stable) {
    // 复用节点直接锁定在上一轮坐标上，半径仍按当前条数重新计算。
    for (const node of reusable) {
      const before = previousByName.get(node.name);
      if (!before) continue;
      node.x = before.x;
      node.y = before.y;
      node.fx = before.x;
      node.fy = before.y;
    }

    // 新节点只在自身集合内按条数降序编号，避免全部叠在螺旋起点。
    nodes
      .filter((node) => !previousByName.has(node.name))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"))
      .forEach((node, index) => {
        const angle = index * 2.39996;
        const distance = 36 + 30 * Math.sqrt(index);
        node.x = centerX + distance * Math.cos(angle);
        node.y = centerY + distance * Math.sin(angle);
      });
  } else {
    [...nodes]
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"))
      .forEach((node, index) => {
        const angle = index * 2.39996;
        const distance = 36 + 30 * Math.sqrt(index);
        node.x = centerX + distance * Math.cos(angle);
        node.y = centerY + distance * Math.sin(angle);
      });
  }

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

  let mapNodes: MapNode[];
  if (stable) {
    // 稳定模式不缩放：复用节点保持上一轮坐标系，新节点夹取到画布内。
    mapNodes = nodes.map((node) => ({
      name: node.name,
      count: node.count,
      description: node.description,
      enabled: node.enabled,
      x: node.fx ?? clampToViewX(node.x),
      y: node.fy ?? clampToViewY(node.y),
      r: Math.min(Math.max(radiusFor(node.count), MIN_NODE_RADIUS), MAX_NODE_RADIUS),
    }));
  } else {
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

    mapNodes = nodes.map((node) => ({
      name: node.name,
      count: node.count,
      description: node.description,
      enabled: node.enabled,
      x: node.x * scale + offsetX,
      y: node.y * scale + offsetY,
      r: Math.min(Math.max(node.r * scale, MIN_NODE_RADIUS), MAX_NODE_RADIUS),
    }));
  }

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
