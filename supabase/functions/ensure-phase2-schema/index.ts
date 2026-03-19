/**
 * ensure-phase2-schema (v2.1 — section-aware)
 *
 * Checks if an active Phase 2 extraction schema exists for a given template.
 * If not, generates one using an LLM and stores it in template_phase2_schemas.
 * Links the schema to the session via sessions.phase2_schema_id.
 *
 * v2.1: Schema fields now include section/field_group/content_type metadata
 * to preserve template structure for guidance, extraction, and reviewer.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

const SERVICE_NAME = "ensure-phase2-schema";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// SCHEMA FIELD CONTRACT (v2.1 — section-aware)
// ============================================================

interface SchemaField {
  field_key: string;
  label: string;
  template_prompt: string;
  fact_based: boolean;
  answer_type: string;
  matching_mode: string;
  allowed_values: string[] | null;
  requires_direct_statement: boolean;
  return_null_if_missing: boolean;
  matching_guidance: string;
  examples: string[];
  requires_human_review: boolean;
  human_review_reason: string | null;
  sensitivity_level: "low" | "medium" | "high";
  ambiguity_level: "low" | "medium" | "high";
  extraction_priority: "high" | "medium" | "low";
  // v2.1 section-aware fields
  section: string;
  field_group: string | null;
  content_type: "checkbox" | "narrative" | "factual" | "identifier" | "categorical";
  field_purpose: string[];
}

// ============================================================
// TEMPLATE SECTION DETECTION
// ============================================================

/**
 * Heuristically detect section headings from template content.
 * Handles real OCR-extracted text, not just clean markdown.
 *
 * Patterns recognized:
 * - "SECTION 1: Source Information"  (labeled numbered)
 * - "SECTION 2 - Intake Narrative"   (labeled with dash)
 * - "## Section Name"                (markdown)
 * - "1. Section Name" / "A. Section" (numbered/lettered)
 * - "ALL CAPS LINE"                  (all-caps headers)
 * - "Section: Name" / "Part: Name"   (prefixed)
 * - "**Bold Name**"                  (bold markers)
 * - "--- Section Name ---"           (separator-framed)
 * - "Section Name:" at start of line (colon-terminated title-case)
 */
function detectTemplateSections(content: string): string[] {
  const lines = content.split("\n");
  const sections: string[] = [];
  const seen = new Set<string>();

  const addSection = (name: string): void => {
    // Clean trailing punctuation / whitespace
    name = name.replace(/[\s:\-–—.]+$/, "").replace(/^\s+/, "").trim();
    if (name.length < 3 || name.length > 80) return;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return;
    // Skip lines that look like field values, not headers
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(name)) return; // dates
    if (/^(yes|no|n\/a|unknown|none|other)$/i.test(name)) return;
    seen.add(key);
    sections.push(name);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3 || line.length > 150) continue;

    // 1. "SECTION 1: Source Information" / "SECTION 2 - Intake Narrative" / "SECTION III: ..."
    const sectionLabelMatch = line.match(
      /^SECTION\s+(?:\d+|[IVXLC]+)\s*[:\-–—.]\s*(.+)/i,
    );
    if (sectionLabelMatch) {
      addSection(sectionLabelMatch[1]);
      continue;
    }

    // 2. Markdown headings: ## Section Name
    const mdMatch = line.match(/^#{1,3}\s+(.+)/);
    if (mdMatch) {
      addSection(mdMatch[1]);
      continue;
    }

    // 3. Numbered/lettered sections: "1. Section Name", "I. Section", "A. Section", "1) Section"
    const numMatch = line.match(
      /^(?:\d{1,3}|[IVXLC]{1,5}|[A-Z])[\.\)]\s+([A-Z][A-Za-z\s\/\-&,()]+)/,
    );
    if (numMatch && numMatch[1].trim().length > 3) {
      // Only accept if it looks like a heading (title-case, not a full sentence)
      const candidate = numMatch[1].trim();
      if (candidate.split(" ").length <= 10 && !/[.!?]$/.test(candidate)) {
        addSection(candidate);
        continue;
      }
    }

    // 4. ALL-CAPS lines: "CHILD ISSUES", "INTAKE NARRATIVE", "DEMOGRAPHICS"
    if (
      line === line.toUpperCase() &&
      line.length > 4 &&
      line.length < 80 &&
      /^[A-Z][A-Z\s\/\-&,()0-9]+$/.test(line) &&
      // Must have at least one letter sequence > 2 chars (avoid "N/A", "ID")
      /[A-Z]{3,}/.test(line)
    ) {
      addSection(line);
      continue;
    }

    // 5. "Section:" / "Part:" / "Category:" / "Area:" prefixed
    const prefixMatch = line.match(
      /^(?:Section|Part|Category|Area|Block|Tab)\s*[:\-–—]\s*(.+)/i,
    );
    if (prefixMatch) {
      addSection(prefixMatch[1]);
      continue;
    }

    // 6. Bold markers: **Section Name**
    const boldMatch = line.match(/^\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch[1].length > 3 && boldMatch[1].length < 60) {
      const candidate = boldMatch[1].trim();
      if (/^[A-Z]/.test(candidate) && candidate.split(" ").length <= 8) {
        addSection(candidate);
        continue;
      }
    }

    // 7. Separator-framed: "--- Section Name ---" or "=== Section Name ==="
    const sepMatch = line.match(/^[-=]{2,}\s*(.+?)\s*[-=]{2,}$/);
    if (sepMatch && sepMatch[1].length > 3) {
      addSection(sepMatch[1]);
      continue;
    }

    // 8. Colon-terminated title-case header at start of line (common in OCR):
    //    "Source Information:" / "Intake Narrative:" / "Family Issues:"
    //    Must be title-case, 2-6 words, ending with colon, and be the whole line or nearly
    const colonHeaderMatch = line.match(
      /^([A-Z][A-Za-z]+(?:\s+[A-Za-z&\/\-]+){0,6})\s*:\s*$/,
    );
    if (colonHeaderMatch && colonHeaderMatch[1].length > 5) {
      addSection(colonHeaderMatch[1]);
      continue;
    }

    // 9. OCR-style: lines that are short, title-cased, standalone (no punctuation except maybe colon)
    //    e.g., "Behavioral Concerns and Family Issues"
    //    Heuristic: title-case, 2-7 words, no sentence punctuation, preceded by blank line
    if (
      /^[A-Z][a-z]+(?:\s+(?:and|or|of|the|for|in|to|&|\/|-|[A-Z][a-z]+|[A-Z]+))+$/.test(line) &&
      line.split(" ").length >= 2 &&
      line.split(" ").length <= 8 &&
      line.length < 60
    ) {
      addSection(line);
      continue;
    }
  }

  return sections;
}

