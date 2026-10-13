/**
 * generate-parser-artifacts Edge Function
 *
 * Generates and caches template-level parser artifacts (section map, skeleton,
 * checkbox groups, narrative regions) for deterministic completed-template parsing.
 *
 * Called once per template. Artifacts are reused across all sessions using that template.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";

const SERVICE_NAME = "generate-parser-artifacts";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errJson(status: number, code: string, message: string) {
  return json(status, { error: { code, message } });
}

// ── Deterministic section detection ──────────────────────────────────────

interface DetectedSection {
  name: string;
  order: number;
  type: string;
  start_patterns: string[];
  field_anchors: string[];
  has_repeated_blocks: boolean;
  expected_repeat_count?: number;
}

function detectSections(content: string): DetectedSection[] {
  const sections: DetectedSection[] = [];
  const seen = new Set<string>();
  let order = 0;

  // ── Pass 0: Inline section extraction ──────────────────────────────
  // PDF-extracted templates often have section headers mid-line.
  // Pre-scan the entire content for "SECTION N: Title" patterns anywhere,
  // not just at line starts.
  const inlineSectionRe = /(?:SECTION|Section)\s+(\d+)\s*[:.\-–—]\s*([A-Za-z][A-Za-z0-9\s&,/()]+)/g;
  let inlineMatch: RegExpExecArray | null;
  const inlineHits: Array<{ num: number; name: string; pos: number }> = [];
  while ((inlineMatch = inlineSectionRe.exec(content)) !== null) {
    const rawName = inlineMatch[2].replace(/[\s:\-–—.]+$/, "").trim();
    if (rawName.length >= 3) {
      inlineHits.push({ num: parseInt(inlineMatch[1], 10), name: rawName, pos: inlineMatch.index });
    }
  }

  // Dedupe by name, keep first occurrence, sort by position
  const seenInline = new Set<string>();
  const dedupedHits = inlineHits.filter(h => {
    const key = h.name.toLowerCase().replace(/\s+/g, " ");
    if (seenInline.has(key)) return false;
    seenInline.add(key);
    return true;
  }).sort((a, b) => a.pos - b.pos);

  for (const hit of dedupedHits) {
    const name = hit.name.replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let type = "general";
    if (/\b(narrative|description|summary|reason|comment)\b/.test(key)) type = "narrative";
    else if (/\b(checkbox|concern|issue|service|behavior)\b/.test(key)) type = "checkbox_group";
    else if (/\b(demographic|person|individual|participant)\b/.test(key)) type = "demographics";
    else if (/\b(decision|determination|recommendation|disposition)\b/.test(key)) type = "decision";
    else if (/\b(signature|sign|approval)\b/.test(key)) type = "signature";
    else if (/\b(relationship|matrix|family)\b/.test(key)) type = "relationship_matrix";

    const hasRepeated = /\b(person|individual|participant|child)\b/i.test(key) && type === "demographics";
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    sections.push({
      name,
      order: order++,
      type,
      start_patterns: [escapedName, `SECTION\\s+${hit.num}\\s*[:\\.\\-–—]\\s*${escapedName}`],
      field_anchors: [],
      has_repeated_blocks: hasRepeated,
      expected_repeat_count: hasRepeated ? 3 : undefined,
    });
  }

  // ── Pass 1: Line-by-line fallback for non-"SECTION N:" formats ─────
  const lines = content.split("\n");

  const linePatterns = [
    /^#{1,3}\s+(.+)/,
    /^\d+\.\s+([A-Z][A-Za-z\s&,/]+)/,
    /^[A-Z]\.\s+([A-Z][A-Za-z\s&,/]+)/,
    /^([A-Z][A-Z\s]{5,})$/,
    /^(?:PART|Part)\s+[\dIVX]+[\s:\-–—]+(.+)/,
    /^\*\*(.+?)\*\*/,
    /^-{3,}\s*(.+?)\s*-{3,}$/,
    /^([A-Z][a-zA-Z\s/&]+):\s*$/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 3 || line.length > 120) continue;

    for (const pat of linePatterns) {
      const m = pat.exec(line);
      if (!m) continue;
      let name = (m[1] || line).replace(/[\s:\-–—.]+$/, "").trim();
      if (name.length < 3) continue;

      name = name.replace(/\s+/g, " ");
      const key = name.toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);

      let type = "general";
      if (/\b(narrative|description|summary|reason|comment)\b/.test(key)) type = "narrative";
      else if (/\b(checkbox|concern|issue|service|behavior)\b/.test(key)) type = "checkbox_group";
      else if (/\b(demographic|person|individual|participant)\b/.test(key)) type = "demographics";
      else if (/\b(decision|determination|recommendation|disposition)\b/.test(key)) type = "decision";
      else if (/\b(signature|sign|approval)\b/.test(key)) type = "signature";
      else if (/\b(relationship|matrix|family)\b/.test(key)) type = "relationship_matrix";

      const hasRepeated = /\b(person|individual|participant|child)\b/i.test(key) && type === "demographics";
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      sections.push({
        name,
        order: order++,
        type,
        start_patterns: [escapedName],
        field_anchors: [],
        has_repeated_blocks: hasRepeated,
        expected_repeat_count: hasRepeated ? 3 : undefined,
      });
      break;
    }
  }

  return sections;
}

