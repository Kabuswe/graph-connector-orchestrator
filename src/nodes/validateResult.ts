/**
 * validateResult — validates the execution result against expected schema.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validateResultNode = async (state: any) => {
  const { rawResult, resultStatus, expectedResultSchema } = state;

  if (resultStatus !== "success" || rawResult === null) {
    return {
      phase: "validate-result",
      validatedResult: null,
      resultStatus: "failed" as const,
    };
  }

  // If no schema provided, pass through
  if (!expectedResultSchema) {
    return { phase: "validate-result", validatedResult: rawResult, resultStatus: "success" as const };
  }

  // Simple schema check: verify required fields exist
  const schema = expectedResultSchema as Record<string, unknown>;
  const result = rawResult as Record<string, unknown> ?? {};

  const required = (schema.required as string[]) ?? [];
  const missing = required.filter(k => !(k in result));

  if (missing.length > 0) {
    return {
      phase: "validate-result",
      validatedResult: null,
      resultStatus: "partial" as const,
      error: `Missing required fields: ${missing.join(", ")}`,
    };
  }

  return { phase: "validate-result", validatedResult: rawResult, resultStatus: "success" as const };
};