// ============================================================
// CONTENT COMPLEXITY ESTIMATION (fallback)
// ============================================================

/**
 * Estimate template complexity even when section detection fails.
 * Uses content signals: length, keyword density, checkbox markers, etc.
 */
function estimateTemplateComplexity(content: string): {
  estimatedSections: number;
  isComplex: boolean;
  signals: string[];
} {
  const signals: string[] = [];

  // Count "section"-like markers even if they didn't parse cleanly
  const sectionMarkerCount = (
    content.match(/\b(?:SECTION|Part|Category|Block)\s*\d/gi) ?? []
  ).length;
  if (sectionMarkerCount > 0) {
    signals.push(`${sectionMarkerCount} section markers found`);
  }

  // Count distinct ALL-CAPS lines (even short ones)
  const capsLines = content.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 4 && t === t.toUpperCase() && /[A-Z]{3,}/.test(t);
  }).length;
  if (capsLines > 3) {
    signals.push(`${capsLines} all-caps lines`);
  }

  // Content length as proxy
  const charCount = content.length;
  if (charCount > 10000) signals.push(`large template (${charCount} chars)`);

  // Checkbox-like markers
  const checkboxCount = (
    content.match(/\[\s*\]|\byes\s*\/\s*no\b|☐|☑|□|■/gi) ?? []
  ).length;
  if (checkboxCount > 10) {
    signals.push(`${checkboxCount} checkbox markers`);
  }

  // Colon-terminated lines (potential field labels)
  const colonLines = content.split("\n").filter((l) =>
    /^[A-Z][A-Za-z\s\/\-&]+:\s*$/.test(l.trim()),
  ).length;
  if (colonLines > 5) {
    signals.push(`${colonLines} colon-terminated label lines`);
  }

  const estimatedSections = Math.max(
    sectionMarkerCount,
    Math.floor(capsLines * 0.7),
    charCount > 20000 ? 8 : charCount > 10000 ? 5 : 3,
  );

  const isComplex =
    sectionMarkerCount >= 3 ||
    capsLines >= 5 ||
    charCount > 15000 ||
    checkboxCount > 15 ||
    colonLines > 10;

  return { estimatedSections, isComplex, signals };
}

// ============================================================
// SCHEMA QUALITY VALIDATION
// ============================================================

interface SchemaQualityResult {
  pass: boolean;
  issues: string[];
  fieldCount: number;
  sectionsCovered: number;
  sectionsExpected: number;
  narrativeCount: number;
  complexitySignals: string[];
}

