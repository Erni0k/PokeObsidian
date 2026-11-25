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
import { CsvImportModal, ExportScopeModal, ImportOutcome, ImportPlan } from "./ui/CsvModals";
import { EXPORT_COLUMNS, readTable } from "./services/CsvImportService";
import { toCsv } from "./csv";
import { formatMoney } from "./currency";
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
			id: "export-csv",
			name: "Export collection to CSV",
			callback: () => this.exportCsvCommand(),
		});

		plugin.addCommand({
			id: "import-csv",
			name: "Import cards from CSV",
			callback: () => this.importCsvCommand(),
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
		const entry = md.entryAtLine(editor.getValue(), editor.getLine(editor.getCursor().line));
		const key = entry?.key;
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
						// id:variant:cond[:grade] key), then remove from the wishlist.
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

	// --- CSV export / import -------------------------------------------------

	private exportCsvCommand(): void {
		const active = this.plugin.app.workspace.getActiveFile();
		const run = (scope: "all" | TFile): void => void this.exportCsv(scope);
		if (active && active.extension === "md") {
			void this.plugin.app.vault.cachedRead(active).then((c) => {
				if (this.plugin.markdown.hasSection(c)) {
					new ExportScopeModal(this.plugin.app, active, run).open();
				} else run("all");
			});
		} else run("all");
	}

	/** Write every card in scope to `<folder>/Exports/…csv` (our own format). */
	async exportCsv(scope: "all" | TFile): Promise<TFile | null> {
		const md = this.plugin.markdown;
		const notes =
			scope === "all"
				? await this.plugin.collection.scanNotes()
				: [{ file: scope, entries: md.parseEntries(await this.plugin.app.vault.read(scope)) }];
		const rows: string[][] = [[...EXPORT_COLUMNS]];
		for (const { file, entries } of notes) {
			for (const e of entries) {
				rows.push([
					e.id,
					e.name,
					e.setName,
					this.setCodeFor(e.id),
					e.number,
					String(e.variant),
					e.language,
					String(e.quantity),
					e.price !== undefined ? e.price.toFixed(2) : "",
					"", // paid: no Paid column in the table yet
					e.condition,
					e.grade ?? "",
					file.path,
					e.price !== undefined ? e.currency ?? this.plugin.price.currency : "",
				]);
			}
		}
		if (rows.length === 1) {
			new Notice("No cards to export.");
			return null;
		}

		const vault = this.plugin.app.vault;
		const root = this.plugin.settings.collectionFolder.trim();
		const folder = `${root ? `${root}/` : ""}Exports`;
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
		const d = new Date();
		const pad = (n: number): string => String(n).padStart(2, "0");
		const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
		const base = scope === "all" ? "pokemon-collection" : scope.basename;
		const path = `${folder}/${base} ${stamp}.csv`;
		// BOM so Excel reads UTF-8 names (é, ★) correctly.
		const file = await vault.create(path, `\uFEFF${toCsv(rows)}`);
		new Notice(`Exported ${rows.length - 1} card row(s) to ${path}.`, 8000);
		return file;
	}

	/** Short set code for a card id ("sv10-021" → "DRI"), else the set id. */
	private setCodeFor(id: string): string {
		if (!id || id.startsWith("manual-") || id.includes("|")) return "";
		const setId = this.plugin.api.setIdFromCardId(id);
		const index = this.plugin.setIndex;
		const entry =
			index.allSets("en").find((s) => s.id === setId) ??
			index.allSets().find((s) => s.id === setId);
		return entry?.abbreviation ?? setId;
	}

	private importCsvCommand(): void {
		const app = this.plugin.app;
		const csvs = app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "csv");
		if (!csvs.length) {
			new Notice("No .csv files in the vault. Copy the export file into your vault first.");
			return;
		}
		const active = app.workspace.getActiveFile();
		const target = active && active.extension === "md" ? active : null;
		new NotePickerModal(app, csvs, "Import which CSV file?", (file) => {
			void app.vault.read(file).then((text) => {
				const table = readTable(text);
				if (!table.headers.length || !table.rows.length) {
					new Notice(`${file.name} has no rows.`);
					return;
				}
				new CsvImportModal(this.plugin, file, table, target, (plan) => this.runImport(plan)).open();
			});
		}).open();
	}

	/** Build entries for an import plan and write them, one write per note. */
	private async runImport(plan: ImportPlan): Promise<ImportOutcome> {
		const csv = this.plugin.csvImport;
		const exact = plan.presetId === "ours";
		const byNote = new Map<string, BulkItem[]>();
		const add = (path: string, entry: CollectionEntry): void => {
			const list = byNote.get(path) ?? [];
			list.push({ entry, qty: entry.quantity });
			byNote.set(path, list);
		};
		const pathFor = (note: string): string =>
			plan.original && note ? (note.endsWith(".md") ? note : `${note}.md`) : plan.target.path;

		let manual = 0;
		for (const r of plan.result.resolved) {
			const entry = await csv.entryFor(r, plan.presetId);
			if (r.method === "manual-id") manual++;
			add(pathFor(r.fields.note), entry);
		}
		if (plan.unresolved === "manual") {
			for (const u of plan.result.unresolved) {
				if (!u.fields.name) continue;
				const keepId = exact && u.fields.id ? u.fields.id : undefined;
				add(pathFor(u.fields.note), await csv.manualEntry(u.fields, plan.presetId, keepId));
				manual++;
			}
		}

		const vault = this.plugin.app.vault;
		let added = 0;
		for (const [path, items] of byNote) {
			let file = vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
				let acc = "";
				for (const part of dir ? dir.split("/") : []) {
					acc = acc ? `${acc}/${part}` : part;
					if (!vault.getAbstractFileByPath(acc)) {
						try {
							await vault.createFolder(acc);
						} catch {
							/* may already exist */
						}
					}
				}
				file = await vault.create(path, "");
			}
			if (file instanceof TFile) {
				await this.insertEntries(file, items);
				added += items.length;
			}
		}
		return { added, manual, notes: byNote.size };
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
				await this.plugin.app.vault.process(file, apply);
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
				await this.plugin.app.vault.process(file, (content) =>
					this.withEntry(content, entry, addQty)
				);
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
		const content = editor.getValue();
		const row = md.entryAtLine(content, editor.getLine(editor.getCursor().line));
		if (!row) {
			new Notice("Place the cursor on a card row in the collection table.");
			return;
		}
		if (row.grade) {
			new Notice(`${row.name} is graded (${row.grade}) — its price is set by hand.`);
			return;
		}

		const notice = new Notice(`Updating ${row.name}…`, 0);
		const market = await this.marketPrices([row]);
		notice.hide();

		const entries = this.maybeAutoSort(
			this.applyPrices(md.parseEntries(content), market, (e) => e.key === row.key)
		);
		const newContent = md.replaceSection(content, entries);
		if (newContent) this.setEditorValue(editor, newContent);

		const price = this.plugin.price.rowPrice(
			market.get(md.printingKey(row)),
			row.condition,
			row.grade
		);
		new Notice(
			price !== undefined
				? `${row.name} (${row.condition}): ${md.formatPrice(price)}`
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

		const notice = new Notice(`Updating ${entries.length} cards…`, 0);
		const market = await this.marketPrices(entries);
		notice.hide();

		const updated = this.maybeAutoSort(this.applyPrices(entries, market));
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

		// First pass: read notes and collect every row.
		const notes: Array<{ file: TFile; content: string; entries: CollectionEntry[] }> =
			[];
		const all: CollectionEntry[] = [];
		for (const file of files) {
			const content = await this.plugin.app.vault.read(file);
			const entries = md.parseEntries(content);
			notes.push({ file, content, entries });
			all.push(...entries);
		}

		const printings = new Set(all.filter((e) => !e.grade).map((e) => md.printingKey(e)));
		const notice = new Notice(`Updating prices for ${printings.size} cards…`, 0);
		const market = await this.marketPrices(all);

		// Second pass: rewrite each note and tally the portfolio value.
		let totalValue = 0;
		let totalCards = 0;
		let otherCurrency = 0;
		const cur = this.plugin.price.currency;
		const uniq = new Set<CardKey>();

		for (const note of notes) {
			let updated = this.maybeAutoSort(this.applyPrices(note.entries, market));
			const changed = md.replaceSection(note.content, updated);
			if (changed && changed !== note.content) {
				// Re-apply to the current text: the note may have changed while prices loaded.
				await this.plugin.app.vault.process(note.file, (content) => {
					updated = this.maybeAutoSort(this.applyPrices(md.parseEntries(content), market));
					return md.replaceSection(content, updated) ?? content;
				});
			}
			// Prices of every list are refreshed (wishlist cost needs them),
			// but the portfolio value counts only what you own.
			if (this.plugin.collection.listTypeOf(note.file) !== "collection") continue;
			for (const e of updated) {
				// Never add two currencies: a graded card's manual price in
				// the old currency stays out of the total until re-entered.
				if (e.price !== undefined && (e.currency ?? cur) !== cur) {
					otherCurrency++;
				} else {
					totalValue += e.quantity * (e.price ?? 0);
				}
				totalCards += e.quantity;
				uniq.add(e.key);
			}
		}

		await this.plugin.cache.addSnapshot({
			timestamp: new Date().toISOString(),
			totalValue,
			totalCards,
			uniqueCards: uniq.size,
			currency: cur,
		});

		notice.hide();
		new Notice(
			`Updated ${printings.size} cards. Collection value: ${formatMoney(totalValue, cur)}.` +
				(otherCurrency
					? ` ${otherCurrency} row(s) keep a price in another currency (manual/graded) and are not counted.`
					: ""),
			otherCurrency ? 10000 : 5000
		);
	}

	// --- shared price refresh ----------------------------------------------

	/**
	 * Fetch the market (NM) price once per printing (`id:variant`) of the
	 * raw rows; graded rows have no automatic price, so they need none.
	 */
	private async marketPrices(
		entries: CollectionEntry[]
	): Promise<Map<CardKey, number | undefined>> {
		const md = this.plugin.markdown;
		const map = new Map<CardKey, number | undefined>();
		for (const e of entries) {
			if (e.grade || !e.id) continue;
			const pk = md.printingKey(e);
			if (map.has(pk)) continue;
			map.set(pk, await this.plugin.price.refreshPrice(e.id, String(e.variant)));
		}
		return map;
	}

	/**
	 * New row prices: raw = market × condition multiplier; graded rows and
	 * rows without a market price keep their current (manual) price.
	 */
	private applyPrices(
		entries: CollectionEntry[],
		market: Map<CardKey, number | undefined>,
		only?: (e: CollectionEntry) => boolean
	): CollectionEntry[] {
		const md = this.plugin.markdown;
		return entries.map((e) => {
			if (e.grade || (only && !only(e))) return e;
			const price = this.plugin.price.rowPrice(
				market.get(md.printingKey(e)),
				e.condition,
				e.grade
			);
			return price === undefined ? e : { ...e, price, currency: this.plugin.price.currency };
		});
	}
}
