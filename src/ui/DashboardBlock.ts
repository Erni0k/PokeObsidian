import { MarkdownRenderChild } from "obsidian";
import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import { renderDashboard } from "./DashboardRenderer";

/**
 * Renders the dashboard inside a note via a ```pokemon-dashboard code block.
 * Extends MarkdownRenderChild so Chart.js instances are destroyed when the
 * block is re-rendered or the note closes.
 */
export class DashboardBlock extends MarkdownRenderChild {
	private plugin: PokemonCollectionPlugin;
	private charts: Chart[] = [];

	constructor(plugin: PokemonCollectionPlugin, containerEl: HTMLElement) {
		super(containerEl);
		this.plugin = plugin;
	}

	async render(): Promise<void> {
		this.destroyCharts();
		const wrap = this.containerEl.createDiv({
			cls: "pokemon-collection-dashboard-block",
		});

		const header = wrap.createDiv({ cls: "pokemon-collection-dash-header" });
		header.createEl("h2", { text: "Pokémon Collection Dashboard" });
		const refreshBtn = header.createEl("button", { text: "Refresh" });
		refreshBtn.onclick = () => void this.render();

		const body = wrap.createDiv();
		this.charts = await renderDashboard(this.plugin, body);
	}

	private destroyCharts(): void {
		for (const c of this.charts) c.destroy();
		this.charts = [];
		this.containerEl.empty();
	}

	onunload(): void {
		this.destroyCharts();
	}
}
