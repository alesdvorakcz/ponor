-- Ponor · M2a · 1 of 3 — extensions
--
-- DESIGN.md §5 names two, and names them as *features of the database* rather than
-- app code: PostGIS answers "sites near me" and holds `dive_sites.location`; pg_trgm
-- powers the fuzzy autocomplete and the duplicate detection that keep the community
-- catalogue from filling with three spellings of one wreck.
--
-- Both go in the `extensions` schema, which is Supabase's own convention and where
-- their `search_path` already points. Nothing here is created in `public`, so the
-- catalogue of a Ponor project stays exactly the six tables of §6.
--
-- Re-running this file is a no-op. Safe to paste twice.

create schema if not exists extensions;

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
