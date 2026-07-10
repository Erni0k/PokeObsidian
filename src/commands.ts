import { Editor, MarkdownView, Notice, TFile } from "obsidian";
import type PokemonCollectionPlugin from "./main";
import type { CardKey, CollectionEntry } from "./types";
import { CardSearchModal } from "./ui/CardSearchModal";
import { SortModal } from "./ui/SortModal";
import { AddByLinkModal } from "./ui/AddByLinkModal";
import { ManualAddModal } from "./ui/ManualAddModal";
import type { CardSearchQuery } from "./services/ApiService";

/** Registers all plugin commands and holds their implementations. */
export class CommandController {
	private plugin: PokemonCollectionPlugin;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
	}

	register(): void {
		const plugin = this.plugin;

		plugin.addCommand({
			id: "add-card",
			name: "Add card",
			callback: () => this.addCard(),
		});

		plugin.addCommand({
			id: "add-card-from-link",
			name: "Add card from Cardmarket link",
			callback: () => this.addCardFromLink(),
		});

		plugin.addCommand({
			id: "add-card-manually",
			name: "Add card manually",
			callback: () => this.addCardManually(),
		});

		plugin.addCommand({
			id: "update-selected-card",
			name: "Update selected card price",
			editorCallback: (editor) => this.updateSelectedCard(editor),
		});

		plugin.addCommand({
			id: "update-note-prices",
			name: "Update current note prices",
			editorCallback: (editor) => this.updateNotePrices(editor),
		});

		plugin.addCommand({
			id: "update-all-prices",
			name: "Update all collection prices",
			callback: () => this.updateAllPrices(),
		});

		plugin.addCommand({
			id: "create-dashboard-note",
			name: "Create dashboard note",
			callback: () => this.createDashboardNote(),
		});

		plugin.addCommand({
			id: "sort-collection-table",
			name: "Sort collection table",
			editorCallback: (editor) => this.sortTable(editor),
		});
	}

	// --- Sort ---------------------------------------------------------------

	/** Apply the configured auto-sort, if enabled; otherwise return unchanged. */
	private maybeAutoSort(entries: CollectionEntry[]): CollectionEntry[] {
		const s = this.plugin.settings;
		if (!s.autoSort) return entries;
		return this.plugin.markdown.sortEntries(
			entries,
			s.autoSortField,
			s.autoSortDirection
		);
	}

	private sortTable(editor: Editor): void {
		const md = this.plugin.markdown;
		const content = editor.getValue();
		if (!md.hasSection(content)) {
			new Notice("This note has no Pokémon collection table.");
			return;
		}

		new SortModal(this.plugin, (field, dir) => {
			const current = editor.getValue();
			const entries = md.parseEntries(current);
			const sorted = md.sortEntries(entries, field, dir);
			const newContent = md.replaceSection(current, sorted);
			if (newContent) this.setEditorValue(editor, newContent);
			new Notice(`Sorted by ${field} (${dir}).`);
		}).open();
	}

	// --- Dashboard note -----------------------------------------------------

	/** Create (or open) a note containing a live `pokemon-dashboard` block. */
	private async createDashboardNote(): Promise<void> {
		const vault = this.plugin.app.vault;
		const folder = this.plugin.settings.collectionFolder.trim();
		const path = `${folder ? `${folder}/` : ""}Pokémon Dashboard.md`;

		let file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			if (folder && !vault.getAbstractFileByPath(folder)) {
				try {
					await vault.createFolder(folder);
				} catch {
					/* folder may already exist */
				}
			}
			const content =
				"# Pokémon Collection Dashboard\n\n```pokemon-dashboard\n```\n";
			file = await vault.create(path, content);
		}

		if (file instanceof TFile) {
			await this.plugin.app.workspace.getLeaf(true).openFile(file);
		}
	}

	// --- Add card -----------------------------------------------------------

	private addCard(): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a note first to add a card into it.");
			return;
		}

		new CardSearchModal(this.plugin, (entry, addQty) => {
			void this.insertEntry(file, entry, addQty);
		}).open();
	}

	private addCardManually(): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a note first to add a card into it.");
			return;
		}
		new ManualAddModal(this.plugin, (entry, addQty) =>
			void this.insertEntry(file, entry, addQty)
		).open();
	}

	private addCardFromLink(): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a note first to add a card into it.");
			return;
		}

		new AddByLinkModal(this.plugin, (query: CardSearchQuery) => {
			new CardSearchModal(
				this.plugin,
				(entry, addQty) => void this.insertEntry(file, entry, addQty),
				query
			).open();
		}).open();
	}

	/**
	 * Insert a card into `file`. Uses the live editor when the file is open in
	 * an editing mode (preserves cursor + unsaved buffer); otherwise (e.g.
	 * Reading view) writes the file on disk so it works in every mode.
	 */
	private async insertEntry(
		file: TFile,
		entry: CollectionEntry,
		addQty: number
	): Promise<void> {
		try {
			const md = this.plugin.markdown;
			const view =
				this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const editor =
				view && view.file === file && view.getMode() === "source"
					? view.editor
					: null;

			if (editor) {
				const content = editor.getValue();
				const next = this.withEntry(content, entry, addQty);
				this.setEditorValue(editor, next);
			} else {
				const content = await this.plugin.app.vault.read(file);
				const next = this.withEntry(content, entry, addQty);
				await this.plugin.app.vault.modify(file, next);
			}
		} catch (err) {
			console.error("[pokemon-collection] failed to insert card", err);
			new Notice(
				`Could not write card to note: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	/** Return `content` with the card upserted into its collection section. */
	private withEntry(
		content: string,
		entry: CollectionEntry,
		addQty: number
	): string {
		const md = this.plugin.markdown;
		if (md.hasSection(content)) {
			const updated = this.maybeAutoSort(
				md.upsert(md.parseEntries(content), entry, addQty)
			);
			return md.replaceSection(content, updated) ?? content;
		}
		// No section yet: append a fresh one at the end of the note.
		const section = md.renderSection([{ ...entry, quantity: addQty }]);
		const sep = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
		return `${content}${sep}${section}\n`;
	}

	/** Replace the whole document while keeping the cursor position stable. */
	private setEditorValue(editor: Editor, value: string): void {
		const cursor = editor.getCursor();
		editor.setValue(value);
		editor.setCursor(
			Math.min(cursor.line, editor.lineCount() - 1),
			cursor.ch
		);
	}

	// --- Update selected card ----------------------------------------------

	private async updateSelectedCard(editor: Editor): Promise<void> {
		const md = this.plugin.markdown;
		const line = editor.getLine(editor.getCursor().line);
		const key = md.keyFromRow(line);
		if (!key) {
			new Notice("Place the cursor on a card row in the collection table.");
			return;
		}
		const content = editor.getValue();
		const row = md.parseEntries(content).find((e) => e.key === key);
		if (!row) {
			new Notice("Could not identify the card on this row.");
			return;
		}

		const notice = new Notice(`Updating ${row.name}…`, 0);
		const price = await this.refreshKey(key);
		notice.hide();

		const entries = this.maybeAutoSort(
			md
				.parseEntries(content)
				.map((e) => (e.key === key ? { ...e, price } : e))
		);
		const newContent = md.replaceSection(content, entries);
		if (newContent) this.setEditorValue(editor, newContent);

		new Notice(
			price !== undefined
				? `${row.name}: ${md.formatPrice(price)}`
				: `No price available for ${row.name}.`
		);
	}

	// --- Update current note -----------------------------------------------

	private async updateNotePrices(editor: Editor): Promise<void> {
		const md = this.plugin.markdown;
		const content = editor.getValue();
		if (!md.hasSection(content)) {
			new Notice("This note has no Pokémon collection table.");
			return;
		}
		const entries = md.parseEntries(content);
		const keys = uniqueKeys(entries);

		const notice = new Notice(`Updating ${keys.length} cards…`, 0);
		const priceMap = await this.refreshKeys(keys);
		notice.hide();

		const updated = this.maybeAutoSort(
			entries.map((e) => ({
				...e,
				price: priceMap.get(e.key) ?? e.price,
			}))
		);
		const newContent = md.replaceSection(content, updated);
		if (newContent) this.setEditorValue(editor, newContent);

		new Notice("Note prices updated.");
	}

	// --- Update all + snapshot ---------------------------------------------

	async updateAllPrices(): Promise<void> {
		const md = this.plugin.markdown;
		const files = await this.plugin.collection.getCollectionFiles();
		if (!files.length) {
			new Notice("No collection notes found in the configured folder.");
			return;
		}

		// First pass: read notes and collect every distinct key.
		const notes: Array<{ file: TFile; content: string; entries: CollectionEntry[] }> =
			[];
		const allKeys = new Set<CardKey>();
		for (const file of files) {
			const content = await this.plugin.app.vault.read(file);
			const entries = md.parseEntries(content);
			notes.push({ file, content, entries });
			for (const e of entries) allKeys.add(e.key);
		}

		const notice = new Notice(
			`Updating prices for ${allKeys.size} cards…`,
			0
		);
		const priceMap = await this.refreshKeys([...allKeys]);

		// Second pass: rewrite each note and tally the portfolio value.
		let totalValue = 0;
		let totalCards = 0;
		const uniq = new Set<CardKey>();

		for (const note of notes) {
			const updated = this.maybeAutoSort(
				note.entries.map((e) => ({
					...e,
					price: priceMap.get(e.key) ?? e.price,
				}))
			);
			const newContent = md.replaceSection(note.content, updated);
			if (newContent && newContent !== note.content) {
				await this.plugin.app.vault.modify(note.file, newContent);
			}
			for (const e of updated) {
				totalValue += e.quantity * (e.price ?? 0);
				totalCards += e.quantity;
				uniq.add(e.key);
			}
		}

		await this.plugin.cache.addSnapshot({
			timestamp: new Date().toISOString(),
			totalValue,
			totalCards,
			uniqueCards: uniq.size,
			currency: this.plugin.price.currency,
		});

		notice.hide();
		new Notice(
			`Updated ${uniq.size} cards. Collection value: €${totalValue.toFixed(
				2
			)}.`
		);
	}

	// --- shared price refresh ----------------------------------------------

	private async refreshKey(key: CardKey): Promise<number | undefined> {
		const { id, variant } = this.plugin.markdown.splitKey(key);
		return this.plugin.price.refreshPrice(id, variant);
	}

	private async refreshKeys(
		keys: CardKey[]
	): Promise<Map<CardKey, number | undefined>> {
		const map = new Map<CardKey, number | undefined>();
		for (const key of keys) {
			map.set(key, await this.refreshKey(key));
		}
		return map;
	}
}

function uniqueKeys(entries: CollectionEntry[]): CardKey[] {
	return [...new Set(entries.map((e) => e.key))];
}
