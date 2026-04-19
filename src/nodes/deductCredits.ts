/**
 * deductCredits — updates the credit balance after a successful execution.
 */
import fs from "fs";

const CREDITS_PATH = process.env.CREDITS_STORE_PATH ?? "./credits.json";

interface CreditsEntry {
  clientId: string;
  balance: number;
  updatedAt: string;
}

function loadCredits(): CreditsEntry[] {
  try {
    if (fs.existsSync(CREDITS_PATH)) {
      return JSON.parse(fs.readFileSync(CREDITS_PATH, "utf-8")) as CreditsEntry[];
    }
  } catch { /* ignore */ }
  return [];
}

function saveCredits(entries: CreditsEntry[]): void {
  fs.writeFileSync(CREDITS_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const deductCreditsNode = async (state: any) => {
  const { clientId, connectorConfig, resultStatus } = state;

  if (resultStatus !== "success") {
    return { phase: "deduct-credits", creditStatus: "skipped" as const };
  }

  const cost = (connectorConfig as Record<string, unknown>)?.creditCost as number ?? 1;
  const cid = clientId as string ?? "default";

  const credits = loadCredits();
  const idx = credits.findIndex(c => c.clientId === cid);

  if (idx >= 0) {
    credits[idx].balance -= cost;
    credits[idx].updatedAt = new Date().toISOString();
  } else {
    // Auto-provision with default balance (in production: check billing system)
    credits.push({ clientId: cid, balance: 1000 - cost, updatedAt: new Date().toISOString() });
  }

  saveCredits(credits);

  const newBalance = idx >= 0 ? credits[idx].balance : 1000 - cost;
  console.log(`[deductCredits] clientId=${cid}, deducted=${cost}, balance=${newBalance}`);

  return {
    phase: "deduct-credits",
    creditStatus: "ok" as const,
    creditsDeducted: cost,
    remainingCredits: newBalance,
  };
};