function validateSchemaQuality(
  fields: SchemaField[],
  detectedSections: string[],
  templateContent: string,
  llmSections: string[],
): SchemaQualityResult {
  const issues: string[] = [];
  const fieldCount = fields.length;

  // Use detected sections first; fall back to LLM-reported sections; fall back to complexity estimation
  const complexity = estimateTemplateComplexity(templateContent);
  let sectionsExpected = detectedSections.length;
  let sectionSource = "detected";

  if (sectionsExpected === 0 && llmSections.length > 0) {
    // Fallback 1: trust the LLM's own section list
    sectionsExpected = llmSections.length;
    sectionSource = "llm-reported";
  }

  if (sectionsExpected === 0 && complexity.isComplex) {
    // Fallback 2: use complexity estimation
    sectionsExpected = complexity.estimatedSections;
    sectionSource = "estimated";
  }

  // Absolute minimum: if content is substantial, expect at least 5 sections
  if (sectionsExpected < 5 && templateContent.length > 8000) {
    sectionsExpected = Math.max(sectionsExpected, 5);
    if (sectionSource === "detected") sectionSource = "length-floor";
  }

  const fieldSections = new Set(fields.map((f) => f.section.toLowerCase()));
  const sectionsCovered = fieldSections.size;

  const narrativeCount = fields.filter((f) => f.content_type === "narrative").length;

  // ── Field count checks ──

  // Hard floor: complex templates need at least 15 fields
  if (sectionsExpected >= 5 && fieldCount < 15) {
    issues.push(
      `Only ${fieldCount} fields for a template with ~${sectionsExpected} sections (${sectionSource}) — minimum 15 for complex forms`,
    );
  }

  // Density check: at least 1.5 fields per expected section
  if (sectionsExpected >= 5 && fieldCount < sectionsExpected * 1.5) {
    issues.push(
      `${(fieldCount / sectionsExpected).toFixed(1)} fields/section — expected ≥1.5 (${sectionSource})`,
    );
  }

  // ── Section coverage checks ──

  if (sectionsExpected >= 5 && sectionsCovered < Math.ceil(sectionsExpected * 0.5)) {
    issues.push(
      `Only ${sectionsCovered} sections covered out of ~${sectionsExpected} expected — many sections have no fields`,
    );
  }

  // ── Narrative checks ──
  const hasNarrativeContent =
    /narrative|summary|description|comments|explanation|notes|reason/i.test(templateContent);
  if (hasNarrativeContent && narrativeCount === 0) {
    issues.push("No narrative fields despite template containing narrative sections");
  }
  if (sectionsExpected >= 5 && hasNarrativeContent && narrativeCount < 2) {
    issues.push(
      `Only ${narrativeCount} narrative field(s) — complex templates with narrative sections should have ≥2`,
    );
  }

  // ── Distribution checks ──
  if (fieldCount >= 5) {
    const sectionCounts = new Map<string, number>();
    for (const f of fields) {
      const s = f.section.toLowerCase();
      sectionCounts.set(s, (sectionCounts.get(s) ?? 0) + 1);
    }
    const maxInOne = Math.max(...sectionCounts.values());
    if (maxInOne > fieldCount * 0.5 && sectionsExpected >= 5) {
      issues.push(
        `${maxInOne} of ${fieldCount} fields concentrated in one section — poor distribution`,
      );
    }
  }

  // ── Subgroup checks ──
  // If template mentions child/caretaker/family issues distinctly, check schema has them
  const hasChildIssues = /child\s+issues/i.test(templateContent);
  const hasCaretakerIssues = /caretaker\s+issues|caregiver\s+issues/i.test(templateContent);
  const hasFamilyIssues = /family\s+issues/i.test(templateContent);
  const issueSubgroups = [hasChildIssues, hasCaretakerIssues, hasFamilyIssues].filter(Boolean).length;

  if (issueSubgroups >= 2) {
    const fieldSectionsLower = Array.from(fieldSections);
    const fieldLabels = fields.map((f) => f.label.toLowerCase() + " " + f.field_key.toLowerCase());
    const allFieldText = [...fieldSectionsLower, ...fieldLabels].join(" ");

    const coveredSubgroups = [
      hasChildIssues && /child/i.test(allFieldText),
      hasCaretakerIssues && /caretaker|caregiver/i.test(allFieldText),
      hasFamilyIssues && /family/i.test(allFieldText),
    ].filter(Boolean).length;

    if (coveredSubgroups < issueSubgroups) {
      issues.push(
        `Template has ${issueSubgroups} distinct issue subgroups (child/caretaker/family) but only ${coveredSubgroups} represented in schema`,
      );
    }
  }

  // ── Absolute floor ──
  if (fieldCount < 5) {
    issues.push(`Only ${fieldCount} fields — absolute minimum is 5`);
  }

  return {
    pass: issues.length === 0,
    issues,
    fieldCount,
    sectionsCovered,
    sectionsExpected,
    narrativeCount,
    complexitySignals: complexity.signals,
  };
}

