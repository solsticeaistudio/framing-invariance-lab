import { canonicalSha256 } from "./canonicalJson.js";
import { VARIANT_PROTOCOL_VERSION } from "./protocolVersions.js";
import { axisDefinitions } from "./variantFactory.js";

export type FramingProtocolDefinition = {
  id: "pairwise-seven-axis" | "cartesian-seven-axis-exploratory";
  version: typeof VARIANT_PROTOCOL_VERSION | "1.0";
  compatibilityHash: string;
  promotable: boolean;
};

export const PAIRWISE_FRAMING_PROTOCOL: FramingProtocolDefinition = {
  id: "pairwise-seven-axis",
  version: VARIANT_PROTOCOL_VERSION,
  promotable: true,
  compatibilityHash: canonicalSha256({
    id: "pairwise-seven-axis",
    version: VARIANT_PROTOCOL_VERSION,
    axes: axisDefinitions(),
  }),
};

export const CARTESIAN_EXPLORATORY_PROTOCOL = {
  id: "cartesian-seven-axis-exploratory",
  version: "1.0",
  promotable: false,
  compatibilityHash: canonicalSha256({
    id: "cartesian-seven-axis-exploratory",
    version: "1.0",
    axes: axisDefinitions(),
  }),
} as const satisfies FramingProtocolDefinition;

export function resolveFramingProtocol(
  design: "pairwise" | "cartesian",
): FramingProtocolDefinition {
  return design === "pairwise"
    ? PAIRWISE_FRAMING_PROTOCOL
    : CARTESIAN_EXPLORATORY_PROTOCOL;
}
