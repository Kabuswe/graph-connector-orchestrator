/**
 * emitTelemetry — logs execution telemetry to file and optionally to EventBridge.
 */
import fs from "fs";

const LOG_PATH = process.env.TELEMETRY_LOG_PATH ?? "./telemetry.jsonl";

interface TelemetryEvent {
  eventId: string;
  clientId: string;
  connectorId: string;
  action: string;
  success: boolean;
  creditsUsed: number;
  durationMs?: number;
  timestamp: string;
  error?: string;
}

function appendTelemetry(event: TelemetryEvent): void {
  fs.appendFileSync(LOG_PATH, JSON.stringify(event) + "\n", "utf-8");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const emitTelemetryNode = async (state: any) => {
  const {
    clientId,
    connectorConfig,
    action,
    resultStatus,
    creditsDeducted,
    error,
  } = state;

  const config = connectorConfig as Record<string, unknown>;
  const event: TelemetryEvent = {
    eventId: crypto.randomUUID(),
    clientId: clientId as string ?? "default",
    connectorId: config?.id as string ?? "unknown",
    action: action as string ?? "",
    success: resultStatus === "success",
    creditsUsed: creditsDeducted as number ?? config?.creditCost as number ?? 1,
    timestamp: new Date().toISOString(),
    error: error as string | undefined,
  };

  appendTelemetry(event);

  // Optional EventBridge (AWS) — install @aws-sdk/client-eventbridge and uncomment to enable
  // if (process.env.EVENTBRIDGE_BUS_ARN) { ... }
  if (process.env.EVENTBRIDGE_BUS_ARN) {
    console.log("[emitTelemetry] EventBridge configured but @aws-sdk/client-eventbridge not installed");
  }

  return {
    phase: "emit-telemetry",
    telemetryId: event.eventId,
    emittedAt: event.timestamp,
  };
};
