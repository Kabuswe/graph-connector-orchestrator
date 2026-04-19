/**
 * executeAction — executes the requested action via the resolved connector.
 */
import type { ConnectorConfig } from "../registry.js";

interface ActionPayload {
  action: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

async function executeHttpWebhook(
  params: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const { url, method = "POST", body } = params;
  if (!url) throw new Error("http-webhook requires params.url");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const r = await fetch(url as string, {
    method: method as string,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  return { status: r.status, ok: r.ok, body: r.ok ? await r.json().catch(() => null) : null };
}

async function executeGitHub(
  action: string,
  params: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const base = "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (action === "create-issue") {
    const r = await fetch(`${base}/repos/${params.owner}/${params.repo}/issues`, {
      method: "POST", headers,
      body: JSON.stringify({ title: params.title, body: params.body }),
      signal: AbortSignal.timeout(15000),
    });
    return r.json();
  }
  if (action === "list-issues") {
    const r = await fetch(`${base}/repos/${params.owner}/${params.repo}/issues`, { headers, signal: AbortSignal.timeout(15000) });
    return r.json();
  }
  throw new Error(`GitHub action '${action}' not implemented`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const executeActionNode = async (state: any) => {
  const { connectorConfig, authStatus, action, payload } = state;

  if (authStatus !== "ok" || !connectorConfig) {
    return {
      phase: "execute-action",
      rawResult: null,
      resultStatus: "failed" as const,
      // Preserve existing error from resolveConnector — don't overwrite
    };
  }

  const config = connectorConfig as ConnectorConfig;

  if (!config.actions.includes(action as string)) {
    return {
      phase: "execute-action",
      rawResult: null,
      resultStatus: "failed" as const,
      error: `Action '${action}' not supported by connector '${config.id}'. Supported: ${config.actions.join(", ")}`,
    };
  }

  // Read token directly from env — never passed through state
  const envToken = config.credentialEnv ? (process.env[config.credentialEnv] ?? "") : "";
  const params = (payload as Record<string, unknown>) ?? {};

  try {
    let result: unknown;

    if (config.type === "http-webhook") {
      result = await executeHttpWebhook(params, envToken);
    } else if (config.type === "github") {
      result = await executeGitHub(action as string, params, envToken);
    } else {
      result = { simulated: true, message: `Connector type '${config.type}' not yet implemented` };
    }

    return {
      phase: "execute-action",
      rawResult: result,
      resultStatus: "success" as const,
    };
  } catch (err) {
    return {
      phase: "execute-action",
      rawResult: null,
      resultStatus: "failed" as const,
      error: (err as Error).message,
    };
  }
};
