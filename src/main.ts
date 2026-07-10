import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PokemonCollectionSettings,
	PokemonCollectionSettingTab,
} from "./settings";
import { ApiService } from "./services/ApiService";
import { CacheService } from "./services/CacheService";
import { PriceService } from "./services/PriceService";
import { CollectionService } from "./services/CollectionService";
import { MarkdownParser } from "./parser/MarkdownParser";
import { CommandController } from "./commands";
import { DashboardBlock } from "./ui/DashboardBlock";
import { registerTableSort } from "./ui/tableSort";

/** Legacy sidebar view type — detached on load so old leaves don't error. */
const LEGACY_DASHBOARD_VIEW_TYPE = "pokemon-collection-dashboard";

export default class PokemonCollectionPlugin extends Plugin {
	settings!: PokemonCollectionSettings;

	cache!: CacheService;
	api!: ApiService;
	price!: PriceService;
	collection!: CollectionService;
	markdown!: MarkdownParser;

	commands!: CommandController;
	private autoUpdateHandle: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Services (order matters: cache is a dependency of the others).
		this.cache = new CacheService(this);
		await this.cache.load();
		this.api = new ApiService(this);
		this.price = new PriceService(this);
		this.markdown = new MarkdownParser(this);
		this.collection = new CollectionService(this);

		// Commands.
		this.commands = new CommandController(this);
		this.commands.register();

		// Clean up any leftover sidebar dashboard leaf from older versions.
		this.app.workspace.detachLeavesOfType(LEGACY_DASHBOARD_VIEW_TYPE);

		// In-note dashboard: ```pokemon-dashboard code blocks.
		this.registerMarkdownCodeBlockProcessor(
			"pokemon-dashboard",
			async (_source, el, ctx) => {
				const child = new DashboardBlock(this, el);
				ctx.addChild(child);
				await child.render();
			}
		);

		// Clickable column headers to sort collection tables in Reading view.
		registerTableSort(this);

		this.addSettingTab(new PokemonCollectionSettingTab(this.app, this));

		this.restartAutoUpdate();
	}

	onunload(): void {
		if (this.autoUpdateHandle !== null) {
			window.clearInterval(this.autoUpdateHandle);
			this.autoUpdateHandle = null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** (Re)start the optional auto price-update interval based on settings. */
	restartAutoUpdate(): void {
		if (this.autoUpdateHandle !== null) {
			window.clearInterval(this.autoUpdateHandle);
			this.autoUpdateHandle = null;
		}
		const minutes = this.settings.autoUpdateIntervalMinutes;
		if (minutes > 0) {
			this.autoUpdateHandle = window.setInterval(
				() => void this.commands.updateAllPrices(),
				minutes * 60 * 1000
			);
			this.registerInterval(this.autoUpdateHandle);
		}
	}
}
