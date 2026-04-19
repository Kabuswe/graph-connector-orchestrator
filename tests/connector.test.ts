/**
 * tests/connector.test.ts — integration test for graph-connector-orchestrator
 * Uses the built-in http-webhook connector with a public test endpoint.
 */
import "dotenv/config";
import { graph } from "../src/graph.js";

const TEST_CASES = [
  {
    name: "http-webhook POST",
    input: {
      connectorId: "http-webhook",
      action: "POST",
      payload: {
        url: "https://httpbin.org/post",
        body: { test: "graph-connector-orchestrator", timestamp: new Date().toISOString() },
      },
      clientId: "test-client",
    },
    validate: (r: Record<string, unknown>) =>
      r.connectorConfig !== null &&
      r.authStatus === "ok" &&
      r.resultStatus === "success",
  },
  {
    name: "invalid connector ID",
    input: {
      connectorId: "nonexistent-connector-12345",
      action: "POST",
      payload: {},
      clientId: "test-client",
    },
    validate: (r: Record<string, unknown>) =>
      r.connectorConfig === null &&
      typeof r.error === "string" && (r.error as string).includes("not found"),
  },
];

async function runTest(tc: (typeof TEST_CASES)[0]) {
  const config = { configurable: { thread_id: `test-${Date.now()}` } };
  const result = await graph.invoke(tc.input, config);

  const valid = tc.validate(result as Record<string, unknown>);
  const icon = valid ? "✅" : "⚠️";
  console.log(
    `${icon} [${tc.name}] resolved=${result.connectorConfig !== null} auth=${result.authStatus} ` +
    `status=${result.resultStatus} telemetry=${result.telemetryId ? 'yes' : 'no'}`,
  );
  if (!valid) {
    console.log(`   error: ${result.error}`);
  }
  return valid;
}

async function main() {
  console.log("\n=== graph-connector-orchestrator integration tests ===\n");
  const results = await Promise.all(TEST_CASES.map(runTest));
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
