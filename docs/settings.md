# Settings

Open **Settings → Pokemon Collection Manager**.

## General

| Setting | Default | Description |
| --- | --- | --- |
| **Preferred language** | `EN` | Language for TCGdex lookups: card names, images, set names. Any language can still be searched from the search window. |
| **Price source** | Cardmarket (EUR) | *Cardmarket (EUR)* or *TCGplayer (USD)*. After switching, run **Update all collection prices**. → [Prices](prices.md#price-sources) |
| **Stale price after (days)** | `7` | Prices older than this are highlighted in tables, the dashboard and the gallery. |
| **Collection folder** | `Pokemon` | Folder scanned for collection notes by the dashboard, "Update all collection prices", folder galleries and CSV export. Blank = the whole vault. New dashboard, set, list and export files are created here. |

## Tables

| Setting | Default | Description |
| --- | --- | --- |
| **Keep table sorted** | Off | Re-sort tables automatically after adding cards or updating prices. |
| **Auto-sort field** | Card name | Field used when *Keep table sorted* is on. |
| **Auto-sort direction** | Ascending | Ascending (A→Z, low→high) or descending. |
| **Default quantity** | `1` | Quantity pre-filled when adding a card. |

## Updates and caching

| Setting | Default | Description |
| --- | --- | --- |
| **Auto-update interval** | `0` | Run *Update all collection prices* every N minutes while Obsidian is open. `0` turns it off. |
| **Cache duration (hours)** | `24` | How long TCGdex responses are reused before being fetched again. Price updates always fetch fresh data. |
| **Set list refresh (hours)** | `6` | How long the list of sets is reused, so new releases show up soon. *Refresh Pokémon sets* updates it immediately. |
| **Price history per card** | `100` | Maximum number of price changes kept per card printing. |

## Condition pricing

| Setting | Default | Description |
| --- | --- | --- |
| **LP — Lightly Played** | `0.85` | Multiplier applied to the near-mint market price. |
| **MP — Moderately Played** | `0.7` | |
| **HP — Heavily Played** | `0.5` | |
| **DMG — Damaged** | `0.3` | |

Near Mint is always `1`. Graded cards are never priced automatically. → [Condition pricing](prices.md#condition-pricing)

## Images

| Setting | Default | Description |
| --- | --- | --- |
| **Enable image previews** | Off | Show card images in search results and the variant window. |
| **Image column in table** | On | Add a thumbnail column to collection tables (applied the next time a table is rewritten). |
| **Image size (px)** | `200` | Width of image previews. Table thumbnails are capped at 80 px. |

## Maintenance

| Action | Description |
| --- | --- |
| **Clear API cache** | Delete cached TCGdex responses. Your tables, card metadata and price history are kept. |
