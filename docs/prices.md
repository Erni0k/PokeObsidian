# Prices

Prices come from the market data that TCGdex publishes for each card. The plugin never scrapes Cardmarket or TCGplayer directly.

## Price sources

Choose the source in **Settings → Price source**:

| Source | Currency | Price used (first available) |
| --- | --- | --- |
| **Cardmarket** (default) | EUR | trend → 30-day average → average → lowest |
| **TCGplayer** | USD | market price → mid price → lowest |

Prices are looked up **per printing**:

- **Cardmarket** lists a card's foil version under separate "holo" price fields. Reverse holos are priced from those fields. A holo card that is its own product — for example a holo-only rare like Base Set Charizard — is priced from the regular fields.
- **TCGplayer** has a separate entry per printing (Normal, Reverse Holofoil, Holofoil, 1st Edition, Unlimited). A 1st Edition card is only ever priced from a 1st Edition entry. If TCGplayer doesn't price a printing (e.g. Shadowless), the card gets no price instead of borrowing another printing's.

### Switching sources

The currency follows the source. After switching, run **Update all collection prices** to re-price your tables. Until then, cards still priced in the old currency are counted but **never added** to totals in the new currency, and the dashboard shows a warning. Graded and manual cards keep the prices you entered — re-enter those in the new currency if needed.

## Condition pricing

The market price is the near-mint (NM) price. Raw cards in other conditions are priced as **market price × condition multiplier**:

| Condition | Default multiplier |
| --- | --- |
| NM — Near Mint | 1.00 |
| LP — Lightly Played | 0.85 |
| MP — Moderately Played | 0.70 |
| HP — Heavily Played | 0.50 |
| DMG — Damaged | 0.30 |

The multipliers can be changed under **Settings → Condition pricing**.

## Graded cards

Cards with a grade (`PSA 10`, `CGC 9.5`, …) are **never priced automatically**, because a slab's value depends heavily on the grade. Enter their price by hand; price updates leave it unchanged.

## Updating prices

| Command | Updates |
| --- | --- |
| **Update selected card price** | The table row under the cursor |
| **Update current note prices** | Every row in the current note |
| **Update all collection prices** | Every collection note in the collection folder, and records a value snapshot |

The **Update prices** buttons on the [dashboard](dashboard.md#buttons) and the [gallery](gallery.md#basic-use) do the same without the command palette. The **Refresh** buttons only redraw a view with the prices already in your notes. The set block's **Refresh prices** reloads prices for that set's missing-cards list, not for your table rows.

Each printing is fetched once per run, even if it appears in many rows or notes. Starting a second run while one is in progress is ignored. Wishlist and trade notes are re-priced as well, but only cards in *collection* notes count towards the snapshot value.

Set **Auto-update interval** to a number of minutes to run *Update all collection prices* automatically while Obsidian is open (`0` = off).

## Stale prices

A price older than **Stale price after (days)** (default 7) is highlighted in tables, on the dashboard and in the gallery. Hover a price to see exactly when it was updated.

## Price history

Every time a card's price **changes**, the plugin records a point for that printing (up to *Price history per card* points, default 100). History is kept per currency, so EUR and USD prices are never mixed in one chart.

Price history powers:

- **Biggest movers** on the [dashboard](dashboard.md) — the largest rises and falls since the last update or over 30 days.
- **Card price charts** — click a card in *Most valuable cards* on the dashboard, or embed a chart in any note:

  ````markdown
  ```pokemon-card
  sv10-003:reverse
  ```
  ````

  Use `card id:variant`. A bare card id (`sv10-003`) shows the first variant with recorded history, and a full row key (`sv10-003:reverse:LP`) works too. The chart shows the change since the previous price and over the last 30 days.

History starts with your first price update. Run **Update all collection prices** regularly to build it up.

## Accuracy

Prices are market estimates provided by TCGdex, which updates them periodically. They can lag behind the live marketplaces and are not offers to buy or sell. Always check the marketplace before trading.
