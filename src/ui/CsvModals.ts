import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import {
	autoMapping,
	CSV_FIELD_LABELS,
	CSV_FIELDS,
	CsvTable,
	detectPreset,
	Mapping,
	PRESETS,
	PresetId,
	ResolveResult,
} from "../services/CsvImportService";
import { NotePickerModal } from "./ListModals";

/** "Export the whole collection or just this note?" */
export class ExportScopeModal extends Modal {
	private active: TFile;
	private onPick: (scope: "all" | TFile) => void;

	constructor(app: App, active: TFile, onPick: (scope: "all" | TFile) => void) {
		super(app);
		this.active = active;
		this.onPick = onPick;
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "Export collection to CSV" });
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText("All notes in the collection folder")
					.setCta()
					.onClick(() => {
						this.close();
						this.onPick("all");
					})
			)
			.addButton((b) =>
				b.setButtonText(`Only “${this.active.basename}”`).onClick(() => {
					this.close();
					this.onPick(this.active);
				})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export type UnresolvedMode = "manual" | "report";

export interface ImportPlan {
	presetId: PresetId;
	result: ResolveResult;
	unresolved: UnresolvedMode;
	/** Note to import into (also the fallback for rows without a note). */
	target: TFile;
	/** Put rows back into the note named in their "note" column. */
	original: boolean;
}

export interface ImportOutcome {
	added: number;
	manual: number;
	notes: number;
}

/**
 * Import from CSV: detected format + editable column mapping → resolve rows
 * against TCGdex → preview (recognised / not recognised) → one write per
 * target note.
 */
export class CsvImportModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private file: TFile;
	private table: CsvTable;
	private onImport: (plan: ImportPlan) => Promise<ImportOutcome>;

	private presetId: PresetId;
	private mapping: Mapping;
	private result: ResolveResult | null = null;
	private unresolved: UnresolvedMode = "report";
	private target: TFile | null;
	private original = false;
	private busy = false;
	private mappingOpen = false;

	private body!: HTMLElement;

	constructor(
		plugin: PokemonCollectionPlugin,
		file: TFile,
		table: CsvTable,
		target: TFile | null,
		onImport: (plan: ImportPlan) => Promise<ImportOutcome>
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.table = table;
		this.target = target;
		this.onImport = onImport;
		this.presetId = detectPreset(table.headers);
		this.mapping = autoMapping(table.headers, this.presetId);
		this.original = this.presetId === "ours" && this.mapping.note >= 0;
	}

	onOpen(): void {
		this.modalEl.addClass("pokemon-csv-modal");
		this.contentEl.addClass("pokemon-collection-modal");
		this.contentEl.createEl("h3", { text: `Import cards from ${this.file.name}` });
		this.body = this.contentEl.createDiv();
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.body;
		el.empty();
		const detected = PRESETS.find((p) => p.id === this.presetId);
		el.createDiv({
			cls: "pokemon-collection-hint",
			text: `${this.table.rows.length} row(s), ${this.table.headers.length} column(s). ${
				detected ? `Recognised as ${detected.label}.` : "Unknown format — map the columns below."
			}`,
		});

		new Setting(el).setName("Format").addDropdown((dd) => {
			for (const p of PRESETS) dd.addOption(p.id, p.label);
			dd.addOption("custom", "Other (map columns)");
			dd.setValue(this.presetId).onChange((v) => {
				this.presetId = v as PresetId;
				this.mapping = autoMapping(this.table.headers, this.presetId);
				this.result = null;
				this.render();
			});
		});

		this.renderMapping(el);

		const check = new Setting(el).addButton((b) =>
			b
				.setButtonText(this.result ? "Check again" : "Check cards")
				.setCta()
				.onClick(() => void this.resolve(b))
		);
		check.setDesc("Looks every row up on TCGdex: by id, then set + number, then name + set.");

		if (this.result) this.renderPreview(el, this.result);
	}

	private renderMapping(el: HTMLElement): void {
		const details = el.createEl("details", { cls: "pokemon-csv-mapping" });
		details.open = this.mappingOpen || this.presetId === "custom";
		details.addEventListener("toggle", () => (this.mappingOpen = details.open));
		const mapped = CSV_FIELDS.filter((f) => this.mapping[f] >= 0).length;
		details.createEl("summary", { text: `Column mapping (${mapped} mapped)` });
		for (const field of CSV_FIELDS) {
			new Setting(details).setName(CSV_FIELD_LABELS[field]).addDropdown((dd) => {
				dd.addOption("-1", "—");
				this.table.headers.forEach((h, i) => dd.addOption(String(i), h || `(column ${i + 1})`));
				dd.setValue(String(this.mapping[field])).onChange((v) => {
					this.mapping[field] = Number.parseInt(v, 10);
					// A different mapping invalidates the preview.
					if (this.result) {
						this.result = null;
						this.render();
					}
				});
			});
		}
	}

	private async resolve(button: ButtonComponent): Promise<void> {
		if (this.busy) return;
		if (this.mapping.id < 0 && this.mapping.name < 0 && this.mapping.number < 0) {
			new Notice("Map at least the card name, or set + number, or the id.");
			return;
		}
		this.busy = true;
		button.setDisabled(true);
		try {
			this.result = await this.plugin.csvImport.resolveAll(
				this.table,
				this.mapping,
				this.presetId,
				(done, total) => button.setButtonText(`Checking ${done}/${total}…`)
			);
		} finally {
			this.busy = false;
		}
		this.render();
	}

	private renderPreview(el: HTMLElement, r: ResolveResult): void {
		const box = el.createDiv({ cls: "pokemon-csv-preview" });
		const byMethod = new Map<string, number>();
		for (const x of r.resolved) byMethod.set(x.method, (byMethod.get(x.method) ?? 0) + 1);
		const how = [...byMethod].map(([m, n]) => `${n} by ${m}`).join(", ");
		box.createDiv({
			cls: "pokemon-set-summary",
			text: `Recognised ${r.resolved.length} · not recognised ${r.unresolved.length}${
				r.skipped.length ? ` · skipped ${r.skipped.length}` : ""
			}`,
		});
		if (how) box.createDiv({ cls: "pokemon-collection-hint", text: how });

		if (r.unresolved.length) {
			const d = box.createEl("details");
			d.createEl("summary", { text: `Not recognised (${r.unresolved.length})` });
			const ul = d.createEl("ul");
			for (const u of r.unresolved.slice(0, 100)) {
				const f = u.fields;
				const what = [f.name, f.set || f.setCode, f.number && `#${f.number}`].filter(Boolean).join(" · ");
				ul.createEl("li", { text: `Line ${f.line}: ${what || "(empty)"} — ${u.reason}` });
			}
			if (r.unresolved.length > 100) ul.createEl("li", { text: `… and ${r.unresolved.length - 100} more` });

			new Setting(box).setName("Unrecognised rows").addDropdown((dd) => {
				dd.addOption("report", "Skip them (report only)");
				dd.addOption("manual", "Add as manual cards");
				dd.setValue(this.unresolved).onChange((v) => (this.unresolved = v as UnresolvedMode));
			});
		}
		if (r.skipped.length) {
			const d = box.createEl("details");
			d.createEl("summary", { text: `Skipped (${r.skipped.length})` });
			const ul = d.createEl("ul");
			for (const s of r.skipped.slice(0, 50)) ul.createEl("li", { text: `Line ${s.line}: ${s.reason}` });
		}

		const targetSetting = new Setting(box)
			.setName("Import into")
			.setDesc(this.target ? this.target.path : "No note chosen yet.")
			.addButton((b) =>
				b.setButtonText("Choose note…").onClick(() => {
					const files = this.plugin.collection.getCandidateFiles();
					new NotePickerModal(this.app, files, "Import into which note?", (f) => {
						this.target = f;
						targetSetting.setDesc(f.path);
					}).open();
				})
			);
		if (this.mapping.note >= 0) {
			new Setting(box)
				.setName("Restore original notes")
				.setDesc('Put each row back into the note in its "note" column (rows without one go to the note above).')
				.addToggle((t) => t.setValue(this.original).onChange((v) => (this.original = v)));
		}

		new Setting(box).addButton((b) =>
			b
				.setButtonText("Import")
				.setCta()
				.onClick(() => void this.doImport(b))
		);
	}

	private async doImport(button: ButtonComponent): Promise<void> {
		if (this.busy || !this.result) return;
		if (!this.target) {
			new Notice("Choose a note to import into.");
			return;
		}
		this.busy = true;
		button.setDisabled(true).setButtonText("Importing…");
		try {
			const out = await this.onImport({
				presetId: this.presetId,
				result: this.result,
				unresolved: this.unresolved,
				target: this.target,
				original: this.original,
			});
			const skipped = this.unresolved === "report" ? this.result.unresolved.length : 0;
			new Notice(
				`Imported ${out.added} card row(s)${out.manual ? ` (${out.manual} manual)` : ""} into ${out.notes} note(s)${
					skipped ? `; ${skipped} not recognised (see report)` : ""
				}.`
			);
			if (!skipped && !this.result.skipped.length) {
				this.close();
				return;
			}
			// Keep the report of what was left out on screen.
			this.body.empty();
			this.body.createDiv({ cls: "pokemon-set-summary", text: `Imported ${out.added} row(s).` });
			this.renderLeftOut(this.body, this.result, skipped > 0);
		} catch (err) {
			console.error("[pokemon-collection] CSV import failed", err);
			new Notice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
			button.setDisabled(false).setButtonText("Import");
		} finally {
			this.busy = false;
		}
	}

	private renderLeftOut(el: HTMLElement, r: ResolveResult, unresolved: boolean): void {
		const lines: string[] = [];
		if (unresolved) {
			for (const u of r.unresolved) {
				const f = u.fields;
				lines.push(`Line ${f.line}: ${[f.name, f.set || f.setCode, f.number].filter(Boolean).join(" · ")} — ${u.reason}`);
			}
		}
		for (const s of r.skipped) lines.push(`Line ${s.line}: ${s.reason}`);
		el.createDiv({ text: "Not imported:" });
		el.createEl("pre", { cls: "pokemon-csv-report", text: lines.join("\n") });
		new Setting(el).addButton((b) =>
			b.setButtonText("Copy report").onClick(() => {
				void navigator.clipboard.writeText(lines.join("\n"));
				new Notice("Report copied.");
			})
		);
	}
}
