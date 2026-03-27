
# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

AidMind is a trust-first AI platform for human services and case management workflows. It is designed for sensitive environments where security, auditability, clarity, and operational realism matter more than flashy AI behavior.

The product should feel calm, credible, simple, and efficient. Do not make the UI feel overly chatbot-like, overly futuristic, or consumer-AI styled unless explicitly asked.

## Stack

- Frontend: React + TypeScript + Vite/SWC
- Backend: Supabase (PostgreSQL, Auth, Edge Functions)
- Background processing: Python workers
- PII redaction: Presidio microservice

## Core Commands

```bash
npm run dev
npm run build
npm run lint
npx vitest run
npx vitest run src/path/to/file.test.ts
cd presidio-service && docker-compose up -d
````

## **Architecture Notes**

- Frontend entry: src/main.tsx to src/App.tsx
- App providers are composed in App.tsx
- Auth state is resolved through Supabase and get_my_profile()
- Roles include caseworker, supervisor, and auditor
- Route protection uses RouteGuard
- DB types live in src/integrations/supabase/types.ts
- Edge Functions live in supabase/functions/
- Shared edge utilities live in supabase/functions/_shared/
- Background workers live in workers/
- Presidio service lives in presidio-service/


## **Important Product Principles**

- Trust, traceability, and operational safety matter more than novelty
- Simplicity is a feature
- Preserve a government-adjacent and healthcare-adjacent tone
- Do not make the product look or feel like a generic AI toy
- Preserve credibility and restraint in copy and design decisions

## **Editing Rules**

- Prefer small, surgical changes over broad refactors
- Do not change unrelated code while fixing a task
- Preserve existing architecture unless explicitly asked to redesign it
- Preserve naming conventions, file organization, and code style
- Do not add new dependencies unless clearly necessary
- Keep changes easy to review in git diff  

## **Frontend Rules**

- Preserve the existing design language unless explicitly asked to redesign
- Favor clean hierarchy, spacing, and clarity over decoration
- Avoid overly flashy UI, unnecessary motion, or AI-themed visuals
- Use existing components and patterns where possible
- Keep implementations production-oriented, not prototype-hacky

## **Backend and Supabase Safety Rules**

- Do not make schema, migration, auth, RLS, or edge-function changes unless explicitly asked
- Treat any production-facing Supabase change as high risk
- Preserve tenant isolation and row-level security assumptions
- Never expose service role keys in frontend code
- Never move sensitive logic client-side for convenience
- Avoid destructive SQL or irreversible data operations unless explicitly requested  

## **Security Rules**

- Preserve existing security controls
- Do not remove validation, sanitization, or safe rendering patterns
- Respect XSS protections, input validation, encryption boundaries, and least-privilege assumptions
- Service role key is only for trusted backend contexts, never frontend
## **Key Workflows**

- Session creation and management
- Guidance generation
- Knowledge base upload, extraction, chunking, and embedding
- Review workflows
- PII redaction through Presidio
## **How to Work**

When given a task:

1. First understand the smallest possible change that solves it
2. Identify the exact files that should be touched
3. Avoid touching backend or auth-related code unless needed
4. If a change is risky, explicitly say why
5. After edits, suggest sensible verification steps

## **Response Style for This Repo**

- Be practical and implementation-oriented
- Do not over-explain obvious code
- Flag risky assumptions clearly
- When unsure, choose the safest minimal path
- Keep outputs grounded in the actual repository structure