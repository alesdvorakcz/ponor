-- Ponor · M2a · 1 of 3 — extensions
--
-- DESIGN.md §5 names two, and names them as *features of the database* rather than
-- app code: PostGIS answers "sites near me" and holds `dive_sites.location`; pg_trgm
-- powers the fuzzy autocomplete and the duplicate detection that keep the community
-- catalogue from filling with three spellings of one wreck.
--
-- **`unaccent` is the third, and §5 named it by consequence rather than by name** (M2j).
-- §10 has required since M1 that `zelezna` finds `Železná`, and `domain/search.ts` owns
-- the client half. Without this extension the server half does not exist: trigram
-- similarity is *accidentally* tolerant of an accent and not deliberately so — measured
-- on the owner's own project, `similarity('Sarka','Šárka')` is 0.333 against a match
-- floor of 0.3, which is one accent's worth of slack on a five-letter word. *Divoká
-- Šárka* typed as *Divoka Sarka* has two and falls straight through. So the same query
-- would get one answer on the device and a different, worse one from the server —
-- exactly for the Czech names the feature exists to find.
--
-- All three go in the `extensions` schema, which is Supabase's own convention and where
-- their `search_path` already points. Nothing here is created in `public`, so the
-- catalogue of a Ponor project stays exactly the six tables of §6.
--
-- `unaccent` brings a text-search dictionary of the same name along with its functions,
-- and that dictionary is what `public.name_fold` (file 6) names explicitly rather than
-- resolving through a search path. See the block above that function for why the naming
-- is what makes an IMMUTABLE marking honest, and therefore what makes an index possible.
--
-- Re-running this file is a no-op. Safe to paste twice.

create schema if not exists extensions;

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
