import { TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CardKey, CollectionEntry } from "../types";

/**
 * What a note's table means, from its frontmatter `pokemon-list:`.
 * Missing / unknown = "collection" (cards you own).
 */
export type ListType = "collection" | "wishlist" | "trade";

export const LIST_TYPES: ListType[] = ["collection", "wishlist", "trade"];

/** One card aggregated across every note of the same list type in scope. */
export interface AggregatedCard {
	key: CardKey;
	/** `id:variant` — key of the meta cache and the price history. */
	printingKey: CardKey;
	id: string;
	name: string;
	setName: string;
	/** Collector number from the table ("021"). */
	number: string;
	variant: string;
	condition: string;
	grade?: string;
	language: string;
	quantity: number;
	unitPrice: number;
	rarity: string;
	/** Which kind of list the card was found in. */
	list: ListType;
	dateAdded?: string;
	/** Base image URL from the meta cache (without quality/extension). */
	image?: string;
	/** Vault paths of the notes this card appears in. */
	notePaths: string[];
}

/** The parsed table of one note in scope. */
export interface NoteEntries {
	file: TFile;
	list: ListType;
	entries: CollectionEntry[];
}

export interface CollectionStats {
	totalCards: number;
	uniqueCards: number;
	totalValue: number;
	averageValue: number;
	mostExpensive?: AggregatedCard;
	largestSet?: { name: string; count: number };
	setsOwned: number;
	currency: string;
}

/** Count + value of a list (Σ qty, Σ qty × price). */
export interface ListTotals {
	cards: number;
	unique: number;
	value: number;
}

/** A collection card owned more than once: the copies beyond one can be traded. */
export interface TradeCandidate {
	/** A representative row (variant, lang, number, price) for the card. */
	entry: CollectionEntry;
	owned: number;
	surplus: number;
	unitPrice: number;
	/** surplus × unitPrice. */
	value: number;
	image?: string;
	notePaths: string[];
}

/**
 * Scans the configured collection folder (or the whole vault when blank),
 * reads each note's Markdown table, and aggregates cards per list type. This
 * is the bridge between "Markdown = truth" and the dashboard / price snapshots.
 */
