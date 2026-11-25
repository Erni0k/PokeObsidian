# Troubleshooting and FAQ

## Adding cards

**"Add card" says "Open a note first".**
The card is added to the active note. Open (or click into) the note you want to add to, then run the command again.

**A set code isn't recognised (e.g. a brand-new set).**
Run **Refresh Pokémon sets** to download the latest set list, or **Rebuild Pokémon set index** to index every set code at once. Typing the TCGdex set id (`sv10-062`) always works.

**Bulk add says "unknown set code" for a Japanese (or other non-English) card.**
Set ids are different in every language: Japanese `SV7` is *Stellar Miracle*, while the English `sv07` is *Stellar Crown*. Add the language to the line, e.g. `sv7 055 JA`. The error message names the language that has the set.

**The card I want isn't in the results.**
- Try the card's language in the **Language** dropdown — some cards exist only in Japanese or other languages.
- Search by set + number instead of name, or use **Add card from Cardmarket link**.
- If TCGdex simply doesn't have the card, use **Add card manually**.

**The variant I need isn't offered.**
The list contains the printings TCGdex knows for that card. Choose **Custom…** and type the variant (*Full Art*, *Error*, …). Custom variants are tracked normally, but may not get an automatic price.

**I see "Normal" missing for a card I own as non-holo.**
TCGdex lists the card as holo-only. If your copy really is a different printing, add it with a custom variant and report the data issue to TCGdex.

## Prices

**A card has no price.**
TCGdex has no market data for that printing in the active price source. Some printings (e.g. Shadowless on TCGplayer) are intentionally left unpriced instead of borrowing another printing's price. You can enter the price by hand.

**My graded card's price doesn't update.**
That is intended: graded cards keep their manual price. See [Graded cards](prices.md#graded-cards).

**The dashboard warns about cards in another currency.**
You switched the price source. Run **Update all collection prices**. Graded and manual cards keep their manual price, so re-enter those in the new currency.

**The "Collection value over time" chart is empty.**
It is built from snapshots recorded by **Update all collection prices**. Run it, or set an *Auto-update interval*.

**Prices differ from what I see on Cardmarket or TCGplayer.**
Prices come from TCGdex's periodically updated market data (Cardmarket trend price, TCGplayer market price), adjusted for the card's condition. They are estimates, not live listings.

## Views

**The dashboard says "No cards found".**
Your notes must be inside the **Collection folder** (default `Pokemon`). Move them there, change the setting, or clear it to scan the whole vault.

**A set block or gallery says "Unknown set".**
Use a set code (`DRI`) or TCGdex set id (`sv10`). For a new set, run **Refresh Pokémon sets** first.

**Set completion is slow the first time.**
The first load fetches every card of the set. After that it is cached and instant. Click **Refresh prices** only when you want new prices.

**Clicking a column header doesn't sort.**
Header sorting works in **Reading view** on collection tables. In Editing view, use **Sort collection table**.

## Data

**Can I edit the table by hand?**
Yes. Keep the column headers and the start/end markers. See [Editing by hand](collection-table.md#editing-by-hand).

**I accidentally deleted the hidden `<!--k:…-->` comment.**
The plugin recovers the card id from its cache by name and set where it can. Otherwise, delete the row and add the card again.

**Does it work on mobile?**
Yes. All features work on Obsidian mobile.

**How do I back up my collection?**
Your notes are the collection. Back up or sync your vault as usual, and include `price-history.json` from the plugin folder to keep price history. A CSV export is a convenient extra backup.

## Reporting a problem

Open an issue on [GitHub](https://github.com/Erni0k/PokeObsidian/issues) and include your Obsidian version, platform, plugin version, the steps to reproduce the problem, and the card or set involved. Errors are also logged to the developer console (`Ctrl/Cmd + Shift + I`) with the prefix `[pokemon-collection]`.
