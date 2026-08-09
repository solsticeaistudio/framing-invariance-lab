import { describe, expect, it } from "vitest";
import type { Principal, ResourceAcl } from "../v2/types.js";
import { authorizePrincipal } from "./authorization.js";

const principal: Principal = {
  id: "user-a",
  subject: "subject-a",
  organizationId: "org-a",
  displayName: "A",
  roles: ["researcher"],
  teamIds: ["team-a"],
  disabled: false,
};
const acl: ResourceAcl = {
  resourceType: "run",
  resourceId: "run-a",
  ownerId: "user-b",
  organizationId: "org-b",
  teamIds: ["team-b"],
  public: false,
};

describe("resource authorization", () => {
  it("does not treat a resource UUID as authorization", () => {
    expect(authorizePrincipal(principal, "read_internal", acl)).toEqual({
      allowed: false,
      status: 403,
      reason: "The resource is not shared with this principal.",
    });
  });
  it("allows team sharing and administrator override", () => {
    expect(
      authorizePrincipal(principal, "read_internal", {
        ...acl,
        teamIds: ["team-a"],
      }).allowed,
    ).toBe(true);
    expect(
      authorizePrincipal(
        { ...principal, roles: ["administrator"] },
        "manage_trust",
        acl,
      ).allowed,
    ).toBe(true);
  });
  it("rejects disabled accounts and missing roles", () => {
    expect(
      authorizePrincipal({ ...principal, disabled: true }, "read_internal", acl)
        .allowed,
    ).toBe(false);
    expect(
      authorizePrincipal({ ...principal, roles: ["viewer"] }, "create_run")
        .allowed,
    ).toBe(false);
  });
  it("keeps viewers out of sensitive evidence and mutations", () => {
    const viewer = { ...principal, roles: ["viewer"] as const };
    expect(
      authorizePrincipal(viewer, "run.read_sensitive_evidence", acl).allowed,
    ).toBe(false);
    expect(authorizePrincipal(viewer, "run.cancel", acl).allowed).toBe(false);
    expect(authorizePrincipal(viewer, "study.manage_acl", acl).allowed).toBe(
      false,
    );
    expect(
      authorizePrincipal(viewer, "report.read_internal", acl).allowed,
    ).toBe(false);
  });
});
