import { Modal, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import {
	SORT_FIELD_LABELS,
	SortDirection,
	SortField,
} from "../parser/MarkdownParser";

export type SortCallback = (field: SortField, dir: SortDirection) => void;

/** Small dialog to pick a sort field + direction for the collection table. */
export class SortModal extends Modal {
	private field: SortField = "name";
	private dir: SortDirection = "asc";
	private onConfirm: SortCallback;

	constructor(plugin: PokemonCollectionPlugin, onConfirm: SortCallback) {
		super(plugin.app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Sort collection table" });

		new Setting(contentEl).setName("Sort by").addDropdown((dd) => {
			for (const key of Object.keys(SORT_FIELD_LABELS) as SortField[]) {
				dd.addOption(key, SORT_FIELD_LABELS[key]);
			}
			dd.setValue(this.field).onChange((v) => (this.field = v as SortField));
		});

		new Setting(contentEl).setName("Direction").addDropdown((dd) => {
			dd.addOption("asc", "Ascending (A→Z, low→high)");
			dd.addOption("desc", "Descending (Z→A, high→low)");
			dd.setValue(this.dir).onChange((v) => (this.dir = v as SortDirection));
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Sort")
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm(this.field, this.dir);
					})
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
