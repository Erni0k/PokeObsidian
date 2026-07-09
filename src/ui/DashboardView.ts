import { ItemView, WorkspaceLeaf } from "obsidian";
import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import type { AggregatedCard, CollectionStats } from "../services/CollectionService";
import { barChart, lineChart, pieChart } from "./charts";

export const DASHBOARD_VIEW_TYPE = "pokemon-collection-dashboard";

/** Right-panel dashboard: statistics + Chart.js visualisations. */
export class DashboardView extends ItemView {
	private plugin: PokemonCollectionPlugin;
	private charts: Chart[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: PokemonCollectionPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Pokémon Collection Dashboard";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		await this.refresh();
		// Refresh when this view regains focus.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) void this.refresh();
			})
		);
	}

	async onClose(): Promise<void> {
		this.destroyCharts();
	}

	private destroyCharts(): void {
		for (const c of this.charts) c.destroy();
		this.charts = [];
	}

	async refresh(): Promise<void> {
		this.destroyCharts();
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("pokemon-collection-dashboard");

		const header = root.createDiv({ cls: "pokemon-collection-dash-header" });
		header.createEl("h2", { text: "Pokémon Collection Dashboard" });
		const refreshBtn = header.createEl("button", { text: "Refresh" });
		refreshBtn.onclick = () => void this.refresh();

		const cards = await this.plugin.collection.scan();
		const stats = this.plugin.collection.computeStats(cards);

		if (cards.length === 0) {
			root.createEl("p", {
				cls: "pokemon-collection-hint",
				text:
					"No cards found. Add cards with the \"Add Card\" command, and make sure your collection notes are in the configured folder.",
			});
			return;
		}

		this.renderStats(root, stats);
		this.renderCharts(root, cards, stats);
	}

	private renderStats(root: HTMLElement, stats: CollectionStats): void {
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

	private renderCharts(
		root: HTMLElement,
		cards: AggregatedCard[],
		stats: CollectionStats
	): void {
		// Collection value over time (portfolio snapshots).
		const snapshots = this.plugin.cache.getSnapshots();
		if (snapshots.length > 0) {
			const canvas = this.chartBlock(root, "Collection value over time");
			this.charts.push(
				lineChart(
					canvas,
					snapshots.map((s) => new Date(s.timestamp).toLocaleDateString()),
					snapshots.map((s) => s.totalValue),
					"Total value"
				)
			);
		} else {
			this.hintBlock(
				root,
				"Collection value over time",
				"Run \"Update all collection prices\" to record value snapshots."
			);
		}

		// Most valuable cards (top 10 by unit price).
		const top = [...cards]
			.filter((c) => c.unitPrice > 0)
			.sort((a, b) => b.unitPrice - a.unitPrice)
			.slice(0, 10);
		if (top.length) {
			const canvas = this.chartBlock(root, "Most valuable cards");
			this.charts.push(
				barChart(
					canvas,
					top.map((c) => `${c.name} (${c.variant})`),
					top.map((c) => c.unitPrice),
					"Unit price"
				)
			);
		}

		// Collection by set (quantity).
		const bySet = this.groupSum(cards, (c) => c.setName);
		if (bySet.labels.length) {
			const canvas = this.chartBlock(root, "Collection by set");
			this.charts.push(pieChart(canvas, bySet.labels, bySet.values));
		}

		// Collection by rarity (quantity).
		const byRarity = this.groupSum(cards, (c) => c.rarity);
		if (byRarity.labels.length) {
			const canvas = this.chartBlock(root, "Collection by rarity");
			this.charts.push(pieChart(canvas, byRarity.labels, byRarity.values));
		}

		// Collection growth (cumulative unique cards by date added).
		const growth = this.cumulativeGrowth(cards);
		if (growth.labels.length) {
			const canvas = this.chartBlock(root, "Collection growth");
			this.charts.push(
				lineChart(canvas, growth.labels, growth.values, "Unique cards")
			);
		}
	}

	private chartBlock(root: HTMLElement, title: string): HTMLCanvasElement {
		const block = root.createDiv({ cls: "pokemon-collection-chart" });
		block.createEl("h3", { text: title });
		const wrap = block.createDiv({ cls: "pokemon-collection-chart-canvas" });
		return wrap.createEl("canvas");
	}

	private hintBlock(root: HTMLElement, title: string, text: string): void {
		const block = root.createDiv({ cls: "pokemon-collection-chart" });
		block.createEl("h3", { text: title });
		block.createEl("p", { cls: "pokemon-collection-hint", text });
	}

	private groupSum(
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

	private cumulativeGrowth(cards: AggregatedCard[]): {
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
}
