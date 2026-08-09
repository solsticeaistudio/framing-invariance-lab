import type {
  CalibrationReport,
  EvalRun,
  GoldItem,
  HumanAnnotation,
  Meta,
  RunComparison,
  ReportAudience,
  ReportData,
  ReportDisclosure,
  RunConfig,
  RunSummary,
  Scenario,
  Variant,
} from "./types";

const TOKEN_KEY = "framing-invariance-lab.auth-token";
let bearerToken =
  typeof window === "undefined"
    ? ""
    : (window.sessionStorage.getItem(TOKEN_KEY) ?? "");

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("fil_csrf="))
    ?.slice("fil_csrf=".length);
}

function authenticatedHeaders(headers?: HeadersInit, method = "GET"): Headers {
  const result = new Headers(headers);
  result.set("content-type", "application/json");
  if (bearerToken) result.set("authorization", `Bearer ${bearerToken}`);
  const csrf = csrfToken();
  if (csrf && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()))
    result.set("x-csrf-token", csrf);
  return result;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: authenticatedHeaders(init?.headers, init?.method),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok)
    throw new Error(
      body.error ?? `Request failed with HTTP ${response.status}.`,
    );
  return body;
}

export const api = {
  authToken: () => bearerToken,
  setAuthToken: (token: string) => {
    bearerToken = token.trim();
    if (bearerToken) window.sessionStorage.setItem(TOKEN_KEY, bearerToken);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  },
  health: () =>
    requestJson<{ ok: boolean; apiKeyConfigured: boolean }>("/api/health"),
  meta: () => requestJson<Meta>("/api/meta?disclosure=internal"),
  preview: (payload: {
    scenarios: Scenario[];
    design: RunConfig["design"];
    seed: number;
  }) =>
    requestJson<{
      total: number;
      perScenario: number;
      variants: Variant[];
      truncated: boolean;
    }>("/api/variants/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  startRun: (config: RunConfig) =>
    requestJson<{ run: EvalRun }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  getRun: (runId: string) =>
    requestJson<{ run: EvalRun }>(`/api/runs/${runId}?disclosure=internal`),
  getTrialResponse: (runId: string, trialId: string) =>
    requestJson<{ response: string; responseHash: string }>(
      `/api/runs/${runId}/trials/${trialId}/response`,
    ),
  listRuns: () => requestJson<{ runs: RunSummary[] }>("/api/runs"),
  cancelRun: (runId: string) =>
    requestJson<{ ok: boolean }>(`/api/runs/${runId}/cancel`, {
      method: "POST",
    }),
  getReport: (
    runId: string,
    options: {
      audience: ReportAudience;
      disclosure: ReportDisclosure;
      baselineRunId?: string;
    },
  ) => {
    const params = new URLSearchParams({
      format: "json",
      audience: options.audience,
      disclosure: options.disclosure,
    });
    if (options.baselineRunId)
      params.set("baselineRunId", options.baselineRunId);
    return requestJson<{ report: ReportData }>(
      `/api/runs/${runId}/report?${params.toString()}`,
    );
  },
  compareRuns: (baselineRunId: string, candidateRunId: string) =>
    requestJson<{ comparison: RunComparison }>(
      `/api/comparison?baselineRunId=${encodeURIComponent(baselineRunId)}&candidateRunId=${encodeURIComponent(candidateRunId)}`,
    ),
  gold: () =>
    requestJson<{ items: GoldItem[]; report: CalibrationReport }>("/api/gold"),
  getGoldResponse: (itemId: string) =>
    requestJson<{ response: string; responseHash: string }>(
      `/api/gold/${itemId}/response`,
    ),
  addGoldTrial: (runId: string, trialId: string) =>
    requestJson<{ item: GoldItem; report: CalibrationReport }>("/api/gold", {
      method: "POST",
      body: JSON.stringify({ runId, trialId }),
    }),
  annotateGold: (
    itemId: string,
    annotation: Omit<HumanAnnotation, "id" | "createdAt">,
  ) =>
    requestJson<{ item: GoldItem; report: CalibrationReport }>(
      `/api/gold/${itemId}/annotations`,
      {
        method: "POST",
        body: JSON.stringify(annotation),
      },
    ),
  removeGold: (itemId: string) =>
    requestJson<{ ok: boolean; report: CalibrationReport }>(
      `/api/gold/${itemId}`,
      { method: "DELETE" },
    ),
  listStudies: () =>
    requestJson<{ studies: import("./types").StudySummary[] }>("/api/studies"),
  createStudy: (input: import("./types").CreateStudyInput) =>
    requestJson<{ study: import("./types").StudySummary }>("/api/studies", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getStudy: (studyId: string) =>
    requestJson<{ study: import("./types").StudyDetail }>(
      `/api/studies/${studyId}`,
    ),
  registerStudy: (studyId: string) =>
    requestJson<{ study: import("./types").StudyDetail }>(
      `/api/studies/${studyId}/register`,
      { method: "POST" },
    ),
  synthesizeStudy: (studyId: string) =>
    requestJson<{ synthesis: import("./types").SignedStudySynthesis }>(
      `/api/studies/${studyId}/synthesize`,
      { method: "POST" },
    ),
  publishRun: (runId: string) =>
    requestJson<{ artifact: import("./types").PublicArtifactSummary }>(
      `/api/runs/${runId}/publish`,
      { method: "POST" },
    ),
  publishStudy: (studyId: string) =>
    requestJson<{ report: import("./types").PublicArtifactSummary }>(
      `/api/studies/${studyId}/publish`,
      { method: "POST" },
    ),
  audit: () =>
    requestJson<{
      verification: { valid: boolean; errors: string[] };
      events: import("./types").AuditEventSummary[];
    }>("/api/audit"),
  downloadReport: async (url: string, filename: string, open = false) => {
    const response = await fetch(url, { headers: authenticatedHeaders() });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ?? `Request failed with HTTP ${response.status}.`,
      );
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (open) window.open(objectUrl, "_blank", "noopener,noreferrer");
    else {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  },
};
