# Third-party notices

## Matt Pocock skills

`skills/to-spec` and `skills/to-tickets` are based on
[`mattpocock/skills`](https://github.com/mattpocock/skills), licensed under the
MIT License. Each skill directory includes a copy of the upstream license.

The current upstream baseline is `v1.2.0` (`2ffb184`), and the Codex metadata in
both skills is synchronized with that release. `to-spec` carries the release's
terminology cleanup; `to-tickets` carries its local-ticket and native-parent
behavior.

My changes are deliberately narrow:

- `to-spec` applies the `documentation` label instead of `ready-for-agent`.
- `to-tickets` preserves native parent/sub-issue relationships when the tracker
  supports them, and directs execution through the ticket frontier.
- Both replace em dashes with plain hyphens to match this repository's writing
  convention.

Other Matt Pocock skills I use stay installed from upstream and are not
republished here.

## DejaVu Sans

`skills/ui-evidence/assets/DejaVuSans.ttf` is part of the
[DejaVu fonts](https://dejavu-fonts.github.io/). DejaVu's own changes are in the
public domain; the underlying glyphs are covered by the Bitstream Vera and Arev
copyrights. The full license is at
`skills/ui-evidence/assets/DejaVuSans-LICENSE.txt`.

The font is bundled and referenced explicitly so annotation text renders
identically on every machine. Without it, output depends on whatever fonts the
host happens to have, and a container with none renders empty boxes.
