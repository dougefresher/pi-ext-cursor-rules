# AGENTS.md

## Purpose

This repo implements a Pi extension that applies Cursor-style project rules from `.cursor/rules/`.

Reference spec: `./cursor-rules.md` and https://cursor.com/docs/rules.md

## Code Flow (`index.ts`)

1. **Rule discovery/loading**
   - `reloadRules()` reads from: `.cursor/rules/`
   - Supports recursive `*.md` and `*.mdc`
   - Frontmatter parser extracts:
     - `alwaysApply: boolean`
     - `globs: string | string[]`
     - `description: string`

2. **Session init**
   - `session_start` sets `projectCwd` and loads rules
   - Shows a UI notification when rules are found

3. **Prompt augmentation**
   - `before_agent_start` reloads rules and appends guidance:
     - `alwaysApply: true` -> full rule content injected
     - `globs` present -> listed as file-specific enforced rules
     - `description` only -> listed as available/intelligent rules

4. **Enforcement**
   - `tool_call` intercepts `read`, `write`, `edit`
   - For files matching rule `globs`, operation is blocked until the full matching rule set is present in context
   - Uses `<file-rules ...>` tag + content hash to validate context freshness

## Scope / Non-goals

This extension intentionally covers the basic use-case only:
- No Team Rules behavior
- No remote rule import/sync
- No rule creation command (`/create-rule`-style workflow)
- No AGENTS.md parsing logic here (Pi handles AGENTS.md separately)

## Guardrails for Changes

- Keep behavior dependency-light and deterministic
- Prefer simple, explicit parsing over clever abstractions
- Preserve compatibility with both `.md` and `.mdc`
- Do not silently broaden scope beyond Cursor project-rule basics
- If changing enforcement behavior, keep the block/retry UX explicit in returned `reason`

## Dev

- Install deps: `bun install`
- Validate: `bun run check`
