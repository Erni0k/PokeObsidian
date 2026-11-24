import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardFull } from "../types";

/**
 * Persist a card's metadata and build a {@link CollectionEntry}. Shared by the
 * variant selector and the bulk importer so identity, cache and link handling
 * stay in one place.
 */
export async function buildEntryFromCard(
	plugin: PokemonCollectionPlugin,
	card: TcgdexCardFull,
	variant: string,
	lang: string,
	quantity: number,
	price: number | undefined,
	languageLabel?: string
): Promise<CollectionEntry> {
	const id = card.id;
	const key = plugin.markdown.keyOf(id, variant);
	const now = new Date().toISOString();
	const cardmarketUrl = await plugin.api.cardmarketUrlForCard(card, lang);

	await plugin.cache.putMeta(key, {
		id,
		lang,
		name: card.name,
		setName: card.set?.name ?? "",
		setCode: card.set?.id ?? "",
		rarity: card.rarity,
		image: card.image,
		setIcon: card.set?.symbol,
		cardUrl: plugin.api.cardPageUrl(id),
		marketPrice: price,
		currency: "EUR",
		cardmarketId: card.pricing?.cardmarket?.idProduct,
		cardmarketUrl,
		lastPriceUpdate: price !== undefined ? now : undefined,
		dateAdded: plugin.cache.getMeta(key)?.dateAdded ?? now,
	});

	return {
		id,
		name: card.name,
		setName: card.set?.name ?? "",
		number: String(card.localId ?? ""),
		variant,
		language: (languageLabel ?? lang).toUpperCase(),
		quantity,
		price,
		key,
	};
}
