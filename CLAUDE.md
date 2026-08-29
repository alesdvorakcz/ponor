# Ponor — project instructions

Personal hobby project of Aleš (free dive-logging app). **Not a work repo** — none of the work Jira/branch/PR conventions apply here. Plain branches and commit messages are fine; no ticket keys.

## Before implementing anything

Read [DESIGN.md](DESIGN.md) — it is the authoritative plan (scope, data model, sync protocol, milestones, decision log). The v1 field set and scope are frozen there; new ideas go to the post-release shelf (§9), not into v1. §10 is a decision log — don't relitigate settled decisions without new information. §0 holds the name, depth palette, and theme tokens; build against those token names, never colour literals.

## Quick facts

- Stack: Expo + TypeScript + `expo-router` (dev builds, not Expo Go) · `expo-sqlite` + Drizzle (source of truth, offline-first) · react-hook-form + Zod · NativeWind · react-native-maps · i18next (en + cs) · Supabase (auth, Postgres, sync RPCs).
- Conventions: SI units stored, converted at display · all dive fields nullable except date · client-generated UUIDv7 ids · synced tables carry `updated_at` + `deleted_at` · dive numbers are computed, never stored.
- Brand: the app is **Ponor** (`ponor.app`). Colour encodes depth and nothing else — controls stay monochrome, the primary button is inverted ink. Dark and light both ship from M0. No profile curve is ever drawn for a dive without a real sample series (§0.4).
- Work proceeds milestone by milestone (M0 → M3, DESIGN.md §9).
- Two Claude artifacts mirror the plan — a styled design doc and a visual-identity page. Their links are deliberately kept out of this public repo; find them with `/artifacts`. When the plan changes, update DESIGN.md and the relevant artifact together.
