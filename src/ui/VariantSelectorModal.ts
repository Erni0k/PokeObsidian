import { Modal, Notice, Setting, TextComponent } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { TcgdexCardFull } from "../types";
import { defaultVariant, variantOptions, VariantOption } from "../variants";
import { CardmarketProvider } from "../services/PriceService";
import { buildEntryFromCard } from "./buildEntry";
import {
	Condition,
	CONDITION_LABELS,
	CONDITIONS,
	DEFAULT_CONDITION,
	normalizeGrade,
} from "../condition";
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
	private condition: Condition = DEFAULT_CONDITION;
	private grade = "";
	private priceSetting?: Setting;

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

	/**
	 * Row price for a variant value: market (its own detailed pricing first)
	 * × condition multiplier; none for graded cards (priced by hand).
	 */
	private priceForValue(value: string): number | undefined {
		return this.plugin.price.rowPrice(
			this.provider.priceFor(this.card, value),
			this.condition,
			normalizeGrade(this.grade)
		);
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
			.then((url) => {
				if (url) cmLink.href = url;
				else cmLink.hide(); // e.g. Japanese-only trainer: no English name
			});

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

		new Setting(contentEl)
			.setName("Condition")
			.setDesc("Raw card condition; the price uses the multiplier from settings.")
			.addDropdown((dd) => {
				for (const c of CONDITIONS) dd.addOption(c, `${c} — ${CONDITION_LABELS[c]}`);
				dd.setValue(this.condition).onChange((v) => {
					this.condition = v as Condition;
					this.onVariantChanged();
				});
			});

		new Setting(contentEl)
			.setName("Grade")
			.setDesc("Leave empty for raw cards, e.g. PSA 10, CGC 9.5, BGS 9.")
			.addText((t) => {
				t.setPlaceholder("PSA 10").onChange((v) => {
					this.grade = v;
					this.onVariantChanged();
				});
			});

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

		this.priceSetting = new Setting(contentEl)
			.setName("Price (EUR)")
			.setDesc(this.priceDesc())
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

	private priceDesc(): string {
		return normalizeGrade(this.grade)
			? "Graded card: no automatic price — enter it by hand. Price updates keep it."
			: "Auto-filled per variant and condition from Cardmarket. Editable.";
	}

	/** Re-price when variant/condition/grade change, unless the user edited the price. */
	private onVariantChanged(): void {
		this.priceSetting?.setDesc(this.priceDesc());
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
			this.language,
			{ condition: this.condition, grade: this.grade }
		);

		this.onConfirm(entry, this.quantity);
		const extra = entry.grade ? `, ${entry.grade}` : entry.condition !== "NM" ? `, ${entry.condition}` : "";
		new Notice(`Added ${entry.quantity}× ${entry.name} (${variant}${extra}).`);
		this.close();
	}
}
