import { getClientConfig } from "../config/client";
import {
  AI302_BASE_URL,
  ALIBABA_BASE_URL,
  ANTHROPIC_BASE_URL,
  ApiPath,
  BAIDU_BASE_URL,
  BYTEDANCE_BASE_URL,
  CHATGLM_BASE_URL,
  DEEPSEEK_BASE_URL,
  GEMINI_BASE_URL,
  IFLYTEK_BASE_URL,
  MOONSHOT_BASE_URL,
  OPENAI_BASE_URL,
  ServiceProvider,
  SILICONFLOW_BASE_URL,
  STABILITY_BASE_URL,
  TENCENT_BASE_URL,
  XAI_BASE_URL,
} from "../constant";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";

export type ApiHealthStatus = "stable" | "fair" | "unstable" | "unavailable";
export type ApiHealthSource = "official" | "proxy" | "third-party";

export interface ApiHealthRecord {
  url: string;
  timestamp: number;
  model: string;
  stream: boolean;
  success: boolean;
  durationMs: number;
  firstTokenLatencyMs?: number;
  statusCode?: number;
  errorCode?: string;
}

export interface ApiHealthSummary {
  url: string;
  status: ApiHealthStatus;
  source: ApiHealthSource;
  total: number;
  successCount: number;
  avgFirstTokenLatencyMs?: number;
  recentFailures: { code: string; count: number }[];
  suggestions: string[];
}

const MAX_RECORDS_PER_URL = 20;
const MAX_URL_BUCKETS = 8;

