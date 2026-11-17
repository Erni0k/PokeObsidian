import type PokemonCollectionPlugin from "../main";
import type {
	CardKey,
	TcgdexCardFull,
	TcgdexMarketPricing,
	TcgdexVariantDetailed,
} from "../types";

/** True for variants that are foil on Cardmarket (holo / reverse-holo). */
export function variantIsHolo(variant: string): boolean {
	return /holo|reverse|1st|first/i.test(variant);
}

/** The underlying TCGdex variant type ("normal"|"reverse"|"holo") for a label. */
function variantType(variant: string): "normal" | "reverse" | "holo" {
	if (/reverse/i.test(variant)) return "reverse";
	if (variantIsHolo(variant)) return "holo";
	return "normal";
}

/**
 * A price provider abstracts *where* prices come from. v1 ships only the
 * TCGdex/Cardmarket provider, but the interface lets us add pokemontcg.io or
 * others later without touching callers.
 */
export interface PriceProvider {
	readonly id: string;
	readonly currency: string;
	/** Per-unit market price for a specific variant of a card, if present. */
	priceFor(card: TcgdexCardFull, variant: string): number | undefined;
}

/**
 * Reads Cardmarket prices (EUR). Uses the variant's own pricing from
 * `variants_detailed` when available, and the correct field set: `-holo` fields
 * for holo/reverse variants, plain fields for normal.
 */
export class CardmarketProvider implements PriceProvider {
	readonly id = "tcgdex-cardmarket";
	readonly currency = "EUR";

	priceFor(card: TcgdexCardFull, variant: string): number | undefined {
		const type = variantType(variant);
		const holo = type !== "normal";
		const detailed = card.variants_detailed?.find((v) => v.type === type);
		const cm = detailed?.pricing?.cardmarket ?? card.pricing?.cardmarket;
		return this.fromCardmarket(cm, holo);
	}

	/** Price for a specific detailed printing, using its own pricing block. */
	priceFromDetail(detail: TcgdexVariantDetailed): number | undefined {
		return this.fromCardmarket(
			detail.pricing?.cardmarket,
			detail.type !== "normal"
		);
	}

	private fromCardmarket(
		cm: TcgdexMarketPricing | undefined,
		holo: boolean
	): number | undefined {
		if (!cm) return undefined;
		const candidates = holo
			? [
					cm["trend-holo"],
					cm["avg30-holo"],
					cm["avg7-holo"],
					cm["avg-holo"],
					cm["low-holo"],
				]
			: [cm.trend, cm.avg30, cm.avg7, cm.avg, cm.low];
		for (const v of candidates) {
			if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
		}
		// Fall back to the other field set if the preferred one is empty.
		const alt = holo
			? [cm.trend, cm.avg30, cm.avg, cm.low]
			: [cm["trend-holo"], cm["avg30-holo"], cm["avg-holo"]];
		for (const v of alt) {
			if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
		}
		return undefined;
	}
}

export class PriceService {
	private plugin: PokemonCollectionPlugin;
	private provider: PriceProvider;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
		this.provider = new CardmarketProvider();
	}

	get currency(): string {
		return this.provider.currency;
	}

	/**
	 * Fetch the current price for a card id, update the meta cache, and return
	 * the per-unit price (or undefined if unavailable).
	 */
	async refreshPrice(id: string, variant: string): Promise<number | undefined> {
		const card = await this.plugin.api.getCard(id);
		if (!card) return undefined;
		const price = this.provider.priceFor(card, variant);
		const key: CardKey = `${id}:${variant}`;
		const now = new Date().toISOString();
		const cardmarketUrl = await this.plugin.api.cardmarketUrlForCard(card);

		await this.plugin.cache.putMeta(key, {
			id,
			name: card.name,
			setName: card.set?.name ?? "",
			setCode: card.set?.id ?? "",
			rarity: card.rarity,
			image: card.image,
			setIcon: card.set?.symbol,
			cardUrl: this.plugin.api.cardPageUrl(id),
			marketPrice: price,
			currency: this.provider.currency,
			cardmarketId: card.pricing?.cardmarket?.idProduct,
			cardmarketUrl,
			lastPriceUpdate: now,
			dateAdded: this.plugin.cache.getMeta(key)?.dateAdded ?? now,
		});

		return price;
	}
}
