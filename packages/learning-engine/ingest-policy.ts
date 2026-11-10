import type { LearningEvent, LearningEventName, LearningIngestDecision, ConsentSnapshot } from "../shared-types/learning-events";
const ALLOWED = new Set<LearningEventName>(["scan_started","scan_completed","extraction_corrected","menu_item_opened","journey_started","journey_feedback_submitted","question_intent_selected","question_submitted","item_saved","remix_created","remix_adjustment_made","recommendation_feedback","search_no_result","entity_match_rejected","content_reported"]);
const FORBIDDEN = new Set(["email","phone","fullName","address","latitude","longitude","gps","rawText","questionText","photoUrl","imageUrl","ipAddress"]);
export function validateLearningEvent(e: LearningEvent): string[] {
 const errors:string[]=[];
 if(!e.eventId||!e.subjectId) errors.push("eventId and subjectId are required");
 if(!ALLOWED.has(e.eventName)) errors.push("eventName is not allow-listed");
 if(e.schemaVersion!==1) errors.push("unsupported schemaVersion");
 if(!Number.isFinite(Date.parse(e.occurredAt))) errors.push("occurredAt must be ISO-compatible");
 if(!e.appVersion||!(e.platform==="ios"||e.platform==="android")) errors.push("app metadata is invalid");
 for(const key of Object.keys(e.properties??{})) if(FORBIDDEN.has(key)) errors.push(`property '${key}' is not permitted`);
 return errors;
}
// The API must pass the latest server-loaded consent state; never authorize from device state alone.
export function decideLearningIngest(e:LearningEvent, current:ConsentSnapshot):LearningIngestDecision {
 const errors=validateLearningEvent(e);
 if(errors.length) return {accepted:false,reason:e.eventName==="question_submitted"?"conversation_consent_required":"invalid_event",storeQuestionSeparately:false,eligibleForAggregate:false,eligibleForPersonalization:false};
 const personal=current.personalization, aggregate=current.aggregateResearch, conversation=current.conversationAnalysis;
 if(e.eventName==="question_submitted"&&!conversation) return {accepted:false,reason:"conversation_consent_required",storeQuestionSeparately:false,eligibleForAggregate:false,eligibleForPersonalization:false};
 const allowed=personal||aggregate||(e.eventName==="question_submitted"&&conversation);
 return {accepted:allowed,reason:allowed?"accepted":"consent_required",storeQuestionSeparately:e.eventName==="question_submitted"&&conversation,eligibleForAggregate:aggregate,eligibleForPersonalization:personal};
}
