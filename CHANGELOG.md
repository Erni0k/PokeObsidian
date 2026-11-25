# Changelog

All notable changes to Pokemon Collection Manager. Versions follow [semantic versioning](https://semver.org/); each version is a [GitHub release](https://github.com/Erni0k/PokeObsidian/releases).

## [1.1.1] — 2026-11-25

### Added
- **Language per line in bulk add.** End a line with a language code to look the card up in that language, e.g. `sv7 055 JA`. English and Japanese (or any other language) cards can be mixed in one list. → [Bulk add](docs/adding-cards.md#bulk-add)
- **Helpful "unknown set" messages in bulk add.** When a set code doesn't exist in the line's language, the message names the languages that have it (*it exists in JA (ステラミラクル): add JA to the line*) and suggests the zero-padded English id (`sv7` → `sv07`).
- Ko-fi funding link in the plugin manifest.

## [1.1.0] — 2026-11-25

### Added
- **Set code + number lookup** — type `DRI 062` (or `sv10-062`, or a localized code like `RVD`) to jump straight to a card. A per-language set index recognises codes offline and announces newly released sets.
- **Set autocomplete** in the search window, following the selected language.
- **Accurate variants** — only the printings a card really has (Holo, Reverse Holo, 1st Edition, Shadowless, stamped, jumbo …), each priced separately.
- **Continuous add mode** — the search window stays open after each card.
- **Bulk add** from a list: `CODE NUMBER [xQTY] [variant] [condition] [grade]`.
- **Condition and grading** — NM/LP/MP/HP/DMG with adjustable price multipliers; graded cards (PSA, CGC, BGS …) keep a manual price.
- **TCGplayer (USD)** as a second price source, with per-row currencies (EUR and USD are never added together) and stale-price highlighting.
- **Per-card price history**, *Biggest movers* on the dashboard and the `pokemon-card` price chart block.
- **Set completion** — the `pokemon-set` block with regular and master set progress, missing cards and the cost to complete.
- **Gallery and binder view** — the `pokemon-gallery` block, including a full-set binder with missing slots.
- **Wishlist and trade lists** (`pokemon-list` frontmatter), *Move card to collection* and *Find trade candidates*.
- **CSV export and import**, supporting the plugin's own exports, Collectr, TCGplayer and Cardmarket.
- Full documentation in [`docs/`](docs/README.md).
- Automated releases with GitHub Actions, including a build provenance attestation.

### Changed
- Cardmarket links are always built from English card and set data, with a search link for cards that only exist in other languages.
- The settings tab uses Obsidian's section headings.
- Notes are written with `Vault.process`, so price updates no longer overwrite edits made while prices were loading.

### Fixed
- Table parsing on iOS older than 16.4 (an unsupported regular expression broke the plugin there).
- Prices written with thousands separators (`$1,234.56`) are read correctly.
- Cardmarket links with promo codes (`Pikachu-BOO23PAL-062`) are parsed correctly.
- Holo prices for holo-only cards.
- The plugin folder is derived from the vault's configuration folder instead of assuming `.obsidian`.

## [1.0.0] — 2026-08-18

First release: card search via TCGdex, collection tables in Markdown, variant selection, Cardmarket prices, sorting, the `pokemon-dashboard` block, adding cards from a Cardmarket link and manual cards.

[1.1.1]: https://github.com/Erni0k/PokeObsidian/releases/tag/1.1.1
[1.1.0]: https://github.com/Erni0k/PokeObsidian/releases/tag/1.1.0
[1.0.0]: https://github.com/Erni0k/PokeObsidian/releases/tag/1.0.0
