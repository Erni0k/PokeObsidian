# Data, network and privacy

## Where your data lives

| Data | Location | Can it be rebuilt? |
| --- | --- | --- |
| **Your collection** — which cards, variants, conditions, quantities and prices | The Markdown tables in your notes | It *is* the source of truth — back it up like any note |
| Settings | `.obsidian/plugins/pokemon-collection/data.json` | Re-enter in settings |
| Card metadata — images, rarity, market prices, Cardmarket links | `meta.json` in the plugin folder | Yes, by updating prices |
| Price history and value snapshots | `price-history.json` in the plugin folder | No — history is recorded over time |
| Cached TCGdex responses | `cache.json` in the plugin folder | Yes, automatically |
| Set index — set names and codes per language | `sets-index.json` in the plugin folder | Yes, with *Rebuild Pokémon set index* |
| Set completion data | `set-completion.json` in the plugin folder | Yes, with *Refresh prices* in the set block |

(The plugin folder is inside your vault's configuration folder, `.obsidian` by default.)

To keep your price history when moving to another device, include `price-history.json` in your sync or backup. Everything else can be recreated.

## Network requests

The plugin works offline with cached data, and contacts these services when it needs new data:

| Host | Used for | When |
| --- | --- | --- |
| `api.tcgdex.net` | Card, set and price data | Searching, adding cards, updating prices, loading sets |
| `assets.tcgdex.net` | Card images and set symbols | When images are displayed |

All requests are read-only. They contain only what is being looked up — a card id, a set id, a search term or a language — and are made through Obsidian's built-in network API.

Links to **cardmarket.com** are written into your tables and opened only when you click them. The plugin does not contact Cardmarket or TCGplayer itself; their prices reach the plugin through TCGdex.

## What is not collected

- No analytics or telemetry.
- No account, sign-in or API key.
- No ads.
- Nothing about your vault, notes or collection is uploaded.

## Third-party services

Card data and images are provided by [TCGdex](https://tcgdex.dev/), a free and open-source project; see its website for its terms and privacy information. Market prices are published by TCGdex from Cardmarket and TCGplayer data.
