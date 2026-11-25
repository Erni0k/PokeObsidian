import type PokemonCollectionPlugin from "../main";
import type {
	TcgdexCardBrief,
	TcgdexCardFull,
	TcgdexVariantDetailed,
	TcgdexVariants,
} from "../types";
import type { AggregatedCard } from "./CollectionService";
import { resolveVariant, variantOptions } from "../variants";

const FILE = "set-completion.json";
/** Parallel card fetches while loading a set's variants. */
const CONCURRENCY = 6;

/** One collectible printing slot of a card (a master-set slot). */
export interface SlotVariant {
	/** Stored variant value, same as in the table key (`id:variant`). */
	value: string;
	label: string;
	/** Per-unit price at the time of the snapshot. */
	price?: number;
}

/** A card of the set with every printing it has. */
export interface SetCardSlots {
	id: string;
	localId: string;
	name: string;
	image?: string;
	variants: SlotVariant[];
	/** Printings without pricing, used to map owned variant text to slots. */
	detailed?: TcgdexVariantDetailed[];
	flags?: TcgdexVariants;
	/** The card's details could not be loaded (variants are a guess). */
	failed?: boolean;
}

/** Cached per-set variant data (expensive to build: one request per card). */
export interface SetSnapshot {
	setId: string;
	lang: string;
	name: string;
	code?: string;
	/** Printed set size (cardCount.official): the regular-set range. */
	official?: number;
	total?: number;
	currency: string;
	/** ISO timestamp of the last full load. */
	fetchedAt: string;
	cards: SetCardSlots[];
}

export interface LoadProgress {
	done: number;
	total: number;
}

export interface MissingItem {
	card: SetCardSlots;
	variant: SlotVariant;
}

export interface CompletionPart {
	owned: number;
	total: number;
	missing: MissingItem[];
	/** Σ price of the missing items that have a price. */
	cost: number;
	/** Missing items without a known price. */
	unpriced: number;
}

export interface CompletionResult {
	snapshot: SetSnapshot;
	/** Cards numbered ≤ official, owned in any variant. */
	regular: CompletionPart;
	/** Every card × variant pair. */
	master: CompletionPart;
	/** Cards whose variants could not be loaded. */
	failed: number;
}

interface Job {
	promise: Promise<SetSnapshot | null>;
	progress: LoadProgress;
	listeners: Set<(p: LoadProgress) => void>;
}

type Store = Record<string, SetSnapshot>;

/**
 * Set completion tracking. Building a set's slot list needs the full details
 * of every card (variants), so it is loaded once, cached in
 * `set-completion.json`, and only reloaded on request. Ownership is joined
 * live from the Markdown tables via {@link CollectionService.scan}.
 */