const OFFICIAL_HOSTS = new Set(
  [
    OPENAI_BASE_URL,
    ANTHROPIC_BASE_URL,
    GEMINI_BASE_URL,
    BAIDU_BASE_URL,
    BYTEDANCE_BASE_URL,
    ALIBABA_BASE_URL,
    TENCENT_BASE_URL,
    MOONSHOT_BASE_URL,
    STABILITY_BASE_URL,
    IFLYTEK_BASE_URL,
    DEEPSEEK_BASE_URL,
    XAI_BASE_URL,
    CHATGLM_BASE_URL,
    SILICONFLOW_BASE_URL,
    AI302_BASE_URL,
  ]
    .map((url) => {
      try {
        return new URL(url).host.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeProvider(provider?: string): ServiceProvider {
  return (Object.values(ServiceProvider).includes(provider as ServiceProvider)
    ? provider
    : ServiceProvider.OpenAI) as ServiceProvider;
}

export function normalizeApiHealthUrl(url: string) {
  const nextUrl = trimTrailingSlash(url.trim());

  if (nextUrl.length === 0) {
    return "";
  }

  if (nextUrl.startsWith("/")) {
    return nextUrl || "/";
  }

  const normalizedUrl = nextUrl.startsWith("http") ? nextUrl : `https://${nextUrl}`;

  try {
    const parsed = new URL(normalizedUrl);
    return trimTrailingSlash(
      `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`,
    );
  } catch {
    return normalizedUrl;
  }
}

function isExportBuild() {
  return getClientConfig()?.buildMode === "export";
}

function getDefaultProviderUrl(provider: ServiceProvider) {
  const isApp = isExportBuild();

  switch (provider) {
    case ServiceProvider.Azure:
      return isApp ? OPENAI_BASE_URL : ApiPath.Azure;
    case ServiceProvider.Google:
      return isApp ? GEMINI_BASE_URL : ApiPath.Google;
    case ServiceProvider.Anthropic:
      return isApp ? ANTHROPIC_BASE_URL : ApiPath.Anthropic;
    case ServiceProvider.Baidu:
      return isApp ? BAIDU_BASE_URL : ApiPath.Baidu;
    case ServiceProvider.ByteDance:
      return isApp ? BYTEDANCE_BASE_URL : ApiPath.ByteDance;
    case ServiceProvider.Alibaba:
      return isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;
    case ServiceProvider.Tencent:
      return isApp ? TENCENT_BASE_URL : ApiPath.Tencent;
    case ServiceProvider.Moonshot:
      return isApp ? MOONSHOT_BASE_URL : ApiPath.Moonshot;
    case ServiceProvider.Stability:
      return isApp ? STABILITY_BASE_URL : ApiPath.Stability;
    case ServiceProvider.Iflytek:
      return isApp ? IFLYTEK_BASE_URL : ApiPath.Iflytek;
    case ServiceProvider.DeepSeek:
      return isApp ? DEEPSEEK_BASE_URL : ApiPath.DeepSeek;
    case ServiceProvider.XAI:
      return isApp ? XAI_BASE_URL : ApiPath.XAI;
    case ServiceProvider.ChatGLM:
      return isApp ? CHATGLM_BASE_URL : ApiPath.ChatGLM;
    case ServiceProvider.SiliconFlow:
      return isApp ? SILICONFLOW_BASE_URL : ApiPath.SiliconFlow;
    case ServiceProvider["302.AI"]:
      return isApp ? AI302_BASE_URL : ApiPath["302.AI"];
    case ServiceProvider.OpenAI:
    default:
      return isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;
  }
}

function getCustomProviderUrl(
  accessState: ReturnType<typeof useAccessStore.getState>,
  provider: ServiceProvider,
) {
  switch (provider) {
    case ServiceProvider.Azure:
      return accessState.azureUrl;
    case ServiceProvider.Google:
      return accessState.googleUrl;
    case ServiceProvider.Anthropic:
      return accessState.anthropicUrl;
    case ServiceProvider.Baidu:
      return accessState.baiduUrl;
    case ServiceProvider.ByteDance:
      return accessState.bytedanceUrl;
    case ServiceProvider.Alibaba:
      return accessState.alibabaUrl;
    case ServiceProvider.Tencent:
      return accessState.tencentUrl;
    case ServiceProvider.Moonshot:
      return accessState.moonshotUrl;
    case ServiceProvider.Stability:
      return accessState.stabilityUrl;
    case ServiceProvider.Iflytek:
      return accessState.iflytekUrl;
    case ServiceProvider.DeepSeek:
      return accessState.deepseekUrl;
    case ServiceProvider.XAI:
      return accessState.xaiUrl;
    case ServiceProvider.ChatGLM:
      return accessState.chatglmUrl;
    case ServiceProvider.SiliconFlow:
      return accessState.siliconflowUrl;
    case ServiceProvider["302.AI"]:
      return accessState.ai302Url;
    case ServiceProvider.OpenAI:
    default:
      return accessState.openaiUrl;
  }
}

export function getCurrentApiHealthUrl(provider?: string) {
  const accessState = useAccessStore.getState();
  const nextProvider = normalizeProvider(provider ?? accessState.provider);
  const url = accessState.useCustomConfig
    ? getCustomProviderUrl(accessState, nextProvider)
    : getDefaultProviderUrl(nextProvider);

  return normalizeApiHealthUrl(url);
}

export function getApiHealthSource(url: string): ApiHealthSource {
  if (!url) {
    return "proxy";
  }

  if (url.startsWith("/api/")) {
    return "proxy";
  }

  try {
    const parsed = new URL(url);
    return OFFICIAL_HOSTS.has(parsed.host.toLowerCase())
      ? "official"
      : "third-party";
  } catch {
    return "third-party";
  }
}

export function normalizeApiHealthErrorCode(message: string) {
  const nextMessage = message.toLowerCase();

  if (nextMessage.includes("aborted")) {
    return "aborted";
  }

  if (nextMessage.includes("504") || nextMessage.includes("timed out")) {
    return "504";
  }

  if (nextMessage.includes("load failed")) {
    return "network";
  }

  if (nextMessage.includes("empty response")) {
    return "empty";
  }

  if (nextMessage.includes("timeout")) {
    return "timeout";
  }

  return "error";
}

function isSevereFailure(record: ApiHealthRecord) {
  return (
    !record.success &&
    (!!record.statusCode && record.statusCode >= 500 ||
      record.errorCode === "504" ||
      record.errorCode === "timeout" ||
      record.errorCode === "network" ||
      record.errorCode === "empty")
  );
}

function getFailureCode(record: ApiHealthRecord) {
  if (record.success) {
    return null;
  }

  if (record.statusCode) {
    return String(record.statusCode);
  }

  return record.errorCode ?? "error";
}

function getFailureStreak(records: ApiHealthRecord[]) {
  let streak = 0;

  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i].success) {
      break;
    }
    streak += 1;
  }

  return streak;
}

function getStatus(records: ApiHealthRecord[]) {
  if (records.length === 0) {
    return "unavailable" as const;
  }

  const successCount = records.filter((record) => record.success).length;
  const successRate = successCount / records.length;
  const recent10 = records.slice(-10);
  const severeFailures = recent10.filter(isSevereFailure).length;
  const authFailures = recent10.filter((record) => record.statusCode === 401).length;
  const failureStreak = getFailureStreak(records);

  if (
    successCount === 0 ||
    failureStreak >= 3 ||
    (recent10.length >= 3 && recent10.every((record) => !record.success))
  ) {
    return "unavailable" as const;
  }

  if (successRate >= 0.9 && severeFailures === 0 && authFailures === 0) {
    return "stable" as const;
  }

  if (successRate >= 0.7 && severeFailures <= 1 && authFailures <= 1) {
    return "fair" as const;
  }

  return "unstable" as const;
}

function getRecentFailures(records: ApiHealthRecord[]) {
  const recent10 = records.slice(-10);
  const counts = new Map<string, number>();

  recent10.forEach((record) => {
    const code = getFailureCode(record);
    if (!code) {
      return;
    }

    counts.set(code, (counts.get(code) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function buildApiHealthSummary(
  url: string,
  _provider?: string,
  _currentModel?: string,
  streamEnabled?: boolean,
): ApiHealthSummary {
  const normalizedUrl = normalizeApiHealthUrl(url);
  const records = (
    useApiHealthStore.getState().recordsByUrl[normalizedUrl] ?? []
  ).slice(-MAX_RECORDS_PER_URL);
  const successCount = records.filter((record) => record.success).length;
  const latencySamples = records
    .map((record) => record.firstTokenLatencyMs)
    .filter((value): value is number => typeof value === "number");
  const avgFirstTokenLatencyMs =
    latencySamples.length > 0
      ? latencySamples.reduce((total, value) => total + value, 0) /
        latencySamples.length
      : undefined;
  const recentFailures = getRecentFailures(records);
  const source = getApiHealthSource(normalizedUrl);
  const suggestions: string[] = [];

  if (records.length === 0) {
    suggestions.push("no-data");
  }

  if (source === "third-party" && streamEnabled) {
    suggestions.push("third-party-stream");
  }

  if (
    recentFailures.some((item) =>
      ["500", "502", "503", "504", "timeout", "network", "empty"].includes(
        item.code,
      ),
    )
  ) {
    suggestions.push("timeout");
  }

  if (
    records
      .slice(-10)
      .filter((record) => [400, 404].includes(record.statusCode ?? 0)).length >= 2
  ) {
    suggestions.push("model");
  }

  if (
    records
      .slice(-10)
      .filter((record) => (record.statusCode ?? 0) === 401).length >= 2
  ) {
    suggestions.push("auth");
  }

  return {
    url: normalizedUrl,
    source,
    status: getStatus(records),
    total: records.length,
    successCount,
    avgFirstTokenLatencyMs,
    recentFailures,
    suggestions: Array.from(new Set(suggestions)),
  };
}

type ApiHealthState = {
  recordsByUrl: Record<string, ApiHealthRecord[]>;
};

export const useApiHealthStore = createPersistStore(
  {
    recordsByUrl: {} as Record<string, ApiHealthRecord[]>,
  },
  (_set, get) => ({
    record(record: ApiHealthRecord) {
      const normalizedUrl = normalizeApiHealthUrl(record.url);

      if (!normalizedUrl) {
        return;
      }

      const nextRecord: ApiHealthRecord = {
        ...record,
        url: normalizedUrl,
        timestamp: record.timestamp || Date.now(),
      };
      const nextBuckets = {
        ...get().recordsByUrl,
        [normalizedUrl]: [
          ...(get().recordsByUrl[normalizedUrl] ?? []),
          nextRecord,
        ].slice(-MAX_RECORDS_PER_URL),
      };
      const bucketEntries = Object.entries(nextBuckets);

      if (bucketEntries.length > MAX_URL_BUCKETS) {
        const recentBuckets = bucketEntries
          .sort(
            (a, b) =>
              (b[1][b[1].length - 1]?.timestamp ?? 0) -
              (a[1][a[1].length - 1]?.timestamp ?? 0),
          )
          .slice(0, MAX_URL_BUCKETS);

        get().update((state) => {
          state.recordsByUrl = Object.fromEntries(recentBuckets);
        });
        return;
      }

      get().update((state) => {
        state.recordsByUrl = nextBuckets;
      });
    },
  }),
  {
    name: "api-health-store",
    version: 1,
  },
);
