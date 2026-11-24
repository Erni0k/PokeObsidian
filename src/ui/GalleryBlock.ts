import { MarkdownRenderChild, TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { AggregatedCard } from "../services/CollectionService";
import type { SetCardSlots, SetSnapshot } from "../services/SetCompletionService";
import {
	cardmarketSearchUrl,
	cardmarketSingleUrl,
	cardmarketUrl,
	isLatinName,
} from "../cardmarket";
import { formatMoney, isStale, timeAgo } from "../currency";

export type GallerySource = "this" | "folder";
export type GallerySort = "number" | "price" | "name";
export type GalleryLayout = "grid" | "binder";

/** Options from the ```pokemon-gallery block body (`key: value` lines). */
export interface GalleryOptions {
	source: GallerySource;
	sort: GallerySort;
	size: number;
	layout: GalleryLayout;
	/** Set code or id: filters the cards; in binder mode also shows missing slots. */
	set?: string;
	lang?: string;
}

export const BINDER_PAGE = 9;

export function parseGalleryOptions(source: string): GalleryOptions {
	const o: GalleryOptions = { source: "this", sort: "number", size: 120, layout: "grid" };
	for (const raw of source.split(/\r?\n/)) {
		const m = raw.trim().match(/^(\w+)\s*:\s*(.*)$/);
		if (!m) continue;
		const key = m[1].toLowerCase();
		const val = m[2].trim();
		const lc = val.toLowerCase();
		if (key === "source" && (lc === "this" || lc === "folder")) o.source = lc;
		else if (key === "sort" && (lc === "number" || lc === "price" || lc === "name")) o.sort = lc;
		else if (key === "layout" && (lc === "grid" || lc === "binder")) o.layout = lc;
		else if (key === "size") {
			const n = Number.parseInt(val, 10);
			if (Number.isFinite(n)) o.size = Math.min(400, Math.max(60, n));
		} else if (key === "set" && val) o.set = val;
		else if ((key === "lang" || key === "language") && val) o.lang = lc;
	}
	return o;
}

/** The set part of a card id ("sv10-021" → "sv10"). */
function setOf(id: string): string {
	const i = id.lastIndexOf("-");
	return i > 0 ? id.slice(0, i) : id;
}

const byNumber = (a: string, b: string): number =>
	a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function sortCards(cards: AggregatedCard[], sort: GallerySort): AggregatedCard[] {
	const out = cards.slice();
	if (sort === "price") out.sort((a, b) => b.unitPrice - a.unitPrice || a.name.localeCompare(b.name));
	else if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name) || byNumber(a.number, b.number));
	else
		out.sort(
			(a, b) =>
				byNumber(setOf(a.id), setOf(b.id)) || byNumber(a.number, b.number) || a.variant.localeCompare(b.variant)
		);
	return out;
}

/** One binder slot: owned cards (any variants) or a missing card of the set. */
export interface Slot {
	owned: AggregatedCard[];
	/** The set's card for this slot (set mode only). */
	setCard?: SetCardSlots;
}

/** Slots for a whole set in number order; owned matched by card id. */
export function setSlots(snapshot: SetSnapshot, owned: AggregatedCard[]): Slot[] {
	const byId = new Map<string, AggregatedCard[]>();
	for (const c of owned) {
		if (c.quantity <= 0) continue;
		const list = byId.get(c.id) ?? [];
		list.push(c);
		byId.set(c.id, list);
	}
	return snapshot.cards
		.slice()
		.sort((a, b) => byNumber(a.localId, b.localId))
		.map((card) => ({ setCard: card, owned: byId.get(card.id) ?? [] }));
}

/**
 * ```pokemon-gallery — a grid of card thumbnails, or a 3×3 binder with
 * pages; with `set:` the binder shows every card of the set and greys out
 * the missing ones. Re-renders on Refresh and when collection notes change.
 */
