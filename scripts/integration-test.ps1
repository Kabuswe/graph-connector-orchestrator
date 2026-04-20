#!/usr/bin/env pwsh
<#
.SYNOPSIS
  API integration test for graph-connector-orchestrator (port 2032).
  Starts the LangGraph dev server, runs live HTTP tests, then stops it.
.DESCRIPTION
  Tests the connectorOrchestrator graph end-to-end through the HTTP API.
  Uses the http-webhook connector hitting httpbin.org (no API key needed).
  GitHub connector tests are skipped unless GITHUB_TOKEN is set.
#>

$ErrorActionPreference = "Stop"
$PORT = 2032
$BASE_URL = "http://localhost:$PORT"
$GRAPH_ID = "connectorOrchestrator"
$PASSED = 0
$FAILED = 0
$FAILURES = @()

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Wait-ServerReady {
  param([int]$Port, [int]$TimeoutSec = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Host "  Waiting for server on port $Port..." -NoNewline
  while ((Get-Date) -lt $deadline) {
    try {
      $null = Invoke-WebRequest -Uri "http://localhost:$Port/ok" -UseBasicParsing -TimeoutSec 2
      Write-Host " ready."
      return
    } catch { Start-Sleep -Milliseconds 800 }
  }
  throw "Server did not start within ${TimeoutSec}s"
}

function Invoke-GraphRun {
  param(
    [string]$GraphId,
    [hashtable]$Input,
    [string]$ThreadId = $null
  )
  $tid = if ($ThreadId) { $ThreadId } else { "test-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))" }
  $body = @{
    input  = $Input
    config = @{ configurable = @{ thread_id = $tid } }
  } | ConvertTo-Json -Depth 10

  $resp = Invoke-RestMethod `
    -Uri "$BASE_URL/runs/wait" `
    -Method POST `
    -Headers @{ "Content-Type" = "application/json"; "x-graph-id" = $GraphId } `
    -Body $body `
    -TimeoutSec 60
  return $resp
}

function Assert-Field {
  param($Result, [string]$Field, $Expected, [string]$TestName)
  $actual = $Result.$Field
  if ($null -eq $actual) { $actual = $Result.PSObject.Properties[$Field]?.Value }

  if ($Expected -is [scriptblock]) {
    $ok = & $Expected $actual
  } else {
    $ok = $actual -eq $Expected
  }

  if ($ok) {
    Write-Host "    [PASS] $Field = $actual" -ForegroundColor Green
    $script:PASSED++
  } else {
    Write-Host "    [FAIL] $Field: expected '$Expected', got '$actual'" -ForegroundColor Red
    $script:FAILED++
    $script:FAILURES += "[$TestName] $Field mismatch — expected '$Expected' got '$actual'"
  }
}

# ─── Server startup ──────────────────────────────────────────────────────────

Set-Location $PSScriptRoot\..
Write-Host "`n=== graph-connector-orchestrator integration tests ===" -ForegroundColor Cyan
Write-Host "Starting server on port $PORT..."

$serverJob = Start-Job -ScriptBlock {
  param($Dir, $Port)
  Set-Location $Dir
  $env:PORT = $Port
  npx @langchain/langgraph-cli dev --port $Port
} -ArgumentList (Get-Location).Path, $PORT

try {
  Wait-ServerReady -Port $PORT -TimeoutSec 90
  Start-Sleep -Seconds 2

  # ─── Test 1: http-webhook POST to httpbin.org ────────────────────────────

  Write-Host "`n[T1] http-webhook POST — httpbin.org success" -ForegroundColor Yellow
  $r1 = Invoke-GraphRun -GraphId $GRAPH_ID -Input @{
    connectorId = "http-webhook"
    action      = "POST"
    payload     = @{
      url  = "https://httpbin.org/post"
      body = @{ source = "integration-test"; timestamp = (Get-Date -Format o) }
    }
    clientId = "integration-test-client"
  }
  Assert-Field $r1 "phase"        "emit-telemetry" "T1"
  Assert-Field $r1 "authStatus"   "ok"             "T1"
  Assert-Field $r1 "resultStatus" "success"        "T1"
  Assert-Field $r1 "telemetryId"  { param($v) $v -ne $null -and $v -ne "" } "T1"
  Assert-Field $r1 "creditsDeducted" { param($v) $v -gt 0 } "T1"

  Start-Sleep -Seconds 2

  # ─── Test 2: http-webhook GET to httpbin.org ─────────────────────────────

  Write-Host "`n[T2] http-webhook GET — httpbin.org success" -ForegroundColor Yellow
  $r2 = Invoke-GraphRun -GraphId $GRAPH_ID -Input @{
    connectorId = "http-webhook"
    action      = "GET"
    payload     = @{
      url = "https://httpbin.org/get?source=integration-test"
    }
    clientId = "integration-test-client"
  }
  Assert-Field $r2 "phase"        "emit-telemetry" "T2"
  Assert-Field $r2 "resultStatus" "success"        "T2"
  Assert-Field $r2 "authStatus"   "ok"             "T2"

  Start-Sleep -Seconds 2

  # ─── Test 3: unknown connector → resolves error path ─────────────────────

  Write-Host "`n[T3] Unknown connector → error path" -ForegroundColor Yellow
  $r3 = Invoke-GraphRun -GraphId $GRAPH_ID -Input @{
    connectorId = "nonexistent-connector-xyz"
    action      = "POST"
    payload     = @{}
    clientId    = "integration-test-client"
  }
  Assert-Field $r3 "phase"        "emit-telemetry" "T3"
  Assert-Field $r3 "resultStatus" "failed"         "T3"
  Assert-Field $r3 "error"        { param($v) $v -match "not found" } "T3"
  # Telemetry still fires on failure
  Assert-Field $r3 "telemetryId"  { param($v) $v -ne $null -and $v -ne "" } "T3"

  Start-Sleep -Seconds 2

  # ─── Test 4: unsupported action ──────────────────────────────────────────

  Write-Host "`n[T4] Unsupported action on http-webhook" -ForegroundColor Yellow
  $r4 = Invoke-GraphRun -GraphId $GRAPH_ID -Input @{
    connectorId = "http-webhook"
    action      = "PATCH"
    payload     = @{ url = "https://httpbin.org/patch" }
    clientId    = "integration-test-client"
  }
  Assert-Field $r4 "resultStatus" "failed" "T4"
  Assert-Field $r4 "error"        { param($v) $v -match "not supported" } "T4"

  Start-Sleep -Seconds 2

  # ─── Test 5: credit deduction confirmed ──────────────────────────────────

  Write-Host "`n[T5] Credit deduction — verifies creditsDeducted and creditStatus" -ForegroundColor Yellow
  $r5 = Invoke-GraphRun -GraphId $GRAPH_ID -Input @{
    connectorId = "http-webhook"
    action      = "POST"
    payload     = @{
      url  = "https://httpbin.org/post"
      body = @{ test = "credit-deduction-check" }
    }
    clientId = "integration-test-client"
  }
  Assert-Field $r5 "creditStatus"    "ok" "T5"
  Assert-Field $r5 "creditsDeducted" { param($v) $v -eq 1 } "T5"
  Assert-Field $r5 "remainingCredits" { param($v) $v -is [int] -or $v -is [long] -or $v -ge 0 } "T5"

  Start-Sleep -Seconds 2

  # ─── Test 6: GitHub connector — skipped without token ────────────────────

  Write-Host "`n[T6] GitHub connector — auth check" -ForegroundColor Yellow
  if (-not $env:GITHUB_TOKEN) {
    Write-Host "    [SKIP] GITHUB_TOKEN not set — GitHub connector tests skipped" -ForegroundColor DarkYellow
    Write-Host "           See docs/PRD-GITHUB_TOKEN.md for setup instructions"
  } else {
    $r6 = Invoke-GraphRun -GraphId $GRAPH_ID -Input @{
      connectorId = "github"
      action      = "list-issues"
      payload     = @{ owner = "octocat"; repo = "Hello-World"; state = "open"; perPage = 5 }
      clientId    = "integration-test-client"
    }
    Assert-Field $r6 "authStatus"   "ok"             "T6"
    Assert-Field $r6 "resultStatus" "success"        "T6"
    Assert-Field $r6 "phase"        "emit-telemetry" "T6"
  }

} finally {
  # ─── Server teardown ─────────────────────────────────────────────────────
  Write-Host "`nStopping server..."
  Stop-Job  $serverJob -ErrorAction SilentlyContinue
  Remove-Job $serverJob -Force -ErrorAction SilentlyContinue
}

# ─── Summary ─────────────────────────────────────────────────────────────────

Write-Host "`n=== Results ===" -ForegroundColor Cyan
Write-Host "PASSED: $PASSED  FAILED: $FAILED" -ForegroundColor $(if ($FAILED -eq 0) { "Green" } else { "Red" })

if ($FAILURES.Count -gt 0) {
  Write-Host "`nFailure details:" -ForegroundColor Red
  $FAILURES | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

if ($FAILED -gt 0) {
  Write-Host "`nIntegration tests FAILED" -ForegroundColor Red
  exit 1
} else {
  Write-Host "`nAll integration tests PASSED" -ForegroundColor Green
  exit 0
}
