# Logbook — project instructions

Personal hobby project of Aleš (free dive-logging app). **Not an mWork365 repo** — the mWork365 Jira/branch/PR conventions do NOT apply here. Plain branches and commit messages are fine; no Jira keys.

## Before implementing anything

Read [DESIGN.md](DESIGN.md) — it is the authoritative plan (scope, data model, sync protocol, milestones, decision log). The v1 field set and scope are frozen there; new ideas go to the post-release shelf (§9), not into v1. §10 is a decision log — don't relitigate settled decisions without new information.

## Quick facts

- Stack: Expo + TypeScript + `expo-router` (dev builds, not Expo Go) · `expo-sqlite` + Drizzle (source of truth, offline-first) · react-hook-form + Zod · NativeWind · react-native-maps · i18next (en + cs) · Supabase (auth, Postgres, sync RPCs).
- Conventions: SI units stored, converted at display · all dive fields nullable except date · client-generated UUIDv7 ids · synced tables carry `updated_at` + `deleted_at` · dive numbers are computed, never stored.
- Work proceeds milestone by milestone (M0 → M3, DESIGN.md §9).
- The styled design doc is a Claude artifact: https://claude.ai/code/artifact/e4dd99fa-ad16-4b3c-b91c-dfc550f4ed09 — when the plan changes, update DESIGN.md and the artifact together.
