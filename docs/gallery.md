# Gallery and binder

Show your cards as images — a responsive grid, or 3×3 binder pages — anywhere in your notes.

## Basic use

````markdown
```pokemon-gallery
```
````

Without options, the gallery shows the cards of **the note it is in** as a grid, ordered by set and number. The header shows the number of cards and their total value. The gallery redraws automatically when the cards change.

The header has two buttons:

- **Update prices** fetches current prices for the cards shown. With `source: this` that is the cards in this note; with `source: folder` it updates every collection note, like *Update all collection prices*.
- **Refresh** redraws the gallery from the prices already in your notes, without network requests.

Each tile shows the card image, a ×N badge for multiple copies, the price (stale prices highlighted) and links to the card's Cardmarket page.

## Options

Add `key: value` lines:

````markdown
```pokemon-gallery
source: folder
layout: binder
sort: price
size: 150
```
````

| Option | Values | Default |
| --- | --- | --- |
| `source` | `this` — cards in this note; `folder` — every collection note in the collection folder | `this` |
| `layout` | `grid` or `binder` (3×3 pages with Prev / Next) | `grid` |
| `sort` | `number` (set, then number), `price` (highest first) or `name` | `number` |
| `size` | Tile width in pixels, 60–400 | `120` |
| `set` | Only cards of this set — a code (`DRI`) or id (`sv10`) | — |
| `lang` | Language used to resolve and load the set | Preferred language |

## Binder for a whole set

Combine `set` with `layout: binder` to see the full set in number order, with the cards you own and **greyed-out placeholders for the cards you are missing**:

````markdown
```pokemon-gallery
source: folder
set: DRI
layout: binder
```
````

The header shows how many of the set's cards you own. The set's card list is shared with [set completion](set-completion.md), so it is loaded once and then cached.
