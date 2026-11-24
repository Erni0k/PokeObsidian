import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry } from "../types";
import { cardmarketUrl, slug } from "../cardmarket";
import type { AddCardCallback } from "./CardSearchModal";
import {
	Condition,
	CONDITION_LABELS,
	CONDITIONS,
	DEFAULT_CONDITION,
	normalizeGrade,
} from "../condition";

export interface ManualDefaults {
	name?: string;
	setName?: string;
	number?: string;
	language?: string;
}

/**
 * Add a card that TCGdex doesn't have (promo bundles, regional/other-language
 * printings, etc.) by entering its details by hand. A synthetic id keeps the
 * row's identity stable without depending on the API.
 */
export class ManualAddModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onConfirm: AddCardCallback;

	private name: string;
	private setName: string;
	private number: string;
	private variant = "normal";
	private language: string;
	private quantity: number;
	private price: number | undefined;
	private condition: Condition = DEFAULT_CONDITION;
	private grade = "";

	constructor(
		plugin: PokemonCollectionPlugin,
		onConfirm: AddCardCallback,
		defaults?: ManualDefaults
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
		this.name = defaults?.name ?? "";
		this.setName = defaults?.setName ?? "";
		this.number = defaults?.number ?? "";
		this.language =
			defaults?.language ??
			(plugin.settings.preferredLanguage || "en").toUpperCase();
		this.quantity = plugin.settings.defaultQuantity;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Add card manually" });
		contentEl.createEl("p", {
			cls: "pokemon-collection-hint",
			text: "For cards TCGdex doesn't have. No image or automatic prices, but the card is tracked in your collection.",
		});

		this.textRow(contentEl, "Card name", this.name, (v) => (this.name = v));
		this.textRow(contentEl, "Set", this.setName, (v) => (this.setName = v));
		this.textRow(contentEl, "Number", this.number, (v) => (this.number = v));
		this.textRow(contentEl, "Variant", this.variant, (v) => (this.variant = v));
		new Setting(contentEl).setName("Condition").addDropdown((dd) => {
			for (const c of CONDITIONS) dd.addOption(c, `${c} — ${CONDITION_LABELS[c]}`);
			dd.setValue(this.condition).onChange((v) => (this.condition = v as Condition));
		});
		new Setting(contentEl)
			.setName("Grade")
			.setDesc("Leave empty for raw cards, e.g. PSA 10, CGC 9.5.")
			.addText((t) => t.setPlaceholder("PSA 10").onChange((v) => (this.grade = v)));
		this.textRow(contentEl, "Language", this.language, (v) => (this.language = v));
		this.textRow(contentEl, "Quantity", String(this.quantity), (v) => {
			const n = Number.parseInt(v, 10);
			this.quantity = Number.isFinite(n) && n > 0 ? n : 1;
		});
		this.textRow(contentEl, "Price (EUR)", "", (v) => {
			this.price = this.plugin.markdown.parsePrice(v);
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Add to note")
					.setCta()
					.onClick(() => this.confirm())
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private textRow(
		parent: HTMLElement,
		name: string,
		value: string,
		onChange: (v: string) => void
	): void {
		new Setting(parent).setName(name).addText((t) => {
			t.setValue(value).onChange(onChange);
		});
	}

	private async confirm(): Promise<void> {
		const name = this.name.trim();
		if (!name) {
			new Notice("Enter a card name.");
			return;
		}
		const variant = this.variant.trim().replace(/\|/g, " ") || "normal";
		const setName = this.setName.trim();

		// Synthetic id (no pipe/colon) so identity is stable without TCGdex.
		const id = `manual-${slug(setName)}-${slug(name)}-${slug(this.number) || "x"}`;
		const grade = normalizeGrade(this.grade);
		const key = this.plugin.markdown.keyOf(id, variant, this.condition, grade);
		const printing = this.plugin.markdown.printingKey({ id, variant });
		const now = new Date().toISOString();
		// A graded price is that slab's own, not the card's market price.
		const market = grade ? this.plugin.cache.getMeta(printing)?.marketPrice : this.price;

		await this.plugin.cache.putMeta(printing, {
			id,
			name,
			setName,
			setCode: "",
			marketPrice: market,
			currency: "EUR",
			cardmarketUrl: cardmarketUrl(setName, name),
			lastPriceUpdate: market !== undefined ? now : undefined,
			dateAdded: this.plugin.cache.getMeta(printing)?.dateAdded ?? now,
		});

		const entry: CollectionEntry = {
			id,
			name,
			setName,
			number: this.number.trim(),
			variant,
			language: this.language.trim().toUpperCase() || "EN",
			condition: this.condition,
			grade: grade || undefined,
			quantity: this.quantity,
			price: this.price,
			key,
		};

		this.onConfirm(entry, this.quantity);
		new Notice(`Added ${entry.quantity}× ${name} (manual).`);
		this.close();
	}
}
