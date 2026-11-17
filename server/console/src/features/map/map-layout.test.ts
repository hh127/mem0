import { describe, expect, it } from "vitest";
import type { CategoryCatalog } from "@/lib/types";
import type { Memory } from "@/features/memories/types";
import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  RECENT_RING_DAYS,
  TIME_WINDOW_DAYS,
  buildCategoryStats,
  buildCoOccurrence,
  buildLayout,
  buildMapGraph,
  countRecentByCategory,
  edgeWidthFor,
  filterByTimeWindow,
  findIslandCategories,
  findSimilarCategoryPairs,
  neighborsOf,
  nodeFillOpacity,
  placeLabels,
  radiusFor,
  recentShare,
  splitRecallable,
} from "./map-layout";
import type { CategoryStat, CoOccurrenceLink, MapNode, PlacedLabel } from "./map-layout";

function memory(id: string, categories: string[], createdAt?: string): Memory {
  return {
    id,
    memory: `记忆 ${id}`,
    user_id: "hermes-user-1",
    agent_id: null,
    run_id: null,
    categories,
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
  };
}

/** 固定时间基准，避免断言依赖真实当前时间。 */
const NOW = new Date("2026-11-17T00:00:00Z").getTime();
const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function node(
  name: string,
  count: number,
  x: number,
  y: number,
  r: number,
): MapNode {
  return { name, count, description: "", enabled: true, x, y, r };
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
  it("汇总总数、未归类数量与已归类数量", () => {
    const many = Array.from({ length: 201 }, (_, index) => memory(String(index), index % 2 === 0 ? ["A"] : []));
    const graph = buildMapGraph(many, CATALOG);

    expect(graph.total).toBe(201);
    expect(graph.uncategorized).toBe(100);
    expect(graph.classified).toBe(101);
  });
});

describe("splitRecallable", () => {
  it("按可召回 / 待审核 / 已驳回 / 已过期分桶，且过期优先于驳回", () => {
    const approved: Memory = {
      ...memory("1", []),
      expiration_date: "2999-01-01",
      metadata: { review_status: "approved" },
    };
    const pending = memory("2", []);
    const rejected: Memory = {
      ...memory("3", []),
      metadata: { review_status: "rejected" },
    };
    const expired: Memory = {
      ...memory("4", []),
      expiration_date: "2000-01-01",
      metadata: { review_status: "approved" },
    };
    // 同时已驳回且已过期：只计入 expired。
    const rejectedExpired: Memory = {
      ...memory("5", []),
      expiration_date: "2000-01-01",
      metadata: { review_status: "rejected" },
    };

    const result = splitRecallable([approved, pending, rejected, expired, rejectedExpired]);

    expect(result.recallable.map((item) => item.id)).toEqual(["1"]);
    expect(result.pending).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.expired).toBe(2);
  });
});

function labelRect(label: PlacedLabel): { left: number; top: number; right: number; bottom: number } {
  const width = [...label.name].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) >= 0x2e80 ? 12 : 7), 0);
  return {
    left: label.x - width / 2,
    right: label.x + width / 2,
    top: label.y - 7,
    bottom: label.y + 7,
  };
}

function overlaps(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number },
): boolean {
  return left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom;
}

