import { MarkdownRenderChild, TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import { formatMoney, isStale, timeAgo } from "../currency";
import type {
	CompletionPart,
	CompletionResult,
	LoadProgress,
	SetSnapshot,
} from "../services/SetCompletionService";

type Mode = "regular" | "master";

/**
 * Parsed ```pokemon-set block: a set code/id plus optional `lang:`, `mode:`
 * and `languages:` (which owned-card languages count: `any`, or a list like
 * `en, fr`; default = the block's language).
 */
export interface SetBlockConfig {
	set: string;
	lang?: string;
	mode?: Mode;
	/** Lowercased Lang column values that count, or "any". */
	languages?: string[] | "any";
}

export function parseSetBlock(source: string): SetBlockConfig {
	const cfg: SetBlockConfig = { set: "" };
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = line.match(/^(\w+)\s*:\s*(.*)$/);
		if (!m) {
			if (!cfg.set) cfg.set = line;
			continue;
		}
		const [, k, v] = m;
		const key = k.toLowerCase();
		const val = v.trim();
		if (key === "set") cfg.set = val;
		else if (key === "lang" || key === "language") cfg.lang = val.toLowerCase();
		else if (key === "mode" && /^(regular|master)$/i.test(val)) {
			cfg.mode = val.toLowerCase() as Mode;
		} else if (key === "languages" || key === "owned") {
			const list = val
				.toLowerCase()
				.split(/[\s,]+/)
				.filter(Boolean);
			if (list.some((l) => l === "any" || l === "all")) cfg.languages = "any";
			else if (list.length) cfg.languages = list;
		}
	}
	return cfg;
}

/**
 * Renders set completion inside a note. Set data (one request per card) comes
 * from the {@link SetCompletionService} cache and is fetched only when the set
 * was never loaded or the user clicks "Refresh prices"; ownership is re-read
 * from the collection tables on every render (cheap).
 */
export class SetCompletionBlock extends MarkdownRenderChild {
	private plugin: PokemonCollectionPlugin;
	private cfg: SetBlockConfig;
	private lang: string;
	private mode: Mode;
	private setId: string | undefined;
	private unsubscribe: (() => void) | null = null;
	private rerenderTimer: number | null = null;

	constructor(
		plugin: PokemonCollectionPlugin,
		containerEl: HTMLElement,
		source: string
	) {
		super(containerEl);
		this.plugin = plugin;
		this.cfg = parseSetBlock(source);
		this.lang = this.cfg.lang || plugin.settings.preferredLanguage || "en";
		this.mode = this.cfg.mode ?? "regular";
	}

	onload(): void {
		// Re-join ownership when a collection note changes (no network).
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
		return this.plugin.collection.getCandidateFiles().some((f) => f.path === file.path);
	}

	private scheduleRerender(): void {
		if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
		this.rerenderTimer = window.setTimeout(() => {
			this.rerenderTimer = null;
			void this.render();
		}, 800);
	}

	async render(): Promise<void> {
		const root = this.containerEl;
		root.empty();
		root.addClass("pokemon-set-block");

		if (!this.cfg.set) {
			this.hint(root, "Put a set code or id in the block, e.g. DRI or sv10.");
			return;
		}

		const service = this.plugin.setCompletion;
		if (!this.setId) {
			this.hint(root, `Looking up set “${this.cfg.set}”…`);
			this.setId = await service.resolveSetId(this.cfg.set, this.lang);
			root.empty();
			if (!this.setId) {
				this.hint(
					root,
					`Unknown set “${this.cfg.set}” (${this.lang.toUpperCase()}). Use a set code like DRI or a TCGdex id like sv10.`
				);
				return;
			}
		}

		const snapshot = service.getSnapshot(this.setId, this.lang);
		if (!snapshot || service.loading(this.setId, this.lang)) {
			await this.loadAndRender(false);
			return;
		}
		await this.renderSnapshot(snapshot);
	}

	/** Fetch the set's variants with a progress bar, then render. */
	private async loadAndRender(force: boolean): Promise<void> {
		const setId = this.setId;
		if (!setId) return;
		const root = this.containerEl;
		root.empty();
		const box = root.createDiv({ cls: "pokemon-set-loading" });
		const label = box.createDiv({ text: "Loading set cards…" });
		const bar = box.createEl("progress");
		bar.max = 1;
		bar.value = 0;
		const onProgress = (p: LoadProgress): void => {
			if (!p.total) return;
			bar.max = p.total;
			bar.value = p.done;
			label.setText(`Loading card variants ${p.done}/${p.total}…`);
		};

		this.unsubscribe?.();
		const job = this.plugin.setCompletion.fetchSet(setId, this.lang, {
			force,
			onProgress,
		});
		this.unsubscribe = job.unsubscribe;
		const snapshot = await job.promise;
		job.unsubscribe();
		this.unsubscribe = null;

		if (!snapshot) {
			root.empty();
			this.hint(root, "Could not load this set — check your connection and try again.");
			const retry = root.createEl("button", { text: "Retry" });
			retry.onclick = () => void this.loadAndRender(force);
			return;
		}
		await this.renderSnapshot(snapshot);
	}

	private async renderSnapshot(snapshot: SetSnapshot): Promise<void> {
		const langs = this.ownedLanguages();
		// Only cards you own: wishlist/trade lists don't fill slots.
		const owned = (await this.plugin.collection.scan(["collection"])).filter(
			(c) => !langs || langs.includes(c.language.trim().toLowerCase())
		);
		const result = this.plugin.setCompletion.compute(snapshot, owned);

		const root = this.containerEl;
		root.empty();
		this.renderHeader(root, result);
		const body = root.createDiv();
		this.renderList(body, result);
	}

