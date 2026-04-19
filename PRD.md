# graph-connector-orchestrator — Product Requirements Document

## Purpose
Universal MCP connector execution wrapper. Every agent graph that needs to write to or read from an external app — email, calendar, Slack, social platforms, webhooks — routes through this graph. It resolves the correct MCP server, authenticates the session, executes the action, validates the result, deducts credits from the client’s ledger, and emits a structured telemetry event to LangSmith + DynamoDB. No connector logic ever lives in a parent graph — it always delegates here.

## Deployment
- Deployed on LangSmith Deployment as `connectorOrchestrator`
- `langgraph.json`: `{ "graphs": { "connectorOrchestrator": "./src/graph.ts:graph" } }`
- Called by `graph-supervisor`, `graph-daily-briefing`, `graph-monitor-alert`, and `graph-email-processor` via `RemoteGraph`

## Pipeline
```
START → resolveConnector → authenticateViaMCP → executeAction → validateResult → deductCredits → emitTelemetry → END
```

### Node Responsibilities

**`resolveConnector`**
- Look up `connectorId` in DynamoDB `kabatoshi-connectors` registry
- Resolve: `mcpServerUrl`, `transport` (`stdio | sse | streamable_http`), `authType` (`oauth2 | apikey | none`), `creditWeight`
- Validate `action` is in connector’s `capabilities[]`
- Output: `connectorConfig: ConnectorConfig`, `creditWeight: number`

**`authenticateViaMCP`**
- For `oauth2`: retrieve client token from DynamoDB `kabatoshi-client-tokens` (encrypted at rest)
- For `apikey`: retrieve from AWS Secrets Manager using `secretArn` from connector config
- Instantiate `MultiServerMCPClient` with resolved transport and auth
- Output: `mcpClient: MCPClientRef`, `authStatus: 'ok' | 'expired' | 'failed'`
- If `authStatus !== 'ok'`: set `error`, skip to `emitTelemetry`

**`executeAction`** (ReAct — model + MCP tools)
- Load available tools from the resolved MCP client
- Invoke `createReactAgent({ model: fastModel, tools })` with the `action` and `payload` as the prompt
- Capture tool calls and final result
- Output: `rawResult: any`, `toolCalls: ToolCall[]`, `executionMs: number`

**`validateResult`**
- Confirm `rawResult` matches expected output shape for the given `action`
- Run client-specific guardrail check: load `clientConfig.guardrailLevel` from DynamoDB
- If validation fails: set `resultStatus: 'failed'`, do NOT deduct credits
- Output: `validatedResult`, `resultStatus: 'success' | 'failed' | 'partial'`

**`deductCredits`**
- Only runs if `resultStatus !== 'failed'`
- Deduct `creditWeight` from client’s DynamoDB credit ledger using atomic conditional write
- If balance insufficient: set `creditStatus: 'insufficient'`, mark result as delivered but log warning
- Output: `creditsDeducted: number`, `remainingCredits: number`, `creditStatus`

**`emitTelemetry`**
- Always runs — even on failure paths
- Build `TelemetryEvent`: `{ runId, connectorId, action, resultStatus, creditsDeducted, executionMs, toolCalls[], timestamp }`
- Write to DynamoDB `kabatoshi-telemetry` table
- LangSmith trace is captured automatically via LANGSMITH_TRACING_V2
- Output: `telemetryId`, `emittedAt`

## State Schema
```ts
{
  connectorId: string;
  action: string;
  payload: Record<string, any>;
  clientId: string;

  connectorConfig: ConnectorConfig;
  creditWeight: number;
  mcpClient: any; // runtime reference, not serialized
  authStatus: 'ok' | 'expired' | 'failed';
  rawResult: any;
  toolCalls: any[];
  executionMs: number;
  validatedResult: any;
  resultStatus: 'success' | 'failed' | 'partial';
  creditsDeducted: number;
  remainingCredits: number;
  creditStatus: 'ok' | 'insufficient' | 'skipped';
  telemetryId: string;
  emittedAt: string;

  error?: string;
  phase: string;
}
```

## Supported Connectors (initial registry)
| connectorId | MCP Server | Transport | Actions |
|---|---|---|---|
| `gmail` | Gmail MCP | stdio | `send_email`, `read_inbox`, `search_emails` |
| `slack` | Slack MCP | streamable_http | `post_message`, `read_channel`, `list_channels` |
| `calendar` | Google Calendar MCP | stdio | `create_event`, `list_events`, `update_event` |
| `playwright` | Playwright MCP | stdio | `navigate`, `extract`, `screenshot`, `click` |
| `github` | GitHub MCP | streamable_http | `create_issue`, `list_prs`, `add_comment` |
| `webhook` | Custom HTTP | streamable_http | `post_payload` |

## Credit Weight Table
| Action Class | Credit Weight |
|---|---|
| Read-only (inbox, list) | 1 |
| Simple write (send message, create event) | 2 |
| Complex execution (Playwright multi-step) | 5 |
| Premium model action | 10 |

## Environment Variables
```
OPENROUTER_API_KEY=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
DYNAMODB_CONNECTORS_TABLE=kabatoshi-connectors
DYNAMODB_TOKENS_TABLE=kabatoshi-client-tokens
DYNAMODB_TELEMETRY_TABLE=kabatoshi-telemetry
DYNAMODB_CREDITS_TABLE=kabatoshi-credits
LANGSMITH_API_KEY=
LANGSMITH_TRACING_V2=true
LANGSMITH_PROJECT=graph-connector-orchestrator
DATABASE_URL=
```

## Agent Instructions
1. `mcpClient` is a runtime object — it must NOT be serialized to graph state; store only a reference key
2. `emitTelemetry` must be unconditional — add it as the final node on ALL paths including error paths
3. Credit deduction must use DynamoDB conditional expressions to prevent race conditions: `ConditionExpression: 'balance >= :weight'`
4. `executeAction` must capture `executionMs` using `Date.now()` before and after the ReAct agent invocation
5. Each supported connector must have a corresponding `src/connectors/[connectorId].ts` that exports the MCP client config — the `resolveConnector` node imports from this registry
6. Write a seed script `src/seed-registry.ts` that populates DynamoDB with the initial connector registry
7. Test `deductCredits` with insufficient balance — must not throw, must set `creditStatus: 'insufficient'`

## Acceptance Criteria
- `connectorId: 'slack', action: 'post_message'` successfully posts and emits telemetry with `resultStatus: 'success'`
- Insufficient credits results in `creditStatus: 'insufficient'` but telemetry is still emitted
- Auth failure on `oauth2` connector skips `executeAction` and `deductCredits` but still emits telemetry
- All 6 connector IDs resolve without error from the DynamoDB registry
- LangSmith trace shows all 6 nodes including the telemetry emit
