import { Editor, MarkdownView, Notice, TFile } from "obsidian";
import type PokemonCollectionPlugin from "./main";
import type { CardKey, CollectionEntry } from "./types";
import { CardSearchModal } from "./ui/CardSearchModal";
import { SortModal } from "./ui/SortModal";
import { AddByLinkModal } from "./ui/AddByLinkModal";
import { ManualAddModal } from "./ui/ManualAddModal";
import { BulkAddModal, BulkItem } from "./ui/BulkAddModal";
import { SetChoice, SetCompletionModal } from "./ui/SetCompletionModal";
import {
	CreateListNoteModal,
	defaultListName,
	NotePickerModal,
	TradeCandidatesModal,
} from "./ui/ListModals";
import type { ListType, TradeCandidate } from "./services/CollectionService";
import type { CardSearchQuery } from "./services/ApiService";

/** Registers all plugin commands and holds their implementations. */
export class CommandController {
	private plugin: PokemonCollectionPlugin;
	/** Serializes note writes so rapid adds (continuous / bulk) never interleave. */
	private writeQueue: Promise<void> = Promise.resolve();

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
			id: "bulk-add",
			name: "Bulk add cards from list",
			callback: () => this.bulkAdd(),
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
			id: "show-set-completion",
			name: "Show set completion",
			callback: () =>
				new SetCompletionModal(plugin, (c) => void this.createSetNote(c)).open(),
		});

		plugin.addCommand({
			id: "move-card-to-collection",
			name: "Move card to collection",
			editorCallback: (editor, ctx) => {
				if (ctx.file) void this.moveToCollection(editor, ctx.file);
			},
		});

		plugin.addCommand({
			id: "find-trade-candidates",
			name: "Find trade candidates",
			callback: () => void this.findTradeCandidates(),
		});

		plugin.addCommand({
			id: "create-list-note",
			name: "Create wishlist / trade note",
			callback: () =>
				new CreateListNoteModal(plugin.app, (type, name) => {
					void this.createListNote(type, name).then((file) => {
						if (file) void plugin.app.workspace.getLeaf(true).openFile(file);
					});
				}).open(),
		});

		plugin.addCommand({
			id: "sort-collection-table",
			name: "Sort collection table",
			editorCallback: (editor) => this.sortTable(editor),
		});

		plugin.addCommand({
			id: "refresh-sets",
			name: "Refresh Pokémon sets",
			callback: () =>
				void this.plugin.setIndex.refreshSets(
					this.plugin.settings.preferredLanguage
				),
		});

		plugin.addCommand({
			id: "rebuild-set-index",
			name: "Rebuild Pokémon set index",
			callback: () =>
				void this.plugin.setIndex.rebuild([
					this.plugin.settings.preferredLanguage,
					"en",
				]),
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

	/** Create (or open) a note with a ```pokemon-set block for a set. */
	private async createSetNote(choice: SetChoice): Promise<void> {
		const vault = this.plugin.app.vault;
		const root = this.plugin.settings.collectionFolder.trim();
		const folder = `${root ? `${root}/` : ""}Sets`;
		const preferred = this.plugin.settings.preferredLanguage || "en";
		const tag = [choice.code ?? choice.setId];
		if (choice.lang !== preferred) tag.push(choice.lang.toUpperCase());
		const safe = `${choice.name} (${tag.join(", ")})`
			.replace(/[\\/:*?"<>|#^[\]]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		const path = `${folder}/${safe}.md`;

		let file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			let acc = "";
			for (const part of folder.split("/")) {
				acc = acc ? `${acc}/${part}` : part;
				if (!vault.getAbstractFileByPath(acc)) {
					try {
						await vault.createFolder(acc);
					} catch {
						/* may already exist */
					}
				}
			}
			const lines = [choice.code ?? choice.setId];
			if (choice.lang !== preferred) lines.push(`lang: ${choice.lang}`);
			const title = choice.code ? `${choice.name} (${choice.code})` : choice.name;
			const fence = "```";
			const content = `# ${title}\n\n${fence}pokemon-set\n${lines.join("\n")}\n${fence}\n`;
			file = await vault.create(path, content);
		}
		if (file instanceof TFile) {
			await this.plugin.app.workspace.getLeaf(true).openFile(file);
		}
	}

	// --- Wishlist / trade lists ----------------------------------------------

	/**
	 * Rewrite a note's content: through the live editor when the note is open
	 * in an editing mode (keeps the cursor and unsaved buffer), else on disk.
	 */
	private async modifyNote(file: TFile, fn: (content: string) => string): Promise<void> {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const editor =
			view && view.file === file && view.getMode() === "source" ? view.editor : null;
		if (editor) {
			const before = editor.getValue();
			const after = fn(before);
			if (after !== before) this.setEditorValue(editor, after);
		} else {
			await this.plugin.app.vault.process(file, fn);
		}
	}

	/** Move the wishlist row under the cursor into a picked collection note. */
	private async moveToCollection(editor: Editor, file: TFile): Promise<void> {
		const md = this.plugin.markdown;
		const collection = this.plugin.collection;
		if (collection.listTypeOf(file) !== "wishlist") {
			new Notice('Use this in a wishlist note (frontmatter "pokemon-list: wishlist").');
			return;
		}
		const key = md.keyFromRow(editor.getLine(editor.getCursor().line));
		const entry = key ? md.parseEntries(editor.getValue()).find((e) => e.key === key) : undefined;
		if (!key || !entry) {
			new Notice("Place the cursor on a card row in the wishlist table.");
			return;
		}

		const targets = (await collection.scanNotes(["collection"]))
			.map((n) => n.file)
			.filter((f) => f.path !== file.path);
		if (!targets.length) {
			new Notice("No collection notes with a card table found in the collection folder.");
			return;
		}

		new NotePickerModal(
			this.plugin.app,
			targets,
			`Move ${entry.name} (${entry.variant}) to which collection note?`,
			(target) =>
				void this.enqueueWrite(async () => {
					const qty = Math.max(1, entry.quantity);
					try {
						// Add first (merges into an existing row with the same
						// id:variant key), then remove from the wishlist.
						await this.modifyNote(target, (c) => this.withEntry(c, entry, qty));
						await this.modifyNote(file, (c) => {
							const rest = md.parseEntries(c).filter((e) => e.key !== key);
							return md.replaceSection(c, rest) ?? c;
						});
						new Notice(`Moved ${entry.name} (${entry.variant}) ×${qty} to ${target.basename}.`);
					} catch (err) {
						console.error("[pokemon-collection] move failed", err);
						new Notice(
							`Could not move the card: ${err instanceof Error ? err.message : String(err)}`
						);
					}
				})
		).open();
	}

	/** Show collection cards with Qty > 1 and offer to write them to a trade note. */
	private async findTradeCandidates(): Promise<void> {
		const candidates = await this.plugin.collection.tradeCandidates();
		if (!candidates.length) {
			new Notice("No duplicates: every collection card has Qty 1.");
			return;
		}
		new TradeCandidatesModal(this.plugin, candidates, () =>
			void this.pickTradeNote(candidates)
		).open();
	}

	private async pickTradeNote(candidates: TradeCandidate[]): Promise<void> {
		const collection = this.plugin.collection;
		const notes = collection
			.getCandidateFiles()
			.filter((f) => collection.listTypeOf(f) === "trade");
		if (!notes.length) {
			const file = await this.createListNote("trade", defaultListName("trade"));
			if (file) await this.writeTradeNote(file, candidates);
			return;
		}
		if (notes.length === 1) {
			await this.writeTradeNote(notes[0], candidates);
			return;
		}
		new NotePickerModal(this.plugin.app, notes, "Add spare copies to which trade note?", (f) =>
			void this.writeTradeNote(f, candidates)
		).open();
	}

	/** Upsert candidates into a trade note with Qty = spare copies (idempotent). */
	private writeTradeNote(file: TFile, candidates: TradeCandidate[]): Promise<void> {
		const md = this.plugin.markdown;
		return this.enqueueWrite(async () => {
			await this.modifyNote(file, (content) => {
				const entries = md.parseEntries(content);
				for (const c of candidates) {
					const price = c.unitPrice || c.entry.price;
					const i = entries.findIndex((e) => e.key === c.entry.key);
					if (i >= 0) entries[i] = { ...entries[i], quantity: c.surplus, price: price ?? entries[i].price };
					else entries.push({ ...c.entry, quantity: c.surplus, price });
				}
				const sorted = this.maybeAutoSort(entries);
				if (md.hasSection(content)) return md.replaceSection(content, sorted) ?? content;
				const sep = content.endsWith("\n") ? "\n" : "\n\n";
				return `${content}${sep}${md.renderSection(sorted)}\n`;
			});
			new Notice(`Wrote ${candidates.length} trade candidate(s) to ${file.basename}.`);
			await this.plugin.app.workspace.getLeaf(false).openFile(file);
		});
	}

	/** Create a list note with frontmatter and an empty table (or return the existing one). */
	private async createListNote(type: ListType, name: string): Promise<TFile | null> {
		const vault = this.plugin.app.vault;
		const folder = this.plugin.settings.collectionFolder.trim();
		const safe = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
		if (!safe) return null;
		const path = `${folder ? `${folder}/` : ""}${safe}.md`;

		const existing = vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			new Notice(`${safe} already exists — opening it.`);
			return existing;
		}
		if (folder && !vault.getAbstractFileByPath(folder)) {
			try {
				await vault.createFolder(folder);
			} catch {
				/* may already exist */
			}
		}
		const content = `---\npokemon-list: ${type}\n---\n\n# ${safe}\n\n${this.plugin.markdown.renderSection([])}\n`;
		return vault.create(path, content);
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

	private bulkAdd(): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a note first to add cards into it.");
			return;
		}
		new BulkAddModal(this.plugin, (items) =>
			this.insertEntries(file, items)
		).open();
	}

	/** Run a note write after any write already in progress. */
	private enqueueWrite(task: () => Promise<void>): Promise<void> {
		const next = this.writeQueue.then(task, task);
		this.writeQueue = next.catch(() => undefined);
		return next;
	}

	/** Insert many resolved cards into `file` in a single read/modify/write. */
	private insertEntries(file: TFile, items: BulkItem[]): Promise<void> {
		if (!items.length) return Promise.resolve();
		return this.enqueueWrite(() => this.writeEntries(file, items));
	}

	private async writeEntries(file: TFile, items: BulkItem[]): Promise<void> {
		try {
			const apply = (content: string): string => {
				let c = content;
				for (const it of items) c = this.withEntry(c, it.entry, it.qty);
				return c;
			};
			const view =
				this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const editor =
				view && view.file === file && view.getMode() === "source"
					? view.editor
					: null;
			if (editor) {
				this.setEditorValue(editor, apply(editor.getValue()));
			} else {
				const content = await this.plugin.app.vault.read(file);
				await this.plugin.app.vault.modify(file, apply(content));
			}
		} catch (err) {
			console.error("[pokemon-collection] bulk insert failed", err);
			new Notice(
				`Could not write cards: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
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
	private insertEntry(
		file: TFile,
		entry: CollectionEntry,
		addQty: number
	): Promise<void> {
		return this.enqueueWrite(() => this.writeEntry(file, entry, addQty));
	}

	private async writeEntry(
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
			// Prices of every list are refreshed (wishlist cost needs them),
			// but the portfolio value counts only what you own.
			if (this.plugin.collection.listTypeOf(note.file) !== "collection") continue;
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
			`Updated ${allKeys.size} cards. Collection value: €${totalValue.toFixed(
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
