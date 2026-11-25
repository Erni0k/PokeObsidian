# Getting started

This guide takes you from installation to a working collection with a dashboard in about five minutes.

## 1. Install and enable

Install the plugin from **Settings → Community plugins → Browse** (search for *Pokemon Collection Manager*), or install it manually — see [Installation](../README.md#installation). Then enable it under **Settings → Community plugins**.

Requirements: Obsidian **1.5.0** or newer, on desktop or mobile, with an internet connection for card lookups.

## 2. Check the basic settings

Open **Settings → Pokemon Collection Manager** and review:

- **Preferred language** — the language used to search cards and fetch names and images (default `EN`). You can still search any other language from the search window.
- **Price source** — *Cardmarket (EUR)* or *TCGplayer (USD)*.
- **Collection folder** — the folder the plugin scans for your collection notes (default `Pokemon`). Leave it blank to scan the whole vault.

All settings are described in [Settings](settings.md).

## 3. Create a collection note

Create a note inside your collection folder, for example `Pokemon/Binder 1.md`. A collection note is a normal note — you can write anything around the table. You can split your collection across as many notes as you like (one per binder, per set, per box …); the dashboard adds them all up.

## 4. Add your first card

1. Open the note and run **Add card** from the command palette (`Ctrl/Cmd + P`).
2. Type a card name such as `Pikachu`, or a set code and number such as `DRI 062`. Results appear as you type; press **Enter** to search immediately.
3. Click the card you want.
4. In the next window choose the **variant**, **condition** (or a **grade** for slabbed cards), **language**, **quantity** and **price**. The price is filled in from the price source and can be edited.
5. Click **Add to note**.

The plugin inserts a table at the end of the note the first time, and adds new rows (or increases the quantity of an existing row) after that. The search window stays open, so you can keep adding cards; click **Done** when you are finished.

More ways to add cards — Cardmarket links, bulk lists, manual cards — are in [Adding cards](adding-cards.md).

## 5. See your collection

- Run **Create dashboard note** to create `Pokemon/Pokémon Dashboard.md` with a live [dashboard](dashboard.md).
- Run **Update all collection prices** whenever you want fresh prices. Each run also records a snapshot for the *Collection value over time* chart.
- Add a [gallery](gallery.md) to any note to browse your cards as images:

  ````markdown
  ```pokemon-gallery
  ```
  ````

- Track a set with a [set completion](set-completion.md) block:

  ````markdown
  ```pokemon-set
  DRI
  ```
  ````

## Next steps

- Keep a wishlist or a trade list: [Wishlist and trade lists](lists.md).
- Coming from another app? [Import a CSV file](csv.md).
- Understand how prices are calculated: [Prices](prices.md).
