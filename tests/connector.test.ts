/**
 * tests/connector.test.ts — vitest unit tests for graph-connector-orchestrator
 *
 * Tests the full graph pipeline using built-in connectors.
 * http-webhook uses httpbin.org (no API key required).
 * GitHub connector tests are skipped if GITHUB_TOKEN is not set.
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { graph } from "../src/graph.js";
import { getConnector, listConnectors } from "../src/registry.js";
import { resolveConnectorNode } from "../src/nodes/resolveConnector.js";
import { deductCreditsNode } from "../src/nodes/deductCredits.js";
import { emitTelemetryNode } from "../src/nodes/emitTelemetry.js";
import fs from "fs";

function makeConfig() {
  return { configurable: { thread_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}` } };
}

// ─── Registry unit tests ───────────────────────────────────────────────────

describe("registry", () => {
  it("resolves built-in http-webhook connector", () => {
    const c = getConnector("http-webhook");
    expect(c).toBeDefined();
    expect(c!.type).toBe("http-webhook");
    expect(c!.enabled).toBe(true);
    expect(c!.actions).toContain("POST");
  });

  it("resolves built-in github connector", () => {
    const c = getConnector("github");
    expect(c).toBeDefined();
    expect(c!.creditCost).toBe(2);
    expect(c!.credentialEnv).toBe("GITHUB_TOKEN");
  });

  it("returns undefined for unknown connector", () => {
    expect(getConnector("does-not-exist-xyz")).toBeUndefined();
  });

  it("listConnectors returns all enabled connectors", () => {
    const all = listConnectors();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every(c => c.enabled)).toBe(true);
  });
});

// ─── resolveConnector node unit tests ─────────────────────────────────────

describe("resolveConnector node", () => {
  it("resolves known connector and sets creditWeight", async () => {
    const result = await resolveConnectorNode({ connectorId: "http-webhook" });
    expect(result.phase).toBe("resolve-connector");
    expect(result.connectorConfig).not.toBeNull();
    expect(result.creditWeight).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("returns error for unknown connector", async () => {
    const result = await resolveConnectorNode({ connectorId: "no-such-connector" });
    expect(result.phase).toBe("resolve-connector");
    expect(result.connectorConfig).toBeNull();
    expect(result.error).toMatch(/not found/);
  });

  it("returns error when connectorId is empty", async () => {
    const result = await resolveConnectorNode({ connectorId: "" });
    expect(result.error).toBeDefined();
  });
});

// ─── deductCredits node unit tests ────────────────────────────────────────

describe("deductCredits node", () => {
  it("skips deduction when resultStatus is failed", async () => {
    const result = await deductCreditsNode({
      clientId: "test-client",
      connectorConfig: { creditCost: 5 },
      resultStatus: "failed",
    });
    expect(result.creditStatus).toBe("skipped");
  });

  it("deducts credits on success", async () => {
    const result = await deductCreditsNode({
      clientId: `vitest-${Date.now()}`,
      connectorConfig: { creditCost: 1 },
      resultStatus: "success",
    });
    expect(result.creditStatus).toBe("ok");
    expect(result.creditsDeducted).toBe(1);
    expect(typeof result.remainingCredits).toBe("number");
  });
});

// ─── emitTelemetry node unit tests ────────────────────────────────────────

describe("emitTelemetry node", () => {
  it("emits a telemetry event and returns telemetryId", async () => {
    const result = await emitTelemetryNode({
      clientId: "test-client",
      connectorConfig: { id: "http-webhook", creditCost: 1 },
      action: "POST",
      resultStatus: "success",
      creditsDeducted: 1,
      error: undefined,
    });
    expect(result.phase).toBe("emit-telemetry");
    expect(result.telemetryId).toBeTruthy();
    expect(result.emittedAt).toBeTruthy();
  });

  it("emits telemetry even on failure", async () => {
    const result = await emitTelemetryNode({
      clientId: "test-client",
      connectorConfig: { id: "github", creditCost: 2 },
      action: "create-issue",
      resultStatus: "failed",
      creditsDeducted: 0,
      error: "auth failed",
    });
    expect(result.telemetryId).toBeTruthy();
  });
});

// ─── Full pipeline via graph.invoke ───────────────────────────────────────

describe("graph pipeline — http-webhook (no API key required)", () => {
  it("succeeds end-to-end with httpbin.org POST", async () => {
    const result = await graph.invoke(
      {
        connectorId: "http-webhook",
        action: "POST",
        payload: {
          url: "https://httpbin.org/post",
          body: { test: "graph-connector-orchestrator-vitest", ts: Date.now() },
        },
        clientId: "vitest-client",
      },
      makeConfig(),
    );

    expect(result.phase).toBe("emit-telemetry");
    expect(result.authStatus).toBe("ok");
    expect(result.resultStatus).toBe("success");
    expect(result.validatedResult).not.toBeNull();
    expect(result.telemetryId).toBeTruthy();
    expect(result.creditsDeducted).toBeGreaterThan(0);
  }, 30000);

  it("full pipeline returns error phase for unknown connector", async () => {
    const result = await graph.invoke(
      {
        connectorId: "ghost-connector-xyz",
        action: "POST",
        payload: {},
        clientId: "vitest-client",
      },
      makeConfig(),
    );

    expect(result.phase).toBe("emit-telemetry");
    expect(result.connectorConfig).toBeNull();
    expect(result.resultStatus).toBe("failed");
    expect(typeof result.error).toBe("string");
    // Telemetry still fires on failure
    expect(result.telemetryId).toBeTruthy();
  }, 15000);

  it("returns failed when action is not supported by connector", async () => {
    const result = await graph.invoke(
      {
        connectorId: "http-webhook",
        action: "delete-everything",
        payload: {},
        clientId: "vitest-client",
      },
      makeConfig(),
    );

    expect(result.resultStatus).toBe("failed");
    expect(result.error).toMatch(/not supported/);
    expect(result.telemetryId).toBeTruthy();
  }, 15000);
});