export class CollectionService {
	private plugin: PokemonCollectionPlugin;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
	}

	/** Markdown files in scope (respecting the configured folder). */
	getCandidateFiles(): TFile[] {
		const folder = this.plugin.settings.collectionFolder.trim();
		const all = this.plugin.app.vault.getMarkdownFiles();
		if (!folder) return all;
		const prefix = folder.endsWith("/") ? folder : `${folder}/`;
		return all.filter((f) => f.path === folder || f.path.startsWith(prefix));
	}

	/** List type of a note from its frontmatter (default "collection"). */
	listTypeOf(file: TFile): ListType {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const raw = fm?.["pokemon-list"];
		const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
		return (LIST_TYPES as string[]).includes(v) ? (v as ListType) : "collection";
	}

	/** Files that actually contain a collection section. */
	async getCollectionFiles(): Promise<TFile[]> {
		const files: TFile[] = [];
		for (const file of this.getCandidateFiles()) {
			const content = await this.plugin.app.vault.cachedRead(file);
			if (this.plugin.markdown.hasSection(content)) files.push(file);
		}
		return files;
	}

	/** Notes with a table in scope, optionally only of the given list types. */
	async scanNotes(lists?: ListType[]): Promise<NoteEntries[]> {
		const out: NoteEntries[] = [];
		for (const file of this.getCandidateFiles()) {
			const list = this.listTypeOf(file);
			if (lists && !lists.includes(list)) continue;
			const content = await this.plugin.app.vault.cachedRead(file);
			if (!this.plugin.markdown.hasSection(content)) continue;
			out.push({ file, list, entries: this.plugin.markdown.parseEntries(content) });
		}
		return out;
	}

	/**
	 * Aggregate cards across the scope, one item per (list type, key): the
	 * same card in a collection and a wishlist stays two separate items.
	 */
	async scan(lists?: ListType[]): Promise<AggregatedCard[]> {
		return this.aggregate(await this.scanNotes(lists));
	}

	/** The cards of a single note (its own list type), aggregated by key. */
	async scanFile(file: TFile): Promise<AggregatedCard[]> {
		const content = await this.plugin.app.vault.cachedRead(file);
		if (!this.plugin.markdown.hasSection(content)) return [];
		return this.aggregate([
			{ file, list: this.listTypeOf(file), entries: this.plugin.markdown.parseEntries(content) },
		]);
	}

	/** Aggregate parsed notes, one item per (list type, key). */
	aggregate(notes: NoteEntries[]): AggregatedCard[] {
		const byKey = new Map<string, AggregatedCard>();

		for (const { file, list, entries } of notes) {
			for (const e of entries) {
				const printingKey = this.plugin.markdown.printingKey(e);
				const meta = this.plugin.cache.getMeta(printingKey);
				const unit = this.unitPrice(e, meta?.marketPrice);
				const agg = `${list}\u0000${e.key}`;
				const existing = byKey.get(agg);
				if (existing) {
					existing.quantity += e.quantity;
					// Prefer a non-zero price if we have one.
					if (!existing.unitPrice && unit) existing.unitPrice = unit;
					if (!existing.notePaths.includes(file.path)) {
						existing.notePaths.push(file.path);
					}
				} else {
					byKey.set(agg, {
						key: e.key,
						printingKey,
						id: e.id,
						name: e.name,
						setName: e.setName || meta?.setName || "Unknown",
						number: e.number,
						variant: String(e.variant),
						condition: e.condition,
						grade: e.grade,
						language: e.language,
						quantity: e.quantity,
						unitPrice: unit,
						rarity: meta?.rarity ?? "Unknown",
						list,
						dateAdded: meta?.dateAdded,
						image: meta?.image,
						notePaths: [file.path],
					});
				}
			}
		}

		return Array.from(byKey.values());
	}

	/** Collection cards with Qty > 1 (summed across collection notes). */
	async tradeCandidates(): Promise<TradeCandidate[]> {
		const byKey = new Map<CardKey, TradeCandidate>();
		for (const { file, entries } of await this.scanNotes(["collection"])) {
			for (const e of entries) {
				const meta = this.plugin.cache.getMeta(this.plugin.markdown.printingKey(e));
				const unit = this.unitPrice(e, meta?.marketPrice);
				const c = byKey.get(e.key);
				if (c) {
					c.owned += e.quantity;
					if (!c.unitPrice && unit) c.unitPrice = unit;
					if (!c.notePaths.includes(file.path)) c.notePaths.push(file.path);
				} else {
					byKey.set(e.key, {
						entry: e,
						owned: e.quantity,
						surplus: 0,
						unitPrice: unit,
						value: 0,
						image: meta?.image,
						notePaths: [file.path],
					});
				}
			}
		}
		const out: TradeCandidate[] = [];
		for (const c of byKey.values()) {
			if (c.owned <= 1) continue;
			c.surplus = c.owned - 1;
			c.value = c.surplus * c.unitPrice;
			out.push(c);
		}
		return out.sort((a, b) => b.value - a.value);
	}

	/**
	 * A row's unit price: its own table price, else (raw cards only) the
	 * cached market price × condition multiplier. Graded cards without a
	 * manual price count as 0 — they are never auto-priced.
	 */
	private unitPrice(e: CollectionEntry, market: number | undefined): number {
		if (e.price !== undefined) return e.price;
		return this.plugin.price.rowPrice(market, e.condition, e.grade) ?? 0;
	}

	totals(cards: AggregatedCard[]): ListTotals {
		let count = 0;
		let value = 0;
		for (const c of cards) {
			count += c.quantity;
			value += c.quantity * c.unitPrice;
		}
		return { cards: count, unique: cards.length, value };
	}

	computeStats(cards: AggregatedCard[]): CollectionStats {
		let totalCards = 0;
		let totalValue = 0;
		let mostExpensive: AggregatedCard | undefined;
		const setCounts = new Map<string, number>();

		for (const c of cards) {
			totalCards += c.quantity;
			totalValue += c.quantity * c.unitPrice;
			if (!mostExpensive || c.unitPrice > mostExpensive.unitPrice) {
				mostExpensive = c;
			}
			setCounts.set(
				c.setName,
				(setCounts.get(c.setName) ?? 0) + c.quantity
			);
		}

		let largestSet: { name: string; count: number } | undefined;
		for (const [name, count] of setCounts) {
			if (!largestSet || count > largestSet.count) {
				largestSet = { name, count };
			}
		}

		return {
			totalCards,
			uniqueCards: cards.length,
			totalValue,
			averageValue: totalCards ? totalValue / totalCards : 0,
			mostExpensive,
			largestSet,
			setsOwned: setCounts.size,
			currency: this.plugin.price.currency,
		};
	}
}
