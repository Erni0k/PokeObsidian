# Pokemon Collection Manager

Track your Pokémon Trading Card Game collection in plain Markdown, right inside your Obsidian vault — with card search, variant detection, live market prices, set completion, a gallery view and a dashboard.

[![Latest release](https://img.shields.io/github/v/release/Erni0k/PokeObsidian?sort=semver)](https://github.com/Erni0k/PokeObsidian/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Obsidian 1.5.0+](https://img.shields.io/badge/Obsidian-1.5.0%2B-7c3aed)
![Desktop and mobile](https://img.shields.io/badge/platform-desktop%20%7C%20mobile-lightgrey)

Card data, images and prices come from the free, open [TCGdex API](https://tcgdex.dev/). No account or API key is needed.

---

## Highlights

- **Your data stays Markdown.** Every collection is an ordinary table in an ordinary note. Edit it by hand, sync it, version it — the plugin only touches the region between its own markers.
- **Fast card entry.** Search by name, jump straight to a card with its set code and number (`DRI 062`), paste a Cardmarket link, or bulk-add a whole list in one go.
- **Real variants.** Only the printings a card actually has are offered (Normal, Reverse Holo, Holo, 1st Edition, Shadowless, stamped, jumbo …), plus free-text custom variants.
- **Market prices.** Cardmarket (EUR) or TCGplayer (USD), priced per variant and adjusted for condition. Graded slabs (PSA, CGC, BGS …) keep your own price.
- **Set completion.** Regular and master-set progress, the missing cards and the cost to complete.
- **Dashboard, gallery and price history.** Collection value over time, most valuable cards, biggest movers, breakdowns by set, rarity and condition, a binder view and per-card price charts.
- **Wishlist and trade lists.** Separate lists with their own totals, spare-copy detection and one-step moves into your collection.
- **CSV import and export.** Round-trips your own exports and reads Collectr, TCGplayer and Cardmarket files.
- **16 languages, offline-friendly, mobile-ready.** Responses are cached and reused offline, and all requests go through Obsidian's own network API.

## Quick start

1. Install the plugin (see [Installation](#installation)) and enable it in **Settings → Community plugins**.
2. Create a note inside the `Pokemon` folder (the default collection folder — configurable).
3. Open the command palette and run **Pokemon Collection Manager: Add card**.
4. Type `DRI 062` (or a card name), pick the card, choose the variant and condition, and click **Add to note**.
5. Run **Create dashboard note** to see your collection's statistics and charts.

A collection table looks like this — readable without the plugin, and safe to edit by hand:

```markdown
<!-- pokemon-collection:start -->
| Card | Set | Number | Variant | Cond | Grade | Lang | Qty | Price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Pikachu](https://www.cardmarket.com/…)<!--k:sv10-003:reverse:NM--> | Destined Rivals | 003 | reverse | NM |  | EN | 2 | €4.00 |
<!-- pokemon-collection:end -->
```

The full walkthrough is in **[Getting started](docs/getting-started.md)**.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Installation, your first collection note and first card |
| [Adding cards](docs/adding-cards.md) | Search, set code + number, Cardmarket links, bulk add, manual cards, variants, condition and grade |
| [The collection table](docs/collection-table.md) | Table format, columns, editing by hand, sorting, thumbnails |
| [Prices](docs/prices.md) | Price sources, condition multipliers, graded cards, updates, stale prices, price history |
| [Dashboard](docs/dashboard.md) | The `pokemon-dashboard` block: statistics and charts |
| [Set completion](docs/set-completion.md) | The `pokemon-set` block: regular and master sets, missing cards, cost to complete |
| [Gallery and binder](docs/gallery.md) | The `pokemon-gallery` block: card grid and 3×3 binder pages |
| [Wishlist and trade lists](docs/lists.md) | List types, moving cards, trade candidates |
| [CSV import and export](docs/csv.md) | Export format, supported apps, column mapping |
| [Commands](docs/commands.md) | Every command at a glance |
| [Settings](docs/settings.md) | Every setting and its default |
| [Data, network and privacy](docs/data-and-privacy.md) | Which files are stored and which services are contacted |
| [Troubleshooting and FAQ](docs/troubleshooting.md) | Common problems and answers |
| [Development](docs/development.md) | Building from source and the code architecture |

## Installation

### From Community plugins

The plugin is being prepared for the Obsidian Community plugins directory. Once it is listed, open **Settings → Community plugins → Browse**, search for *Pokemon Collection Manager*, then click **Install** and **Enable**.

### Manually

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Erni0k/PokeObsidian/releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/pokemon-collection/` (create the folder if needed).
3. Reload Obsidian and enable **Pokemon Collection Manager** in **Settings → Community plugins**.

### With BRAT (beta builds)

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, choose **Add beta plugin** and enter `Erni0k/PokeObsidian`.

## Network use and privacy

The plugin needs an internet connection to look up cards and prices. It contacts:

- **`api.tcgdex.net`** — card, set and price data;
- **`assets.tcgdex.net`** — card images and set symbols, when they are shown.

Cardmarket links are only opened when you click them. Nothing about your vault or your collection is sent anywhere, and there is no telemetry, no account and no ads. Details: [Data, network and privacy](docs/data-and-privacy.md).

## Support and contributing

Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/Erni0k/PokeObsidian/issues). Please include your Obsidian version, platform and, if possible, the card or set involved. To build from source, see [Development](docs/development.md).

## License and disclaimer

Released under the [MIT License](LICENSE).

This is an unofficial fan project. It is not affiliated with, endorsed or sponsored by Nintendo, Creatures, GAME FREAK, The Pokémon Company, Cardmarket or TCGplayer. Pokémon and all related names are trademarks of their respective owners. Card data and images are provided by [TCGdex](https://tcgdex.dev/).
