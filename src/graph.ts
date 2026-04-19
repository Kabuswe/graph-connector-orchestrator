/**
 * graph-connector-orchestrator
 *
 * Pipeline: resolveConnector → authenticateViaMCP → executeAction → validateResult → deductCredits → emitTelemetry
 *
 * Input:  ConnectorOrchestratorInput  (connectorId, action, payload, clientId)
 * Output: ConnectorOrchestratorOutput (validatedResult, resultStatus, creditsDeducted, telemetryId)
 *
 * emitTelemetry is unconditional — runs on all paths including errors.
 * TODO: implement nodes under src/nodes/ per PRD.md
 * TODO: implement src/connectors/[id].ts registry
 * TODO: implement src/seed-registry.ts
 */

import { StateGraph, START, END, MemorySaver, StateSchema, UntrackedValue } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import { z } from 'zod';

function lastValue<T>(schema: z.ZodType<T, any, any>): UntrackedValue<T> {
  return schema as unknown as UntrackedValue<T>;
}

const ConnectorState = new StateSchema({
  connectorId:      lastValue(z.string().default('')),
  action:           lastValue(z.string().default('')),
  payload:          lastValue(z.record(z.any()).default(() => ({}))),
  clientId:         lastValue(z.string().default('')),
  connectorConfig:  lastValue(z.any().optional()),
  creditWeight:     lastValue(z.number().default(1)),
  authStatus:       lastValue(z.enum(['ok', 'expired', 'failed']).default('ok')),
  rawResult:        lastValue(z.any().optional()),
  toolCalls:        lastValue(z.array(z.any()).default(() => [])),
  executionMs:      lastValue(z.number().default(0)),
  validatedResult:  lastValue(z.any().optional()),
  resultStatus:     lastValue(z.enum(['success', 'failed', 'partial']).default('failed')),
  creditsDeducted:  lastValue(z.number().default(0)),
  remainingCredits: lastValue(z.number().default(0)),
  creditStatus:     lastValue(z.enum(['ok', 'insufficient', 'skipped']).default('skipped')),
  telemetryId:      lastValue(z.string().default('')),
  emittedAt:        lastValue(z.string().default('')),
  error:            lastValue(z.string().optional()),
  phase:            lastValue(z.string().default('')),
});

const standardRetry = { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2 };

// TODO: replace with real implementations
const resolveConnectorNode    = async (s: any) => ({ phase: 'resolve-connector', connectorConfig: {}, creditWeight: 1 });
const authenticateViaMCPNode  = async (s: any) => ({ phase: 'authenticate', authStatus: 'ok' as const });
const executeActionNode       = async (s: any) => ({ phase: 'execute-action', rawResult: null, toolCalls: [], executionMs: 0 });
const validateResultNode      = async (s: any) => ({ phase: 'validate-result', validatedResult: s.rawResult, resultStatus: 'success' as const });
const deductCreditsNode       = async (s: any) => ({ phase: 'deduct-credits', creditsDeducted: s.creditWeight, remainingCredits: 0, creditStatus: 'ok' as const });
const emitTelemetryNode       = async (s: any) => ({ phase: 'emit-telemetry', telemetryId: crypto.randomUUID(), emittedAt: new Date().toISOString() });

function assembleGraph(checkpointer?: MemorySaver) {
  const builder = new StateGraph(ConnectorState)
    .addNode('resolveConnector',   resolveConnectorNode,   { retryPolicy: standardRetry })
    .addNode('authenticateViaMCP', authenticateViaMCPNode, { retryPolicy: standardRetry })
    .addNode('executeAction',      executeActionNode,      { retryPolicy: standardRetry })
    .addNode('validateResult',     validateResultNode,     { retryPolicy: standardRetry })
    .addNode('deductCredits',      deductCreditsNode)
    .addNode('emitTelemetry',      emitTelemetryNode)
    .addEdge(START, 'resolveConnector')
    .addEdge('resolveConnector', 'authenticateViaMCP')
    .addEdge('authenticateViaMCP', 'executeAction')
    .addEdge('executeAction', 'validateResult')
    .addEdge('validateResult', 'deductCredits')
    .addEdge('deductCredits', 'emitTelemetry')
    .addEdge('emitTelemetry', END);

  return checkpointer ? builder.compile({ checkpointer }) : builder.compile();
}

export const graph: any = assembleGraph(new MemorySaver());

export async function buildGraph(): Promise<any> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  return assembleGraph(checkpointer as unknown as MemorySaver);
}
