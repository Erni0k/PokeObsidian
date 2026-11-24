import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { ListType, TradeCandidate } from "../services/CollectionService";

/** Pick one note out of a list (fuzzy search by path). */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
	private files: TFile[];
	private onChoose: (file: TFile) => void;

	constructor(app: App, files: TFile[], placeholder: string, onChoose: (file: TFile) => void) {
		super(app);
		this.files = files;
		this.onChoose = onChoose;
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path.replace(/\.md$/, "");
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

/** Collection cards owned more than once, with the value of the extra copies. */
export class TradeCandidatesModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private candidates: TradeCandidate[];
	private onInsert: () => void;

	constructor(
		plugin: PokemonCollectionPlugin,
		candidates: TradeCandidate[],
		onInsert: () => void
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.candidates = candidates;
		this.onInsert = onInsert;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h3", { text: "Trade candidates" });
		const cur = this.plugin.price.currency === "EUR" ? "€" : "";
		const money = (n: number): string => `${cur}${n.toFixed(2)}`;

		const surplus = this.candidates.reduce((s, c) => s + c.surplus, 0);
		const value = this.candidates.reduce((s, c) => s + c.value, 0);
		contentEl.createDiv({
			cls: "pokemon-set-summary",
			text: `${this.candidates.length} card(s) owned more than once · ${surplus} spare cop${surplus === 1 ? "y" : "ies"} worth ${money(value)}`,
		});

		const wrap = contentEl.createDiv({ cls: "pokemon-collection-results" });
		const table = wrap.createEl("table", { cls: "pokemon-set-missing" });
		const hr = table.createEl("thead").createEl("tr");
		for (const h of ["", "Card", "Variant", "Owned", "Spare", "Unit", "Spare value"]) {
			hr.createEl("th", { text: h });
		}
		const tbody = table.createEl("tbody");
		for (const c of this.candidates) {
			const tr = tbody.createEl("tr");
			const td = tr.createEl("td", { cls: "pokemon-set-thumb" });
			const src = this.plugin.api.imageUrl(c.image, "low");
			if (src) td.createEl("img", { attr: { src, width: "32", loading: "lazy" } });
			const name = tr.createEl("td");
			name.createDiv({ text: c.entry.name });
			name.createDiv({
				cls: "pokemon-collection-result-meta",
				text: [c.entry.setName, c.entry.number, c.entry.language].filter(Boolean).join(" · "),
			});
			tr.createEl("td", { text: String(c.entry.variant) });
			tr.createEl("td", { text: String(c.owned) });
			tr.createEl("td", { text: String(c.surplus) });
			tr.createEl("td", { cls: "pokemon-set-price", text: c.unitPrice ? money(c.unitPrice) : "—" });
			tr.createEl("td", { cls: "pokemon-set-price", text: c.unitPrice ? money(c.value) : "—" });
		}

		new Setting(contentEl)
			.setDesc("Writes the spare copies into a trade note (Qty = spare count; re-running updates instead of duplicating).")
			.addButton((b) =>
				b
					.setButtonText("Add to trade note…")
					.setCta()
					.onClick(() => {
						this.close();
						this.onInsert();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Ask for a list type and a note name. */
export class CreateListNoteModal extends Modal {
	private onCreate: (type: ListType, name: string) => void;
	private type: ListType;
	private name: string;
	private nameEdited = false;

	constructor(app: App, onCreate: (type: ListType, name: string) => void, type: ListType = "wishlist") {
		super(app);
		this.onCreate = onCreate;
		this.type = type;
		this.name = defaultListName(type);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Create wishlist / trade note" });
		let nameInput: HTMLInputElement | undefined;

		new Setting(contentEl).setName("List type").addDropdown((dd) => {
			dd.addOption("wishlist", "Wishlist (cards you want)");
			dd.addOption("trade", "Trade (cards you offer)");
			dd.setValue(this.type).onChange((v) => {
				this.type = v as ListType;
				if (!this.nameEdited && nameInput) {
					this.name = defaultListName(this.type);
					nameInput.value = this.name;
				}
			});
		});

		new Setting(contentEl).setName("Note name").addText((t) => {
			nameInput = t.inputEl;
			t.setValue(this.name).onChange((v) => {
				this.name = v;
				this.nameEdited = true;
			});
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					this.submit();
				}
			});
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Create")
				.setCta()
				.onClick(() => this.submit())
		);
	}

	private submit(): void {
		const name = this.name.trim();
		if (!name) {
			new Notice("Enter a note name.");
			return;
		}
		this.close();
		this.onCreate(this.type, name);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function defaultListName(type: ListType): string {
	return type === "wishlist" ? "Wishlist" : type === "trade" ? "Trade" : "Collection";
}
