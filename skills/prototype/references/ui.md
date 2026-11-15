# UI prototype

Build several genuinely different versions of one piece of UI, render them behind a picker, and let the user flip through them live and choose.

The whole value is **divergence**. Three tints of one idea teach the user nothing. Each variant is a direction you could defend shipping on its own.

Divergence keeps the craft bar. Every variant fully works: real interactions, realistic content, the project's tokens, correct easing (`ease-out` on entrances), UI motion under 300ms outside modals, drawers and toasts, and reduced motion handled. A sloppy variant loses on execution and tells the user nothing about the direction it stands for.

## 1. Scope

One decision per run. Restate the brief in one sentence: what the piece is, where it lives, what it must do.

When a ticket holds several decisions, make **one run per decision**. Build one shared realistic context, and let each run swap a single piece of it while the others hold still. Give the fixed pieces the incumbent drawing first, then the user's picks as they land, so later runs are judged beside earlier choices.

## 2. Recon

Map what the variants stand on before designing:

- **Stack**: framework, styling system, motion library.
- **Tokens**: colors, radii, spacing, type, easing. Variants use them, so each looks like it could ship tomorrow.
- **Personality**: how far the boldest variant may go.
- **Context**: where the piece renders, beside what, at what sizes and in which themes.
- **Rules**: the project's design doc and any prototype convention.

With no project at all, build a single self-contained HTML file with a restrained look: neutral grays, one accent, the system font stack.

## 3. Choose directions

Default to **3 variants**, up to 5 when the design space is wide.

Before writing code, list each variant with a name and an **axis**: layout, density, interaction model, motion, personality. Names describe the direction ("Quiet", "Dense", "Swipe"), never "Option A". Two directions that differ only in accent color or copy are one direction; replace one.

**Done when** every variant has a name and a stated axis, and no two share an axis position.

## 4. Build the harness

- **Host**: mount the variants where the piece will really live. Prefer an existing page, so real navigation, data and density sit around them. Use a throwaway route only when no page can host the piece, and then build realistic surroundings: a toast needs a page behind it, a row needs siblings.
- **Files**: one file per variant plus a small harness, all inside the prototype's own directory.
- **One variant at a time, full size.** Side-by-side thumbnails distort spacing and scale.
- **Instant swap.** The variant change itself has no transition.
- **Picker**: copy [picker.md](picker.md) exactly. It is harness chrome, identical in every project, and never takes the project's tokens.
- **State that should survive a swap** (the open record, the scroll position) lives in the harness, above the variant, so the user compares like with like.
- **Development only.** Keep the picker and the route out of production builds.

## 5. Verify and hand off

Run it. Flip through every variant yourself in a real browser at the sizes and themes the product ships in, operate every control, and confirm the console is clean. Capture a screenshot of each variant when browser tooling exists.

Then present the set and stop:

| # | Variant | Axis | When it is the right choice | Its cost |
| --- | --- | --- | --- | --- |
| 1 | Quiet | Borders over shadows, minimal motion | A daily-use tool | Least memorable |

Sell each variant in one honest line and name its cost in another. Keep the table free of a favorite. Give a recommendation when the user asks for one, with a reason rooted in the product's use, and say plainly when two variants converged and one was cut. Close with the URL or file path and the keys that flip.

**Done when** every variant is reachable from the picker and behaves correctly, the console is clean, and each row states a real cost.

## 6. Riff or keep

- **Another round**: commit the current round to the throwaway branch first, so every variant shown stays recoverable. Then keep the harness, cut the variants the user ruled out, and build a fresh set that diverges *around* the direction they leaned toward.
- **A pick**: follow rule 6 of [the skill](../SKILL.md). Record the pick and the user's reasons, commit the prototype to its throwaway branch, and link the chosen files at a fixed commit from the implementation ticket.
- **Promotion**, when the user asks for it in the same session: rebuild the winner in its production location on the project's conventions and checks. Prototype code was written under prototype rules.

## Requests

| The user says | Do |
| --- | --- |
| a description | Scope, recon, 3 variants, picker, hand off |
| a description and a count, such as "x5" | The same with that many variants, capped at 5 |
| "riff on" a variant | A new round diverging around it |
| "keep" a variant | Record the pick and capture the prototype |
