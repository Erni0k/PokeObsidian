# CSV import and export

Export your collection for backups and spreadsheets, or bring a collection over from another app.

## Export

Run **Export collection to CSV**. If the current note has a collection table, you can export **all notes in the collection folder** or **only that note**.

The file is saved to `Pokemon/Exports/pokemon-collection YYYY-MM-DD HHMMSS.csv`. It is UTF-8 with a byte-order mark, so Excel and other spreadsheet apps show accented names correctly.

| Column | Content |
| --- | --- |
| `id` | TCGdex card id (`sv10-003`), or `manual-…` for manual cards |
| `name`, `set`, `number` | As in the table |
| `setCode` | Set code (`DRI`) when known, otherwise the set id |
| `variant`, `condition`, `grade`, `lang`, `qty` | As in the table |
| `price` | Price per copy, two decimals |
| `currency` | Currency of `price` (`EUR`, `USD`) |
| `paid` | Reserved (currently empty) |
| `note` | Path of the note the row came from |

## Import

1. Copy the CSV file into your vault (any folder).
2. Optionally open the note you want to import into.
3. Run **Import cards from CSV** and pick the file.

The import window then guides you through these steps:

1. **Format** — the format is detected from the column headers; you can change it.
2. **Column mapping** — each field (card name, set, number, variant, quantity, price, condition, grade …) is mapped to a column. Known formats are mapped automatically; for any other file, choose the columns yourself.
3. **Check cards** — every row is looked up on TCGdex: by card id first, then set code or set name + number, then name + set. You get a summary of recognised, unrecognised and skipped rows, with the reason for each one that failed.
4. **Unrecognised rows** — skip them (report only) or add them as [manual cards](adding-cards.md#manual-cards).
5. **Import into** — choose the target note. For the plugin's own exports you can turn on **Restore original notes** to put every row back into the note named in its `note` column; missing notes and folders are created.
6. **Import** — all rows are written, one write per note. Existing rows with the same card, variant, condition and grade have their quantities increased.

### Supported formats

| Format | Notes |
| --- | --- |
| **Pokemon Collection Manager export** | Restored exactly as exported: names, variants, conditions, grades, prices and currencies. |
| **Collectr** | Product name, set, number, variance, condition, grade + grading company, quantity, market price (USD). |
| **TCGplayer** | Product name (the number is read from names like `Charizard ex - 199/165`), set name, printing or condition text such as `Near Mint Reverse Holofoil`, quantity, market price (USD). Rows from other games are skipped. |
| **Cardmarket** | English name, expansion, collector number, numeric or named language, condition (Cardmarket's MT/NM/EX/GD/LP/PL/PO scale), foil / reverse holo / 1st edition flags, amount, price (EUR). |
| **Other** | Any CSV with a header row — map the columns by hand. Comma, semicolon and tab delimiters are detected automatically. |

### Prices on import

- **Own exports** keep their prices and currencies.
- **Other apps' rows** are priced from your active price source and the row's condition. Graded cards get no automatic price.
- **Manual cards** created from unrecognised rows keep the CSV's price in the CSV's currency.

### Tips

- Set names don't have to match exactly: prefixes and punctuation are ignored (`SV10: Destined Rivals`, `Scarlet & Violet—Destined Rivals`).
- If many rows fail with *unknown set*, run **Rebuild Pokémon set index** and check the cards again.
- *Ambiguous* means several cards share the name and the file has no set or number. Map a set or number column, or add those rows by hand.
