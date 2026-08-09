import type express from "express";
import type { Permission } from "./authorization.js";
import { authorizePrincipal } from "./authorization.js";
import { originAllowed, requiresCsrf } from "./csrf.js";
import type { OidcManager } from "./oidc.js";
import type { SessionManager } from "./sessions.js";
import type { PlatformStorage, StoredSession } from "./storage/index.js";
import type { Principal, ResourceAcl } from "../v2/types.js";
import { createAuditEvent } from "./audit.js";

type AuthenticatedContext = { principal: Principal; session: StoredSession };

export class ProductionAuth {
  private readonly contexts = new WeakMap<
    express.Request,
    AuthenticatedContext
  >();
  constructor(
    readonly settings: {
      oidc: OidcManager;
      sessions: SessionManager;
      storage: PlatformStorage;
      publicBaseUrl: string;
      secureCookies: boolean;
    },
  ) {}

  context(request: express.Request): AuthenticatedContext | undefined {
    return this.contexts.get(request) ?? this.authenticate(request);
  }

  private authenticate(
    request: express.Request,
  ): AuthenticatedContext | undefined {
    const context = this.settings.sessions.authenticate(
      request.header("cookie"),
    );
    if (context) this.contexts.set(request, context);
    return context;
  }

  audit(
    action: string,
    resourceType: string,
    resourceId: string,
    request?: express.Request,
    metadata: Record<string, string | number | boolean | null> = {},
  ): void {
    const principal = request ? this.context(request)?.principal : undefined;
    if (this.settings.storage.appendAuditAtomically) {
      this.settings.storage.appendAuditAtomically({
        occurredAt: new Date().toISOString(),
        actorId: principal?.id ?? "anonymous",
        actorOrganization: principal?.organizationId,
        action,
        resourceType,
        resourceId,
        metadata,
      });
    } else {
      const events = this.settings.storage.listAudit();
      this.settings.storage.appendAudit(
        createAuditEvent(events.at(-1), {
          occurredAt: new Date().toISOString(),
          actorId: principal?.id ?? "anonymous",
          actorOrganization: principal?.organizationId,
          action,
          resourceType,
          resourceId,
          metadata,
        }),
      );
    }
  }

  require(
    permission: Permission,
    acl?: (request: express.Request) => ResourceAcl | undefined,
  ): express.RequestHandler {
    return (request, response, next) => {
      const context = this.context(request);
      const decision = authorizePrincipal(
        context?.principal,
        permission,
        acl?.(request),
      );
      if (!decision.allowed) {
        this.audit("authorization.failed", "route", request.path, request, {
          status: decision.status,
        });
        response.status(decision.status).json({ error: decision.reason });
        return;
      }
      if (requiresCsrf(request.method)) {
        if (
          !context ||
          !this.settings.sessions.validateCsrf(
            context.session,
            request.header("x-csrf-token"),
          ) ||
          !originAllowed(request, this.settings.publicBaseUrl)
        ) {
          this.audit("csrf.failed", "route", request.path, request);
          response.status(403).json({ error: "CSRF validation failed." });
          return;
        }
      }
      next();
    };
  }

  install(app: express.Express): void {
    app.get("/api/auth/login", async (request, response, next) => {
      try {
        response.redirect(
          (
            await this.settings.oidc.begin(
              typeof request.query.returnTo === "string"
                ? request.query.returnTo
                : undefined,
            )
          ).toString(),
        );
      } catch (error) {
        next(error);
      }
    });
    app.get("/api/auth/callback", async (request, response, next) => {
      try {
        const callback = new URL(
          request.originalUrl,
          this.settings.publicBaseUrl,
        );
        const result = await this.settings.oidc.complete(callback);
        const current = this.settings.storage.getPrincipal(result.principal.id);
        if (current?.disabled) {
          response.status(403).json({ error: "The account is disabled." });
          return;
        }
        const principal = current
          ? { ...result.principal, disabled: current.disabled }
          : result.principal;
        this.settings.storage.putPrincipal(principal);
        const old = this.settings.sessions.authenticate(
          request.header("cookie"),
        );
        if (old) this.settings.sessions.revoke(old.session.id);
        const created = this.settings.sessions.create(principal);
        this.contexts.set(request, { principal, session: created.session });
        this.audit("session.created", "user", principal.id, request);
        const secure = this.settings.secureCookies ? "; Secure" : "";
        response.setHeader("Set-Cookie", [
          created.cookie,
          `fil_csrf=${created.csrfToken}; Path=/; SameSite=Strict${secure}`,
        ]);
        response.redirect(result.returnTo);
      } catch (error) {
        next(error);
      }
    });
    app.post(
      "/api/auth/logout",
      this.require("report.read_public"),
      (request, response) => {
        const context = this.context(request);
        if (context) this.settings.sessions.revoke(context.session.id);
        this.audit(
          "session.revoked",
          "session",
          context?.session.id ?? "unknown",
          request,
        );
        response.setHeader("Set-Cookie", [
          this.settings.sessions.clearCookie(),
          `fil_csrf=; Path=/; SameSite=Strict; Max-Age=0${this.settings.secureCookies ? "; Secure" : ""}`,
        ]);
        response.json({
          ok: true,
          providerLogoutUrl: this.settings.oidc.logoutUrl().toString(),
        });
      },
    );
    app.get(
      "/api/auth/me",
      this.require("report.read_public"),
      (request, response) => {
        const principal = this.context(request)?.principal;
        response.json({
          principal: principal
            ? {
                id: principal.id,
                displayName: principal.displayName,
                organizationId: principal.organizationId,
                roles: principal.roles,
                teamIds: principal.teamIds,
              }
            : null,
        });
      },
    );
  }
}
