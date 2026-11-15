/**
 * 记忆模块的接口类型。
 *
 * 形状对齐 `server/main.py`（Pydantic 模型与序列化）和 `server/console/mock/server.mjs`
 * （开发期内存实现）。只声明界面真正用到的字段，避免把上游 SDK 的内部结构泄漏到 UI。
 */

/** 一条记忆。`score` 只在语义搜索命中时存在。 */
export interface Memory {
  id: string;
  memory: string;
  user_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  hash?: string | null;
  /** 到期日，`YYYY-MM-DD`；null/缺省 = 永不过期。 */
  expiration_date?: string | null;
  categories?: string[] | null;
  /** 由服务端把非保留字段合并而来（source、confidence 等）。 */
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** 语义搜索相关度（0–1）。 */
  score?: number | null;
}

export type EntityType = "user" | "agent" | "run";

/** `GET /entities` 的一行；同一个 id 可能在不同 type 下各出现一次。 */
export interface MemoryEntity {
  id: string;
  type: string;
  total_memories: number;
  created_at?: string | null;
  updated_at?: string | null;
}

/** 列表与语义搜索共用的实体过滤条件。 */
export interface MemoryFilters {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}

export interface MemoryListResponse {
  results?: Memory[];
}

export interface MemorySearchResponse {
  results?: Memory[];
}

export interface MemoryCreateResponse {
  results?: { id?: string; memory?: string; event?: string }[];
}

export interface MemoryWriteResponse {
  message?: string;
}

/** `GET /memories/{id}/history` 的一条事件。 */
export interface MemoryHistoryEntry {
  id?: string;
  event: string;
  old_memory: string | null;
  new_memory: string | null;
  created_at?: string | null;
}

export interface CreateMemoryInput {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  user_id: string;
  agent_id?: string;
  run_id?: string;
  expiration_date?: string;
  metadata?: Record<string, unknown>;
}

/** `PUT /memories/{id}` 的字段集合；只发送实际改动的键。 */
export interface MemoryPatch {
  text?: string;
  categories?: string[];
  expiration_date?: string | null;
  metadata?: Record<string, unknown>;
}
