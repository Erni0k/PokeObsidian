import { Modal, Notice, Setting, TextComponent } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { TcgdexCardFull } from "../types";
import { defaultVariant, variantOptions, VariantOption } from "../variants";
import { CardmarketProvider } from "../services/PriceService";
import { buildEntryFromCard } from "./buildEntry";
import type { AddCardCallback } from "./CardSearchModal";

const CUSTOM = "__custom__";

/**
 * "Add Card" step 2: choose a variant (from TCGdex `variants_detailed`, or the
 * boolean `variants` as a fallback, plus a custom option), language, quantity
 * and price (per variant), then insert into the note.
 */
export class VariantSelectorModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private card: TcgdexCardFull;
	private onConfirm: AddCardCallback;

	private selectedVariant: string;
	private customVariant = "";
	private language: string;
	private lang: string;
	private quantity: number;
	private price: number | undefined;

	private provider = new CardmarketProvider();
	private options: VariantOption[];
	private priceComp?: TextComponent;
	private priceEdited = false;

	private customSetting?: Setting;

	constructor(
		plugin: PokemonCollectionPlugin,
		card: TcgdexCardFull,
		onConfirm: AddCardCallback,
		lang?: string
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.card = card;
		this.onConfirm = onConfirm;
		this.lang = lang || plugin.settings.preferredLanguage || "en";

		this.options = variantOptions(card);
		this.selectedVariant = defaultVariant(this.options);
		this.language = this.lang.toUpperCase();
		this.quantity = plugin.settings.defaultQuantity;
		this.price = this.priceForValue(this.selectedVariant);
	}

	/** Market price for a variant value (its own detailed pricing first). */
	private priceForValue(value: string): number | undefined {
		return this.provider.priceFor(this.card, value);
	}

	onOpen(): void {
		try {
			this.build();
		} catch (err) {
			console.error("[pokemon-collection] variant modal render failed", err);
			new Notice(
				`Variant selector failed: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	private build(): void {
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
		meta.createEl("br");
		const cmLink = meta.createEl("a", {
			text: "View on Cardmarket ↗",
			cls: "pokemon-collection-cm-link",
		});
		cmLink.setAttr("target", "_blank");
		void this.plugin.api
			.cardmarketUrlForCard(this.card, this.lang)
			.then((url) => (cmLink.href = url));

		if (this.plugin.settings.enableImagePreviews && this.card.image) {
			const img = contentEl.createEl("img", {
				cls: "pokemon-collection-preview",
			});
			img.src = this.plugin.api.imageUrl(this.card.image, "high") ?? "";
			img.style.maxWidth = `${this.plugin.settings.imageSize}px`;
		}

		new Setting(contentEl)
			.setName("Variant")
			.setDesc("Variants this card actually has, from TCGdex.")
			.addDropdown((dd) => {
				for (const o of this.options) dd.addOption(o.value, o.label);
				dd.addOption(CUSTOM, "Custom…");
				dd.setValue(this.selectedVariant);
				dd.onChange((value) => {
					this.selectedVariant = value;
					this.toggleCustom(value === CUSTOM);
					this.onVariantChanged();
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
			.setDesc("Auto-filled per variant from Cardmarket. Editable.")
			.addText((t) => {
				this.priceComp = t;
				t.setPlaceholder("0.00")
					.setValue(this.price !== undefined ? this.price.toFixed(2) : "")
					.onChange((v) => {
						this.priceEdited = true;
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

	/** Re-price when the variant changes, unless the user edited the price. */
	private onVariantChanged(): void {
		if (this.priceEdited || this.selectedVariant === CUSTOM) return;
		this.price = this.priceForValue(this.selectedVariant);
		this.priceComp?.setValue(
			this.price !== undefined ? this.price.toFixed(2) : ""
		);
	}

	private resolvedVariant(): string {
		if (this.selectedVariant === CUSTOM) {
			return this.customVariant.trim() || "Custom";
		}
		return this.selectedVariant;
	}

	private async confirm(): Promise<void> {
		try {
			await this.doConfirm();
		} catch (err) {
			console.error("[pokemon-collection] failed to add card", err);
			new Notice(
				`Could not add card: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	private async doConfirm(): Promise<void> {
		const variant = this.resolvedVariant();
		const entry = await buildEntryFromCard(
			this.plugin,
			this.card,
			variant,
			this.lang,
			this.quantity,
			this.price,
			this.language
		);

		this.onConfirm(entry, this.quantity);
		new Notice(`Added ${entry.quantity}× ${entry.name} (${variant}).`);
		this.close();
	}
}