// ── Checkbox group detection ─────────────────────────────────────────────

interface CheckboxGroup {
  section: string;
  group_name: string;
  options: string[];
  has_other_option: boolean;
  subgroup?: string;
}

function detectCheckboxGroups(content: string, sections: DetectedSection[]): CheckboxGroup[] {
  const groups: CheckboxGroup[] = [];
  const lines = content.split("\n");
  let currentSection = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track current section
    for (const sec of sections) {
      if (line.toLowerCase().includes(sec.name.toLowerCase())) {
        currentSection = sec.name;
        break;
      }
    }

    // Detect checkbox patterns: [ ] Option, ☐ Option, □ Option
    if (/^[\[☐☑□■✓✗✘\(]/.test(line) || /^\s*[xX✓☑]\s/.test(line)) {
      // Look backward for group label
      let groupName = currentSection;
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prevLine = lines[j].trim();
        if (prevLine.endsWith(":") || /^[A-Z]/.test(prevLine)) {
          groupName = prevLine.replace(/:$/, "").trim();
          break;
        }
      }

      // Collect consecutive checkbox lines
      const options: string[] = [];
      let k = i;
      while (k < lines.length) {
        const cbLine = lines[k].trim();
        const optMatch = cbLine.match(/^[\[☐☑□■✓✗✘\(][\s\]xX✓]*\)?\s*(.+)/);
        if (!optMatch && options.length > 0) break;
        if (optMatch) options.push(optMatch[1].trim());
        k++;
      }

      if (options.length >= 2) {
        groups.push({
          section: currentSection,
          group_name: groupName,
          options,
          has_other_option: options.some((o) => o.toLowerCase() === "other" || o.toLowerCase().startsWith("other")),
        });
        i = k - 1; // Skip processed lines
      }
    }
  }

  return groups;
}

// ── Narrative region detection ───────────────────────────────────────────

interface NarrativeRegion {
  section: string;
  label: string;
  may_span_pages: boolean;
  content_indicators: string[];
}

function detectNarrativeRegions(sections: DetectedSection[]): NarrativeRegion[] {
  return sections
    .filter((s) => s.type === "narrative")
    .map((s) => ({
      section: s.name,
      label: s.name,
      may_span_pages: true,
      content_indicators: ["narrative", "description", "explain", "describe"],
    }));
}

// ── Scaffold line hashing ────────────────────────────────────────────────

function computeScaffoldHashes(content: string): string[] {
  const lines = content.split("\n");
  const hashes: string[] = [];
  const scaffoldPatterns = [
    /^\s*page\s+\|?\s*\d+/i,
    /^\s*\d+\s*\|\s*page/i,
    /^\s*general\s+instructions/i,
    /^\s*confidential/i,
    /^\s*form\s+#?\d/i,
    /^\s*revised\s+\d/i,
    /^\s*approved\s+by/i,
    /^\s*-{3,}\s*$/,
    /^\s*={3,}\s*$/,
    /^\s*_{3,}\s*$/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const isScaffold = scaffoldPatterns.some((p) => p.test(trimmed));
    // Also hash static instruction lines (long lines with no data indicators)
    const isInstruction = trimmed.length > 50 && !/\b(name|date|phone|address|number)\b/i.test(trimmed) &&
      !/:/.test(trimmed) && /\b(please|must|should|complete|enter|provide)\b/i.test(trimmed);

    if (isScaffold || isInstruction) {
      hashes.push(trimmed.toLowerCase().replace(/\s+/g, " "));
    }
  }

  return hashes;
}

