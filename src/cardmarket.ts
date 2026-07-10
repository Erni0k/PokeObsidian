import type { TcgdexCardFull } from "./types";

/**
 * Cardmarket link helpers.
 *
 * TCGdex exposes the Cardmarket `idProduct`, but Cardmarket does not offer a
 * reliable public deep-link by product id, so we link to a search by card name
 * which always resolves. `idProduct` is still stored for future use.
 */
export function cardmarketSearchUrl(name: string): string {
	const q = encodeURIComponent(name.trim());
	return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q}`;
}

/** Best available Cardmarket URL for a card. */
export function cardmarketUrlForCard(card: TcgdexCardFull): string {
	return cardmarketSearchUrl(card.name);
}