describe("placeLabels", () => {
  it("返回数量与节点一致、坐标有限且完全确定", () => {
    const nodes: MapNode[] = [
      node("个人信息", 8, 100, 120, 20),
      node("工作信息", 5, 320, 240, 16),
      node("空分类", 0, 560, 380, 9),
    ];

    const first = placeLabels(nodes);
    const second = placeLabels(nodes);

    expect(first).toHaveLength(nodes.length);
    for (const label of first) {
      expect(Number.isFinite(label.x)).toBe(true);
      expect(Number.isFinite(label.y)).toBe(true);
    }
    expect(second).toEqual(first);
  });

  it("坐标极近的两个节点标签不重叠", () => {
    const labels = placeLabels([node("甲", 2, 100, 100, 7), node("乙", 2, 100, 100, 7)]);
    const first = labels[0];
    const second = labels[1];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first && second) {
      const moved = first.x !== second.x || first.y !== second.y;
      expect(first.hidden || second.hidden || moved).toBe(true);
      if (!first.hidden && !second.hidden) {
        expect(overlaps(labelRect(first), labelRect(second))).toBe(false);
      }
    }
  });

  it("巨型节点周围的小节点标签放不下时标记 hidden", () => {
    const nodes: MapNode[] = [node("巨型分类", 1000, 410, 280, 250)];
    for (let index = 0; index < 12; index += 1) {
      nodes.push(
        node(
          `小${index}`,
          12 - index,
          400 + (index % 4) * 4,
          275 + Math.floor(index / 4) * 4,
          7,
        ),
      );
    }

    const labels = placeLabels(nodes);

    expect(labels.some((label) => label.hidden)).toBe(true);
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

describe("buildLayout 稳定模式", () => {
  const statsA: CategoryStat[] = [
    { name: "A", count: 3, description: "", enabled: true },
    { name: "B", count: 2, description: "", enabled: true },
    { name: "C", count: 1, description: "", enabled: true },
  ];
  const linksA: CoOccurrenceLink[] = [{ source: "A", target: "B", count: 1 }];
  const layoutA = buildLayout(statsA, linksA);

  const statsB: CategoryStat[] = [
    ...statsA,
    { name: "D", count: 1, description: "", enabled: true },
  ];

  it("复用节点坐标严格不漂移", () => {
    const layoutB = buildLayout(statsB, linksA, { previous: layoutA.nodes });

    for (const name of ["A", "B", "C"]) {
      const before = layoutA.nodes.find((node) => node.name === name);
      const after = layoutB.nodes.find((node) => node.name === name);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after?.x).toBe(before?.x);
      expect(after?.y).toBe(before?.y);
    }
  });

  it("新节点落在画布内且不与复用节点重合", () => {
    const layoutB = buildLayout(statsB, linksA, { previous: layoutA.nodes });

    for (const node of layoutB.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(MAP_VIEW_WIDTH);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(MAP_VIEW_HEIGHT);
    }

    const added = layoutB.nodes.find((node) => node.name === "D");
    expect(added).toBeDefined();
    for (const name of ["A", "B", "C"]) {
      const reused = layoutB.nodes.find((node) => node.name === name);
      expect(added?.x === reused?.x && added?.y === reused?.y).toBe(false);
    }
  });

  it("相同 previous 两次调用结果完全一致", () => {
    const first = buildLayout(statsB, linksA, { previous: layoutA.nodes });
    const second = buildLayout(statsB, linksA, { previous: layoutA.nodes });

    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });

  it("空 previous 等价于不传", () => {
    expect(buildLayout(statsA, linksA, { previous: [] })).toEqual(buildLayout(statsA, linksA));
  });

  it("名字完全不匹配的 previous 被忽略", () => {
    const previous: MapNode[] = [
      { name: "无关分类", count: 4, description: "", enabled: true, x: 40, y: 40, r: 20 },
    ];
    const layout = buildLayout(statsA, linksA, { previous });

    expect(layout.nodes).toHaveLength(statsA.length);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(MAP_VIEW_WIDTH);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(MAP_VIEW_HEIGHT);
    }
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

describe("filterByTimeWindow", () => {
  it("all 返回全部记忆并统计无时间条数", () => {
    const result = filterByTimeWindow(
      [
        memory("1", ["A"], daysAgo(3)),
        memory("2", ["A"], daysAgo(100)),
        memory("3", ["A"]),
      ],
      "all",
      NOW,
    );

    expect(result.memories.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(result.undated).toBe(1);
  });

  it("7d 窗口保留边界当天，排除更早的记忆", () => {
    const result = filterByTimeWindow(
      [
        memory("3d", ["A"], daysAgo(3)),
        memory("7d", ["A"], daysAgo(7)),
        memory("8d", ["A"], daysAgo(8)),
      ],
      "7d",
      NOW,
    );

    expect(result.memories.map((item) => item.id)).toEqual(["3d", "7d"]);
    expect(result.undated).toBe(0);
  });

  it("非 all 窗口排除无时间的记忆并计入 undated", () => {
    const result = filterByTimeWindow(
      [memory("dated", ["A"], daysAgo(1)), memory("undated", ["A"])],
      "7d",
      NOW,
    );

    expect(result.memories.map((item) => item.id)).toEqual(["dated"]);
    expect(result.undated).toBe(1);
  });

  it("8 天前的记忆在 30d 窗口里保留", () => {
    const result = filterByTimeWindow([memory("8d", ["A"], daysAgo(8))], "30d", NOW);

    expect(result.memories.map((item) => item.id)).toEqual(["8d"]);
  });
});

describe("countRecentByCategory", () => {
  it("同一分类的近期记忆累计，超窗的不计", () => {
    const counts = countRecentByCategory(
      [
        memory("1", ["工作信息"], daysAgo(1)),
        memory("2", ["工作信息"], daysAgo(2)),
        memory("3", ["工作信息"], daysAgo(40)),
      ],
      30,
      NOW,
    );

    expect(counts.get("工作信息")).toBe(2);
  });

  it("同一条记忆里的重复分类只计 1", () => {
    const counts = countRecentByCategory([memory("1", ["A", "A"], daysAgo(1))], 30, NOW);

    expect(counts.get("A")).toBe(1);
  });

  it("没有分类的记忆不产生键", () => {
    const counts = countRecentByCategory([memory("1", [], daysAgo(1))], 30, NOW);

    expect(counts.size).toBe(0);
  });
});

describe("recentShare", () => {
  it("总数非正返回 0，正常比例按除法，超出范围夹取到 1", () => {
    expect(recentShare(0, 0)).toBe(0);
    expect(recentShare(5, 10)).toBe(0.5);
    expect(recentShare(20, 10)).toBe(1);
  });
});

describe("时间窗口常量", () => {
  it("外环天数与 7d 窗口天数固定", () => {
    expect(RECENT_RING_DAYS).toBe(30);
    expect(TIME_WINDOW_DAYS["7d"]).toBe(7);
  });
});

describe("findIslandCategories", () => {
  const stats = [
    { name: "A", count: 3, description: "孤岛 A", enabled: true },
    { name: "B", count: 3, description: "有连线 B", enabled: false },
    { name: "C", count: 1, description: "只有一条 C", enabled: true },
  ];
  const links = [{ source: "B", target: "D", count: 2 }];

  it("默认只看条数 >= 2 且无任何共现的分类", () => {
    expect(findIslandCategories(stats, links).map((stat) => stat.name)).toEqual(["A"]);
  });

  it("minCount 传 1 时连只有一条的分类也算候选", () => {
    expect(findIslandCategories(stats, links, 1).map((stat) => stat.name)).toEqual(["A", "C"]);
  });

  it("按条数降序、并列按名称升序排列", () => {
    const islands = [
      { name: "乙", count: 3, description: "", enabled: true },
      { name: "甲", count: 3, description: "", enabled: true },
      { name: "丙", count: 5, description: "", enabled: true },
    ];

    expect(findIslandCategories(islands, []).map((stat) => stat.name)).toEqual(["丙", "甲", "乙"]);
  });

  it("返回入参里的原对象，保留 description 与 enabled", () => {
    const result = findIslandCategories(stats, links);

    expect(result[0]).toBe(stats[0]);
    expect(result[0]?.description).toBe("孤岛 A");
    expect(result[0]?.enabled).toBe(true);
  });
});

describe("findSimilarCategoryPairs", () => {
  it("名字高度重叠的分类构成一对，sharedChars 按 a 的顺序去重", () => {
    const pairs = findSimilarCategoryPairs(
      [
        { name: "技术能力", count: 2, description: "", enabled: true },
        { name: "技术偏好", count: 2, description: "", enabled: true },
      ],
      [],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.sharedChars).toBe("技术");
  });

  it("工作信息与工作项目共享「工作」", () => {
    const pairs = findSimilarCategoryPairs(
      [
        { name: "工作信息", count: 1, description: "", enabled: true },
        { name: "工作项目", count: 1, description: "", enabled: true },
      ],
      [],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.sharedChars).toBe("工作");
  });

  it("没有共同字符的分类不输出", () => {
    const pairs = findSimilarCategoryPairs(
      [
        { name: "技术能力", count: 2, description: "", enabled: true },
        { name: "健康记录", count: 2, description: "", enabled: true },
      ],
      [],
    );

    expect(pairs).toEqual([]);
  });

  it("count 为 0 的空分类不参与配对", () => {
    const pairs = findSimilarCategoryPairs(
      [
        { name: "技术能力", count: 2, description: "", enabled: true },
        { name: "技术偏好", count: 0, description: "", enabled: true },
      ],
      [],
    );

    expect(pairs).toEqual([]);
  });

  it("共现次数从 links 读取，正向与反向写法都认", () => {
    const stats = [
      { name: "技术能力", count: 2, description: "", enabled: true },
      { name: "技术偏好", count: 2, description: "", enabled: true },
    ];

    const forward = findSimilarCategoryPairs(stats, [
      { source: "技术能力", target: "技术偏好", count: 3 },
    ]);
    const reverse = findSimilarCategoryPairs(stats, [
      { source: "技术偏好", target: "技术能力", count: 3 },
    ]);

    expect(forward[0]?.coOccurrence).toBe(3);
    expect(reverse[0]?.coOccurrence).toBe(3);
    expect(findSimilarCategoryPairs(stats, [])[0]?.coOccurrence).toBe(0);
  });

  it("minSharedChars 传 3 时两个字符的重叠不再输出", () => {
    const stats = [
      { name: "技术能力", count: 2, description: "", enabled: true },
      { name: "技术偏好", count: 2, description: "", enabled: true },
      { name: "工作信息", count: 1, description: "", enabled: true },
      { name: "工作项目", count: 1, description: "", enabled: true },
    ];

    expect(findSimilarCategoryPairs(stats, [], { minSharedChars: 3 })).toEqual([]);
  });

  it("每一对只输出一次，且 a、b 已按 zh-CN 排序", () => {
    const pairs = findSimilarCategoryPairs(
      [
        { name: "技术偏好", count: 2, description: "", enabled: true },
        { name: "技术能力", count: 2, description: "", enabled: true },
      ],
      [],
    );

    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    expect(pair).toBeDefined();
    if (pair) {
      expect(pair.a.localeCompare(pair.b, "zh-CN")).toBeLessThanOrEqual(0);
      expect(pair.sharedChars).toBe("技术");
    }
  });
});
