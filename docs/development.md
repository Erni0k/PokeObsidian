# Development

## Requirements

- Node.js 18 or newer
- npm

## Build

```bash
npm install
npm run dev     # watch mode: rebuilds main.js on every change
npm run build   # type-check (tsc) + production bundle (esbuild)
```

To try a build, copy (or symlink) `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/pokemon-collection/` and reload Obsidian. A separate test vault is recommended.

## Releasing

1. Update the version: `npm version patch|minor|major`. This runs `version-bump.mjs`, which updates `manifest.json` and `versions.json` (the new version mapped to `minAppVersion`).
2. Obsidian requires the release tag to equal the version exactly, **without** a `v` prefix (e.g. `1.1.0`). npm prefixes tags with `v` by default, so either add `tag-version-prefix=""` to an `.npmrc` file, or tag manually: `git tag -a 1.1.0 -m "1.1.0"`.
3. Run `npm run build`, push the commit and the tag, then create a GitHub release for the tag and attach `main.js`, `manifest.json` and `styles.css`.

## Architecture

```
src/
  main.ts                     Plugin entry: services, commands, code blocks, settings tab
  types.ts                    Data models and TCGdex response shapes
  settings.ts                 Settings and the settings tab
  commands.ts                 Command registration and implementations
  cardmarket.ts               Cardmarket URL building, slugging and link parsing
  condition.ts                Conditions, grades and their parsing
  currency.ts                 Currency symbols, money parsing and formatting, "updated X ago"
  csv.ts                      CSV reader/writer (RFC 4180, delimiter detection)
  priceHistory.ts             Price change calculations
  variants.ts                 Variant options, defaults and matching
  parser/
    MarkdownParser.ts         Reads, writes and sorts the collection table
  services/
    ApiService.ts             TCGdex REST client over requestUrl, with caching
    CacheService.ts           cache.json, meta.json, price-history.json
    PriceService.ts           Price sources (Cardmarket, TCGplayer) and condition pricing
    CollectionService.ts      Folder scan, list types, aggregation and statistics
    SetIndexService.ts        Per-language set index (names, codes), new-set detection
    SetCompletionService.ts   Set snapshots and completion calculation
    CsvImportService.ts       CSV formats, column mapping and row resolution
  ui/
    CardSearchModal.ts        Search step of "Add card"
    VariantSelectorModal.ts   Variant, condition, grade, quantity and price step
    AddByLinkModal.ts         Cardmarket link entry
    ManualAddModal.ts         Manual card entry
    BulkAddModal.ts           Bulk add
    buildEntry.ts             Shared "card → table row" logic
    SetSuggest.ts             Set autocomplete
    SortModal.ts              Sort field and direction picker
    tableSort.ts              Clickable headers and price tooltips in Reading view
    DashboardBlock.ts         pokemon-dashboard block
    DashboardRenderer.ts      Dashboard statistics and charts
    SetCompletionBlock.ts     pokemon-set block
    SetCompletionModal.ts     "Show set completion" dialog
    GalleryBlock.ts           pokemon-gallery block
    CardHistory.ts            pokemon-card block and price history modal
    ListModals.ts             List note, trade candidate and note picker dialogs
    CsvModals.ts              Export scope and import dialogs
    charts.ts                 Chart.js wrappers
```

### Design principles

- **Markdown is the source of truth.** Collection data lives only in note tables. The parser is header-driven, so tables with or without optional columns (and older formats) are read correctly, and only the marked section of a note is ever rewritten.
- **JSON files are caches.** Metadata, API responses, the set index and set snapshots can all be rebuilt; only price history accumulates over time.
- **Stable identity.** A row's key is `id:variant:condition[:grade]`, stored in a hidden comment. Metadata and price history are keyed per printing (`id:variant`).
- **Offline-first networking.** All requests go through Obsidian's `requestUrl` (no CORS issues, works on mobile), are cached with a TTL and fall back to stale data when offline.
- **No mixed currencies.** Every price carries its currency; totals only ever add up prices in the active currency.
