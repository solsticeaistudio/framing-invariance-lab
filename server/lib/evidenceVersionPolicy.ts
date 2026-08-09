export type EvidenceVersionPolicy = {
  cryptographicVerificationAllowed: boolean;
  historicalUseAllowed: boolean;
  modernPromotionEligibleByVersion: boolean;
  requiresModernEligibilityContract: boolean;
  blockers: string[];
};

type SemanticVersion = {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
};

const MODERN_ELIGIBILITY_CONTRACT_VERSION: SemanticVersion = {
  major: "2",
  minor: "2",
  patch: "3",
  prerelease: [],
};

function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (identifier) =>
        /^\d+$/.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  )
    return undefined;
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
  };
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSemanticVersions(
  left: SemanticVersion,
  right: SemanticVersion,
) {
  const major = compareNumericIdentifiers(left.major, right.major);
  if (major) return major;
  const minor = compareNumericIdentifiers(left.minor, right.minor);
  if (minor) return minor;
  const patch = compareNumericIdentifiers(left.patch, right.patch);
  if (patch) return patch;
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric)
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function compareHarnessVersions(
  left: string,
  right: string,
): number | undefined {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);
  if (!parsedLeft || !parsedRight) return undefined;
  return Math.sign(compareSemanticVersions(parsedLeft, parsedRight));
}

/**
 * Separates historical signature verification from eligibility to contribute to
 * a new modern evidence-tier decision. Version alone never grants promotion.
 */
export function assessEvidenceVersionPolicy(
  harnessVersion: string,
): EvidenceVersionPolicy {
  const version = parseSemanticVersion(harnessVersion);
  if (!version)
    return {
      cryptographicVerificationAllowed: true,
      historicalUseAllowed: true,
      modernPromotionEligibleByVersion: false,
      requiresModernEligibilityContract: false,
      blockers: ["invalid_harness_version"],
    };

  if (compareSemanticVersions(version, MODERN_ELIGIBILITY_CONTRACT_VERSION) < 0)
    return {
      cryptographicVerificationAllowed: true,
      historicalUseAllowed: true,
      modernPromotionEligibleByVersion: false,
      requiresModernEligibilityContract: false,
      blockers: ["legacy_signed_evidence_eligibility_unverified"],
    };

  return {
    cryptographicVerificationAllowed: true,
    historicalUseAllowed: true,
    modernPromotionEligibleByVersion: true,
    requiresModernEligibilityContract: true,
    blockers: [],
  };
}