// ============================================================
// SCHEMA GENERATION (v2.1)
// ============================================================

async function generateSchemaFromTemplate(
  templateName: string,
  templateContent: string,
  templateMetadata: Record<string, unknown>,
  retryContext?: { issues: string[]; previousFieldCount: number },
): Promise<{ fields: SchemaField[]; model: string; sections: string[]; detectedSections: string[] }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = "gpt-4o";

  // Build context from template content and metadata
  const metaSections = templateMetadata.sections;
  let existingFieldsHint = "";
  if (Array.isArray(metaSections)) {
    const fieldNames: string[] = [];
    for (const section of metaSections) {
      if (!section || typeof section !== "object") continue;
      const fields = (section as Record<string, unknown>).fields;
      if (!Array.isArray(fields)) continue;
      for (const f of fields) {
        if (f && typeof f === "object" && typeof (f as Record<string, unknown>).field_key === "string") {
          fieldNames.push(
            `${(f as Record<string, unknown>).field_key}: ${(f as Record<string, unknown>).question ?? (f as Record<string, unknown>).label ?? ""}`,
          );
        }
      }
    }
    if (fieldNames.length > 0) {
      existingFieldsHint = `\n\nEXISTING TEMPLATE FIELDS (use these as a starting point):\n${fieldNames.join("\n")}`;
    }
  }

  const systemPrompt = `You are a schema designer for a social services case management system called AidMind.

Your task is to analyze a program template and produce a structured extraction schema that defines what factual information can safely be extracted from interview notes by a narrow local model.

CRITICAL: You must PRESERVE THE TEMPLATE'S REAL STRUCTURE. Complex templates have distinct sections, subsections, and field groups. Your schema must reflect this structure — do NOT flatten everything into a single flat list.

SECTION AND STRUCTURE RULES (CRITICAL):

1. "section" (REQUIRED): The major section of the template this field belongs to. Use the template's own section names when they exist. Examples: "Source Information", "Intake Narrative", "Child Issues", "Caretaker Issues", "Family Issues", "Emergency Services", "Demographics", "Decision Summary", "Services Required".

2. "field_group" (optional): A subsection or logical grouping within a section. Use when a section contains distinct subgroups. Examples: "Physical Address", "Mailing Address", "Primary Caretaker", "Secondary Caretaker", "Alleged Perpetrator".

3. "content_type" (REQUIRED): What kind of content this field holds:
   - "checkbox": A yes/no selection, checkmark, or boolean toggle
   - "categorical": A selection from a list of predefined options (single or multi-select)
   - "narrative": Free-text, description, summary, or authored language that may span multiple sentences
   - "factual": A specific fact like a name, date, number, or short factual phrase
   - "identifier": A sensitive identifier like SSN, ID number, phone, email, address

4. "field_purpose" (REQUIRED): An array of which downstream stages benefit from this field. Include one or more of:
   - "guidance": This field helps shape what questions to ask in an interview
   - "extraction": This field can be extracted from interview notes
   - "reviewer": This field is important for document review/audit
   Examples:
   - A narrative field about behavioral concerns → ["guidance", "extraction", "reviewer"]
   - A checkbox for "Pregnant: Yes/No" → ["extraction"]
   - A date of birth field → ["extraction"]
   - A free-text intake narrative → ["guidance", "extraction", "reviewer"]
   - A decision summary field → ["guidance", "reviewer"]

The local extraction model will NOT reason about the form. It will perform constrained matching:
- For categorical fields: select one or more allowed values
- For boolean fields: return true/false
- For numeric fields: extract a number
- For date fields: extract a date
- For text spans: copy exact text from notes
- For human-review fields: skip entirely

YOUR JOB is to classify each field carefully so the local model knows EXACTLY what to do.

FIELD CLASSIFICATION RULES:

1. matching_mode (CRITICAL — tells the local model how to match):
   - "select_one": field has a fixed set of allowed values, pick exactly one
   - "select_many": field has a fixed set of allowed values, pick one or more. Use this when the field naturally accepts multiple simultaneous values (e.g., sources of income, services seeking, substances used).
   - "boolean_decision": yes/no or true/false
   - "extract_number": extract a numeric value
   - "extract_date": extract a date
   - "extract_literal_span": copy an exact text span (name, ID, address line). The extraction model should return the SMALLEST sufficient span, not surrounding narrative.
   - "extract_short_text": extract a short factual phrase (1-5 words)
   - "human_review_only": do NOT auto-extract; too sensitive, ambiguous, or risky

2. sensitivity_level:
   - "high": SSN, insurance IDs, phone numbers, email addresses, exact addresses, emergency contact details, legal identifiers
   - "medium": names, dates of birth, employer info, income amounts
   - "low": general categorical questions (pregnant?, substance use?, housing type?)

3. ambiguity_level:
   - "high": field could easily be confused with another similar field, or notes rarely contain clear evidence
   - "medium": field is usually present but can be stated ambiguously
   - "low": field is typically stated clearly and unambiguously

4. extraction_priority:
   - "high": core intake data that is almost always present in notes
   - "medium": commonly available but may be missing
   - "low": rarely explicitly stated, or too sensitive to prioritize

5. requires_human_review — set to true for ANY of:
   - sensitivity_level = "high" (sensitive identifiers)
   - The field requires professional judgment
   - The field is structurally ambiguous
   - Mistakes would be costly or harmful

6. human_review_reason — when requires_human_review is true, explain WHY

7. DUPLICATE / SIMILAR FIELD HANDLING:
   - If the template has both physical and mailing address fields, prefix field_keys clearly
   - Make matching_guidance explicitly distinguish them
   - Set ambiguity_level = "high" for both

8. answer_type should be one of: "text", "categorical_single", "categorical_multi", "boolean", "date", "number"

9. fact_based = true ONLY if the field can be answered by direct factual statements in notes

10. A field CAN be fact_based = true AND requires_human_review = true simultaneously.

MATCHING_GUIDANCE QUALITY RULES (CRITICAL for extraction accuracy):

For select_many fields, matching_guidance MUST include:
- "Return ALL allowed values that are clearly supported by the notes, not just the first match."

For extract_literal_span fields, matching_guidance MUST include:
- "Return the smallest sufficient exact span — just the value itself."

For extract_date fields, matching_guidance MUST include:
- "Normalize the date to YYYY-MM-DD format."

For extract_short_text fields, matching_guidance MUST include:
- "Return compact factual content only, stripping narrative wrappers."

NARRATIVE FIELD RULES (CRITICAL):
- Templates often contain important narrative/free-text sections (e.g., "Intake Narrative", "Decision Summary", "Emergency Actions Taken", "Sensitive Case Comments")
- These MUST be represented as fields with content_type = "narrative" and matching_mode = "extract_short_text" or "extract_literal_span"
- Set field_purpose to include "guidance" and "reviewer" — these are high-value for both
- Do NOT skip narrative sections just because they are open-ended

SECTION COVERAGE RULES:
- Generate fields for ALL major sections of the template, not just the easiest ones
- If a template has 10+ sections, the schema should have fields from most of them
- Checkbox-heavy sections should generate select_many or boolean_decision fields
- Narrative sections should generate extract_short_text or extract_literal_span fields
- Identity/factual sections should generate appropriate literal_span or human_review_only fields

IMPORTANT: Do NOT mark all fields as safely extractable. Be conservative.
Expect that for a typical intake form:
- 30-60% of fields should be safely auto-extractable
- 20-40% should be fact-based but human-review-preferred
- 10-20% should require professional judgment

Return JSON:
{
  "sections": ["Section Name 1", "Section Name 2", ...],
  "fields": [
    {
      "field_key": "string (snake_case, disambiguated)",
      "label": "string (human-readable label)",
      "template_prompt": "string (original prompt from template)",
      "section": "string (section name from template)",
      "field_group": "string or null (subsection grouping)",
      "content_type": "checkbox|narrative|factual|identifier|categorical",
      "field_purpose": ["guidance", "extraction", "reviewer"],
      "fact_based": true/false,
      "answer_type": "text|categorical_single|categorical_multi|boolean|date|number",
      "matching_mode": "select_one|select_many|boolean_decision|extract_number|extract_date|extract_literal_span|extract_short_text|human_review_only",
      "allowed_values": ["array"] or null,
      "requires_direct_statement": true/false,
      "return_null_if_missing": true,
      "matching_guidance": "string",
      "examples": ["example 1", "example 2"],
      "requires_human_review": true/false,
      "human_review_reason": "string or null",
      "sensitivity_level": "low|medium|high",
      "ambiguity_level": "low|medium|high",
      "extraction_priority": "high|medium|low"
    }
  ]
}`;

  // Allow much more content through — gpt-4o has 128k context.
  // Complex intake forms can be 15-40k chars; truncating at 12k was the #1 cause of shallow schemas.
  const MAX_CONTENT_CHARS = 60000;
  const contentPreview = templateContent.length > MAX_CONTENT_CHARS
    ? templateContent.slice(0, MAX_CONTENT_CHARS) + "\n\n[... truncated ...]"
    : templateContent;

  // Pre-analyze: detect section headings to give the LLM explicit expectations
  const detectedSections = detectTemplateSections(templateContent);
  const sectionHint = detectedSections.length > 0
    ? `\n\nDETECTED TEMPLATE SECTIONS (${detectedSections.length} found — ensure each gets meaningful field representation):\n${detectedSections.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const fieldCountGuidance = detectedSections.length > 0
    ? `This template has approximately ${detectedSections.length} major sections. You should generate AT LEAST ${Math.max(detectedSections.length * 2, 15)} fields total, with at least 1-3 fields per section depending on section complexity. Sections with multiple checkboxes, subgroups, or distinct prompts should generate multiple fields. Do NOT produce fewer than ${Math.max(detectedSections.length, 10)} fields for a template this complex.`
    : `Generate a thorough set of fields. For templates with multiple sections, aim for 15-50+ fields depending on complexity.`;

  const userPrompt = `TEMPLATE NAME: ${templateName}

