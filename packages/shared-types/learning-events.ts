export type LearningPurpose = "personalization" | "aggregate_research" | "conversation_analysis";
export interface ConsentSnapshot { personalization: boolean; aggregateResearch: boolean; conversationAnalysis: boolean; policyVersion: string; }
export type LearningEventName = "scan_started" | "scan_completed" | "extraction_corrected" | "menu_item_opened" | "journey_started" | "journey_feedback_submitted" | "question_intent_selected" | "question_submitted" | "item_saved" | "remix_created" | "remix_adjustment_made" | "recommendation_feedback" | "search_no_result" | "entity_match_rejected" | "content_reported";
export type BeverageCategory = "cocktail" | "wine" | "beer" | "spirits" | "other";
export interface LearningEvent {
 eventId: string; eventName: LearningEventName; schemaVersion: 1; occurredAt: string;
 subjectId: string; sessionId?: string; appVersion: string; platform: "ios" | "android";
 consent: ConsentSnapshot;
 context?: { beverageCategory?: BeverageCategory; feature?: string; venueRegion?: string; sourceType?: "menu_scan" | "search" | "journey" | "collection" | "remix" };
 properties?: Record<string,string|number|boolean|string[]>;
}
export interface LearningIngestDecision { accepted: boolean; reason: "accepted"|"consent_required"|"conversation_consent_required"|"invalid_event"; storeQuestionSeparately: boolean; eligibleForAggregate: boolean; eligibleForPersonalization: boolean; }
