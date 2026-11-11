export type ImprovementStage =
  | "candidate"
  | "research_requested"
  | "research_in_progress"
  | "evidence_ready"
  | "proposal_submitted"
  | "approved"
  | "rejected"
  | "implemented"
  | "measuring"
  | "completed"
  | "rolled_back";

export type EvidenceKind =
  | "primary_source"
  | "peer_reviewed"
  | "official_reference"
  | "validated_internal_dataset"
  | "expert_review"
  | "consumer_signal";

export interface EvidenceReference {
  id: string;
  kind: EvidenceKind;
  title: string;
  publisher: string;
  url: string;
  accessedAt: string;
  supportsClaim: string;
  reliability: "high" | "medium" | "low";
  notes?: string;
}

export interface ImprovementRecord {
  id: string;
  domain: string;
  targetComponent: string;
  problemStatement: string;
  proposedChange: string;
  hypothesis: string;
  evidence: EvidenceReference[];
  stage: ImprovementStage;
  createdBy: string;
  reviewer?: string;
  approver?: string;
  implementer?: string;
  implementationVersion?: string;
  rollbackReference?: string;
  outcomeMetric?: string;
  baseline?: number;
  target?: number;
  measured?: number;
  audit: AuditEntry[];
}

export interface AuditEntry {
  actor: string;
  action: string;
  from: ImprovementStage;
  to: ImprovementStage;
  at: string;
  note: string;
}

export type WorkflowAction =
  | "request_research"
  | "start_research"
  | "submit_evidence"
  | "submit_proposal"
  | "approve"
  | "reject"
  | "mark_implemented"
  | "start_measurement"
  | "complete"
  | "rollback";

export interface WorkflowCommand {
  action: WorkflowAction;
  actor: string;
  at: string;
  note: string;
  evidence?: EvidenceReference[];
  implementationVersion?: string;
  rollbackReference?: string;
  outcomeMetric?: string;
  baseline?: number;
  target?: number;
  measured?: number;
}

export interface WorkflowResult {
  ok: boolean;
  record: ImprovementRecord;
  error?: string;
}

const MIN_RELIABLE_EVIDENCE = 2;
const GOOD_EVIDENCE = new Set<EvidenceKind>([
  "primary_source", "peer_reviewed", "official_reference",
  "validated_internal_dataset", "expert_review",
]);

function hasAdequateEvidence(evidence: EvidenceReference[]): boolean {
  const reliable = evidence.filter(e => GOOD_EVIDENCE.has(e.kind) && e.reliability !== "low");
  const distinctPublishers = new Set(reliable.map(e => e.publisher.trim().toLowerCase()));
  return reliable.length >= MIN_RELIABLE_EVIDENCE && distinctPublishers.size >= 2;
}

/**
 * Pure state machine. The caller must persist the returned record and audit entry
 * in a transaction. Authentication/role checks must happen before this function.
 */
export function transitionImprovement(
  current: ImprovementRecord,
  command: WorkflowCommand,
): WorkflowResult {
  const fail = (error: string): WorkflowResult => ({ ok: false, record: current, error });
  if (!command.actor.trim()) return fail("actor_required");
  if (!Number.isFinite(Date.parse(command.at))) return fail("valid_timestamp_required");
  if (!command.note.trim()) return fail("audit_note_required");

  const next = { ...current, evidence: [...current.evidence], audit: [...current.audit] };
  let stage: ImprovementStage = current.stage;

  switch (command.action) {
    case "request_research":
      if (stage !== "candidate") return fail("research_can_only_be_requested_from_candidate");
      stage = "research_requested";
      break;
    case "start_research":
      if (stage !== "research_requested") return fail("research_must_be_requested_first");
      stage = "research_in_progress";
      break;
    case "submit_evidence":
      if (stage !== "research_in_progress" && stage !== "research_requested") return fail("evidence_not_expected_at_this_stage");
      if (!command.evidence?.length) return fail("evidence_required");
      next.evidence.push(...command.evidence);
      if (!hasAdequateEvidence(next.evidence)) return fail("insufficient_independent_reliable_evidence");
      stage = "evidence_ready";
      break;
    case "submit_proposal":
      if (stage !== "evidence_ready") return fail("evidence_review_required_before_proposal");
      if (!current.proposedChange.trim() || !current.hypothesis.trim()) return fail("proposal_and_hypothesis_required");
      stage = "proposal_submitted";
      next.reviewer = command.actor;
      break;
    case "approve":
      if (stage !== "proposal_submitted") return fail("proposal_not_submitted");
      if (current.createdBy === command.actor || current.reviewer === command.actor) return fail("independent_approval_required");
      if (!hasAdequateEvidence(next.evidence)) return fail("evidence_gate_failed");
      next.approver = command.actor;
      stage = "approved";
      break;
    case "reject":
      if (stage !== "proposal_submitted" && stage !== "evidence_ready") return fail("nothing_reviewable");
      next.reviewer = command.actor;
      stage = "rejected";
      break;
    case "mark_implemented":
      if (stage !== "approved") return fail("approval_required_before_implementation");
      if (!command.implementationVersion?.trim()) return fail("implementation_version_required");
      if (current.approver === command.actor) return fail("approver_cannot_self_implement");
      next.implementer = command.actor;
      next.implementationVersion = command.implementationVersion;
      stage = "implemented";
      break;
    case "start_measurement":
      if (stage !== "implemented") return fail("implementation_required_before_measurement");
      if (!command.outcomeMetric?.trim() || command.baseline === undefined || command.target === undefined) {
        return fail("metric_baseline_and_target_required");
      }
      next.outcomeMetric = command.outcomeMetric;
      next.baseline = command.baseline;
      next.target = command.target;
      stage = "measuring";
      break;
    case "complete":
      if (stage !== "measuring") return fail("measurement_must_be_started");
      if (command.measured === undefined) return fail("measured_outcome_required");
      next.measured = command.measured;
      stage = "completed";
      break;
    case "rollback":
      if (stage !== "implemented" && stage !== "measuring" && stage !== "completed") return fail("nothing_to_rollback");
      if (!command.rollbackReference?.trim()) return fail("rollback_reference_required");
      next.rollbackReference = command.rollbackReference;
      stage = "rolled_back";
      break;
    default:
      return fail("unsupported_action");
  }

  next.stage = stage;
  next.audit.push({
    actor: command.actor,
    action: command.action,
    from: current.stage,
    to: stage,
    at: command.at,
    note: command.note,
  });
  return { ok: true, record: next };
}
