/**
 * 记忆地图的纯布局算法（不依赖 React，可单独跑测试）。
 *
 * 手写极简力导向：斥力（圈不重叠）+ 共现弹簧（常同现的两类靠拢）+ 向心收敛。
 * 项目里没有 d3 依赖，而节点只有十几个，固定迭代 + 固定初值 = 布局稳定可复现
 * （无随机数，同一份数据每次渲染完全一致）。
 */

export const VIEW_W = 780;
export const VIEW_H = 520;
export const PAD = 62;
const ITERATIONS = 520;
/** 节点之间的最小空隙（圆边到圆边），给名称标签留位置 */
const NODE_GAP = 30;
const EMPTY_RADIUS = 10;

export interface LayoutInputNode {
  name: string;
  description: string;
  count: number;
  /** false = 目录里存在但已停用（图上照常画，仅用于说明） */
  enabled?: boolean;
}

export interface LayoutNode extends LayoutInputNode {
  x: number;
  y: number;
  r: number;
}

export interface LayoutInputLink {
  source: string;
  target: string;
  count: number;
}

export interface LayoutEdge extends LayoutInputLink {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  scale: number;
}

/**
 * 半径 ≈ √条数：面积正比于条数，视觉上「大一倍的圈 ≈ 多一倍的记忆」。
 * 前面那个小常数是为了让小分类也看得见（纯 ∝√count 会让 1 条的圈只有 7px 不可读），
 * 代价是大小分类的面积比被轻微压缩。
 */
export function radiusFor(count: number): number {
  return count > 0 ? 4 + Math.sqrt(count) * 7 : EMPTY_RADIUS;
}

export function buildLayout(
  input: LayoutInputNode[],
  links: LayoutInputLink[],
): Layout {
  const nodes: LayoutNode[] = input.map((node) => ({
    ...node,
    x: 0,
    y: 0,
    r: radiusFor(node.count),
  }));
  if (nodes.length === 0) return { nodes, edges: [], scale: 1 };

  const index = new Map(nodes.map((node, i) => [node.name, i]));
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;

  // 固定初值：按条数从大到小，黄金角螺旋铺开
  const seeded = [...nodes].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  seeded.forEach((node, i) => {
    const angle = i * 2.39996;
    const distance = 40 + 26 * Math.sqrt(i);
    node.x = cx + distance * Math.cos(angle);
    node.y = cy + distance * Math.sin(angle);
  });

  const springs: { a: number; b: number; weight: number }[] = [];
  for (const link of links) {
    const a = index.get(link.source);
    const b = index.get(link.target);
    if (a === undefined || b === undefined) continue;
    springs.push({ a, b, weight: link.count });
  }

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const cooling = 1 - iteration / ITERATIONS;

    // 斥力：只在「挨得太近」时推开（线性、接触式），远处不作用。
    // 早先用 1/d² 的全局斥力会把布局撑到画布的四倍，等比缩放后圈只剩几个像素。
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = 0.01 * (i + 1);
          dy = 0.01 * (j + 1);
          distance = Math.hypot(dx, dy);
        }
        const minDistance = a.r + b.r + NODE_GAP;
        const overlap = minDistance - distance;
        if (overlap <= 0) continue;
        const push = overlap * 0.09;
        const fx = (dx / distance) * push;
        const fy = (dy / distance) * push;
        a.x -= fx;
        a.y -= fy;
        b.x += fx;
        b.y += fy;
      }
    }

    // 弹簧：共现越多拉得越紧
    for (const spring of springs) {
      const a = nodes[spring.a];
      const b = nodes[spring.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const target = 120 + (a.r + b.r) * 1.25;
      const pull =
        (distance - target) * 0.02 * (1 + Math.min(spring.weight, 3) * 0.25);
      const fx = (dx / distance) * pull;
      const fy = (dy / distance) * pull;
      a.x += fx;
      a.y += fy;
      b.x -= fx;
      b.y -= fy;
    }

    // 向心（重力）：大圈更靠中间，也让孤立节点不至于飘到画布外
    for (const node of nodes) {
      const gravity = 0.012 * (0.6 + node.r / 40) * cooling;
      node.x += (cx - node.x) * gravity;
      node.y += (cy - node.y) * gravity;
    }
  }

  // 等比缩放（半径一起缩放，保持面积比例）并居中
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
  const scale = Math.min(
    (VIEW_W - PAD * 2) / Math.max(maxX - minX, 1),
    (VIEW_H - PAD * 2) / Math.max(maxY - minY, 1),
    1.25,
  );
  const offsetX = (VIEW_W - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (VIEW_H - (maxY - minY) * scale) / 2 - minY * scale;
  for (const node of nodes) {
    node.x = node.x * scale + offsetX;
    node.y = node.y * scale + offsetY;
    node.r = node.r * scale;
  }

  const byName = new Map(nodes.map((node) => [node.name, node]));
  const edges: LayoutEdge[] = [];
  for (const link of links) {
    const a = byName.get(link.source);
    const b = byName.get(link.target);
    if (!a || !b) continue;
    edges.push({ ...link, ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }

  return { nodes, edges, scale };
}
