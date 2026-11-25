# Pokemon Collection Manager — Documentation

Welcome! These guides cover every feature of the plugin. If you are new, start with **Getting started**.

## Using the plugin

1. [Getting started](getting-started.md) — install, create your first collection note, add your first card.
2. [Adding cards](adding-cards.md) — every way to add cards, variants, condition and grade, languages.
3. [The collection table](collection-table.md) — how your data is stored and how to edit it safely.
4. [Prices](prices.md) — price sources, updates, condition pricing, graded cards and price history.

## Views inside your notes

- [Dashboard](dashboard.md) — the `pokemon-dashboard` block.
- [Set completion](set-completion.md) — the `pokemon-set` block.
- [Gallery and binder](gallery.md) — the `pokemon-gallery` block.
- Card price chart — the `pokemon-card` block, described in [Prices → Price history](prices.md#price-history).

## Organising and moving data

- [Wishlist and trade lists](lists.md)
- [CSV import and export](csv.md)

## Reference

- [Commands](commands.md)
- [Settings](settings.md)
- [Data, network and privacy](data-and-privacy.md)
- [Troubleshooting and FAQ](troubleshooting.md)
- [Development](development.md)

## Glossary

| Term | Meaning |
| --- | --- |
| **Collection note** | Any note that contains a collection table (between the plugin's start/end markers). |
| **Collection folder** | The folder the plugin scans for collection notes (`Pokemon` by default). Used by the dashboard, "Update all collection prices", the gallery in folder mode and CSV export. |
| **Set code** | The short code printed on cards and used by Cardmarket, e.g. `DRI` for *Destined Rivals*. |
| **Set id** | TCGdex's identifier for a set, e.g. `sv10`. Card ids are `{set id}-{number}`, e.g. `sv10-003`. |
| **Variant / printing** | A specific version of a card: Normal, Reverse Holo, Holo, 1st Edition, Shadowless, stamped, jumbo, or a custom text. |
| **Raw / graded** | A raw card has a condition (NM, LP, MP, HP, DMG). A graded card is slabbed and has a grade such as `PSA 10`. |
| **Market price** | The near-mint price of a printing from the active price source (Cardmarket or TCGplayer). |
