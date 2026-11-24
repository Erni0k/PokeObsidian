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
import { SetIndexService } from "./services/SetIndexService";
import { SetCompletionService } from "./services/SetCompletionService";
import { MarkdownParser } from "./parser/MarkdownParser";
import { CommandController } from "./commands";
import { DashboardBlock } from "./ui/DashboardBlock";
import { SetCompletionBlock } from "./ui/SetCompletionBlock";
import { CardHistoryBlock } from "./ui/CardHistory";
import { registerTableSort } from "./ui/tableSort";

/** Legacy sidebar view type — detached on load so old leaves don't error. */
const LEGACY_DASHBOARD_VIEW_TYPE = "pokemon-collection-dashboard";

export default class PokemonCollectionPlugin extends Plugin {
	settings!: PokemonCollectionSettings;

	cache!: CacheService;
	api!: ApiService;
	price!: PriceService;
	collection!: CollectionService;
	setIndex!: SetIndexService;
	setCompletion!: SetCompletionService;
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
		this.setIndex = new SetIndexService(this);
		await this.setIndex.load();
		this.setCompletion = new SetCompletionService(this);
		await this.setCompletion.load();

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

		// Set completion: ```pokemon-set DRI``` code blocks.
		this.registerMarkdownCodeBlockProcessor(
			"pokemon-set",
			async (source, el, ctx) => {
				const child = new SetCompletionBlock(this, el, source);
				ctx.addChild(child);
				await child.render();
			}
		);

		// Price chart of one card: ```pokemon-card sv10-021:normal```.
		this.registerMarkdownCodeBlockProcessor("pokemon-card", (source, el, ctx) => {
			const child = new CardHistoryBlock(this, el, source);
			ctx.addChild(child);
			child.render();
		});

		// Clickable column headers to sort collection tables in Reading view.
		registerTableSort(this);

		this.addSettingTab(new PokemonCollectionSettingTab(this.app, this));

		this.restartAutoUpdate();
	}

	onunload(): void {
		void this.cache.flush();
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
