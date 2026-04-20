# PRD: GITHUB_TOKEN Setup for graph-connector-orchestrator

**Blocker for:** GitHub connector tests  
**Severity:** Medium (http-webhook tests pass without it)  
**Labels:** `blocker`, `github-connector`, `authentication`

---

## Overview

The `github` built-in connector in `graph-connector-orchestrator` requires a GitHub Personal Access Token (PAT) to authenticate with the GitHub REST API. Without this token, all GitHub connector actions (`create-issue`, `list-issues`, `create-pr`, `list-prs`, `get-file`) will fail with a 401 Unauthorized error.

The `GITHUB_TOKEN` environment variable is referenced in `src/registry.ts` via `credentialEnv: "GITHUB_TOKEN"` and resolved in `src/nodes/authenticateViaMCP.ts`.

Current state:
- The `.env` file has `GITHUB_TOKEN=` (empty)
- Test T6 in `scripts/integration-test.ps1` detects the absence and skips gracefully
- The `github` connector is registered and enabled — it just cannot authenticate

---

## Requirements

| Requirement | Detail |
|-------------|--------|
| Token type  | GitHub PAT (classic) or fine-grained PAT |
| Scopes (classic) | `repo` (full), `read:org` |
| Fine-grained permissions | Repository: Issues (read/write), Pull Requests (read/write), Contents (read) |
| Env var name | `GITHUB_TOKEN` |
| File to update | `C:\Users\ULTRAPC\Documents\GitHub\graph-connector-orchestrator\.env` |

---

## Setup Steps

1. **Generate a PAT at:** https://github.com/settings/tokens
   - For classic tokens: enable `repo` scope
   - For fine-grained tokens: select target repos, enable Issues + PRs + Contents

2. **Add to `.env`:**
   ```
   GITHUB_TOKEN=ghp_your_token_here
   ```

3. **Verify** by running integration test T6:
   ```powershell
   cd "C:\Users\ULTRAPC\Documents\GitHub\graph-connector-orchestrator"
   $env:GITHUB_TOKEN = "ghp_your_token_here"
   .\scripts\integration-test.ps1
   ```

4. **For CI/CD:** Add `GITHUB_TOKEN` as a repository or organisation secret.

---

## Actions in this connector that will be unlocked

| Action | HTTP Method | Endpoint |
|--------|------------|----------|
| `list-issues` | GET | `/repos/{owner}/{repo}/issues` |
| `create-issue` | POST | `/repos/{owner}/{repo}/issues` |
| `list-prs` | GET | `/repos/{owner}/{repo}/pulls` |
| `create-pr` | POST | `/repos/{owner}/{repo}/pulls` |
| `get-file` | GET | `/repos/{owner}/{repo}/contents/{path}` |

---

## Security Notes

- Never commit the token value to git (it is in `.gitignore` via `.env`)
- Rotate the PAT every 90 days
- Use the minimum required scopes
- For production deployments: store in AWS Secrets Manager (`GITHUB_TOKEN_SECRET_ARN` env var) and provision via `authenticateViaMCP.ts`

---

## Linked GitHub Issues

- **graph-connector-orchestrator** issue #1: `[BLOCKER] GITHUB_TOKEN not configured — GitHub connector unavailable`

---

## Acceptance Criteria

- [ ] `GITHUB_TOKEN` set in `.env`
- [ ] `npm test` shows T6 (GitHub connector) passing
- [ ] `scripts/integration-test.ps1` T6 passes (no SKIP message)
- [ ] `GRAPH_STATUS.md` updated to reflect GitHub connector unblocked
