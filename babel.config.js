// This file exists for one reason: to add babel-plugin-inline-import for drizzle's .sql
// migrations. Without a babel.config.js at all, Expo SDK 57 falls back to
// babel-preset-expo automatically — but the moment this file exists, that automatic
// fallback is gone, so the preset must be named explicitly below or every other
// transform in the app (JSX, TypeScript, path aliases, …) breaks in ways that look
// unrelated to this change.
//
// drizzle's generated migrations.js does `import m0000 from './0000_..._.sql'` and then
// calls `.split('--> statement-breakpoint')` on m0000, so the import must resolve to the
// file's contents as a string. metro.config.js's `sourceExts.push('sql')` only makes
// Metro hand .sql files to Babel as source modules; Babel itself has no idea what to do
// with SQL syntax. inline-import is what actually turns the file into a string literal
// at build time — inlining it, because a device has no filesystem to read the file from
// at runtime.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
