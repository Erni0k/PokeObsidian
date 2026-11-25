# Set completion

Track how complete a set is — both the regular set and the full master set — see which cards you are missing and what it would cost to finish it.

## Creating a set note

Run **Show set completion**, enter a set code or id (e.g. `DRI`, `sv10`) and a language, and click **Open**. The plugin creates a note in `Pokemon/Sets/` with a set block. You can also write the block yourself:

````markdown
```pokemon-set
DRI
```
````

## Options

Put the set on the first line, optionally followed by `key: value` lines:

````markdown
```pokemon-set
set: DRI
lang: fr
mode: master
languages: en, fr
```
````

| Option | Values | Default |
| --- | --- | --- |
| `set` (or the first line) | A set code (`DRI`, localized codes like `RVD`) or a TCGdex set id (`sv10`) | — (required) |
| `lang` | TCGdex language of the set's card list and prices | Preferred language |
| `mode` | `regular` or `master` — the list shown first | `regular` |
| `languages` | Which cards from your tables count as owned, by their Lang column: a list like `en, fr`, or `any` | The block's language |

Lines starting with `#` are ignored.

## Regular set vs. master set

- **Regular set** — every card numbered up to the printed set size (for example 1–182). A card counts as owned if you have it in **any** variant. Secret rares and other cards numbered above the set size are not part of the regular set.
- **Master set** — every printing of every card in the set: each card × each of its variants (normal, reverse holo, holo, stamped …), including secret rares.

The block shows a progress bar for both, and a list for the selected mode with:

- the **missing cards** (or printings), with image, number, variant and price;
- the **cost to complete**, i.e. the sum of the missing items' prices. In regular mode each missing card is priced at its cheapest variant. Items without a known price are counted separately.

Switch between the lists with the **Regular** and **Master** buttons.

## Loading and refreshing

Building a set's list requires the details of every card in the set, so the first load takes a while (a progress bar is shown). The result is cached in `set-completion.json` and reused, so later views are instant and work offline.

Which cards you own is re-read from your collection tables every time the note is displayed, so newly added cards appear immediately. Click **Refresh prices** to reload the set from TCGdex for current prices. The block also tells you when its prices are stale or in a different currency than your current price source.

If some cards could not be loaded, the block says so and guesses their variants. Click **Refresh prices** to try again.