TEMPLATE CONTENT:
${contentPreview}
${existingFieldsHint}
${sectionHint}

FIELD COUNT GUIDANCE:
${fieldCountGuidance}

Analyze this template and produce the Phase 2 extraction schema.

CRITICAL REQUIREMENTS:
1. Preserve the template's real section structure. Generate fields for ALL major sections, not just the easy ones.
2. Include narrative/free-text sections as fields with content_type = "narrative".
3. Checkbox-heavy sections should decompose into MULTIPLE fields when they contain distinct subgroups (e.g., "Child Issues" vs "Caretaker Issues" vs "Family Issues" should be SEPARATE fields, not one catch-all).
4. Each major section should have AT LEAST 1-3 fields. Sections with many prompts or subgroups should have more.
5. Do NOT flatten a multi-section form into a handful of generic fields.
6. Narrative areas like "Intake Narrative", "Decision Summary", "Emergency Actions", "Sensitive Case Comments" must each be their own field.
7. Be conservative about auto-extraction. Sensitive identifiers, ambiguous duplicates, and rarely-documented fields should be marked requires_human_review = true.

Return JSON only.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const completion = await response.json();
  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("OpenAI returned empty content");
  }

  let parsed: { fields?: unknown; sections?: unknown };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }

  if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    throw new Error("OpenAI response missing or empty 'fields' array");
  }

  const sections = Array.isArray(parsed.sections) ? parsed.sections.map(String) : [];

  const VALID_MATCHING_MODES = new Set([
    "select_one", "select_many", "boolean_decision",
    "extract_number", "extract_date", "extract_literal_span",
    "extract_short_text", "human_review_only",
  ]);
  const VALID_SENSITIVITY = new Set(["low", "medium", "high"]);
  const VALID_PRIORITY = new Set(["high", "medium", "low"]);
  const VALID_CONTENT_TYPES = new Set(["checkbox", "narrative", "factual", "identifier", "categorical"]);
  const VALID_PURPOSES = new Set(["guidance", "extraction", "reviewer"]);

  // Validate/normalize fields
  const fields: SchemaField[] = parsed.fields.map((f: Record<string, unknown>) => {
    const requiresHumanReview = f.requires_human_review === true ||
      f.sensitivity_level === "high" ||
      f.matching_mode === "human_review_only";

    const rawMode = String(f.matching_mode ?? "extract_short_text");
    const matchingMode = VALID_MATCHING_MODES.has(rawMode) ? rawMode : "extract_short_text";

    const rawSensitivity = String(f.sensitivity_level ?? "low");
    const sensitivityLevel = VALID_SENSITIVITY.has(rawSensitivity) ? rawSensitivity as "low" | "medium" | "high" : "low";

    const rawAmbiguity = String(f.ambiguity_level ?? "low");
    const ambiguityLevel = VALID_SENSITIVITY.has(rawAmbiguity) ? rawAmbiguity as "low" | "medium" | "high" : "low";

    const rawPriority = String(f.extraction_priority ?? "medium");
    const extractionPriority = VALID_PRIORITY.has(rawPriority) ? rawPriority as "high" | "medium" | "low" : "medium";

    // Force human_review_only matching_mode for high-sensitivity fields
    const finalMatchingMode = (sensitivityLevel === "high" && matchingMode !== "human_review_only")
      ? "human_review_only"
      : matchingMode;

    // v2.1: section metadata
    const section = typeof f.section === "string" && f.section.trim().length > 0
      ? f.section.trim()
      : "General";

    const fieldGroup = typeof f.field_group === "string" && f.field_group.trim().length > 0
      ? f.field_group.trim()
      : null;

    const rawContentType = String(f.content_type ?? "factual");
    const contentType = VALID_CONTENT_TYPES.has(rawContentType)
      ? rawContentType as "checkbox" | "narrative" | "factual" | "identifier" | "categorical"
      : "factual";

    const rawPurpose = Array.isArray(f.field_purpose) ? f.field_purpose : ["extraction"];
    const fieldPurpose = rawPurpose
      .map(String)
      .filter((p: string) => VALID_PURPOSES.has(p));
    if (fieldPurpose.length === 0) fieldPurpose.push("extraction");

    return {
      field_key: String(f.field_key ?? ""),
      label: String(f.label ?? ""),
      template_prompt: String(f.template_prompt ?? ""),
      fact_based: f.fact_based === true,
      answer_type: String(f.answer_type ?? "text"),
      matching_mode: finalMatchingMode,
      allowed_values: Array.isArray(f.allowed_values) ? f.allowed_values.map(String) : null,
      requires_direct_statement: f.requires_direct_statement !== false,
      return_null_if_missing: f.return_null_if_missing !== false,
      matching_guidance: String(f.matching_guidance ?? ""),
      examples: Array.isArray(f.examples) ? f.examples.map(String) : [],
      requires_human_review: requiresHumanReview,
      human_review_reason: requiresHumanReview
        ? String(f.human_review_reason ?? "Requires manual verification")
        : null,
      sensitivity_level: sensitivityLevel,
      ambiguity_level: ambiguityLevel,
      extraction_priority: extractionPriority,
      section,
      field_group: fieldGroup,
      content_type: contentType,
      field_purpose: fieldPurpose,
    };
  });

  return { fields, model, sections, detectedSections };
}

