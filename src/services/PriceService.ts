import type PokemonCollectionPlugin from "../main";
import type { CardKey, TcgdexCardFull } from "../types";

/**
 * A price provider abstracts *where* prices come from. v1 ships only the
 * TCGdex/Cardmarket provider, but the interface lets us add pokemontcg.io or
 * others later without touching callers.
 */
export interface PriceProvider {
	readonly id: string;
	readonly currency: string;
	/** Extract a per-unit market price from a full TCGdex card, if present. */
	priceFromCard(card: TcgdexCardFull): number | undefined;
}

/** Reads Cardmarket "trend" (EUR), falling back through average fields. */
export class CardmarketProvider implements PriceProvider {
	readonly id = "tcgdex-cardmarket";
	readonly currency = "EUR";

	priceFromCard(card: TcgdexCardFull): number | undefined {
		const cm = card.pricing?.cardmarket;
		if (!cm) return undefined;
		const value = cm.trend ?? cm.avg30 ?? cm.avg7 ?? cm.avg ?? cm.low;
		return typeof value === "number" && Number.isFinite(value)
			? value
			: undefined;
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
		const price = this.provider.priceFromCard(card);
		const key: CardKey = `${id}:${variant}`;
		const now = new Date().toISOString();

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
			lastPriceUpdate: now,
			dateAdded: this.plugin.cache.getMeta(key)?.dateAdded ?? now,
		});

		return price;
	}
}
