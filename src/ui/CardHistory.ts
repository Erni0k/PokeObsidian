import { MarkdownRenderChild, Modal } from "obsidian";
import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import type { CardKey } from "../types";
import { priceChart } from "./charts";
import { changeOverDays, changeSincePrevious, PriceMove } from "../priceHistory";

/** Currency symbol for display. */
export function currencySymbol(plugin: PokemonCollectionPlugin): string {
	return plugin.price.currency === "EUR" ? "€" : "";
}

/** "+€1.20 (+12.5%)" style label for a move. */
export function formatMove(move: PriceMove, cur: string): string {
	const sign = move.abs > 0 ? "+" : move.abs < 0 ? "−" : "";
	const pctSign = move.pct > 0 ? "+" : move.pct < 0 ? "−" : "";
	return `${sign}${cur}${Math.abs(move.abs).toFixed(2)} (${pctSign}${Math.abs(move.pct).toFixed(1)}%)`;
}

/**
 * Resolve the block text to a key with history: an exact `id:variant`, or a
 * bare id (the first recorded variant of that card).
 */
export function resolveHistoryKey(
	plugin: PokemonCollectionPlugin,
	text: string
): CardKey | undefined {
	const t = text.trim();
	if (!t) return undefined;
	const keys = plugin.cache.getCardHistoryKeys();
	if (t.includes(":")) {
		// History is per printing: a full row key (…:LP, …:NM:PSA 10) maps to id:variant.
		const lc = plugin.markdown.printingKey(t).toLowerCase();
		return keys.find((k) => k.toLowerCase() === lc) ?? plugin.markdown.printingKey(t);
	}
	return keys.find((k) => plugin.markdown.splitKey(k).id === t);
}

/**
 * Render a card's price history (header + stepped line chart) into `root`.
 * Returns the chart so the caller can destroy it.
 */
export function renderCardHistory(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement,
	key: CardKey
): Chart | undefined {
	root.empty();
	root.addClass("pokemon-card-history");
	const cur = currencySymbol(plugin);
	const meta = plugin.cache.getMeta(key);
	const { id, variant } = plugin.markdown.splitKey(key);
	const points = plugin.cache.getCardHistory(key);

	const head = root.createDiv({ cls: "pokemon-card-history-head" });
	const img = plugin.api.imageUrl(meta?.image, "low");
	if (img) head.createEl("img", { cls: "pokemon-collection-top-img", attr: { src: img } });
	const info = head.createDiv({ cls: "pokemon-collection-top-info" });
	info.createDiv({
		cls: "pokemon-collection-top-name",
		text: `${meta?.name ?? id} · ${variant}`,
	});
	info.createDiv({
		cls: "pokemon-collection-hint",
		text: [meta?.setName, id].filter(Boolean).join(" · "),
	});

	const last = points[points.length - 1];
	const stats = head.createDiv({ cls: "pokemon-card-history-stats" });
	stats.createDiv({
		cls: "pokemon-collection-top-price",
		text: last ? `${cur}${last.p.toFixed(2)}` : "—",
	});
	const prev = changeSincePrevious(points);
	const month = changeOverDays(points, 30);
	if (prev) moveLine(stats, "last change", prev, cur);
	if (month) moveLine(stats, "30 days", month, cur);

	if (!points.length) {
		root.createEl("p", {
			cls: "pokemon-collection-hint",
			text: 'No price history yet. It is recorded when prices are updated ("Update all collection prices") and the price changes.',
		});
		return undefined;
	}

	// Extend the last price to today so the step reaches "now".
	const data = points.map((p) => ({ x: new Date(p.t).getTime(), y: p.p }));
	const now = Date.now();
	if (data[data.length - 1].x < now) data.push({ x: now, y: last.p });

	const wrap = root.createDiv({ cls: "pokemon-collection-chart-canvas" });
	const chart = priceChart(wrap.createEl("canvas"), data, cur);
	root.createDiv({
		cls: "pokemon-collection-hint",
		text: `${points.length} recorded price${points.length === 1 ? "" : "s"} since ${new Date(points[0].t).toLocaleDateString()}.`,
	});
	return chart;
}

function moveLine(parent: HTMLElement, label: string, move: PriceMove, cur: string): void {
	parent.createDiv({
		cls: `pokemon-move ${move.abs >= 0 ? "pokemon-move-up" : "pokemon-move-down"}`,
		text: `${formatMove(move, cur)} · ${label}`,
	});
}

/** ```pokemon-card sv10-021:normal``` — price chart of one card. */
export class CardHistoryBlock extends MarkdownRenderChild {
	private plugin: PokemonCollectionPlugin;
	private source: string;
	private chart: Chart | undefined;

	constructor(plugin: PokemonCollectionPlugin, containerEl: HTMLElement, source: string) {
		super(containerEl);
		this.plugin = plugin;
		this.source = source;
	}

	render(): void {
		this.chart?.destroy();
		this.chart = undefined;
		const text = this.source.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
		const key = resolveHistoryKey(this.plugin, text);
		if (!key) {
			this.containerEl.empty();
			this.containerEl.createEl("p", {
				cls: "pokemon-collection-hint",
				text: text
					? `No price history for “${text}”. Use a key like sv10-021:normal.`
					: "Put a card key in the block, e.g. sv10-021:normal.",
			});
			return;
		}
		this.chart = renderCardHistory(this.plugin, this.containerEl, key);
	}

	onunload(): void {
		this.chart?.destroy();
	}
}

/** Modal with a card's price chart (opened from the dashboard lists). */
export class CardHistoryModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private key: CardKey;
	private chart: Chart | undefined;

	constructor(plugin: PokemonCollectionPlugin, key: CardKey) {
		super(plugin.app);
		this.plugin = plugin;
		this.key = key;
	}

	onOpen(): void {
		this.modalEl.addClass("pokemon-card-history-modal");
		const body = this.contentEl.createDiv();
		this.chart = renderCardHistory(this.plugin, body, this.key);
		this.contentEl.createDiv({
			cls: "pokemon-collection-hint",
			text: "Embed this chart in a note:",
		});
		this.contentEl.createEl("pre", { text: `\`\`\`pokemon-card\n${this.key}\n\`\`\`` });
	}

	onClose(): void {
		this.chart?.destroy();
		this.contentEl.empty();
	}
}
