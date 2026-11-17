-- Custom SQL migration file, put your code below! -----
-- A site's `entry` becomes a set (issue #31, DESIGN.md §6 and §10): a JSON array of the ways in,
-- NOT NULL and '[]' when nothing is known, kept under its singular name. The next migration is
-- drizzle-kit's own rebuild of `dive_sites` for the NOT NULL and the default, and it copies each
-- row across as it stands — which a NULL would fail, and which would leave a bare `shore` that no
-- reader can take for a set. So every value is made a set first, here, and the rebuild only
-- copies sets: nothing known (NULL or a blank) is '[]', a value already a JSON array is kept, and
-- any other value is the one member of its set.
update dive_sites set entry = case when entry is null or entry = '' then '[]' when json_valid(entry) and json_type(entry) = 'array' then entry else json_array(entry) end;
