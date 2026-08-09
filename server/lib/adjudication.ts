import type {
  HumanAdjudication,
  SignedArtifact,
  StudySynthesis,
} from "../v2/types.js";
import { verifySignedArtifact } from "./signatures.js";
import { TrustStore } from "./trustStore.js";

export function verifyHumanAdjudication(args: {
  adjudication: SignedArtifact<HumanAdjudication>;
  trustStore: TrustStore;
  expectedStudyId: string;
  expectedReviewerId?: string;
  now?: string;
}): string[] {
  const errors: string[] = [];
  const verification = verifySignedArtifact({
    artifact: args.adjudication,
    trustStore: args.trustStore,
    expectedType: "human_adjudication",
    expectedPurpose: "publication-review",
    requiredRole: "human_reviewer",
    now: args.now,
  });
  if (!verification.validAtSigning || !verification.currentlyValid)
    errors.push("adjudication_signature_invalid");
  const payload = args.adjudication.payload;
  if (payload.studyId !== args.expectedStudyId)
    errors.push("adjudication_study_mismatch");
  if (args.expectedReviewerId && payload.reviewerId !== args.expectedReviewerId)
    errors.push("adjudication_reviewer_mismatch");
  if (payload.reviewerOrganization !== verification.signerOrganization)
    errors.push("adjudication_organization_mismatch");
  if (payload.conflictDisclosure.length)
    errors.push("adjudication_conflict_disclosed");
  if (
    !args.adjudication.signature.parentArtifactHashes.includes(
      payload.findingId,
    ) ||
    !payload.evidenceHashes.every((hash) =>
      args.adjudication.signature.parentArtifactHashes.includes(hash),
    )
  )
    errors.push("adjudication_evidence_commitment_missing");
  return [...new Set(errors)];
}

export function publicationReviewBlockers(
  synthesis: StudySynthesis,
  adjudications: SignedArtifact<HumanAdjudication>[],
  trustStore: TrustStore,
  now: string,
): string[] {
  const blockers: string[] = [];
  for (const finding of synthesis.findings) {
    const reviews = adjudications.filter(
      (item) => item.payload.findingId === finding.claimKey,
    );
    if (!reviews.length) {
      blockers.push(`human_review_missing:${finding.claimKey}`);
      continue;
    }
    const valid = reviews.filter(
      (review) =>
        verifyHumanAdjudication({
          adjudication: review,
          trustStore,
          expectedStudyId: synthesis.studyId,
          now,
        }).length === 0,
    );
    if (!valid.some((review) => review.payload.status === "accepted"))
      blockers.push(`human_review_not_accepted:${finding.claimKey}`);
    if (valid.some((review) => review.payload.status === "rejected"))
      blockers.push(`human_review_rejected:${finding.claimKey}`);
  }
  return blockers;
}
