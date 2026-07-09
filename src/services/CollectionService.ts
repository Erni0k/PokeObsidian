import { TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CardKey } from "../types";

/** One card aggregated across every collection note in scope. */
export interface AggregatedCard {
	key: CardKey;
	id: string;
	name: string;
	setName: string;
	variant: string;
	language: string;
	quantity: number;
	unitPrice: number;
	rarity: string;
	dateAdded?: string;
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

/**
 * Scans the configured collection folder (or the whole vault when blank),
 * reads each note's Markdown table, and aggregates owned cards. This is the
 * bridge between "Markdown = truth" and the dashboard / price snapshots.
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

	/** Files that actually contain a collection section. */
	async getCollectionFiles(): Promise<TFile[]> {
		const files: TFile[] = [];
		for (const file of this.getCandidateFiles()) {
			const content = await this.plugin.app.vault.cachedRead(file);
			if (this.plugin.markdown.hasSection(content)) files.push(file);
		}
		return files;
	}

	/** Aggregate all owned cards across the collection scope. */
	async scan(): Promise<AggregatedCard[]> {
		const byKey = new Map<CardKey, AggregatedCard>();

		for (const file of this.getCandidateFiles()) {
			const content = await this.plugin.app.vault.cachedRead(file);
			if (!this.plugin.markdown.hasSection(content)) continue;
			const entries = this.plugin.markdown.parseEntries(content);

			for (const e of entries) {
				const meta = this.plugin.cache.getMeta(e.key);
				const unit = e.price ?? meta?.marketPrice ?? 0;
				const existing = byKey.get(e.key);
				if (existing) {
					existing.quantity += e.quantity;
					// Prefer a non-zero price if we have one.
					if (!existing.unitPrice && unit) existing.unitPrice = unit;
				} else {
					byKey.set(e.key, {
						key: e.key,
						id: e.id,
						name: e.name,
						setName: e.setName || meta?.setName || "Unknown",
						variant: String(e.variant),
						language: e.language,
						quantity: e.quantity,
						unitPrice: unit,
						rarity: meta?.rarity ?? "Unknown",
						dateAdded: meta?.dateAdded,
					});
				}
			}
		}

		return Array.from(byKey.values());
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