export class GalleryBlock extends MarkdownRenderChild {
	private plugin: PokemonCollectionPlugin;
	private opts: GalleryOptions;
	private sourcePath: string;
	private page = 0;
	private rerenderTimer: number | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		plugin: PokemonCollectionPlugin,
		containerEl: HTMLElement,
		source: string,
		sourcePath: string
	) {
		super(containerEl);
		this.plugin = plugin;
		this.opts = parseGalleryOptions(source);
		this.sourcePath = sourcePath;
	}

	onload(): void {
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => {
				if (this.inScope(file)) this.scheduleRerender();
			})
		);
	}

	onunload(): void {
		this.unsubscribe?.();
		if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
	}

	private inScope(file: TFile): boolean {
		if (this.opts.source === "this") return file.path === this.sourcePath;
		return this.plugin.collection.getCandidateFiles().some((f) => f.path === file.path);
	}

	private scheduleRerender(): void {
		if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
		this.rerenderTimer = window.setTimeout(() => {
			this.rerenderTimer = null;
			void this.render();
		}, 800);
	}

	private get lang(): string {
		return this.opts.lang || this.plugin.settings.preferredLanguage || "en";
	}

	async render(): Promise<void> {
		const root = this.containerEl;
		root.empty();
		root.addClass("pokemon-gallery");
		root.style.setProperty("--pg-size", `${this.opts.size}px`);

		const head = root.createDiv({ cls: "pokemon-gallery-head" });
		const title = head.createDiv({ cls: "pokemon-gallery-title" });
		const refresh = head.createEl("button", { text: "Refresh" });
		refresh.onclick = () => void this.render();
		const body = root.createDiv();

		let cards = await this.loadCards();

		// set: resolve once; filter (grid) or full set with missing slots (binder).
		let snapshot: SetSnapshot | undefined;
		let setId: string | undefined;
		if (this.opts.set) {
			setId = await this.plugin.setCompletion.resolveSetId(this.opts.set, this.lang);
			if (!setId) {
				body.createEl("p", {
					cls: "pokemon-collection-hint",
					text: `Unknown set “${this.opts.set}”. Use a set code like DRI or an id like sv10.`,
				});
				return;
			}
			cards = cards.filter((c) => setOf(c.id) === setId);
			if (this.opts.layout === "binder") {
				snapshot = await this.loadSnapshot(setId, body);
				if (!snapshot) return;
			}
		}

		if (snapshot) {
			const slots = setSlots(snapshot, cards);
			const have = slots.filter((s) => s.owned.length).length;
			title.setText(`${snapshot.code ? `${snapshot.name} (${snapshot.code})` : snapshot.name} · ${have}/${slots.length} owned`);
			this.renderBinder(body, slots, snapshot);
			return;
		}

		const sorted = sortCards(cards, this.opts.sort);
		const total = sorted.reduce((s, c) => s + c.quantity, 0);
		// Sum only the active currency; cards still priced in another are noted.
		const totals = this.plugin.collection.totals(sorted);
		const other = Object.values(totals.other).reduce((n, o) => n + o.cards, 0);
		title.setText(
			`${total} card${total === 1 ? "" : "s"} · ${formatMoney(totals.value, this.plugin.price.currency)}` +
				(other ? ` (+${other} priced in another currency)` : "")
		);
		if (!sorted.length) {
			body.createEl("p", {
				cls: "pokemon-collection-hint",
				text:
					this.opts.source === "this"
						? "No cards in this note yet."
						: "No cards found in the collection folder.",
			});
			return;
		}
		if (this.opts.layout === "binder") {
			this.renderBinder(body, sorted.map((c) => ({ owned: [c] })));
		} else {
			const grid = body.createDiv({ cls: "pokemon-gallery-grid" });
			for (const c of sorted) this.ownedTile(grid, [c]);
		}
	}

	/** Cards of this note, or of every collection note in the folder. */
	private async loadCards(): Promise<AggregatedCard[]> {
		if (this.opts.source === "folder") return this.plugin.collection.scan(["collection"]);
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		return file instanceof TFile ? this.plugin.collection.scanFile(file) : [];
	}

	/** The set's cards (cached by set completion; fetched once with progress). */
	private async loadSnapshot(setId: string, body: HTMLElement): Promise<SetSnapshot | undefined> {
		const service = this.plugin.setCompletion;
		const cached = service.getSnapshot(setId, this.lang);
		if (cached && !service.loading(setId, this.lang)) return cached;

		const box = body.createDiv({ cls: "pokemon-set-loading" });
		const label = box.createDiv({ text: "Loading set cards…" });
		const bar = box.createEl("progress");
		this.unsubscribe?.();
		const job = service.fetchSet(setId, this.lang, {
			onProgress: (p) => {
				if (!p.total) return;
				bar.max = p.total;
				bar.value = p.done;
				label.setText(`Loading set cards ${p.done}/${p.total}…`);
			},
		});
		this.unsubscribe = job.unsubscribe;
		const snap = await job.promise;
		job.unsubscribe();
		this.unsubscribe = null;
		box.remove();
		if (!snap) {
			body.createEl("p", {
				cls: "pokemon-collection-hint",
				text: "Could not load this set — check your connection and press Refresh.",
			});
			return undefined;
		}
		return snap;
	}

	private renderBinder(body: HTMLElement, slots: Slot[], snap?: SetSnapshot): void {
		const pages = Math.max(1, Math.ceil(slots.length / BINDER_PAGE));
		this.page = Math.min(Math.max(0, this.page), pages - 1);

		const nav = body.createDiv({ cls: "pokemon-gallery-nav" });
		const prev = nav.createEl("button", { text: "‹ Prev", attr: { "aria-label": "Previous page" } });
		const label = nav.createSpan({ cls: "pokemon-gallery-page" });
		const next = nav.createEl("button", { text: "Next ›", attr: { "aria-label": "Next page" } });
		const sheet = body.createDiv({ cls: "pokemon-gallery-binder" });

		const draw = (): void => {
			sheet.empty();
			const start = this.page * BINDER_PAGE;
			const pageSlots = slots.slice(start, start + BINDER_PAGE);
			for (const slot of pageSlots) {
				if (slot.owned.length) this.ownedTile(sheet, slot.owned, slot.setCard);
				else if (slot.setCard) this.missingTile(sheet, slot.setCard, snap);
			}
			// Keep the 3×3 shape on the last page.
			for (let i = pageSlots.length; i < BINDER_PAGE; i++) {
				sheet.createDiv({ cls: "pokemon-gallery-tile is-empty" });
			}
			const nums = pageSlots.map((s) => s.setCard?.localId).filter(Boolean);
			label.setText(
				`Page ${this.page + 1} / ${pages}${nums.length ? ` · #${nums[0]}–${nums[nums.length - 1]}` : ""}`
			);
			prev.disabled = this.page === 0;
			next.disabled = this.page >= pages - 1;
		};
		prev.onclick = () => {
			this.page--;
			draw();
		};
		next.onclick = () => {
			this.page++;
			draw();
		};
		draw();
	}

	/** A tile for owned card(s): one card id, possibly several variants. */
	private ownedTile(parent: HTMLElement, owned: AggregatedCard[], setCard?: SetCardSlots): void {
		const main = owned.slice().sort((a, b) => b.unitPrice - a.unitPrice)[0];
		const meta = this.plugin.cache.getMeta(main.printingKey);
		const url = meta?.cardmarketUrl ?? cardmarketUrl(main.setName, main.name);
		const qty = owned.reduce((s, c) => s + c.quantity, 0);

		const tile = parent.createDiv({ cls: "pokemon-gallery-tile" });
		const link = this.imageLink(tile, main.image ?? setCard?.image, main.name, url);
		if (qty > 1) link.createSpan({ cls: "pokemon-gallery-qty", text: `×${qty}` });

		const cap = tile.createDiv({ cls: "pokemon-gallery-caption" });
		cap.createDiv({ cls: "pokemon-gallery-name", text: main.name, attr: { title: main.name } });
		const variants = owned.map((c) => this.variantLabel(c)).join(", ");
		const num = main.number || setCard?.localId;
		cap.createDiv({
			cls: "pokemon-gallery-meta",
			text: [num && `#${num}`, variants].filter(Boolean).join(" · "),
			attr: { title: variants },
		});
		const price = cap.createDiv({
			cls: "pokemon-gallery-price",
			text: main.unitPrice ? formatMoney(main.unitPrice, main.currency) : "—",
		});
		if (main.grade) price.title = "Manual price (graded card)";
		else if (main.lastPriceUpdate) {
			price.title = `Updated ${timeAgo(main.lastPriceUpdate)}`;
			if (isStale(main.lastPriceUpdate, this.plugin.settings.stalePriceDays)) {
				price.addClass("pokemon-price-stale");
			}
		}
	}

	/** Greyed slot for a card of the set you don't own. */
	private missingTile(parent: HTMLElement, card: SetCardSlots, snap?: SetSnapshot): void {
		const tile = parent.createDiv({ cls: "pokemon-gallery-tile is-missing" });
		// English data: the exact single ("…/Smoliv-DRI021"); else a name search.
		const num = /^\d+$/.test(card.localId) ? card.localId.padStart(3, "0") : card.localId.toUpperCase();
		const url =
			snap && snap.lang === "en" && isLatinName(card.name)
				? cardmarketSingleUrl(snap.name, card.name, snap.code ? `${snap.code}${num}` : undefined)
				: cardmarketSearchUrl(card.name);
		this.imageLink(tile, card.image, card.name, url);
		const cap = tile.createDiv({ cls: "pokemon-gallery-caption" });
		cap.createDiv({ cls: "pokemon-gallery-name", text: card.name, attr: { title: card.name } });
		cap.createDiv({ cls: "pokemon-gallery-meta", text: `#${card.localId} · missing` });
	}

	private variantLabel(c: AggregatedCard): string {
		const state = c.grade ? c.grade : c.condition && c.condition !== "NM" ? c.condition : "";
		const qty = c.quantity > 1 ? ` ×${c.quantity}` : "";
		return `${c.variant}${state ? ` ${state}` : ""}${qty}`;
	}

	/** Lazy thumbnail in a Cardmarket link; placeholder when there is no image. */
	private imageLink(
		tile: HTMLElement,
		image: string | undefined,
		name: string,
		url: string | undefined
	): HTMLElement {
		const link = url
			? tile.createEl("a", {
					cls: "pokemon-gallery-img",
					href: url,
					attr: { target: "_blank", rel: "noopener", title: `${name} on Cardmarket` },
				})
			: tile.createDiv({ cls: "pokemon-gallery-img" });
		const src = this.plugin.api.imageUrl(image, "low");
		const placeholder = (): void => {
			link.querySelector("img")?.remove();
			link.createDiv({ cls: "pokemon-gallery-placeholder", text: name });
		};
		if (!src) {
			placeholder();
		} else {
			const img = link.createEl("img", {
				attr: { src, alt: name, loading: "lazy", decoding: "async" },
			});
			img.onerror = placeholder;
		}
		return link;
	}
}
