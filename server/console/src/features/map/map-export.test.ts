import { describe, expect, it } from "vitest";
import { buildSvgFileName } from "./map-export";

describe("buildSvgFileName", () => {
  it("把本地日期补零成 YYYYMMDD（月初）", () => {
    expect(buildSvgFileName(new Date(2026, 0, 5))).toBe("mem0-记忆地图-20260105.svg");
  });

  it("把本地日期补零成 YYYYMMDD（年末）", () => {
    expect(buildSvgFileName(new Date(2026, 11, 31))).toBe("mem0-记忆地图-20261231.svg");
  });

  it("不传参时以当前日期生成文件名", () => {
    expect(buildSvgFileName()).toMatch(/^mem0-记忆地图-\d{8}\.svg$/);
  });

  it("相同入参得到相同结果", () => {
    const date = new Date(2026, 5, 7);
    expect(buildSvgFileName(date)).toBe(buildSvgFileName(date));
  });
});