	private renderHeader(root: HTMLElement, r: CompletionResult): void {
		const s = r.snapshot;
		const head = root.createDiv({ cls: "pokemon-set-header" });
		const title = head.createDiv({ cls: "pokemon-set-title" });
		title.createEl("h3", {
			text: s.code ? `${s.name} (${s.code})` : s.name,
		});
		const langs = this.ownedLanguages();
		title.createSpan({
			cls: "pokemon-set-meta",
			text: `${s.setId} · ${s.lang.toUpperCase()} · counting ${
				langs ? langs.map((l) => l.toUpperCase()).join(", ") : "all languages"
			}`,
		});

		const bars = head.createDiv({ cls: "pokemon-set-bars" });
		this.progressRow(bars, "Regular", r.regular);
		this.progressRow(bars, "Master", r.master);

		if (r.failed) {
			head.createDiv({
				cls: "pokemon-collection-hint",
				text: `${r.failed} card(s) could not be loaded; their variants are guessed. Refresh to retry.`,
			});
		}
	}

	private progressRow(parent: HTMLElement, label: string, part: CompletionPart): void {
		const row = parent.createDiv({ cls: "pokemon-set-bar-row" });
		row.createSpan({ cls: "pokemon-set-bar-label", text: label });
		const bar = row.createEl("progress");
		bar.max = Math.max(part.total, 1);
		bar.value = part.owned;
		const pct = part.total ? (part.owned / part.total) * 100 : 0;
		row.createSpan({
			cls: "pokemon-set-bar-value",
			text: `${part.owned}/${part.total} (${pct.toFixed(1)}%)`,
		});
	}

	private renderList(body: HTMLElement, r: CompletionResult): void {
		const part = this.mode === "master" ? r.master : r.regular;
		const money = (n: number): string => formatMoney(n, r.snapshot.currency);

		const bar = body.createDiv({ cls: "pokemon-set-toolbar" });
		const toggle = bar.createDiv({ cls: "pokemon-set-toggle" });
		for (const m of ["regular", "master"] as Mode[]) {
			const btn = toggle.createEl("button", {
				text: m === "regular" ? "Regular" : "Master",
			});
			if (m === this.mode) btn.addClass("mod-cta");
			btn.onclick = () => {
				if (this.mode === m) return;
				this.mode = m;
				body.empty();
				this.renderList(body, r);
			};
		}
		const refresh = bar.createEl("button", { text: "Refresh prices" });
		refresh.title =
			"Reload every card of this set from TCGdex for current prices of the missing cards (slow). To re-price the cards in your notes, use \"Update prices\" on the dashboard.";
		refresh.onclick = () => void this.loadAndRender(true);

		const summary = body.createDiv({ cls: "pokemon-set-summary" });
		if (!part.missing.length) {
			summary.setText(
				this.mode === "master" ? "Master set complete! 🎉" : "Set complete! 🎉"
			);
		} else {
			const what = this.mode === "master" ? "printing(s)" : "card(s)";
			let text = `Missing ${part.missing.length} ${what} · Cost to complete: ${money(part.cost)}`;
			if (part.unpriced) text += ` (+${part.unpriced} without a price)`;
			summary.setText(text);
		}

		if (part.missing.length) {
			const table = body.createEl("table", { cls: "pokemon-set-missing" });
			const hr = table.createEl("thead").createEl("tr");
			for (const h of ["", "#", "Card", "Variant", "Price"]) hr.createEl("th", { text: h });
			const tbody = table.createEl("tbody");
			for (const { card, variant } of part.missing) {
				const tr = tbody.createEl("tr");
				const imgCell = tr.createEl("td", { cls: "pokemon-set-thumb" });
				const src = this.plugin.api.imageUrl(card.image, "low");
				if (src) {
					const img = imgCell.createEl("img", { attr: { src, loading: "lazy", alt: card.name } });
					img.width = 40;
				}
				tr.createEl("td", { text: card.localId });
				tr.createEl("td", { text: card.name });
				tr.createEl("td", { text: variant.label });
				tr.createEl("td", {
					cls: "pokemon-set-price",
					text: typeof variant.price === "number" ? money(variant.price) : "—",
				});
			}
		}

		const when = new Date(r.snapshot.fetchedAt);
		const stale = isStale(r.snapshot.fetchedAt, this.plugin.settings.stalePriceDays);
		const otherCurrency = r.snapshot.currency !== this.plugin.price.currency;
		const note = body.createDiv({
			cls: "pokemon-collection-hint",
			text: `Prices (${r.snapshot.currency}) updated ${timeAgo(r.snapshot.fetchedAt)}${
				otherCurrency
					? ` — your price source is now ${this.plugin.price.sourceLabel} (${this.plugin.price.currency}); click “Refresh prices”`
					: stale
						? " — click “Refresh prices” for current ones"
						: ""
			}.`,
			attr: { title: when.toLocaleString() },
		});
		if (stale || otherCurrency) note.addClass("pokemon-price-stale");
	}

	/**
	 * Lang column values (lowercased) of owned cards that count, or null for
	 * all. Default: the block's language, since its variants and prices are.
	 */
	private ownedLanguages(): string[] | null {
		const l = this.cfg.languages;
		if (l === "any") return null;
		return l ?? [this.lang];
	}

	private hint(root: HTMLElement, text: string): void {
		root.createEl("p", { cls: "pokemon-collection-hint", text });
	}
}
