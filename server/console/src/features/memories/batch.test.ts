import { describe, expect, it } from "vitest";
import {
  applyCategoryOp,
  batchSummary,
  normalizeCategories,
  pruneSelection,
  runWithConcurrency,
} from "./batch";

describe("normalizeCategories", () => {
  it("去空、去重并保持顺序", () => {
    expect(normalizeCategories([" b ", "a", "", "b", "a"])).toEqual(["b", "a"]);
  });
});

describe("applyCategoryOp", () => {
  it("replace 整体替换（空选择 = 清空）", () => {
    expect(applyCategoryOp(["旧分类"], ["新分类"], "replace")).toEqual(["新分类"]);
    expect(applyCategoryOp(["旧分类"], [], "replace")).toEqual([]);
  });

  it("add 在原有分类上追加并去重", () => {
    expect(applyCategoryOp(["旧分类", "新分类"], ["新分类", "另一个"], "add")).toEqual([
      "旧分类",
      "新分类",
      "另一个",
    ]);
  });

  it("remove 从原有分类里摘掉选中项", () => {
    expect(applyCategoryOp(["A", "B", "C"], ["B", "D"], "remove")).toEqual(["A", "C"]);
  });
});

describe("runWithConcurrency", () => {
  it("单个失败不中断整批，并逐条报告进度", async () => {
    const progress: number[] = [];
    const result = await runWithConcurrency(
      [1, 2, 3, 4],
      2,
      async (item) => {
        if (item === 2) throw new Error("boom");
      },
      (done) => progress.push(done),
    );

    expect(result.succeeded).toEqual([1, 3, 4]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.item).toBe(2);
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it("空列表直接返回空结果", async () => {
    await expect(runWithConcurrency([], 4, async () => undefined)).resolves.toEqual({
      succeeded: [],
      failed: [],
    });
  });
});

describe("pruneSelection", () => {
  it("剪掉已经不存在的 ID，未变化时返回同一引用", () => {
    const alive = new Set(["a", "c"]);
    expect(pruneSelection(["a", "b", "c"], alive)).toEqual(["a", "c"]);

    const selected = ["a", "c"];
    expect(pruneSelection(selected, alive)).toBe(selected);
  });
});

describe("batchSummary", () => {
  it("生成成功/部分失败的摘要", () => {
    expect(batchSummary("批量删除", { succeeded: [1, 2], failed: [] })).toBe("批量删除完成：共 2 条");
    expect(
      batchSummary("批量删除", { succeeded: [1], failed: [{ item: 2, error: new Error("x") }] }),
    ).toBe("批量删除：成功 1 条，失败 1 条");
  });
});
