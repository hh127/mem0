import { Badge, Button, Card, Field, Input, Select } from "@/ui/primitives";
import type { SectionDraft, TestState } from "./types";

interface ModelSectionCardProps {
  idPrefix: string;
  title: string;
  description: string;
  draft: SectionDraft;
  /** null 表示用文本输入（reranker / vector_store），否则渲染为下拉。 */
  providerOptions: string[] | null;
  apiKeyConfigured: boolean;
  changed: boolean;
  testState?: TestState;
  supportsTest: boolean;
  onProviderChange: (value: string) => void;
  onChange: (patch: Partial<SectionDraft>) => void;
  onTest: () => void;
}

export function ModelSectionCard({
  idPrefix,
  title,
  description,
  draft,
  providerOptions,
  apiKeyConfigured,
  changed,
  testState,
  supportsTest,
  onProviderChange,
  onChange,
  onTest,
}: ModelSectionCardProps) {
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
        <div className="space-y-0.5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            {title}
            {changed ? <Badge tone="accent">已修改</Badge> : null}
            {testState?.result
              ? testState.result.ok
                ? <Badge tone="ok">连接正常</Badge>
                : <Badge tone="danger">连接失败</Badge>
              : null}
          </p>
          <p className="text-xs leading-5 text-ink-faint">{description}</p>
        </div>
        {supportsTest ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onTest}
            loading={testState?.loading}
          >
            测试连接
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="提供商" htmlFor={`${idPrefix}-provider`}>
          {providerOptions ? (
            <Select
              id={`${idPrefix}-provider`}
              value={draft.provider}
              onChange={(event) => onProviderChange(event.target.value)}
            >
              {draft.provider && !providerOptions.includes(draft.provider) ? (
                <option value={draft.provider}>{draft.provider}（当前）</option>
              ) : null}
              {providerOptions.length === 0 ? <option value="">未配置</option> : null}
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={`${idPrefix}-provider`}
              value={draft.provider}
              placeholder="例如 openai / cohere / pgvector"
              onChange={(event) => onProviderChange(event.target.value)}
            />
          )}
        </Field>

        <Field label="模型" htmlFor={`${idPrefix}-model`} hint="该提供商使用的模型名">
          <Input
            id={`${idPrefix}-model`}
            value={draft.model}
            placeholder="例如 gpt-4o-mini"
            onChange={(event) => onChange({ model: event.target.value })}
          />
        </Field>

        <Field
          label="Base URL"
          htmlFor={`${idPrefix}-base-url`}
          hint="留空使用提供商默认地址"
        >
          <Input
            id={`${idPrefix}-base-url`}
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
        </Field>

        <Field
          label="API Key"
          htmlFor={`${idPrefix}-api-key`}
          hint={apiKeyConfigured ? "服务端已保存密钥（不回显），留空表示不修改" : "留空表示不修改"}
        >
          <Input
            id={`${idPrefix}-api-key`}
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            placeholder="留空表示不修改"
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
        </Field>

        <Field
          label="Temperature"
          htmlFor={`${idPrefix}-temperature`}
          hint="可选，仅采样类模型使用"
        >
          <Input
            id={`${idPrefix}-temperature`}
            inputMode="decimal"
            value={draft.temperature}
            placeholder="例如 0.1"
            onChange={(event) => onChange({ temperature: event.target.value })}
          />
        </Field>

        <Field
          label="Max tokens"
          htmlFor={`${idPrefix}-max-tokens`}
          hint="可选，单次生成上限"
        >
          <Input
            id={`${idPrefix}-max-tokens`}
            inputMode="numeric"
            value={draft.maxTokens}
            placeholder="例如 2000"
            onChange={(event) => onChange({ maxTokens: event.target.value })}
          />
        </Field>
      </div>

      {testState?.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-xs leading-5 text-danger"
        >
          {testState.error}
        </p>
      ) : null}

      {testState?.result ? (
        testState.result.ok ? (
          <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-xs leading-5">
            <p className="font-medium text-ok">
              连接成功 · {testState.result.latency_ms} ms
              {testState.result.model ? ` · ${testState.result.model}` : ""}
            </p>
            <p className="mt-0.5 text-ink-soft">{testState.result.detail || "服务端未返回详情"}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-xs leading-5">
            <p className="font-medium text-danger">
              连接失败 · {testState.result.latency_ms} ms
            </p>
            <p className="mt-0.5 text-ink-soft">
              {testState.result.error || "服务端未返回失败原因"}
            </p>
          </div>
        )
      ) : null}
    </Card>
  );
}
