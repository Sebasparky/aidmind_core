

# Plan: Platform Progress Overview Page

## Objective
Create a temporary, internal-facing `/platform/progress` route that provides a comprehensive read-only snapshot of the Platform prototype development state. This is a meta-view for stakeholders, not a product surface.

---

## Implementation Details

### 1. New Route: `/platform/progress`

**File to create:** `src/components/platform/PlatformProgress.tsx`

**Add route to:** `src/pages/Platform.tsx`

```tsx
<Route path="progress" element={<PlatformProgress />} />
```

---

### 2. Page Structure & Sections

#### Section A: Header with Disclaimer Banner
- Title: "Platform Development Progress (Prototype Overview)"
- Banner: "This page summarizes frontend prototype state only. No backend logic is implemented."
- Styled as a warning/info banner to prevent confusion

#### Section B: Implemented Surfaces

**Platform Routes Table:**
| Surface | Status | Description | Data Source |
|---------|--------|-------------|-------------|
| Overview | Implemented | Coordination Health cards, throughput stats | Static JSON |
| Cases | Implemented | Case list with Timeline/Referrals/Documents tabs | Static JSON |
| Referrals | Implemented | Referral list with lifecycle stepper, SLA timer | Static JSON |
| Providers (CBOs) | Implemented | CBO directory with responsiveness metrics | Static JSON |
| Documents | Implemented | Document tracker with retention labels | Static JSON |
| Events & Audit | Implemented | Event explorer with retention model panel | Static JSON |

**Supervisor Integration Table:**
| Feature | Status | Notes |
|---------|--------|-------|
| Coordination event category | Implemented | Added to `EventCategory` type |
| Coordination filter pill | Implemented | In filters panel |
| Source badges | Implemented | System/Policy/Legacy/Coordination |
| Event detail drawer | Implemented | Includes "View in Platform" link |
| Mock coordination events | Implemented | 4 event types injected |

---

#### Section C: Feature Coverage vs PRD

Reference PRD features and map to current state:

| PRD Feature | UI Exists? | Notes |
|-------------|------------|-------|
| Unified Case Timeline | Yes | Read-only timeline tab in case detail drawer |
| Referral Lifecycle Engine (UI) | Yes | Visual lifecycle stepper, state history |
| Lightweight CBO Interaction (UI) | Partial | CBO directory exists; no secure link/action flow |
| Eye Event Emission (UI representation) | Yes | Coordination events appear in Supervisor feed |
| Audit / Event Explorer | Yes | Events & Audit page with filters |
| Policy & Permission indicators (UI only) | Partial | Retention labels shown; no permission UI |
| SLA Timers & Breach Detection | Yes | SLA status and timer displayed per referral |
| Document Flow Tracking | Yes | Document status with due dates shown |

---

#### Section D: Supervisor ("The Eye") Alignment Check

Display as a checklist with visual indicators:

- [x] No new supervisor tabs were created
- [x] Coordination signals appear inside existing event feed
- [x] Read-only guarantees are preserved
- [x] No PHI or case content exposed
- [x] "View in Platform" links to case timeline
- [x] Source badges distinguish event origins

---

#### Section E: Mocked vs Real

Clear breakdown table:

| Layer | Current State |
|-------|---------------|
| Data source | Fully mocked (static JSON in `mock-data.ts`) |
| State management | Client-side only (useState) |
| Filters/search | UI-only logic |
| Event injection | Mock coordination events merged with real DB events |
| Referral SLA logic | Display-only (no real calculation) |
| CBO acknowledgment | UI representation only (no backend action) |
| Document content | Never displayed (metadata only by design) |

---

#### Section F: Known Gaps (Frontend Only)

Explicitly list what is NOT built (by design):

**Out of scope for current prototype:**
- Real-time updates / subscriptions
- Backend persistence for Platform entities
- Authentication / role-based access
- Real SLA calculations (backend logic)
- Backend event ingestion from external systems
- Cross-agency routing logic
- Secure CBO participation links
- Document upload/download functionality
- Supervisor annotation persistence

---

### 3. Visual Design

- **Tone:** Internal/engineering review page, not marketing
- **Layout:** Single-column with clear section headers
- **Components:** 
  - Cards for each section
  - Tables with status badges
  - Checklist with check/warning icons
  - Info banners for disclaimers
- **Colors:** Neutral, using existing design system
- **No emojis, no marketing language**

---

### 4. Navigation

- Add to sidebar nav with "Progress" label (temporary)
- Badge: "Internal" to distinguish from product surfaces
- Link visible only in prototype mode (can hide later)

---

### 5. Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/platform/PlatformProgress.tsx` | Create |
| `src/pages/Platform.tsx` | Add route |
| `src/components/platform/PlatformLayout.tsx` | Add nav item (optional, marked as internal) |

---

## Summary

This Progress Overview page will:
1. Provide immediate visibility into what exists today
2. Map implementation to PRD requirements
3. Clearly distinguish mocked vs real components
4. Confirm Supervisor integration alignment
5. Document intentional gaps
6. Prevent stakeholder confusion about prototype status

The page is temporary and can be removed before production deployment.

