import type PokemonCollectionPlugin from "../main";
import type {
	CardKey,
	TcgdexCardFull,
	TcgdexMarketPricing,
	TcgdexVariantDetailed,
} from "../types";
import { baseType, findDetail } from "../variants";

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
 * Reads Cardmarket prices (EUR) for a variant.
 *
 * Pricing block: the variant's own `variants_detailed[].pricing` when it has
 * one, else the card-level pricing.
 *
 * Field set: Cardmarket's `-holo` fields price the *foil version* of a
 * product. So they are used for reverse holos, and for a holo only when the
 * same product also has a non-foil Normal printing. A holo-only card (e.g.
 * Base Set Charizard) is the product itself and is priced in the plain fields.
 * Order: trend → avg30 → avg → low, falling back to the other set if empty.
 */
export class CardmarketProvider implements PriceProvider {
	readonly id = "tcgdex-cardmarket";
	readonly currency = "EUR";

	priceFor(card: TcgdexCardFull, variant: string): number | undefined {
		const detail = findDetail(card, variant);
		const type = detail?.type ?? this.legacyType(card, variant);
		const cm = detail?.pricing?.cardmarket ?? card.pricing?.cardmarket;
		return this.fromCardmarket(cm, this.usesFoilFields(card, type, detail));
	}

	/** Type for a variant with no detailed printing (boolean-only cards, custom text). */
	private legacyType(card: TcgdexCardFull, variant: string): string {
		const t = baseType(variant);
		if (t) return t;
		// "firstEdition"/"promo"/custom: holo only if the card has no normal print.
		const v = card.variants ?? {};
		return v.holo && !v.normal && !/1st|first/i.test(variant) ? "holo" : "normal";
	}

	private usesFoilFields(
		card: TcgdexCardFull,
		type: string,
		detail: TcgdexVariantDetailed | undefined
	): boolean {
		if (type === "reverse") return true;
		if (type !== "holo") return false;
		const detailed = card.variants_detailed;
		if (detailed?.length) {
			const normals = detailed.filter((d) => d.type === "normal");
			if (!normals.length) return false;
			// Separate Cardmarket products → the holo is its own (non-foil) product.
			const id = detail?.pricing?.cardmarket?.idProduct;
			const normalIds = normals
				.map((d) => d.pricing?.cardmarket?.idProduct)
				.filter((x): x is number => typeof x === "number");
			if (id !== undefined && normalIds.length) return normalIds.includes(id);
			return true;
		}
		return !!card.variants?.normal;
	}

	private fromCardmarket(
		cm: TcgdexMarketPricing | undefined,
		foil: boolean
	): number | undefined {
		if (!cm) return undefined;
		const plain = [cm.trend, cm.avg30, cm.avg, cm.low];
		const holo = [cm["trend-holo"], cm["avg30-holo"], cm["avg-holo"], cm["low-holo"]];
		for (const v of foil ? [...holo, ...plain] : [...plain, ...holo]) {
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

	/** Per-unit price of a variant from already-fetched card details. */
	priceFor(card: TcgdexCardFull, variant: string): number | undefined {
		return this.provider.priceFor(card, variant);
	}

	/**
	 * Fetch the current price for a card id, update the meta cache, and return
	 * the per-unit price (or undefined if unavailable).
	 */
	async refreshPrice(id: string, variant: string): Promise<number | undefined> {
		const key: CardKey = `${id}:${variant}`;
		const prev = this.plugin.cache.getMeta(key);
		// Ids are per language (e.g. Japanese "SV2a-006"): fetch in the
		// language the card was added in, not just the preferred one.
		const lang = prev?.lang ?? this.plugin.settings.preferredLanguage ?? "en";
		// Always fetch fresh (stale cache is the offline fallback): a price
		// update served from the 24h cache would never record a change.
		const card = await this.plugin.api.getCard(id, lang, { force: true });
		if (!card) return undefined;
		const price = this.provider.priceFor(card, variant);
		const now = new Date().toISOString();
		const cardmarketUrl = await this.plugin.api.cardmarketUrlForCard(card, lang);

		await this.plugin.cache.putMeta(key, {
			id,
			lang,
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
			dateAdded: prev?.dateAdded ?? now,
		});

		if (price !== undefined) {
			this.plugin.cache.addCardPoint(
				key,
				price,
				this.plugin.settings.priceHistoryPoints
			);
		}

		return price;
	}
}
