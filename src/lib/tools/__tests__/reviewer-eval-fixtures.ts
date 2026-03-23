/**
 * Reviewer Evaluation Fixtures
 *
 * Structured test cases for evaluating Reviewer quality across domains.
 * Each fixture includes input text, expected behavior, and rationale.
 *
 * These fixtures test the deterministic trigger layer locally.
 * Full edge-function round-trip testing requires manual invocation.
 */

export interface EvalFixture {
  id: string;
  name: string;
  description: string;
  input_text: string;
  expected_trigger_categories: string[];
  expected_min_trigger_hits: number;
  expected_max_trigger_hits: number;
  /** Whether the full reviewer should flag this text */
  should_flag: boolean;
  /** Notes on what the reviewer should or should not do */
  rationale: string;
}

export const EVAL_FIXTURES: EvalFixture[] = [
  {
    id: "clean_professional",
    name: "Clean professional narrative",
    description: "Well-written, neutral caseworker narrative — should produce zero findings",
    input_text: "Worker conducted a home visit on March 15, 2026. The home was clean and organized. Food was available in the pantry and refrigerator. The children appeared healthy, well-nourished, and appropriately dressed for the weather. The mother was cooperative during the visit and answered all questions openly. Worker explained available support services and provided printed resource materials. A follow-up visit was scheduled for April 12, 2026.",
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 0,
    should_flag: false,
    rationale: "Professional, neutral, fact-based documentation should never be flagged.",
  },
  {
    id: "subtle_acceptable",
    name: "Subtle but acceptable professional wording",
    description: "Professionally direct wording that might seem close to a trigger but is acceptable",
    input_text: "The client's housing application was denied due to incomplete documentation. Worker informed the client of the specific documents required and the deadline for resubmission. The client expressed frustration with the process but agreed to gather the necessary paperwork. Worker provided a checklist and offered assistance with document collection. The case will remain open pending resubmission.",
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 0,
    should_flag: false,
    rationale: "Describing a client's frustration factually is not judgmental. Stating a denial reason is not biased.",
  },
  {
    id: "professional_firm",
    name: "Professional but firm / boundary-setting",
    description: "Caseworker being direct and firm without being judgmental — should NOT be flagged",
    input_text: "Worker informed the client that the service plan requirements must be completed by April 30. Worker explained that failure to complete the required steps may result in a change to the case recommendation. The client was advised that attendance at all scheduled appointments is mandatory per program guidelines. Worker documented that the client received written notice of these requirements and acknowledged receipt.",
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 0,
    should_flag: false,
    rationale: "Professional firmness, boundary-setting, and clear communication of consequences are appropriate caseworker behaviors.",
  },
  {
    id: "subtle_tone_drift",
    name: "Subtle tone drift",
    description: "Narrative that drifts into informal or mildly judgmental territory",
    input_text: "The client showed up late again for the scheduled appointment. She didn't seem particularly concerned about the missed sessions. When asked about the service plan, she gave vague answers and didn't really engage with the discussion. Worker tried to explain the importance of the program but the client didn't seem to care much about following through.",
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 1,
    should_flag: true,
    rationale: "Phrases like 'didn't seem to care' and 'didn't really engage' are subjective impressions presented as observations.",
  },
  {
    id: "obvious_bias",
    name: "Obvious bias and stigma",
    description: "Text with clear labeling, stigmatizing language, and dehumanizing phrasing",
    input_text: "The addict was found in the home with the children. These people never change their behavior regardless of how much support is provided. The substance abuser has been through three programs already and continues to make the same choices. It is unlikely that the offender will ever be a suitable caregiver.",
    expected_trigger_categories: ["bias_stigma"],
    expected_min_trigger_hits: 3,
    expected_max_trigger_hits: 10,
    should_flag: true,
    rationale: "Multiple instances of labeling people ('the addict', 'the offender', 'these people') and stigmatizing generalizations.",
  },
  {
    id: "unsupported_conclusion",
    name: "Unsupported conclusions presented as fact",
    description: "Text that presents inference as established fact without supporting evidence",
    input_text: "The client is clearly unable to manage her finances and will obviously continue to misuse program benefits. It is evident that she deliberately misrepresented her income on the application. Without a doubt, the children would be better served in an alternative placement. The client intentionally avoided providing the requested documentation.",
    expected_trigger_categories: ["unsupported_conclusion"],
    expected_min_trigger_hits: 4,
    expected_max_trigger_hits: 15,
    should_flag: true,
    rationale: "Multiple certainty intensifiers ('clearly', 'obviously', 'without a doubt') and intent stated as fact ('deliberately', 'intentionally').",
  },
  {
    id: "policy_language_violation",
    name: "Policy-inconsistent language",
    description: "Text using prohibited terms and unprofessional phrasing",
    input_text: "The alleged perpetrator was tragically found at the scene with the alleged victim. Worker is gonna follow up next week to see if the situation has changed. The shockingly poor conditions in the home were disturbingly apparent to everyone involved.",
    expected_trigger_categories: ["policy_inconsistent"],
    expected_min_trigger_hits: 3,
    expected_max_trigger_hits: 10,
    should_flag: true,
    rationale: "Uses 'alleged perpetrator/victim', informal language ('gonna'), and emotionally loaded qualifiers ('tragically', 'shockingly', 'disturbingly').",
  },
  {
    id: "low_narrative",
    name: "Low narrative content",
    description: "Document with very little authored prose — mostly structured data",
    input_text: "Case ID: 2026-1234. Date: 03/15/2026. Worker: J. Smith.",
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 0,
    should_flag: false,
    rationale: "Too little narrative for meaningful review. Coverage should be 'insufficient'.",
  },
  {
    id: "quoted_not_adopted",
    name: "Quoted problematic language NOT adopted by worker",
    description: "Worker quotes a client using harsh language but maintains professional framing",
    input_text: 'Client stated "my ex is a dangerous abuser and he should be locked up forever." Worker documented the client\'s statement and explained the process for obtaining a protective order. Worker noted that the client appeared distressed during the conversation. According to the client, the incidents have been escalating over the past three months.',
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 1,
    should_flag: false,
    rationale: "The harsh language is clearly attributed to the client. The worker maintains professional framing throughout.",
  },
  {
    id: "quoted_adopted",
    name: "Quoted language adopted uncritically by worker",
    description: "Worker adopts and amplifies problematic language from a source",
    input_text: 'The neighbor reported that the mother is "a total mess who can\'t take care of herself." Based on this report, the mother clearly cannot provide adequate care for the children. The mother is obviously an unfit parent given her history of substance abuse. Worker agrees with the neighbor\'s assessment that the household is dangerous.',
    expected_trigger_categories: ["unsupported_conclusion", "judgmental_tone"],
    expected_min_trigger_hits: 2,
    expected_max_trigger_hits: 10,
    should_flag: true,
    rationale: "Worker adopts the neighbor's language ('unfit parent'), overclaims ('clearly', 'obviously'), and presents opinion as fact.",
  },
  {
    id: "clean_factual_dense",
    name: "Clean factual but dense caseworker narrative",
    description: "Detailed factual documentation that is professionally written — should remain 0 findings",
    input_text: "On March 10, 2026, worker conducted an unannounced home visit at approximately 2:30 PM. The client answered the door and invited the worker inside. Three children were present in the living room, engaged in age-appropriate activities. The kitchen was stocked with food and the home was reasonably clean. Worker observed that the youngest child had a healing bruise on the left knee, which the mother attributed to a fall at the playground on March 8. Worker documented the bruise location and size. The client provided medical records from the pediatrician visit on March 9 confirming the injury was consistent with a fall. Worker reviewed the service plan progress and noted that the client has completed 4 of 6 required parenting sessions. The next session is scheduled for March 17. Worker reminded the client of the remaining requirements and provided a printed summary. No safety concerns were identified during this visit.",
    expected_trigger_categories: [],
    expected_min_trigger_hits: 0,
    expected_max_trigger_hits: 0,
    should_flag: false,
    rationale: "Dense, detailed, factual documentation with no subjective language, labels, or overclaiming.",
  },
];