// ============================================================
// MAIN HANDLER
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const sessionId = body.session_id;
  const templateId = body.template_id;

  if (!sessionId || typeof sessionId !== "string") {
    return json(400, { success: false, error: "session_id is required" });
  }
  if (!templateId || typeof templateId !== "string") {
    return json(400, { success: false, error: "template_id is required" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── 1. Check for existing active schema ──
    const { data: existingSchema, error: schemaErr } = await supabase
      .from("template_phase2_schemas")
      .select("id, schema_version, status, source_template_hash")
      .eq("template_id", templateId)
      .eq("is_active", true)
      .maybeSingle();

    if (schemaErr) {
      console.error(`[${SERVICE_NAME}] Schema lookup error:`, schemaErr.message);
      throw new Error(`Failed to look up existing schema: ${schemaErr.message}`);
    }

    // ── 2. Fetch template (needed for generation or hash check) ──
    const { data: template, error: templateErr } = await supabase
      .from("kb_templates")
      .select("id, tenant_id, name, content, content_hash, metadata")
      .eq("id", templateId)
      .maybeSingle();

    if (templateErr) throw new Error(`Failed to fetch template: ${templateErr.message}`);
    if (!template) return json(404, { success: false, error: "Template not found" });

    let schemaId: string;

    if (existingSchema && existingSchema.status === "ready") {
      const hashMatch = !template.content_hash || existingSchema.source_template_hash === template.content_hash;

      if (hashMatch) {
        schemaId = existingSchema.id;
        console.log(`[${SERVICE_NAME}] Reusing existing schema ${schemaId} (v${existingSchema.schema_version})`);
      } else {
        console.log(`[${SERVICE_NAME}] Template hash changed, regenerating schema`);
        await supabase
          .from("template_phase2_schemas")
          .update({ is_active: false, status: "archived", updated_at: new Date().toISOString() })
          .eq("id", existingSchema.id);

        schemaId = await generateAndStoreSchema(supabase, template, existingSchema.schema_version + 1);
      }
    } else {
      console.log(`[${SERVICE_NAME}] No active schema found, generating for template ${templateId}`);
      schemaId = await generateAndStoreSchema(supabase, template, 1);
    }

    // ── 3. Link schema to session ──
    const { error: linkErr } = await supabase
      .from("sessions")
      .update({ phase2_schema_id: schemaId, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    if (linkErr) {
      console.error(`[${SERVICE_NAME}] Failed to link schema to session:`, linkErr.message);
      throw new Error(`Failed to link schema to session: ${linkErr.message}`);
    }

    // ── Eye event ──
    try {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "phase2_schema.ensured",
        serviceName: SERVICE_NAME,
        payload: {
          template_id: templateId,
          schema_id: schemaId,
          action: existingSchema?.status === "ready" ? "reused" : "generated",
        },
      });
    } catch { /* never break on eye */ }

    return json(200, {
      success: true,
      schema_id: schemaId,
      action: existingSchema?.status === "ready" ? "reused" : "generated",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${SERVICE_NAME}] error:`, message);
    return json(500, { success: false, error: message });
  }
});

// ============================================================
// HELPER: Generate schema and store it
// ============================================================

async function generateAndStoreSchema(
  supabase: ReturnType<typeof createClient>,
  template: {
    id: string;
    tenant_id: string;
    name: string;
    content: string;
    content_hash: string | null;
    metadata: unknown;
  },
  version: number,
): Promise<string> {
  const MAX_ATTEMPTS = 2;
  let lastResult: { fields: SchemaField[]; model: string; sections: string[]; detectedSections: string[] } | null = null;
  let lastQuality: SchemaQualityResult | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateSchemaFromTemplate(
      template.name,
      template.content,
      (template.metadata as Record<string, unknown>) ?? {},
    );

    const quality = validateSchemaQuality(result.fields, result.detectedSections, template.content);
    lastResult = result;
    lastQuality = quality;

    if (quality.pass) {
      console.log(`[${SERVICE_NAME}] Schema quality passed on attempt ${attempt}: ${result.fields.length} fields, ${quality.sectionsCovered} sections covered, ${quality.narrativeCount} narrative`);
      break;
    }

    console.warn(`[${SERVICE_NAME}] Schema quality FAILED on attempt ${attempt}:`, quality.issues.join("; "));

    if (attempt < MAX_ATTEMPTS) {
      console.log(`[${SERVICE_NAME}] Retrying schema generation (attempt ${attempt + 1})...`);
    }
  }

  if (!lastResult) throw new Error("Schema generation produced no result");

  const { fields, model, sections, detectedSections } = lastResult;

  // Log quality warning if still failing after retries (but don't block — accept best effort)
  if (lastQuality && !lastQuality.pass) {
    console.warn(`[${SERVICE_NAME}] Accepting schema despite quality issues after ${MAX_ATTEMPTS} attempts: ${lastQuality.issues.join("; ")}`);
  }

  const now = new Date().toISOString();
  const factCount = fields.filter((f) => f.fact_based).length;
  const humanReviewCount = fields.filter((f) => f.requires_human_review).length;
  const autoExtractCount = fields.filter((f) => f.fact_based && !f.requires_human_review).length;
  const humanReviewOnlyCount = fields.filter((f) => f.matching_mode === "human_review_only").length;
  const narrativeCount = fields.filter((f) => f.content_type === "narrative").length;

  const qualityNote = lastQuality?.pass
    ? "quality: PASS"
    : `quality: WARN (${lastQuality?.issues.join("; ")})`;

  const schemaJson = {
    generated_at: now,
    schema_contract_version: "2.1",
    sections,
    detected_sections: detectedSections,
    quality: lastQuality ? {
      pass: lastQuality.pass,
      issues: lastQuality.issues,
      field_count: lastQuality.fieldCount,
      sections_covered: lastQuality.sectionsCovered,
      sections_expected: lastQuality.sectionsExpected,
      narrative_count: lastQuality.narrativeCount,
    } : null,
    fields,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("template_phase2_schemas")
    .insert({
      template_id: template.id,
      tenant_id: template.tenant_id,
      schema_version: version,
      status: "ready",
      is_active: true,
      schema_json: schemaJson,
      model,
      source_template_hash: template.content_hash,
      generation_notes: `v2.1 — ${fields.length} fields across ${sections.length} sections (${detectedSections.length} detected): ${autoExtractCount} auto-extractable, ${humanReviewCount} human-review, ${humanReviewOnlyCount} human-review-only, ${narrativeCount} narrative, ${factCount} fact-based total — ${qualityNote}`,
      generated_at: now,
    })
    .select("id")
    .single();

  if (insertErr) throw new Error(`Failed to store schema: ${insertErr.message}`);
  if (!inserted) throw new Error("Schema insert returned no data");

  console.log(`[${SERVICE_NAME}] Schema ${inserted.id} generated (v${version}, ${fields.length} fields across ${sections.length} sections, ${detectedSections.length} detected, ${autoExtractCount} auto-extractable, ${narrativeCount} narrative — ${qualityNote})`);
  return inserted.id;
}
