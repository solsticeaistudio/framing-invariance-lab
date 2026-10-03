import type {
  BoundaryObservation,
  ContextArtifactKind,
  TrajectoryTurnRole,
} from "./types.js";
import {
  runDeltaStoreBridge,
  type DeltaStoreBridgeConfig,
} from "./deltaStoreBridge.js";

export type DeltaStoreStatus = {
  state: Record<string, unknown>;
  structure: Record<string, unknown>;
  invariants: {
    valid: boolean;
    errors: string[];
    event_count: number;
    delta_node_count: number;
    max_depth: number;
    retention_mode: string;
    persistence_mode: string;
  };
};

export class DeltaStoreTrajectoryBackend {
  constructor(private readonly config: DeltaStoreBridgeConfig) {}

  status(): Promise<DeltaStoreStatus> {
    return runDeltaStoreBridge(this.config, "status");
  }

  appendTurn(args: {
    role: TrajectoryTurnRole;
    content: string;
    model?: string;
    providerRequestId?: string;
    stopReason?: string | null;
    timestamp?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ event_id: string; turn: Record<string, unknown> }> {
    return runDeltaStoreBridge(this.config, "append_turn", {
      role: args.role,
      content: args.content,
      model: args.model,
      provider_request_id: args.providerRequestId,
      stop_reason: args.stopReason,
      timestamp: args.timestamp,
      metadata: args.metadata,
    });
  }

  recordContextArtifact(args: {
    kind: ContextArtifactKind;
    content: string;
    artifactId?: string;
    afterTurnIndex?: number;
    provider?: string;
    model?: string;
    sourceStartTurn?: number;
    sourceEndTurn?: number;
    timestamp?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<{ event_id: string; artifact: Record<string, unknown> }> {
    return runDeltaStoreBridge(this.config, "record_context_artifact", {
      kind: args.kind,
      content: args.content,
      artifact_id: args.artifactId,
      after_turn_index: args.afterTurnIndex,
      provider: args.provider,
      model: args.model,
      source_start_turn: args.sourceStartTurn,
      source_end_turn: args.sourceEndTurn,
      timestamp: args.timestamp,
      metadata: args.metadata,
    });
  }

  recordBoundaryObservation(
    observation: BoundaryObservation,
  ): Promise<{ event_id: string; observation: Record<string, unknown> }> {
    return runDeltaStoreBridge(this.config, "record_boundary_observation", {
      turn_index: observation.turnIndex,
      state_label: observation.state,
      confidence: observation.confidence,
      operational_specificity: observation.operationalSpecificity,
      signals: observation.signals,
      assessor: observation.assessor,
      notes: observation.notes,
    });
  }

  createBranch(args: {
    name: string;
    fromEventId?: string;
    description?: string;
    switch?: boolean;
  }): Promise<{ timeline_id: string }> {
    return runDeltaStoreBridge(this.config, "create_branch", {
      name: args.name,
      from_event_id: args.fromEventId,
      description: args.description,
      switch: args.switch,
    });
  }

  switchBranch(timelineId: string): Promise<{ state: Record<string, unknown> }> {
    return runDeltaStoreBridge(this.config, "switch_branch", {
      timeline_id: timelineId,
    });
  }

  goToEvent(eventId: string): Promise<{ state: Record<string, unknown> }> {
    return runDeltaStoreBridge(this.config, "go_to_event", {
      event_id: eventId,
    });
  }

  state(): Promise<Record<string, unknown>> {
    return runDeltaStoreBridge(this.config, "state");
  }

  structure(): Promise<Record<string, unknown>> {
    return runDeltaStoreBridge(this.config, "structure");
  }

  verify(): Promise<DeltaStoreStatus["invariants"]> {
    return runDeltaStoreBridge(this.config, "verify");
  }

  exportJsonl(path: string): Promise<{ path: string }> {
    return runDeltaStoreBridge(this.config, "export_jsonl", { path });
  }

  flush(): Promise<{ flushed: boolean }> {
    return runDeltaStoreBridge(this.config, "flush");
  }
}
