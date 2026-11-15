/** 配置页的数据结构，对齐 server/main.py 的 /configure 契约。 */

export interface ModelSection {
  provider?: string;
  config?: Record<string, unknown>;
}

export interface Mem0Config {
  llm?: ModelSection;
  embedder?: ModelSection;
  reranker?: ModelSection;
  vector_store?: ModelSection;
  graph_store?: ModelSection;
  custom_instructions?: string;
  custom_categories?: { name: string; description?: string; enabled?: boolean }[];
  custom_category_rules?: string[];
  [key: string]: unknown;
}

export interface ProviderCatalog {
  llm: string[];
  embedder: string[];
}

export type TestTarget = "llm" | "embedder" | "reranker";
export type SectionKey = "llm" | "embedder" | "reranker" | "vector_store";

/** 单个模型区块的可编辑草稿。apiKey 永远从空开始：服务端不回显密钥。 */
export interface SectionDraft {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
}

export interface ConfigureTestResult {
  target: string;
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  detail: string;
  error: string | null;
}

export interface TestState {
  loading: boolean;
  result: ConfigureTestResult | null;
  error: string | null;
}

export interface SectionPatch {
  provider?: string;
  config?: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value === "string" ? value : "";
}
