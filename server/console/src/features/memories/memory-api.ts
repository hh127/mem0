/**
 * 记忆模块的网络层：所有请求都经过 `@/lib/api`。
 *
 * 真实服务端与 mock 的响应都包在 `{ results: [...] }` 里（`server/main.py`），
 * 语义搜索结果额外带 `score`。查询键统一在这里定义，跨页共享缓存。
 */
import { ApiError, api } from "@/lib/api";
import type { CategoryCatalog } from "@/lib/types";
import type {
  CreateMemoryInput,
  Memory,
  MemoryCreateResponse,
  MemoryEntity,
  MemoryFilters,
  MemoryHistoryEntry,
  MemoryListResponse,
  MemoryPatch,
  MemorySearchResponse,
  MemoryWriteResponse,
} from "./types";

/** 与 server/main.py 的 ALL_MEMORIES_LIMIT 保持一致。 */
export const MEMORY_FETCH_LIMIT = 1000;
/** 语义搜索一次取回的条数（客户端再分页）。 */
export const SEARCH_TOP_K = 200;
/** 管理员未选实体时，全局搜索最多遍历的实体数（按记忆数降序）。 */
export const GLOBAL_SEARCH_MAX_TARGETS = 50;
const GLOBAL_SEARCH_CONCURRENCY = 4;

const IDENTIFIER_KEYS = ["user_id", "agent_id", "run_id"] as const;

/**
 * mem0 SDK 的 search 要求 filters 至少带 user_id / agent_id / run_id 之一，
 * 空 filters 会直接 400。UI 用它判断是否需要先选实体或走全局扇出。
 */
export function hasEntityFilter(filters: MemoryFilters): boolean {
  return IDENTIFIER_KEYS.some((key) => Boolean(filters[key]));
}

/** 记忆模块所有查询键都以 `memories` 为前缀，便于整块失效。 */
export const memoryKeys = {
  root: ["memories"] as const,
  list: (filters: MemoryFilters, showExpired: boolean) =>
    [
      "memories",
      "list",
      filters.user_id ?? "",
      filters.agent_id ?? "",
      filters.run_id ?? "",
      showExpired ? "with-expired" : "active",
    ] as const,
  search: (
    query: string,
    filters: MemoryFilters,
    rerank: boolean,
    showExpired: boolean,
  ) =>
    [
      "memories",
      "search",
      query,
      filters.user_id ?? "",
      filters.agent_id ?? "",
      filters.run_id ?? "",
      rerank ? "rerank" : "plain",
      showExpired ? "with-expired" : "active",
    ] as const,
  detail: (id: string) => ["memories", "detail", id] as const,
  history: (id: string) => ["memories", "history", id] as const,
  entities: ["memories", "entities"] as const,
  categories: ["memories", "categories"] as const,
};

function cleanFilters(filters: MemoryFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.user_id) out.user_id = filters.user_id;
  if (filters.agent_id) out.agent_id = filters.agent_id;
  if (filters.run_id) out.run_id = filters.run_id;
  return out;
}

function asMemoryList(response: MemoryListResponse | MemorySearchResponse | null | undefined): Memory[] {
  return Array.isArray(response?.results) ? response.results : [];
}

/** 拉取记忆列表；管理员不带过滤 = 全量（最多 1000 条），普通用户必须带 user_id。 */
export async function fetchMemories(
  filters: MemoryFilters,
  showExpired: boolean,
  signal?: AbortSignal,
): Promise<Memory[]> {
  const response = await api.get<MemoryListResponse>(
    "/memories",
    {
      user_id: filters.user_id || undefined,
      agent_id: filters.agent_id || undefined,
      run_id: filters.run_id || undefined,
      top_k: MEMORY_FETCH_LIMIT,
      show_expired: showExpired,
    },
    signal,
  );
  return asMemoryList(response);
}

interface SearchInput {
  query: string;
  filters: MemoryFilters;
  rerank: boolean;
  showExpired: boolean;
  signal?: AbortSignal;
}

