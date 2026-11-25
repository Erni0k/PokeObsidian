# Wishlist and trade lists

Besides the cards you own, you can keep lists of cards you want and cards you offer for trade. They use the same table format and the same commands to add cards.

## List types

A note's list type is set in its frontmatter:

```yaml
---
pokemon-list: wishlist
---
```

| `pokemon-list` | Meaning |
| --- | --- |
| *(missing)* or `collection` | Cards you own — the default for every note |
| `wishlist` | Cards you want to get |
| `trade` | Cards you offer for trade |

The fastest way to create one is **Create wishlist / trade note**: pick the type and a name, and the plugin creates the note with the frontmatter and an empty table in your collection folder.

## How lists are counted

- The dashboard's statistics and charts, the value snapshot and the gallery in `folder` mode count only **collection** notes.
- Wishlists and trade lists get their own dashboard tiles: *Wishlist · N cards · cost €X* and *Trade · N cards · value €X*.
- The same card on a collection note and a wishlist is counted separately in each.
- **Update all collection prices** re-prices every list, so the wishlist cost stays current.

## Moving a card from a wishlist to your collection

When you get a card from your wishlist:

1. Open the wishlist note in Editing view and put the cursor on the card's row.
2. Run **Move card to collection** and pick the collection note.

The card is added to that note (merged into an existing row with the same card, variant, condition and grade) and removed from the wishlist.

## Finding trade candidates

Run **Find trade candidates** to list every collection card you own **more than once**, with the number of spare copies and their value. Click **Add to trade note…** to write the spare copies into a trade note:

- If you have no trade note, one named *Trade* is created.
- If you have exactly one, it is used; with several, you pick one.

The trade note's quantity is set to the number of spare copies, so you can run the command again at any time to bring it up to date.
