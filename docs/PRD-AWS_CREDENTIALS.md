# PRD: AWS Credentials for graph-connector-orchestrator

**Blocker for:** Production DynamoDB registry, AWS Secrets Manager credential resolution  
**Severity:** Low (not needed for local dev — all nodes fall back to local JSON)  
**Labels:** `blocker`, `aws`, `production-only`, `dynamodb`

---

## Overview

`graph-connector-orchestrator` uses two AWS services in production:

| Service | Purpose | Env var |
|---------|---------|---------|
| DynamoDB | Connector registry (`ConnectorRegistry` table) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| Secrets Manager | Resolving connector credentials (e.g. `GITHUB_TOKEN`) | same credentials |

In development, both fall back automatically:
- Registry → local `./connector-registry.json` (via `registry.ts`)
- Credentials → environment variables directly (`GITHUB_TOKEN`, `SMTP_PASSWORD`)

The `.env` file currently has `AWS_ACCESS_KEY_ID=` (empty) — AWS calls are silently skipped.

---

## Requirements

| Variable | Example | Description |
|----------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user or role access key |
| `AWS_SECRET_ACCESS_KEY` | `wJalrX...` | Corresponding secret |
| `AWS_REGION` | `us-east-1` | Region where DynamoDB table is provisioned |
| `DYNAMODB_TABLE` | `ConnectorRegistry` | Optional override (default: `ConnectorRegistry`) |

---

## IAM Policy Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/ConnectorRegistry"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:connector/*"
    }
  ]
}
```

---

## DynamoDB Table Setup

```bash
aws dynamodb create-table \
  --table-name ConnectorRegistry \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Seed with built-in connectors:
```bash
cd graph-connector-orchestrator
npm run seed-registry
```

---

## Linked GitHub Issues

- **graph-connector-orchestrator** issue #2: `[BLOCKER] AWS credentials not set — DynamoDB registry and Secrets Manager unavailable in production`

---

## Acceptance Criteria

- [ ] IAM user/role created with minimum required permissions
- [ ] `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` set in production env
- [ ] `ConnectorRegistry` DynamoDB table created and seeded
- [ ] `npm run seed-registry` completes without error
- [ ] `GRAPH_STATUS.md` updated to reflect AWS unblocked
