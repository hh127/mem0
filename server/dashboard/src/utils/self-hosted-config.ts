type ProviderConfig = {
  provider?: string;
  config?: {
    model?: string;
    api_key?: string;
    openai_base_url?: string;
    base_url?: string;
    temperature?: number;
    max_tokens?: number;
    top_k?: number;
    [key: string]: unknown;
  };
};

export type EffectiveConfig = {
  llm?: ProviderConfig;
  embedder?: ProviderConfig;
  reranker?: ProviderConfig;
};

export const RERANKER_PROVIDERS = [
  "cloud_reranker",
  "llm_reranker",
  "cohere",
  "huggingface",
  "sentence_transformer",
  "zero_entropy",
] as const;

export const getEffectiveConfig = (data: unknown): EffectiveConfig | null => {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  return (
    (record.effective_config as EffectiveConfig) ||
    (record.config as EffectiveConfig) ||
    (record as EffectiveConfig)
  );
};

/** Drop blank values so a saved config never erases fields the admin left empty. */
const compact = (input: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
};

/** "" → undefined, "0.2" → 0.2, "abc" → undefined (never posts NaN to the API). */
export const parseOptionalNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildProviderConfig = ({
  provider,
  model,
  apiKey,
}: {
  provider: string;
  model: string;
  apiKey?: string;
}) => {
  if (!provider) {
    return undefined;
  }

  return {
    provider,
    config: {
      model: model || undefined,
      api_key: apiKey || undefined,
    },
  };
};

export const buildLlmConfig = ({
  provider,
  model,
  apiKey,
  baseUrl,
  temperature,
  maxTokens,
}: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}) => {
  if (!provider) return undefined;

  return {
    provider,
    config: compact({
      model,
      api_key: apiKey,
      openai_base_url: baseUrl,
      temperature,
      max_tokens: maxTokens,
    }),
  };
};

export const buildEmbedderConfig = ({
  provider,
  model,
  apiKey,
  baseUrl,
}: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}) => {
  if (!provider) return undefined;

  return {
    provider,
    config: compact({
      model,
      api_key: apiKey,
      openai_base_url: baseUrl,
    }),
  };
};

export const buildRerankerConfig = ({
  provider,
  model,
  apiKey,
  baseUrl,
  topK,
}: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  topK?: number;
}) => {
  if (!provider) return undefined;

  return {
    provider,
    config: compact({
      model,
      api_key: apiKey,
      base_url: baseUrl,
      top_k: topK,
    }),
  };
};