// ── Simple hash ──────────────────────────────────────────────────────────

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Main handler ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errJson(405, "METHOD_NOT_ALLOWED", "POST only");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const templateId = body.template_id as string;
  const force = body.force === true;

  if (!templateId || !UUID_RE.test(templateId)) return errJson(400, "INVALID_TEMPLATE_ID", "template_id required");

  // ── Authenticate caller; tenant comes from membership, never from the body ──
  const auth = await requireUser(req, supabase);
  if (!auth.ok) return errJson(auth.status, "UNAUTHORIZED", auth.error);
  const tenantRes = requireTenantFor(auth.caller, body.tenant_id);
  if (!tenantRes.ok) return errJson(tenantRes.status, "TENANT_ACCESS_DENIED", tenantRes.error);
  const tenantId = tenantRes.tenantId;

  try {
    // Fetch template content
    const { data: template, error: tErr } = await supabase
      .from("kb_templates")
      .select("id, name, content, content_hash")
      .eq("id", templateId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tErr) throw new Error(`DB error: ${tErr.message}`);
    if (!template) return errJson(404, "TEMPLATE_NOT_FOUND", "Template not found");
    if (!template.content || template.content.trim().length < 50) {
      return errJson(400, "TEMPLATE_TOO_SHORT", "Template content too short for artifact generation");
    }

    const contentHash = await hashContent(template.content);

    // Check for existing active artifact with same hash
    if (!force) {
      const { data: existing } = await supabase
        .from("template_parser_artifacts")
        .select("id, artifact_json")
        .eq("template_id", templateId)
        .eq("is_active", true)
        .eq("source_template_hash", contentHash)
        .maybeSingle();

      if (existing) {
        return json(200, {
          status: "exists",
          artifact_id: existing.id,
          message: "Active parser artifact already exists for this template version",
        });
      }
    }

    // Generate artifact deterministically
    const sections = detectSections(template.content);
    const checkboxGroups = detectCheckboxGroups(template.content, sections);
    const narrativeRegions = detectNarrativeRegions(sections);
    const scaffoldHashes = computeScaffoldHashes(template.content);

    // Build section header map
    const sectionHeaderMap: Record<string, string> = {};
    for (const sec of sections) {
      sectionHeaderMap[sec.name.toLowerCase()] = sec.name;
    }

    // Decision regions
    const decisionRegions = sections.filter((s) => s.type === "decision").map((s) => s.name);
    // Signature markers
    const signatureMarkers = sections.filter((s) => s.type === "signature").map((s) => s.name);
    // Repeated blocks
    const repeatedBlocks = sections
      .filter((s) => s.has_repeated_blocks)
      .map((s) => ({
        section: s.name,
        label_pattern: `Person {n}`,
        inner_fields: ["name", "date_of_birth", "gender", "relationship"],
        max_repeats: s.expected_repeat_count || 3,
      }));

    const artifactJson = {
      artifact_schema_version: 1,
      template_name: template.name,
      source_template_hash: contentHash,
      blank_template_skeleton: template.content,
      sections,
      section_header_map: sectionHeaderMap,
      checkbox_groups: checkboxGroups,
      narrative_regions: narrativeRegions,
      repeated_blocks: repeatedBlocks,
      decision_regions: decisionRegions,
      signature_markers: signatureMarkers,
      scaffold_line_hashes: scaffoldHashes,
      parser_hints: {},
    };

    // Deactivate old artifacts
    await supabase
      .from("template_parser_artifacts")
      .update({ is_active: false })
      .eq("template_id", templateId)
      .eq("is_active", true);

    // Insert new artifact
    const { data: inserted, error: insErr } = await supabase
      .from("template_parser_artifacts")
      .insert({
        template_id: templateId,
        tenant_id: tenantId,
        source_template_hash: contentHash,
        artifact_version: 1,
        is_active: true,
        status: "active",
        artifact_json: artifactJson,
        generation_notes: `Deterministic: ${sections.length} sections, ${checkboxGroups.length} checkbox groups, ${narrativeRegions.length} narrative regions`,
        generated_at: new Date().toISOString(),
        model: "deterministic-v1",
      })
      .select("id")
      .single();

    if (insErr) throw new Error(`Insert error: ${insErr.message}`);

    await logEyeEvent(supabase, {
      session_id: null,
      event_type: "parser_artifact.generated",
      serviceName: SERVICE_NAME,
      payload: {
        template_id: templateId,
        artifact_id: inserted.id,
        sections_count: sections.length,
        checkbox_groups_count: checkboxGroups.length,
        narrative_regions_count: narrativeRegions.length,
        scaffold_lines: scaffoldHashes.length,
      },
    });

    return json(200, {
      status: "generated",
      artifact_id: inserted.id,
      sections_count: sections.length,
      checkbox_groups_count: checkboxGroups.length,
      narrative_regions_count: narrativeRegions.length,
      scaffold_lines_count: scaffoldHashes.length,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SERVICE_NAME}] error:`, message);
    return errJson(500, "GENERATION_FAILED", message.slice(0, 500));
  }
});
