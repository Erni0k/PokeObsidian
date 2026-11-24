import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardFull } from "../types";
import { normalizeCondition, normalizeGrade } from "../condition";

export interface EntryOptions {
	/** Raw condition (NM default). */
	condition?: string;
	/** Grade, e.g. "PSA 10"; graded cards are priced by hand only. */
	grade?: string;
}

/**
 * Persist a card's metadata and build a {@link CollectionEntry}. Shared by the
 * variant selector and the bulk importer so identity, cache and link handling
 * stay in one place. Meta is per printing (`id:variant`) and stores the
 * market (NM) price; `price` is the row's own price (condition-adjusted or
 * manual).
 */
export async function buildEntryFromCard(
	plugin: PokemonCollectionPlugin,
	card: TcgdexCardFull,
	variant: string,
	lang: string,
	quantity: number,
	price: number | undefined,
	languageLabel?: string,
	opts: EntryOptions = {}
): Promise<CollectionEntry> {
	const id = card.id;
	const condition = normalizeCondition(opts.condition);
	const grade = normalizeGrade(opts.grade);
	const key = plugin.markdown.keyOf(id, variant, condition, grade);
	const printing = plugin.markdown.printingKey({ id, variant });
	const market = plugin.price.priceFor(card, variant);
	const now = new Date().toISOString();
	const cardmarketUrl = await plugin.api.cardmarketUrlForCard(card, lang);

	await plugin.cache.putMeta(printing, {
		id,
		lang,
		name: card.name,
		setName: card.set?.name ?? "",
		setCode: card.set?.id ?? "",
		rarity: card.rarity,
		image: card.image,
		setIcon: card.set?.symbol,
		cardUrl: plugin.api.cardPageUrl(id),
		marketPrice: market,
		currency: "EUR",
		cardmarketId: card.pricing?.cardmarket?.idProduct,
		cardmarketUrl,
		lastPriceUpdate: market !== undefined ? now : undefined,
		dateAdded: plugin.cache.getMeta(printing)?.dateAdded ?? now,
	});

	return {
		id,
		name: card.name,
		setName: card.set?.name ?? "",
		number: String(card.localId ?? ""),
		variant,
		language: (languageLabel ?? lang).toUpperCase(),
		condition,
		grade: grade || undefined,
		quantity,
		price,
		key,
	};
}
