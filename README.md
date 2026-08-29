# Ponor

A free, offline-first dive log for iOS, Android, and tablets that *fills itself in* — after the first dive of a trip, you only touch what changed.

> **ponor** — Czech for the submersion itself, the depth to which a thing sinks. In English, the karst opening where a surface stream leaves the daylight and becomes a subterranean river.

**Status:** M0 complete — the app builds and runs on iOS with its design system in place. No dive logging yet; that is M1.

The full architecture, data model, and roadmap live in [DESIGN.md](DESIGN.md). The name, depth palette, and theme tokens are in [§0](DESIGN.md#0-name--visual-identity), and [§10](DESIGN.md#10-decision-log) records why each significant choice was made.

## Running it

Requires Node 22 (see `.nvmrc`) and, for iOS, Xcode with an iOS simulator runtime installed.

```bash
npm ci          # applies patches/ via postinstall — see patches/README.md
npm run ios     # builds and launches in a simulator
```

```bash
npm test        # unit tests
npm run typecheck   # app and test programs
npm run lint
```
