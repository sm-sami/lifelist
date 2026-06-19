---
name: scaffold-screen
description: >-
  Generate a new Expo screen or component for the Lifelist mobile app, pre-wired with
  the project conventions: useTheme() (light/dark), safe-area insets, and Halyard type
  tokens. Use when adding a new screen, route, or UI component. Triggers: "scaffold a
  screen", "new component", "create a screen", "add a route".
allowed-tools:
  - Bash
  - Read
  - Edit
---

# scaffold-screen

Thin wrapper over the agent-agnostic `scripts/scaffold-screen.sh`. Generates a file that
already follows `AGENTS.md`'s rules (no `import { theme }`; reads `useTheme()`; safe-area
aware; Halyard `type` tokens) so new UI is consistent and light/dark-ready by default.

## Run
```bash
scripts/scaffold-screen.sh screen <Name>       # -> apps/mobile/app/<name>.tsx (default export, expo-router route)
scripts/scaffold-screen.sh component <Name>    # -> apps/mobile/components/<Name>.tsx (named export)
```
`<Name>` should be PascalCase (e.g. `Profile`, `StreakBadge`). The script refuses to
overwrite an existing file.

## Your job around it
1. Pick `screen` vs `component` from the request (a route under `app/` = screen).
2. Run the script, then **fill in the actual content** in the generated file — the
   template is just the themed skeleton (canvas/scroll/safe-area for screens; a themed
   card for components). Build out the real UI from there, keeping colors inline from
   `useTheme()` and layout in `StyleSheet.create` (see frontend/002 for the pattern).
3. For a new tab, also register it in `app/(tabs)/_layout.tsx`.

Don't hand-write the boilerplate — always scaffold first, then edit. Saves tokens and
keeps every new file on-convention.
