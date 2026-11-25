# Commands

All commands are available from the command palette (`Ctrl/Cmd + P`) under **Pokemon Collection Manager**. None of them have a default hotkey; assign your own in **Settings → Hotkeys**.

## Adding cards

| Command | Description |
| --- | --- |
| **Add card** | Search TCGdex and add a card to the current note. → [Adding cards](adding-cards.md#search) |
| **Add card from Cardmarket link** | Paste a Cardmarket URL; the search opens pre-filled. → [Cardmarket link](adding-cards.md#from-a-cardmarket-link) |
| **Add card manually** | Add a card TCGdex doesn't have. → [Manual cards](adding-cards.md#manual-cards) |
| **Bulk add cards from list** | Add many cards from `CODE NUMBER [xQTY] [variant] [condition] [grade] [language]` lines, e.g. `sv7 055 JA`. → [Bulk add](adding-cards.md#bulk-add) |

## Prices

| Command | Description |
| --- | --- |
| **Update selected card price** | Re-price the table row under the cursor *(Editing view)*. |
| **Update current note prices** | Re-price every row in the current note *(Editing view)*. |
| **Update all collection prices** | Re-price every note in the collection folder and record a value snapshot. → [Prices](prices.md#updating-prices) |

## Tables

| Command | Description |
| --- | --- |
| **Sort collection table** | Sort the current note's table by a field and direction *(Editing view)*. → [Sorting](collection-table.md#sorting) |

## Views

| Command | Description |
| --- | --- |
| **Create dashboard note** | Create or open the dashboard note. → [Dashboard](dashboard.md) |
| **Show set completion** | Create or open a note tracking a set. → [Set completion](set-completion.md) |

## Lists

| Command | Description |
| --- | --- |
| **Create wishlist / trade note** | Create a list note with the right frontmatter. → [Lists](lists.md) |
| **Move card to collection** | Move the wishlist row under the cursor into a collection note *(Editing view, wishlist notes)*. |
| **Find trade candidates** | List cards owned more than once and write the spare copies to a trade note. |

## Import and export

| Command | Description |
| --- | --- |
| **Export collection to CSV** | Export all notes or the current note. → [CSV](csv.md#export) |
| **Import cards from CSV** | Import a CSV file from your vault. → [CSV](csv.md#import) |

## Sets

| Command | Description |
| --- | --- |
| **Refresh Pokémon sets** | Download the latest set list now and report newly released sets. New sets are indexed immediately so their codes work. |
| **Rebuild Pokémon set index** | Download every set's details once, so all set codes (including localized ones) resolve instantly and offline. Takes a minute or two; progress is shown. |

The set list also refreshes by itself according to the *Set list refresh* setting, and newly released sets are announced when they appear.
