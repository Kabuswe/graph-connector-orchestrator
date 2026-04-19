/**
 * registry.ts — Connector registry with JSON file backend.
 * In production: backed by DynamoDB. Fallback: local JSON file.
 */
import fs from "fs";

const REGISTRY_PATH = process.env.CONNECTOR_REGISTRY_PATH ?? "./connector-registry.json";

export interface ConnectorConfig {
  id: string;
  name: string;
  type: "http-webhook" | "github" | "email" | "slack" | "notion" | "custom";
  authType: "none" | "bearer" | "basic" | "oauth2" | "api-key";
  baseUrl?: string;
  credentialEnv?: string;  // env var name holding the secret
  actions: string[];
  rateLimit?: number;  // req/min
  creditCost?: number;  // credits per call
  enabled: boolean;
}

const BUILT_IN_CONNECTORS: ConnectorConfig[] = [
  {
    id: "http-webhook",
    name: "Generic HTTP Webhook",
    type: "http-webhook",
    authType: "none",
    actions: ["POST", "GET"],
    rateLimit: 60,
    creditCost: 1,
    enabled: true,
  },
  {
    id: "github",
    name: "GitHub",
    type: "github",
    authType: "bearer",
    baseUrl: "https://api.github.com",
    credentialEnv: "GITHUB_TOKEN",
    actions: ["create-issue", "list-issues", "create-pr", "list-prs", "get-file"],
    rateLimit: 30,
    creditCost: 2,
    enabled: true,
  },
  {
    id: "email",
    name: "SMTP Email",
    type: "email",
    authType: "basic",
    credentialEnv: "SMTP_PASSWORD",
    actions: ["send", "reply"],
    rateLimit: 10,
    creditCost: 1,
    enabled: true,
  },
];

function loadRegistry(): ConnectorConfig[] {
  const builtin = BUILT_IN_CONNECTORS;
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const custom = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")) as ConnectorConfig[];
      const builtinIds = new Set(builtin.map(c => c.id));
      return [...builtin, ...custom.filter(c => !builtinIds.has(c.id))];
    }
  } catch { /* ignore */ }
  return builtin;
}

export function getConnector(id: string): ConnectorConfig | undefined {
  return loadRegistry().find(c => c.id === id && c.enabled);
}

export function listConnectors(): ConnectorConfig[] {
  return loadRegistry().filter(c => c.enabled);
}

export function registerConnector(config: ConnectorConfig): void {
  const existing = loadRegistry().filter(c => !BUILT_IN_CONNECTORS.some(b => b.id === c.id));
  const idx = existing.findIndex(c => c.id === config.id);
  if (idx >= 0) existing[idx] = config;
  else existing.push(config);
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(existing, null, 2), "utf-8");
}
