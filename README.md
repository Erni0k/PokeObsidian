# Pokémon Collection Manager for Obsidian

Manage a Pokémon TCG collection directly inside your Obsidian vault, powered by the [TCGdex API](https://tcgdex.dev/). Cards are stored as a portable Markdown table; everything else (images, rarity, prices, history) lives in JSON caches next to the plugin.

## Design principles

- **Markdown is the source of truth.** Each collection note holds a Markdown table between hidden markers. You can edit it by hand and nothing breaks.
- **JSON is only a cache.** Card metadata, market prices and portfolio value snapshots are cached under `.obsidian/plugins/pokemon-collection/`.
- **Works offline.** API responses are cached with a TTL and reused when the network is unavailable.
- **Mobile-friendly.** All network calls go through Obsidian's `requestUrl`, so the plugin works on desktop and mobile.

## Features

### Add cards
Command **“Pokémon Collection: Add card”**:
1. Search TCGdex by **name**, **number** and/or **set**.
2. Pick a card, then choose a **variant** — the variants TCGdex flags for that card (Normal, Reverse Holo, Holo, First Edition, Promo) plus a free-text **custom variant** (Full Art, Secret Rare, …).
3. Set **language**, **quantity** and **price** (auto-filled from Cardmarket).
4. The card is inserted into the active note. Adding a card that already exists **increments its quantity**.

The search modal has a **Language** dropdown, so you can search any TCGdex
language (e.g. `ja` for Japanese, `de`, `fr`, …), not just your default.

Two more ways to start an add:

- **“Add card from Cardmarket link”** — paste a Cardmarket single-card URL
  and the plugin extracts the name, set and number from it, then opens the
  same search modal pre-filled so you just pick the variant.
- **“Add card manually”** (a button in the search modal, or its own
  command) — for cards TCGdex doesn't have (promo bundles like *Trick or
  Trade*, some regional printings). No image/auto-price, but the card is
  still tracked, priced manually and counted in the dashboard.

### Collection table
The table is written between `<!-- pokemon-collection:start -->` and `<!-- pokemon-collection:end -->` markers, so the plugin only ever touches that region:

```markdown
<!-- pokemon-collection:start -->
| Card | Set | Number | Variant | Lang | Qty | Price |
| --- | --- | --- | --- | --- | --- | --- |
| [Pikachu](https://www.cardmarket.com/…)<!--k:base1-58:reverse--> | Base Set | 58 | reverse | EN | 2 | €25.41 |
<!-- pokemon-collection:end -->
```

The card's stable identity (`tcgdexId:variant`) is stored in a hidden HTML
comment inside the Card cell — invisible in Reading view, so there is no
technical ID column cluttering the table. If the comment is removed (manual
edit), the plugin recovers the id from the cache by matching name + set, or
falls back to a natural key.

### Price updates
- **Update selected card price** — the row under the cursor.
- **Update current note prices** — every row in the active note.
- **Update all collection prices** — every note in the collection folder, and records a portfolio value snapshot for the history chart.

Prices come from TCGdex's embedded **Cardmarket** data (EUR) via an abstracted `PriceProvider` interface, so other providers can be added later.

### Sorting
- **Sort collection table** — pick a field (name, set, number, variant, language, quantity, price) and direction, applied to the table under the cursor.
- **Keep table sorted** (setting) — auto-sorts by your chosen field/direction after every add or price update, so you never have to sort manually.
- **Reading view:** click a column header on a rendered collection table to sort by it on the spot.

### Dashboard
The dashboard aggregates every collection note in the configured folder and lives **inside a note** via a fenced code block:

````markdown
```pokemon-dashboard
```
````

Use the **“Create dashboard note”** command to generate one automatically (or add the block to any note yourself). It shows:

- **Statistics:** total cards, unique cards, total value, average value, most expensive card, largest set, sets owned.
- **Most valuable cards:** top 10 as a visual list — thumbnail, name, price, and a link to the note the card is in.
- **Charts (Chart.js):** collection value over time, collection by set, collection by rarity, collection growth.

> The old sidebar dashboard view/ribbon icon has been removed in favor of the in-note version; the plugin automatically detaches any leftover sidebar leaf from older installs.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Preferred language | `en` | Used for all TCGdex lookups |
| Currency | `EUR` | Fixed (Cardmarket source) in v1 |
| Price provider | TCGdex — Cardmarket | Abstracted for future providers |
| Collection folder | `Pokemon` | Scanned by the dashboard and "update all prices"; blank = whole vault |
| Default quantity | `1` | Added per card |
| Auto-update interval | `0` (off) | Minutes between automatic price refreshes |
| Cache duration | `24` h | Freshness window for API responses |
| Enable image previews | off | Show card images in modals |
| Image column in table | on | Embed a card thumbnail as the first table column |
| Image size | `200` px | Preview width (thumbnails capped at 80 px) |
| Keep table sorted | off | Auto-sort tables after add / price update |

## Development

```bash
npm install
npm run dev     # watch build → main.js
npm run build   # type-check + production bundle
```

Then symlink/copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/pokemon-collection/` and enable the plugin.

## Architecture

```
src/
  main.ts                    plugin entry, wiring, code-block/sort registration
  types.ts                   data models + TCGdex response shapes
  settings.ts                settings + settings tab
  commands.ts                command registration & implementations
  cardmarket.ts               Cardmarket URL build/slug/parse helpers
  parser/MarkdownParser.ts   read/write + sort the collection table (source of truth)
  services/
    ApiService.ts            TCGdex REST client over requestUrl (+ cache)
    CacheService.ts          cache.json / meta.json / price-history.json
    PriceService.ts          price provider abstraction (Cardmarket/EUR)
    CollectionService.ts     folder scan + statistics aggregation
  ui/
    CardSearchModal.ts       search step
    VariantSelectorModal.ts  variant / language / qty / price step
    AddByLinkModal.ts        paste-a-Cardmarket-link entry point
    ManualAddModal.ts        manual entry for cards TCGdex doesn't have
    SortModal.ts             field/direction picker for "Sort collection table"
    tableSort.ts             clickable column headers in Reading view
    DashboardBlock.ts        `pokemon-dashboard` code-block lifecycle
    DashboardRenderer.ts     stats + charts rendering, shared by the block
    charts.ts                Chart.js wrappers
```

## Roadmap (stretch goals, not in v1)

CSV import/export, value reports, OCR/barcode scanning, duplicate detection, wishlist & trade lists, deck builder, per-card price history chart, Git sync, bulk add, tags, smart search, per-generation stats, missing cards / set completion %.
