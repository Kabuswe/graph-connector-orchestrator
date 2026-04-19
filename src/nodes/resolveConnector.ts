/**
 * resolveConnector — looks up connector config from registry.
 */
import { getConnector, listConnectors } from "../registry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resolveConnectorNode = async (state: any) => {
  const { connectorId } = state;

  if (!connectorId) {
    return {
      phase: "resolve-connector",
      connectorConfig: null,
      error: "connectorId is required",
    };
  }

  const connector = getConnector(connectorId as string);

  if (!connector) {
    const available = listConnectors().map(c => c.id).join(", ");
    return {
      phase: "resolve-connector",
      connectorConfig: null,
      error: `Connector '${connectorId}' not found or disabled. Available: ${available}`,
    };
  }

  console.log(`[resolveConnector] Found connector: ${connector.name} (${connector.type})`);

  return {
    phase: "resolve-connector",
    connectorConfig: connector,
    creditWeight: connector.creditCost ?? 1,
  };
};
