import { describe, expect, it } from "vitest";
import type { CategoryCatalog } from "@/lib/types";
import type { Memory } from "@/features/memories/types";
import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  buildCategoryStats,
  buildCoOccurrence,
  buildLayout,
  buildMapGraph,
  edgeWidthFor,
  neighborsOf,
  nodeFillOpacity,
  radiusFor,
} from "./map-layout";

function memory(id: string, categories: string[]): Memory {
  return {
    id,
    memory: `记忆 ${id}`,
    user_id: "hermes-user-1",
    agent_id: null,
    run_id: null,
    categories,
  };
}

const CATALOG: CategoryCatalog = {
  custom_categories: [
    { name: "个人信息", description: "个人背景", enabled: true },
    { name: "工作信息", description: "工作", enabled: true },
    { name: "空分类", description: "", enabled: false },
  ],
  custom_category_rules: [],
  names: ["个人信息", "工作信息", "空分类"],
  disabled: ["空分类"],
  enabled_count: 2,
};

describe("buildCategoryStats", () => {
  it("统计记忆条数并保留目录里的空分类", () => {
    const stats = buildCategoryStats(
      [memory("1", ["个人信息", "工作信息"]), memory("2", ["个人信息"]), memory("3", [])],
      CATALOG,
    );

    expect(stats.map((stat) => [stat.name, stat.count])).toEqual([
      ["个人信息", 2],
      ["工作信息", 1],
      ["空分类", 0],
    ]);
    expect(stats[0]?.description).toBe("个人背景");
    expect(stats.find((stat) => stat.name === "空分类")?.enabled).toBe(false);
  });

  it("没有目录时也能统计记忆里出现的分类", () => {
    const stats = buildCategoryStats([memory("1", ["自定义", "自定义"]), memory("2", ["另一个"])]);
    expect(stats.map((stat) => [stat.name, stat.count])).toEqual([
      ["另一个", 1],
      ["自定义", 1],
    ]);
  });
});

describe("buildCoOccurrence", () => {
  it("同一条记忆里的分类两两配对并累计次数", () => {
    const links = buildCoOccurrence([
      memory("1", ["A", "B"]),
      memory("2", ["B", "A"]),
      memory("3", ["A", "B", "C"]),
    ]);

    expect(links[0]).toEqual({ source: "A", target: "B", count: 3 });
    expect(links).toContainEqual({ source: "A", target: "C", count: 1 });
    expect(links).toContainEqual({ source: "B", target: "C", count: 1 });
  });

  it("单分类、重复分类与空分类不产生连线", () => {
    expect(
      buildCoOccurrence([memory("1", ["A"]), memory("2", ["A", "A"]), memory("3", [])]),
    ).toEqual([]);
  });
});

describe("buildMapGraph", () => {
  it("汇总总数、未归类数量与阈值标记", () => {
    const many = Array.from({ length: 201 }, (_, index) => memory(String(index), index % 2 === 0 ? ["A"] : []));
    const graph = buildMapGraph(many, CATALOG);

    expect(graph.total).toBe(201);
    expect(graph.uncategorized).toBe(100);
    expect(graph.classified).toBe(101);
    expect(graph.largeDataset).toBe(true);
    expect(buildMapGraph(many.slice(0, 3), CATALOG).largeDataset).toBe(false);
  });
});

describe("buildLayout", () => {
  const stats = buildCategoryStats(
    [memory("1", ["A", "B"]), memory("2", ["A", "B", "C"]), memory("3", ["C"])],
    CATALOG,
  );
  const links = buildCoOccurrence([
    memory("1", ["A", "B"]),
    memory("2", ["A", "B", "C"]),
    memory("3", ["C"]),
  ]);

  it("同一份数据得到完全一致的布局（确定性）", () => {
    const first = buildLayout(stats, links);
    const second = buildLayout(stats, links);

    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });

  it("节点落在画布内，连线端点对应节点坐标", () => {
    const layout = buildLayout(stats, links);

    expect(layout.nodes).toHaveLength(stats.length);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(MAP_VIEW_WIDTH);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(MAP_VIEW_HEIGHT);
      expect(node.r).toBeGreaterThanOrEqual(7);
    }

    for (const edge of layout.edges) {
      const source = layout.nodes.find((node) => node.name === edge.source);
      const target = layout.nodes.find((node) => node.name === edge.target);
      expect([edge.ax, edge.ay]).toEqual([source?.x, source?.y]);
      expect([edge.bx, edge.by]).toEqual([target?.x, target?.y]);
    }
  });

  it("空输入返回空布局", () => {
    expect(buildLayout([], [])).toEqual({ nodes: [], edges: [], maxCount: 0, maxLinkCount: 0 });
  });
});

describe("visual helpers", () => {
  it("节点填充与连线粗细随强度单调增加", () => {
    expect(nodeFillOpacity(0, 10)).toBe(0);
    expect(nodeFillOpacity(10, 10)).toBeGreaterThan(nodeFillOpacity(1, 10));
    expect(edgeWidthFor(4, 4)).toBeGreaterThan(edgeWidthFor(1, 4));
    expect(radiusFor(10)).toBeGreaterThan(radiusFor(1));
  });
});

describe("neighborsOf", () => {
  it("返回双向共现邻居并按次数降序", () => {
    const neighbors = neighborsOf(
      [
        { source: "A", target: "B", count: 2 },
        { source: "C", target: "A", count: 5 },
        { source: "B", target: "D", count: 9 },
      ],
      "A",
    );

    expect(neighbors).toEqual([
      { name: "C", count: 5 },
      { name: "B", count: 2 },
    ]);
  });
});
