# Third-party notices

## DejaVu Sans

`skills/annotated-screenshots/assets/DejaVuSans.ttf` is part of the
[DejaVu fonts](https://dejavu-fonts.github.io/). DejaVu's own changes are in the
public domain; the underlying glyphs are covered by the Bitstream Vera and Arev
copyrights. The full license is at
`skills/annotated-screenshots/assets/DejaVuSans-LICENSE.txt`.

The font is bundled and referenced explicitly so annotation text renders
identically on every machine. Without it, output depends on whatever fonts the
host happens to have, and a container with none renders empty boxes.

## Matt Pocock skills

`skills/to-spec` and `skills/to-tickets` are based on
[`mattpocock/skills`](https://github.com/mattpocock/skills), licensed under the
MIT License. Each skill directory includes a copy of the upstream license.

The current upstream baseline is `v1.2.0` (`2ffb184`). The Codex metadata in
both customized skills is synchronized with that release. The `to-spec` copy
also carries its v1.2.0 terminology cleanup while retaining the local
`documentation` label; `to-tickets` already carries the release's local-ticket
and native-parent behavior plus Nick's tracker-frontier adjustments.

Nick's changes are intentionally narrow:

- `to-spec` applies the `documentation` label instead of `ready-for-agent`.
- `to-tickets` preserves native parent/sub-issue relationships when the tracker
  supports them and directs execution through the ticket frontier.
- Both skills replace em dashes with plain hyphens to match the repository's
  writing convention.

All other retained Matt Pocock skills remain installed from their upstream
source and are not republished here.