async function searchOnce(input: SearchInput): Promise<Memory[]> {
  const response = await api.post<MemorySearchResponse>(
    "/search",
    {
      query: input.query,
      filters: cleanFilters(input.filters),
      top_k: SEARCH_TOP_K,
      rerank: input.rerank,
      show_expired: input.showExpired,
    },
    { signal: input.signal },
  );
  return asMemoryList(response).slice().sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

/**
 * 语义搜索：向量召回 + 可选重排，结果按 score 降序。
 *
 * 服务端（mem0 SDK）不接受空 filters。普通用户永远带 scope 的 user_id；
 * 管理员没选实体时，`globalFallback` 会先枚举实体，再按实体逐个搜索并合并结果，
 * 行为与官方 dashboard 的“全局搜索”一致。单个实体失败不影响整体。
 */
export async function searchMemories(
  input: SearchInput & { globalFallback?: boolean },
): Promise<Memory[]> {
  if (hasEntityFilter(input.filters)) return searchOnce(input);
  if (!input.globalFallback) {
    throw new ApiError(
      "语义搜索需要先选定归属实体（用户 / 代理 / 运行），或由管理员使用全局搜索。",
      400,
    );
  }

  const entities = await fetchEntities(input.signal);
  const targets = entities
    .filter((entity) => entity.type === "user" || entity.type === "agent" || entity.type === "run")
    .sort((left, right) => right.total_memories - left.total_memories)
    .slice(0, GLOBAL_SEARCH_MAX_TARGETS);
  if (targets.length === 0) return [];

  const merged = new Map<string, Memory>();
  for (let start = 0; start < targets.length; start += GLOBAL_SEARCH_CONCURRENCY) {
    const batch = targets.slice(start, start + GLOBAL_SEARCH_CONCURRENCY);
    const lists = await Promise.all(
      batch.map(async (entity) => {
        const filters: MemoryFilters =
          entity.type === "user"
            ? { user_id: entity.id }
            : entity.type === "agent"
              ? { agent_id: entity.id }
              : { run_id: entity.id };
        try {
          return await searchOnce({
            query: input.query,
            filters,
            rerank: input.rerank,
            showExpired: input.showExpired,
            signal: input.signal,
          });
        } catch (error) {
          // 某个实体没有可检索数据（400/404）不应让整次全局搜索失败。
          if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
            return [];
          }
          throw error;
        }
      }),
    );
    for (const list of lists) {
      for (const memory of list) {
        const existing = merged.get(memory.id);
        if (!existing || (memory.score ?? 0) > (existing.score ?? 0)) {
          merged.set(memory.id, memory);
        }
      }
    }
  }

  return [...merged.values()]
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, SEARCH_TOP_K);
}

export async function fetchMemoryDetail(id: string, signal?: AbortSignal): Promise<Memory> {
  return api.get<Memory>(`/memories/${encodeURIComponent(id)}`, undefined, signal);
}

function asHistory(payload: unknown): MemoryHistoryEntry[] {
  if (Array.isArray(payload)) return payload as MemoryHistoryEntry[];
  if (payload && typeof payload === "object") {
    const results = (payload as { results?: unknown }).results;
    if (Array.isArray(results)) return results as MemoryHistoryEntry[];
  }
  return [];
}

export async function fetchMemoryHistory(id: string, signal?: AbortSignal): Promise<MemoryHistoryEntry[]> {
  const payload = await api.get<unknown>(`/memories/${encodeURIComponent(id)}/history`, undefined, signal);
  return asHistory(payload);
}

export async function fetchEntities(signal?: AbortSignal): Promise<MemoryEntity[]> {
  const payload = await api.get<MemoryEntity[]>("/entities", undefined, signal);
  return Array.isArray(payload) ? payload : [];
}

export async function fetchCategoryCatalog(signal?: AbortSignal): Promise<CategoryCatalog> {
  return api.get<CategoryCatalog>("/categories", undefined, signal);
}

export async function createMemory(input: CreateMemoryInput): Promise<MemoryCreateResponse> {
  return api.post<MemoryCreateResponse>("/memories", input);
}

export async function updateMemory(id: string, patch: MemoryPatch): Promise<MemoryWriteResponse> {
  return api.put<MemoryWriteResponse>(`/memories/${encodeURIComponent(id)}`, patch);
}

export async function deleteMemory(id: string): Promise<MemoryWriteResponse> {
  return api.delete<MemoryWriteResponse>(`/memories/${encodeURIComponent(id)}`);
}

export type ReviewAction = "approve" | "reject";

/**
 * 记录人工审核结论（管理员）。审核状态写在记忆 metadata 里，
 * 未审核的记忆没有 `review_status` 字段，因此列表不需要额外的状态字段。
 */
export async function reviewMemory(
  id: string,
  action: ReviewAction,
  note?: string,
): Promise<MemoryWriteResponse> {
  return api.post<MemoryWriteResponse>(`/memories/${encodeURIComponent(id)}/review`, {
    action,
    note: note?.trim() || undefined,
  });
}
