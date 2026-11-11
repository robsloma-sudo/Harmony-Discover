import { describe, expect, it } from "vitest";
import { transitionImprovement, type ImprovementRecord, type EvidenceReference } from "../packages/learning-engine/improvement-workflow";

const evidence: EvidenceReference[] = [
  {id:"e1",kind:"official_reference",title:"Official standard",publisher:"Institute A",url:"https://example.org/a",accessedAt:"2026-11-09T12:00:00Z",supportsClaim:"supports ingredient definition",reliability:"high"},
  {id:"e2",kind:"peer_reviewed",title:"Research paper",publisher:"Journal B",url:"https://example.org/b",accessedAt:"2026-11-09T12:00:00Z",supportsClaim:"supports sensory mechanism",reliability:"high"},
];

const base: ImprovementRecord = {
  id:"imp-001", domain:"cocktail_intelligence", targetComponent:"cocktail education",
  problemStatement:"Repeated questions suggest a possible knowledge gap.",
  proposedChange:"Add a sourced explanation of acid and sugar balance.",
  hypothesis:"The revised explanation will improve helpfulness feedback.",
  evidence:[], stage:"candidate", createdBy:"author-1", audit:[]
};

function command(action: any, actor: string, extra: any = {}) {
  return { action, actor, at:"2026-11-09T12:00:00Z", note:"Test workflow transition", ...extra };
}

describe("improvement workflow",()=>{
  it("blocks proposal without independent evidence",()=>{
    const result=transitionImprovement(base,command("request_research","researcher"));
    expect(result.ok).toBe(true);
    const noEvidence=transitionImprovement(result.record,command("start_research","researcher"));
    expect(noEvidence.ok).toBe(true);
    const blocked=transitionImprovement(noEvidence.record,command("submit_evidence","researcher",{evidence:[evidence[0]]}));
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("insufficient_independent_reliable_evidence");
  });

  it("requires independent approval and implementation version",()=>{
    let r=transitionImprovement(base,command("request_research","author-1")).record;
    r=transitionImprovement(r,command("start_research","researcher")).record;
    r=transitionImprovement(r,command("submit_evidence","researcher",{evidence})).record;
    r=transitionImprovement(r,command("submit_proposal","reviewer-1")).record;
    const selfApproval=transitionImprovement(r,command("approve","author-1"));
    expect(selfApproval.ok).toBe(false);
    const approval=transitionImprovement(r,command("approve","approver-2"));
    expect(approval.ok).toBe(true);
    const noVersion=transitionImprovement(approval.record,command("mark_implemented","developer"));
    expect(noVersion.ok).toBe(false);
  });

  it("records audit trail and requires outcome measurement",()=>{
    let r=transitionImprovement(base,command("request_research","author-1")).record;
    r=transitionImprovement(r,command("start_research","researcher")).record;
    r=transitionImprovement(r,command("submit_evidence","researcher",{evidence})).record;
    r=transitionImprovement(r,command("submit_proposal","reviewer-1")).record;
    r=transitionImprovement(r,command("approve","approver-2")).record;
    r=transitionImprovement(r,command("mark_implemented","developer",{implementationVersion:"dev-2026.11.09.1"})).record;
    r=transitionImprovement(r,command("start_measurement","analyst",{outcomeMetric:"helpful_rating",baseline:3.1,target:4.0})).record;
    const done=transitionImprovement(r,command("complete","analyst",{measured:4.2}));
    expect(done.ok).toBe(true);
    expect(done.record.stage).toBe("completed");
    expect(done.record.audit).toHaveLength(8);
  });

  it("requires a rollback reference",()=>{
    const r={...base,stage:"implemented" as const};
    expect(transitionImprovement(r,command("rollback","developer")).ok).toBe(false);
  });
});
