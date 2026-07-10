import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import { parseCardmarketUrl } from "../cardmarket";
import type { CardSearchQuery } from "../services/ApiService";

export type LinkParsedCallback = (query: CardSearchQuery) => void;

/**
 * Prompts for a Cardmarket URL, extracts the card name/set from it, and hands
 * the parsed query to the caller (which opens the search pre-filled).
 */
export class AddByLinkModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onParsed: LinkParsedCallback;
	private url = "";

	constructor(plugin: PokemonCollectionPlugin, onParsed: LinkParsedCallback) {
		super(plugin.app);
		this.plugin = plugin;
		this.onParsed = onParsed;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Add card from Cardmarket link" });
		contentEl.createEl("p", {
			cls: "pokemon-collection-hint",
			text: "Paste a Cardmarket single-card URL. We'll look the card up on TCGdex so you can pick the variant.",
		});

		new Setting(contentEl).setName("Cardmarket URL").addText((t) => {
			t.setPlaceholder(
				"https://www.cardmarket.com/en/Pokemon/Products/Singles/…"
			).onChange((v) => (this.url = v));
			window.setTimeout(() => t.inputEl.focus(), 0);
			t.inputEl.style.width = "100%";
			t.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") this.submit();
			});
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Find card")
					.setCta()
					.onClick(() => this.submit())
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const info = parseCardmarketUrl(this.url);
		if (!info || !info.name) {
			new Notice("Couldn't read a card from that Cardmarket link.");
			return;
		}
		this.close();
		this.onParsed({ name: info.name, set: info.set, number: info.number });
	}
}
