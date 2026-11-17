# Ponor — project instructions

Personal hobby project of Aleš (free dive-logging app). **Not a work repo** — none of the work Jira/branch/PR conventions apply here. No Jira keys; the backlog is this repo's GitHub issues (below).

## Before implementing anything

Read [DESIGN.md](DESIGN.md) — it is the authoritative plan (scope, data model, sync protocol, milestones, decision log). The v1 field set and scope are frozen there; new ideas go to the post-release shelf (§9), not into v1. §10 is a decision log — don't relitigate settled decisions without new information. §0 holds the name, depth palette, and theme tokens; build against those token names, never colour literals.

## Quick facts

- Stack: Expo + TypeScript + `expo-router` (dev builds, not Expo Go) · `expo-sqlite` + Drizzle (source of truth, offline-first) · react-hook-form + Zod · `StyleSheet` from the §0.2 tokens (no NativeWind — see §10) · react-native-maps · i18next (en + cs) · Supabase (auth, Postgres, sync RPCs).
- Conventions: SI units stored, converted at display · all dive fields nullable except date · client-generated UUIDv7 ids · synced tables carry `updated_at` + `deleted_at` · dive numbers are computed, never stored.
- Brand: the app is **Ponor** (`ponor.app`). Colour encodes depth and nothing else — controls stay monochrome, the primary button is inverted ink. Dark and light both ship from M0. No profile curve is ever drawn for a dive without a real sample series (§0.4).
- Work proceeds milestone by milestone (M0 → M3, DESIGN.md §9); since 2026-11-14 what is left is tracked as GitHub issues.
- Two Claude artifacts mirror the plan — a styled design doc and a visual-identity page. Their links are deliberately kept out of this public repo; find them with `/artifacts`. When the plan changes, update DESIGN.md and the relevant artifact together.

## The visual target

A third Claude artifact is the design canvas **"Dive app design system"** — the owner's visual target for every screen. Find it with `/artifacts` and read it with the Artifact tool; its link stays out of this repo too. Page *Ponor Reference* is the overview; the 21 screens, in dark and light with spec notes and a "New values to tokenise" list, sit on one page per group (*Ponor A Core screens* … *Ponor G Account*); page *Ponor Flows* has the task flows, and boards still being decided live on *Ponor Work in progress*. Bringing a screen to the canvas means reading its screen there first. Values it introduces become styles/tokens (never literals), and DESIGN.md §0.6 / §10 record what changed and every deliberate departure — the canvas also draws post-v1 things (filters, buddy tagging, a tablet rail) that are not v1 scope, and a few of its choices are overruled by §0.1's rules (an aggregate depth takes no band colour).

**Design first, on the canvas.** An issue that adds or changes what a screen shows starts with a board on the canvas's *Work in progress* page: the real screens it touches, dark and light, every state that matters, and options side by side when a look is open, with a recommendation and any DESIGN.md rule a pick bends named. Aleš approves the board before any code; the issue body then records the decisions, and the settled board moves to its group's page when the PR merges.

## Backlog, branches and PRs

- **Open work lives in GitHub issues** (`gh issue list`). Start a task by reading its issue in full: `gh issue view <n> --comments`. DESIGN.md stays the record of what is decided and why; an issue is what is left to do. A PR that settles something updates DESIGN.md (§0.6, §9, §10 as fits) in the same change, as before.
- **Labels:** `design` — a screen or control brought to the canvas, or a design decision · `needs-owner` — needs an account, a key, a device or a decision from Aleš; do what a session can and stop there, saying exactly what is needed · plus `bug`, `enhancement`, `documentation`.
- **One issue → one branch `issue-<n>-<slug>` → one PR** whose body says `Closes #<n>`. CI runs on the PR and Aleš merges; issue work does not go to `main` directly.
- **Issues, PRs and commits are public.** Never put artifact links, Supabase project URLs or keys, Apple/Google account ids, or personal data (real dive times and places) in them.
- Something found along the way that is not this issue's job: propose a new issue (ask before filing) rather than widening the PR. Post-v1 ideas stay on §9's shelf until they are next.
- Parallel sessions collide on DESIGN.md §10, `src/theme/styles.ts` and the i18n files. Rebase on `main` before opening the PR.
