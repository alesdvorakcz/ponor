// `import '../../global.css'` in src/app/_layout.tsx needs a module declaration for
// *.css. Expo ships one in expo/types, but it only reaches the compiler through
// expo-env.d.ts — which Expo generates and gitignores. So it exists locally and is
// absent on a fresh checkout, and typecheck passes on a developer machine while
// failing in CI. Referencing expo/types from a committed file closes that gap.
//
// Found by CI on its first run, after Task 5 introduced the stylesheet import.
/// <reference types="expo/types" />
