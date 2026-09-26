export interface Memory {
  id: string;
  memory: string;
  user_id?: string;
  agent_id?: string;
  created_at?: string;
  updated_at?: string;
  /** 仅搜索结果返回：语义相关度（越大越相关） */
  score?: number;
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
