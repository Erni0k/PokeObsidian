import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import {
	CollectionEntry,
	KnownVariant,
	TcgdexCardFull,
	VARIANT_LABELS,
} from "../types";
import { CardmarketProvider } from "../services/PriceService";
import type { AddCardCallback } from "./CardSearchModal";

const CUSTOM = "__custom__";

/**
 * "Add Card" step 2: choose a variant (TCGdex-exposed booleans + a custom
 * option), language, quantity and price, then insert into the note.
 */
export class VariantSelectorModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private card: TcgdexCardFull;
	private onConfirm: AddCardCallback;

	private selectedVariant: string;
	private customVariant = "";
	private language: string;
	private quantity: number;
	private price: number | undefined;

	private customSetting?: Setting;

	constructor(
		plugin: PokemonCollectionPlugin,
		card: TcgdexCardFull,
		onConfirm: AddCardCallback
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.card = card;
		this.onConfirm = onConfirm;

		const available = this.availableVariants();
		this.selectedVariant = available[0] ?? "normal";
		this.language = (plugin.settings.preferredLanguage || "en").toUpperCase();
		this.quantity = plugin.settings.defaultQuantity;
		this.price = new CardmarketProvider().priceFromCard(card);
	}

	/** Known variants that TCGdex flagged true for this card. */
	private availableVariants(): KnownVariant[] {
		const v = this.card.variants ?? {};
		const out: KnownVariant[] = [];
		if (v.normal) out.push("normal");
		if (v.reverse) out.push("reverse");
		if (v.holo) out.push("holo");
		if (v.firstEdition) out.push("firstEdition");
		if (v.wPromo) out.push("promo");
		if (out.length === 0) out.push("normal");
		return out;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: this.card.name });

		const meta = contentEl.createDiv({ cls: "pokemon-collection-card-meta" });
		meta.createEl("span", {
			text: `${this.card.set?.name ?? "?"} · #${this.card.localId ?? "?"} · ${
				this.card.rarity ?? "—"
			}`,
		});

		if (this.plugin.settings.enableImagePreviews && this.card.image) {
			const img = contentEl.createEl("img", {
				cls: "pokemon-collection-preview",
			});
			img.src = this.plugin.api.imageUrl(this.card.image, "high") ?? "";
			img.style.maxWidth = `${this.plugin.settings.imageSize}px`;
		}

		const available = this.availableVariants();
		new Setting(contentEl)
			.setName("Variant")
			.setDesc("Choose an available variant or define a custom one.")
			.addDropdown((dd) => {
				for (const v of available) {
					dd.addOption(v, VARIANT_LABELS[v]);
				}
				dd.addOption(CUSTOM, "Custom…");
				dd.setValue(this.selectedVariant);
				dd.onChange((value) => {
					this.selectedVariant = value;
					this.toggleCustom(value === CUSTOM);
				});
			});

		this.customSetting = new Setting(contentEl)
			.setName("Custom variant")
			.setDesc("e.g. Full Art, Secret Rare, Alt Art")
			.addText((t) => {
				t.setPlaceholder("Full Art").onChange((v) => {
					this.customVariant = v;
				});
			});
		this.toggleCustom(this.selectedVariant === CUSTOM);

		new Setting(contentEl).setName("Language").addText((t) => {
			t.setValue(this.language).onChange((v) => {
				this.language = v.trim().toUpperCase() || this.language;
			});
		});

		new Setting(contentEl).setName("Quantity").addText((t) => {
			t.setValue(String(this.quantity)).onChange((v) => {
				const n = Number.parseInt(v, 10);
				this.quantity = Number.isFinite(n) && n > 0 ? n : 1;
			});
		});

		new Setting(contentEl)
			.setName("Price (EUR)")
			.setDesc(
				this.price !== undefined
					? "Auto-filled from Cardmarket. Editable."
					: "No market price available — enter manually if you like."
			)
			.addText((t) => {
				t.setPlaceholder("0.00")
					.setValue(this.price !== undefined ? this.price.toFixed(2) : "")
					.onChange((v) => {
						this.price = this.plugin.markdown.parsePrice(v);
					});
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

	private toggleCustom(show: boolean): void {
		this.customSetting?.settingEl.toggle(show);
	}

	private resolvedVariant(): string {
		if (this.selectedVariant === CUSTOM) {
			return this.customVariant.trim() || "Custom";
		}
		return this.selectedVariant;
	}

	private async confirm(): Promise<void> {
		const variant = this.resolvedVariant();
		const id = this.card.id;
		const key = this.plugin.markdown.keyOf(id, variant);
		const now = new Date().toISOString();

		// Persist metadata (image, rarity, price…) to the cache keyed by id:variant.
		await this.plugin.cache.putMeta(key, {
			id,
			name: this.card.name,
			setName: this.card.set?.name ?? "",
			setCode: this.card.set?.id ?? "",
			rarity: this.card.rarity,
			image: this.card.image,
			setIcon: this.card.set?.symbol,
			cardUrl: this.plugin.api.cardPageUrl(id),
			marketPrice: this.price,
			currency: "EUR",
			lastPriceUpdate: this.price !== undefined ? now : undefined,
			dateAdded: this.plugin.cache.getMeta(key)?.dateAdded ?? now,
		});

		const entry: CollectionEntry = {
			id,
			name: this.card.name,
			setName: this.card.set?.name ?? "",
			number: (this.card.localId ?? "").toString(),
			variant,
			language: this.language,
			quantity: this.quantity,
			price: this.price,
			key,
		};

		this.onConfirm(entry, this.quantity);
		new Notice(`Added ${entry.quantity}× ${entry.name} (${variant}).`);
		this.close();
	}
}
