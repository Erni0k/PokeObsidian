import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import type {
	AggregatedCard,
	CollectionStats,
} from "../services/CollectionService";
import { lineChart, pieChart } from "./charts";

/**
 * Renders the dashboard (statistics + charts) into `root` and returns the
 * created Chart instances so the caller can destroy them on re-render/unload.
 * Shared by the sidebar view and the `pokemon-dashboard` code block.
 */
export async function renderDashboard(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement
): Promise<Chart[]> {
	const charts: Chart[] = [];
	root.empty();
	root.addClass("pokemon-collection-dashboard");

	const cards = await plugin.collection.scan();
	const stats = plugin.collection.computeStats(cards);

	if (cards.length === 0) {
		root.createEl("p", {
			cls: "pokemon-collection-hint",
			text:
				'No cards found. Add cards with the "Add card" command, and make sure your collection notes are in the configured folder.',
		});
		return charts;
	}

	renderStats(root, stats);
	renderCharts(plugin, root, cards, charts);
	return charts;
}

function renderStats(root: HTMLElement, stats: CollectionStats): void {
	const grid = root.createDiv({ cls: "pokemon-collection-stats" });
	const cur = stats.currency === "EUR" ? "€" : "";
	const money = (n: number) => `${cur}${n.toFixed(2)}`;

	const items: Array<[string, string]> = [
		["Total cards", String(stats.totalCards)],
		["Unique cards", String(stats.uniqueCards)],
		["Total value", money(stats.totalValue)],
		["Average card value", money(stats.averageValue)],
		[
			"Most expensive",
			stats.mostExpensive
				? `${stats.mostExpensive.name} (${money(
						stats.mostExpensive.unitPrice
					)})`
				: "—",
		],
		[
			"Largest set",
			stats.largestSet
				? `${stats.largestSet.name} (${stats.largestSet.count})`
				: "—",
		],
		["Sets owned", String(stats.setsOwned)],
	];

	for (const [label, value] of items) {
		const cell = grid.createDiv({ cls: "pokemon-collection-stat" });
		cell.createEl("div", {
			cls: "pokemon-collection-stat-value",
			text: value,
		});
		cell.createEl("div", {
			cls: "pokemon-collection-stat-label",
			text: label,
		});
	}
}

function renderCharts(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement,
	cards: AggregatedCard[],
	charts: Chart[]
): void {
	// Collection value over time (portfolio snapshots).
	const snapshots = plugin.cache.getSnapshots();
	if (snapshots.length > 0) {
		const canvas = chartBlock(root, "Collection value over time");
		charts.push(
			lineChart(
				canvas,
				snapshots.map((s) => new Date(s.timestamp).toLocaleDateString()),
				snapshots.map((s) => s.totalValue),
				"Total value"
			)
		);
	} else {
		hintBlock(
			root,
			"Collection value over time",
			'Run "Update all collection prices" to record value snapshots.'
		);
	}

	// Most valuable cards: top 10 with image, name, price and source note.
	const top = [...cards]
		.filter((c) => c.unitPrice > 0)
		.sort((a, b) => b.unitPrice - a.unitPrice)
		.slice(0, 10);
	if (top.length) {
		renderTopValuable(plugin, root, top);
	}

	// Collection by set (quantity).
	const bySet = groupSum(cards, (c) => c.setName);
	if (bySet.labels.length) {
		const canvas = chartBlock(root, "Collection by set");
		charts.push(pieChart(canvas, bySet.labels, bySet.values));
	}

	// Collection by rarity (quantity).
	const byRarity = groupSum(cards, (c) => c.rarity);
	if (byRarity.labels.length) {
		const canvas = chartBlock(root, "Collection by rarity");
		charts.push(pieChart(canvas, byRarity.labels, byRarity.values));
	}

	// Collection growth (cumulative unique cards by date added).
	const growth = cumulativeGrowth(cards);
	if (growth.labels.length) {
		const canvas = chartBlock(root, "Collection growth");
		charts.push(
			lineChart(canvas, growth.labels, growth.values, "Unique cards")
		);
	}
}

/** Top-10 most valuable cards as a visual list (image + name + price + note). */
function renderTopValuable(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement,
	top: AggregatedCard[]
): void {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	block.createEl("h3", { text: "Most valuable cards" });
	const list = block.createDiv({ cls: "pokemon-collection-top-list" });
	const cur = plugin.price.currency === "EUR" ? "€" : "";

	for (const c of top) {
		const row = list.createDiv({ cls: "pokemon-collection-top-row" });

		const url = plugin.api.imageUrl(c.image, "low");
		if (url) {
			const img = row.createEl("img", { cls: "pokemon-collection-top-img" });
			img.src = url;
		}

		const info = row.createDiv({ cls: "pokemon-collection-top-info" });
		info.createEl("div", {
			cls: "pokemon-collection-top-name",
			text: `${c.name} · ${c.variant}`,
		});

		const notes = info.createDiv({ cls: "pokemon-collection-top-notes" });
		notes.createSpan({ text: "in " });
		c.notePaths.forEach((path, i) => {
			if (i > 0) notes.createSpan({ text: ", " });
			const link = notes.createEl("a", {
				text: path.replace(/\.md$/, "").split("/").pop() ?? path,
				cls: "pokemon-collection-note-link",
			});
			link.onclick = (ev) => {
				ev.preventDefault();
				void plugin.app.workspace.openLinkText(path, "", false);
			};
		});

		row.createDiv({
			cls: "pokemon-collection-top-price",
			text: `${cur}${c.unitPrice.toFixed(2)}`,
		});
	}
}

function chartBlock(root: HTMLElement, title: string): HTMLCanvasElement {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	block.createEl("h3", { text: title });
	const wrap = block.createDiv({ cls: "pokemon-collection-chart-canvas" });
	return wrap.createEl("canvas");
}

function hintBlock(root: HTMLElement, title: string, text: string): void {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	block.createEl("h3", { text: title });
	block.createEl("p", { cls: "pokemon-collection-hint", text });
}

function groupSum(
	cards: AggregatedCard[],
	keyFn: (c: AggregatedCard) => string
): { labels: string[]; values: number[] } {
	const map = new Map<string, number>();
	for (const c of cards) {
		const k = keyFn(c) || "Unknown";
		map.set(k, (map.get(k) ?? 0) + c.quantity);
	}
	const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
	return {
		labels: sorted.map((e) => e[0]),
		values: sorted.map((e) => e[1]),
	};
}

function cumulativeGrowth(cards: AggregatedCard[]): {
	labels: string[];
	values: number[];
} {
	const dated = cards
		.filter((c) => c.dateAdded)
		.map((c) => new Date(c.dateAdded as string))
		.sort((a, b) => a.getTime() - b.getTime());
	const labels: string[] = [];
	const values: number[] = [];
	let running = 0;
	for (const d of dated) {
		running += 1;
		labels.push(d.toLocaleDateString());
		values.push(running);
	}
	return { labels, values };
}
