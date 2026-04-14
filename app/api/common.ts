import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";
import { OPENAI_BASE_URL, ServiceProvider } from "../constant";
import { cloudflareAIGatewayUrl } from "../utils/cloudflare";
import { getModelProvider, isModelNotavailableInServer } from "../utils/model";

const serverConfig = getServerSideConfig();

function createRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
  );
}

function redactSecrets(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}

function truncateForLog(text: string, maxLength = 500) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getUpstreamHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function getOpenAIRequestMeta(bodyText?: string) {
  if (!bodyText) return {};

  try {
    const body = JSON.parse(bodyText) as {
      model?: string;
      stream?: boolean;
      messages?: unknown[];
      max_tokens?: number;
      max_completion_tokens?: number;
    };

    return {
      model: body.model,
      stream: body.stream,
      messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
    };
  } catch {
    return { parseError: true };
  }
}

function getErrorSummary(text: string) {
  const safeText = redactSecrets(text);

  try {
    const json = JSON.parse(safeText) as {
      error?: string | { message?: string; type?: string; code?: string };
      message?: string;
      type?: string;
      code?: string;
    };
    const error =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? json.message;

    return truncateForLog(
      JSON.stringify({
        error,
        type: typeof json.error === "object" ? json.error?.type : json.type,
        code: typeof json.error === "object" ? json.error?.code : json.code,
      }),
    );
  } catch {
    return truncateForLog(safeText.replace(/\s+/g, " ").trim());
  }
}

export async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();
  const requestId = createRequestId();
  const startedAt = Date.now();

  const isAzure = req.nextUrl.pathname.includes("azure/deployments");

  var authValue,
    authHeaderName = "";
  if (isAzure) {
    authValue =
      req.headers
        .get("Authorization")
        ?.trim()
        .replaceAll("Bearer ", "")
        .trim() ?? "";

    authHeaderName = "api-key";
  } else {
    authValue = req.headers.get("Authorization") ?? "";
    authHeaderName = "Authorization";
  }

  let path = `${req.nextUrl.pathname}`.replaceAll("/api/openai/", "");

  let baseUrl =
    (isAzure ? serverConfig.azureUrl : serverConfig.baseUrl) || OPENAI_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  if (isAzure) {
    const azureApiVersion =
      req?.nextUrl?.searchParams?.get("api-version") ||
      serverConfig.azureApiVersion;
    baseUrl = baseUrl.split("/deployments").shift() as string;
    path = `${req.nextUrl.pathname.replaceAll(
      "/api/azure/",
      "",
    )}?api-version=${azureApiVersion}`;

    // Forward compatibility:
    // if display_name(deployment_name) not set, and '{deploy-id}' in AZURE_URL
    // then using default '{deploy-id}'
    if (serverConfig.customModels && serverConfig.azureUrl) {
      const modelName = path.split("/")[1];
      let realDeployName = "";
      serverConfig.customModels
        .split(",")
        .filter((v) => !!v && !v.startsWith("-") && v.includes(modelName))
        .forEach((m) => {
          const [fullName, displayName] = m.split("=");
          const [_, providerName] = getModelProvider(fullName);
          if (providerName === "azure" && !displayName) {
            const [_, deployId] = (serverConfig?.azureUrl ?? "").split(
              "deployments/",
            );
            if (deployId) {
              realDeployName = deployId;
            }
          }
        });
      if (realDeployName) {
        console.log("[Replace with DeployId", realDeployName);
        path = path.replaceAll(modelName, realDeployName);
      }
    }
  }

  let requestBodyText: string | undefined;
  if (req.body) {
    try {
      requestBodyText = await req.text();
    } catch (e) {
      console.error("[OpenAI Proxy Diagnostics] failed to read request body", {
        requestId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const fetchUrl = cloudflareAIGatewayUrl(`${baseUrl}/${path}`);
  const requestMeta = getOpenAIRequestMeta(requestBodyText);
  console.log("[OpenAI Proxy Diagnostics] request", {
    requestId,
    method: req.method,
    path,
    upstreamHost: getUpstreamHost(baseUrl),
    ...requestMeta,
  });

  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      [authHeaderName]: authValue,
      ...(serverConfig.openaiOrgId && {
        "OpenAI-Organization": serverConfig.openaiOrgId,
      }),
    },
    method: req.method,
    body: requestBodyText ?? req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  // #1815 try to refuse gpt4 request
  if (serverConfig.customModels && requestBodyText) {
    try {
      const jsonBody = JSON.parse(requestBodyText) as { model?: string };

      // not undefined and is false
      if (
        isModelNotavailableInServer(
          serverConfig.customModels,
          jsonBody?.model as string,
          [
            ServiceProvider.OpenAI,
            ServiceProvider.Azure,
            jsonBody?.model as string, // support provider-unspecified model
          ],
        )
      ) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error("[OpenAI] gpt4 filter", e);
    }
  }

  try {
    const res = await fetch(fetchUrl, fetchOptions);
    const durationMs = Date.now() - startedAt;
    console.log("[OpenAI Proxy Diagnostics] response", {
      requestId,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      contentType: res.headers.get("content-type"),
    });

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    // Conditionally delete the OpenAI-Organization header from the response if [Org ID] is undefined or empty (not setup in ENV)
    // Also, this is to prevent the header from being sent to the client
    if (!serverConfig.openaiOrgId || serverConfig.openaiOrgId.trim() === "") {
      newHeaders.delete("OpenAI-Organization");
    }

    // The latest version of the OpenAI API forced the content-encoding to be "br" in json response
    // So if the streaming is disabled, we need to remove the content-encoding header
    // Because Vercel uses gzip to compress the response, if we don't remove the content-encoding header
    // The browser will try to decode the response with brotli and fail
    newHeaders.delete("content-encoding");

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[OpenAI Proxy Diagnostics] upstream error", {
        requestId,
        status: res.status,
        durationMs,
        summary: getErrorSummary(errorText),
      });
      return new Response(errorText, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders,
      });
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    console.error("[OpenAI Proxy Diagnostics] fetch failed", {
      requestId,
      durationMs,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