export class SetCompletionService {
	private plugin: PokemonCollectionPlugin;
	private store: Store = {};
	private jobs = new Map<string, Job>();
	private dir: string;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
		this.dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
	}

	async load(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.dir}/${FILE}`;
			if (await adapter.exists(path)) {
				this.store = JSON.parse(await adapter.read(path)) as Store;
			}
		} catch (err) {
			console.error(`[pokemon-collection] failed reading ${FILE}`, err);
		}
	}

	private key(setId: string, lang: string): string {
		return `${lang}/${setId}`;
	}

	/** Resolve a set code ("DRI", localized "RVD") or id ("sv10") to a set id. */
	async resolveSetId(query: string, lang: string): Promise<string | undefined> {
		const q = query.trim();
		if (!q) return undefined;
		return this.plugin.api.resolveSetCode(q, lang, true);
	}

	/** The cached snapshot for a set, if it was loaded before. */
	getSnapshot(setId: string, lang: string): SetSnapshot | undefined {
		return this.store[this.key(setId, lang)];
	}

	/** Progress of a running load, if any. */
	loading(setId: string, lang: string): LoadProgress | undefined {
		return this.jobs.get(this.key(setId, lang))?.progress;
	}

	/**
	 * Load (or reload) a set's cards and their variants. Concurrent calls for
	 * the same set share one load. `force` bypasses the API cache for cards
	 * (fresh prices).
	 */
	fetchSet(
		setId: string,
		lang: string,
		opts: { force?: boolean; onProgress?: (p: LoadProgress) => void } = {}
	): { promise: Promise<SetSnapshot | null>; unsubscribe: () => void } {
		const key = this.key(setId, lang);
		let job = this.jobs.get(key);
		if (!job) {
			const fresh: Job = {
				progress: { done: 0, total: 0 },
				listeners: new Set(),
				promise: Promise.resolve(null),
			};
			fresh.promise = this.build(setId, lang, !!opts.force, (p) => {
				fresh.progress = p;
				for (const l of fresh.listeners) l(p);
			}).finally(() => this.jobs.delete(key));
			this.jobs.set(key, fresh);
			job = fresh;
		}
		const listener = opts.onProgress;
		if (listener) {
			job.listeners.add(listener);
			listener(job.progress);
		}
		const j = job;
		return {
			promise: job.promise,
			unsubscribe: () => {
				if (listener) j.listeners.delete(listener);
			},
		};
	}

	private async build(
		setId: string,
		lang: string,
		force: boolean,
		progress: (p: LoadProgress) => void
	): Promise<SetSnapshot | null> {
		const api = this.plugin.api;
		const set = await api.getSet(setId, lang);
		const briefs = set?.cards ?? [];
		if (!set || !briefs.length) return null;

		const prev = this.getSnapshot(setId, lang);
		const prevById = new Map(prev?.cards.map((c) => [c.id, c]) ?? []);
		const out = new Array<SetCardSlots>(briefs.length);
		let done = 0;
		progress({ done, total: briefs.length });

		let next = 0;
		const worker = async (): Promise<void> => {
			while (next < briefs.length) {
				const i = next++;
				const brief = briefs[i];
				let full: TcgdexCardFull | null = null;
				try {
					full = await api.getCard(brief.id, lang, { force });
				} catch (err) {
					console.error(`[pokemon-collection] card ${brief.id}`, err);
				}
				out[i] = full
					? this.slotsFor(brief, full)
					: (prevById.get(brief.id) ?? this.guessSlots(brief));
				done++;
				progress({ done, total: briefs.length });
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(CONCURRENCY, briefs.length) }, worker)
		);

		const snapshot: SetSnapshot = {
			setId: set.id,
			lang,
			name: set.name,
			code: set.abbreviation?.official,
			official: set.cardCount?.official,
			total: set.cardCount?.total ?? briefs.length,
			currency: this.plugin.price.currency,
			fetchedAt: new Date().toISOString(),
			cards: out,
		};
		this.store[this.key(setId, lang)] = snapshot;
		await this.save();
		return snapshot;
	}

	private slotsFor(brief: TcgdexCardBrief, card: TcgdexCardFull): SetCardSlots {
		const variants = variantOptions(card).map((o) => ({
			value: o.value,
			label: o.label,
			price: this.plugin.price.priceFor(card, o.value),
		}));
		return {
			id: card.id,
			localId: String(card.localId ?? brief.localId ?? ""),
			name: card.name ?? brief.name,
			image: card.image ?? brief.image,
			variants,
			detailed: card.variants_detailed
				?.filter((d) => d?.type)
				.map(({ type, subtype, stamp, size }) => ({ type, subtype, stamp, size })),
			flags: card.variants,
		};
	}

	private guessSlots(brief: TcgdexCardBrief): SetCardSlots {
		return {
			id: brief.id,
			localId: String(brief.localId ?? ""),
			name: brief.name,
			image: brief.image,
			variants: [{ value: "normal", label: "Normal" }],
			failed: true,
		};
	}

	/** Join a snapshot with the owned cards (keys `id:variant`). */
	compute(snapshot: SetSnapshot, owned: AggregatedCard[]): CompletionResult {
		const byId = new Map(snapshot.cards.map((c) => [c.id, c]));
		/** card id → owned slot values (or custom variant text). */
		const have = new Map<string, Set<string>>();
		for (const o of owned) {
			if (o.quantity <= 0) continue;
			const card = byId.get(o.id);
			if (!card) continue;
			const value = this.slotValue(card, o.variant);
			let s = have.get(o.id);
			if (!s) have.set(o.id, (s = new Set()));
			s.add(value);
		}

		const regular = emptyPart();
		const master = emptyPart();
		let failed = 0;

		for (const card of snapshot.cards) {
			if (card.failed) failed++;
			const got = have.get(card.id);

			for (const v of card.variants) {
				master.total++;
				if (got?.has(v.value)) master.owned++;
				else addMissing(master, card, v);
			}

			if (!this.isRegular(card, snapshot.official)) continue;
			regular.total++;
			if (got?.size) {
				regular.owned++;
			} else {
				addMissing(regular, card, cheapest(card.variants));
			}
		}

		return { snapshot, regular, master, failed };
	}

	/** Regular set = numbered cards up to the printed set size. */
	private isRegular(card: SetCardSlots, official: number | undefined): boolean {
		if (!official) return true;
		if (!/^\d+$/.test(card.localId)) return false;
		return Number.parseInt(card.localId, 10) <= official;
	}

	/** Map an owned variant ("Reverse Holo", "reverse", "holo-…") to a slot value. */
	private slotValue(card: SetCardSlots, variant: string): string {
		const v = variant.trim();
		const lc = v.toLowerCase();
		const direct = card.variants.find(
			(s) => s.value === lc || s.label.toLowerCase() === lc
		);
		if (direct) return direct.value;
		const fake: TcgdexCardFull = {
			id: card.id,
			name: card.name,
			variants: card.flags,
			variants_detailed: card.detailed,
		};
		return resolveVariant(fake, v);
	}

	private async save(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
			await adapter.write(`${this.dir}/${FILE}`, JSON.stringify(this.store));
		} catch (err) {
			console.error(`[pokemon-collection] failed writing ${FILE}`, err);
		}
	}
}

function emptyPart(): CompletionPart {
	return { owned: 0, total: 0, missing: [], cost: 0, unpriced: 0 };
}

function addMissing(part: CompletionPart, card: SetCardSlots, v: SlotVariant): void {
	part.missing.push({ card, variant: v });
	if (typeof v.price === "number") part.cost += v.price;
	else part.unpriced++;
}

/** The cheapest priced variant (cheapest way to fill a regular slot). */
function cheapest(variants: SlotVariant[]): SlotVariant {
	let best: SlotVariant | undefined;
	for (const v of variants) {
		if (typeof v.price !== "number") continue;
		if (!best || (best.price as number) > v.price) best = v;
	}
	return best ?? variants[0];
}
