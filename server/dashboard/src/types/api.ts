export interface Memory {
  id: string;
  memory: string;
  user_id?: string;
  agent_id?: string;
  created_at?: string;
  updated_at?: string;
  /** 仅搜索结果返回：语义相关度（越大越相关） */
  score?: number;
  /** 到期日（YYYY-MM-DD，UTC，含当天）。缺省/为空 = 永不过期。 */
  expiration_date?: string | null;
  /** 写入时由分类器自动打的标签（顶层字段，与官方 Platform 对齐）。 */
  categories?: string[] | null;
}

export interface CategoryEntry {
  name: string;
  description: string;
  /** false = 保留在目录里但不再参与分类（已存在的标签不受影响）。 */
  enabled?: boolean;
}

export interface CategoryCatalog {
  custom_categories: CategoryEntry[];
  custom_category_rules: string[];
  names: string[];
  /** 已停用的分类名（与 custom_categories 里 enabled:false 的条目一致）。 */
  disabled: string[];
  enabled_count: number;
}

export interface CategoryCandidate {
  name: string;
  confidence: number;
  reason: string;
}

export interface CategoryTestResult {
  candidates: CategoryCandidate[];
  top: string | null;
  /** top1 与 top2 分差过小 = 落在分类边界上，值得人工确认。 */
  conflict: boolean;
  error: string | null;
  catalog_size: number;
}

export interface ApiKey {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyCreateResponse {
  id: string;
  label: string;
  key: string;
  key_prefix: string;
  created_at: string;
}

export interface ApiRequestLog {
  id: string;
  created_at: string;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  auth_type: string;
}

export type EntityType = "user" | "agent" | "run";

export interface UsageStatRow {
  key: string;
  model_type: string;
  prompt_tokens: number;
  /** prompt_tokens 中命中服务商缓存的部分 */
  prompt_cached_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
}

export interface UsageModelSummary {
  model_type: string;
  model_name: string;
  calls: number;
  prompt_tokens: number;
  prompt_cached_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsageStatsResponse {
  group_by: string;
  days: number;
  rows: UsageStatRow[];
  totals: {
    prompt_tokens: number;
    prompt_cached_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
  };
  by_model: UsageModelSummary[];
}

export interface ConfigureTestResult {
  target: "llm" | "embedder" | "reranker";
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  detail: string;
  error: string | null;
}

export interface Entity {
  id: string;
  type: EntityType;
  total_memories: number;
  created_at: string | null;
  updated_at: string | null;
}
