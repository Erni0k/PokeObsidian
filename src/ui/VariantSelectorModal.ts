import { Modal, Notice, Setting, TextComponent } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import {
	CollectionEntry,
	TcgdexCardFull,
	TcgdexVariantDetailed,
	VARIANT_LABELS,
} from "../types";
import { CardmarketProvider } from "../services/PriceService";
import { buildEntryFromCard } from "./buildEntry";
import type { AddCardCallback } from "./CardSearchModal";

const CUSTOM = "__custom__";

/** A selectable variant option shown in the dropdown. */
interface VariantOption {
	value: string;
	label: string;
	detail?: TcgdexVariantDetailed;
}

const TYPE_LABEL: Record<string, string> = {
	normal: "Normal",
	reverse: "Reverse Holo",
	holo: "Holo",
};

function prettify(s: string): string {
	return s
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

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

		this.options = this.variantOptions();
		this.selectedVariant = this.defaultVariant();
		this.language = this.lang.toUpperCase();
		this.quantity = plugin.settings.defaultQuantity;
		this.price = this.priceForValue(this.selectedVariant);
	}

	/**
	 * Variants the card actually has, preferring the accurate `variants_detailed`
	 * (so a holo-only card never offers "Normal"), with the boolean `variants`
	 * as a fallback.
	 */
	private variantOptions(): VariantOption[] {
		const detailed = this.card.variants_detailed;
		if (detailed && detailed.length) {
			const seen = new Set<string>();
			const out: VariantOption[] = [];
			for (const d of detailed) {
				const value = this.detailValue(d);
				if (seen.has(value)) continue;
				seen.add(value);
				out.push({ value, label: this.detailLabel(d), detail: d });
			}
			if (out.length) return out;
		}

		const v = this.card.variants ?? {};
		const out: VariantOption[] = [];
		if (v.normal) out.push({ value: "normal", label: VARIANT_LABELS.normal });
		if (v.reverse) out.push({ value: "reverse", label: VARIANT_LABELS.reverse });
		if (v.holo) out.push({ value: "holo", label: VARIANT_LABELS.holo });
		if (v.firstEdition)
			out.push({ value: "firstEdition", label: VARIANT_LABELS.firstEdition });
		if (v.wPromo) out.push({ value: "promo", label: VARIANT_LABELS.promo });
		if (!out.length) out.push({ value: "normal", label: VARIANT_LABELS.normal });
		return out;
	}

	/** Stable variant string for a detailed printing (no pipe/colon). */
	private detailValue(d: TcgdexVariantDetailed): string {
		const parts = [d.type];
		if (d.subtype) parts.push(d.subtype);
		if (d.stamp?.length) parts.push(...d.stamp);
		return parts.join("-").toLowerCase();
	}

	private detailLabel(d: TcgdexVariantDetailed): string {
		const base = TYPE_LABEL[d.type] ?? prettify(d.type);
		const extras: string[] = [];
		if (d.subtype) extras.push(prettify(d.subtype));
		if (d.stamp?.length) extras.push(...d.stamp.map(prettify));
		return extras.length ? `${base} (${extras.join(", ")})` : base;
	}

	/** Pick a sensible default: the only option, else normal, else the first. */
	private defaultVariant(): string {
		if (this.options.length === 1) return this.options[0].value;
		const normal = this.options.find((o) => o.value === "normal");
		return (normal ?? this.options[0]).value;
	}

	/** Market price for a variant value, preferring its own detailed pricing. */
	private priceForValue(value: string): number | undefined {
		const opt = this.options.find((o) => o.value === value);
		if (opt?.detail) {
			const p = this.provider.priceFromDetail(opt.detail);
			if (p !== undefined) return p;
		}
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
