/**
 * 记忆地图导出：把页面里的 SVG 克隆成独立文件。
 *
 * 页面里的颜色来自 CSS token 与 Tailwind 类，直接序列化会在别处丢失样式，
 * 因此这里逐个元素把 getComputedStyle 的计算值内联成属性。
 */

const FILE_PREFIX = "mem0-记忆地图";

/** 需要内联的计算样式属性。 */
const STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 导出文件名：mem0-记忆地图-YYYYMMDD.svg（本地日期）。 */
export function buildSvgFileName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${FILE_PREFIX}-${year}${month}${day}.svg`;
}

function safeComputedStyle(el: Element): CSSStyleDeclaration | null {
  if (typeof getComputedStyle !== "function") return null;
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

/**
 * 把页面里的 <svg> 克隆成独立 SVG 文本：
 * - 克隆节点，逐个元素把 getComputedStyle 的计算值写成属性
 * - 清理 class 属性
 * - 补 xmlns / width / height / viewBox
 * - 最前面插入一个覆盖整幅画布的底色 rect
 */
export function serializeMapSvg(source: SVGSVGElement): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const sourceElements = Array.from(source.querySelectorAll("*"));
  const cloneElements = Array.from(clone.querySelectorAll("*"));

  const count = Math.min(sourceElements.length, cloneElements.length);
  for (let index = 0; index < count; index += 1) {
    const sourceElement = sourceElements[index]!;
    const cloneElement = cloneElements[index]!;
    const style = safeComputedStyle(sourceElement);
    if (!style) continue;

    for (const property of STYLE_PROPERTIES) {
      const value = style.getPropertyValue(property).trim();
      if (value === "") continue;
      cloneElement.setAttribute(property, value);
    }
  }

  for (const element of cloneElements) {
    element.removeAttribute("class");
  }
  clone.removeAttribute("class");

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = clone.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      clone.setAttribute("width", parts[2]!);
      clone.setAttribute("height", parts[3]!);
    }
  }

  const paperStyle = safeComputedStyle(source);
  const paper = paperStyle?.getPropertyValue("--c-paper").trim() || "#ffffff";

  const ownerDocument = clone.ownerDocument ?? source.ownerDocument;
  const background = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", paper);
  clone.insertBefore(background, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/** 触发浏览器下载（Blob + a[download] + revokeObjectURL）。 */
export function downloadSvg(filename: string, text: string): void {
  const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
}
