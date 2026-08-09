import type { PlatformRole, Principal, ResourceAcl } from "../v2/types.js";

export type Permission =
  | "read_public"
  | "read_internal"
  | "study.read_sanitized"
  | "study.read_internal"
  | "study.manage"
  | "study.publish"
  | "study.manage_acl"
  | "run.read_sanitized"
  | "run.read_sensitive_evidence"
  | "run.export_sensitive_evidence"
  | "run.create"
  | "run.cancel"
  | "run.manage_acl"
  | "report.read_public"
  | "report.read_internal"
  | "report.publish"
  | "adjudication.create"
  | "adjudication.sign"
  | "certificate.manage"
  | "audit.read"
  | "audit.checkpoint"
  | "gold.read"
  | "gold.mutate"
  | "create_run"
  | "create_study"
  | "update_study"
  | "adjudicate"
  | "publish"
  | "manage_gold"
  | "manage_trust"
  | "read_audit";

const ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<Permission>> = {
  viewer: new Set([
    "read_public",
    "study.read_sanitized",
    "run.read_sanitized",
    "report.read_public",
  ]),
  researcher: new Set([
    "read_public",
    "read_internal",
    "study.read_sanitized",
    "study.read_internal",
    "study.manage",
    "study.manage_acl",
    "run.read_sanitized",
    "run.read_sensitive_evidence",
    "run.export_sensitive_evidence",
    "run.create",
    "run.cancel",
    "run.manage_acl",
    "report.read_public",
    "report.read_internal",
    "create_run",
    "create_study",
    "update_study",
  ]),
  reviewer: new Set([
    "read_public",
    "read_internal",
    "study.read_sanitized",
    "study.read_internal",
    "run.read_sensitive_evidence",
    "report.read_internal",
    "adjudication.create",
    "adjudication.sign",
    "adjudicate",
  ]),
  administrator: new Set([
    "read_public",
    "read_internal",
    "study.read_sanitized",
    "study.read_internal",
    "study.manage",
    "study.publish",
    "study.manage_acl",
    "run.read_sanitized",
    "run.read_sensitive_evidence",
    "run.export_sensitive_evidence",
    "run.create",
    "run.cancel",
    "run.manage_acl",
    "report.read_public",
    "report.read_internal",
    "report.publish",
    "adjudication.create",
    "adjudication.sign",
    "certificate.manage",
    "audit.read",
    "audit.checkpoint",
    "gold.read",
    "gold.mutate",
    "create_run",
    "create_study",
    "update_study",
    "adjudicate",
    "publish",
    "manage_gold",
    "manage_trust",
    "read_audit",
  ]),
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403; reason: string };

export function authorizePrincipal(
  principal: Principal | undefined,
  permission: Permission,
  acl?: ResourceAcl,
): AuthorizationDecision {
  if (permission === "read_public" && acl?.public) return { allowed: true };
  if (!principal)
    return {
      allowed: false,
      status: 401,
      reason: "Authentication is required.",
    };
  if (principal.disabled)
    return { allowed: false, status: 403, reason: "The account is disabled." };
  if (!principal.roles.some((role) => ROLE_PERMISSIONS[role].has(permission))) {
    return {
      allowed: false,
      status: 403,
      reason: "The principal lacks the required permission.",
    };
  }
  if (!acl || principal.roles.includes("administrator"))
    return { allowed: true };
  const resourceMember =
    acl.ownerId === principal.id ||
    acl.userIds?.includes(principal.id) === true ||
    (acl.organizationAccess === true &&
      acl.organizationId === principal.organizationId) ||
    acl.teamIds.some((teamId) => principal.teamIds.includes(teamId));
  return resourceMember
    ? { allowed: true }
    : {
        allowed: false,
        status: 403,
        reason: "The resource is not shared with this principal.",
      };
}
