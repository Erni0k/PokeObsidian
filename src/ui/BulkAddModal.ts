import { ButtonComponent, Modal, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry } from "../types";
import { CardmarketProvider } from "../services/PriceService";
import { buildEntryFromCard } from "./buildEntry";
import { baseType, resolveVariant, variantOptions } from "../variants";

export interface BulkItem {
	entry: CollectionEntry;
	qty: number;
	/** Set when the typed variant isn't one this card has (kept as custom). */
	warning?: string;
}

export type BulkResolvedCallback = (items: BulkItem[]) => void | Promise<void>;

/** One parsed list line. */
export interface BulkLine {
	code: string;
	num: string;
	qty?: number;
	variant?: string;
}

/** Why a line could not be added. */
type Failure = { line: string; reason: string };

/**
 * Parse `CODE NUMBER [xQTY] [variant]`. Accepts "DRI 062", "dri-062",
 * "DRI062", "sv10-021"; quantity as "x2", "2x" or "×2" anywhere after the
 * number. Returns null for anything else.
 */
export function parseBulkLine(line: string): BulkLine | null {
	const m =
		line.match(/^([A-Za-z][A-Za-z0-9.]{0,9}?)[\s-]+([A-Za-z]{0,3}\d{1,4}[A-Za-z]?)(?=\s|$)(.*)$/) ??
		line.match(/^([A-Za-z]{2,4})(\d{1,4})(?=\s|$)(.*)$/);
	if (!m) return null;
	let rest = m[3].trim();
	let qty: number | undefined;
	const qm = rest.match(/(?:^|\s)(?:[x×](\d+)|(\d+)[x×])(?=\s|$)/i);
	if (qm) {
		qty = Number.parseInt(qm[1] ?? qm[2], 10);
		rest = (rest.slice(0, qm.index) + rest.slice((qm.index ?? 0) + qm[0].length)).trim();
	}
	return { code: m[1], num: m[2], qty, variant: rest || undefined };
}

/**
 * Bulk importer: paste one card per line as `CODE NUMBER [xQTY] [variant]`
 * (e.g. `DRI 062 x2 reverse`). Each line is resolved against TCGdex; resolved
 * cards are inserted together and unresolved lines are reported.
 */
export class BulkAddModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onResolved: BulkResolvedCallback;
	private text = "";
	private provider = new CardmarketProvider();
	private textarea!: HTMLTextAreaElement;
	private addButton?: ButtonComponent;
	private busy = false;

	constructor(plugin: PokemonCollectionPlugin, onResolved: BulkResolvedCallback) {
		super(plugin.app);
		this.plugin = plugin;
		this.onResolved = onResolved;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Bulk add cards" });
		contentEl.createEl("p", {
			cls: "pokemon-collection-hint",
			text: "One card per line: CODE NUMBER [xQTY] [variant], e.g. DRI 062 x2 reverse. Lines starting with # are ignored.",
		});

		const ta = contentEl.createEl("textarea", {
			cls: "pokemon-collection-bulk",
		});
		this.textarea = ta;
		ta.rows = 8;
		ta.placeholder = "DRI 062 x2 reverse\nsv10-021\nPAF 091 holo";
		ta.addEventListener("input", () => (this.text = ta.value));

		const status = contentEl.createDiv({ cls: "pokemon-collection-hint" });

		new Setting(contentEl)
			.addButton((b) => {
				this.addButton = b;
				b.setButtonText("Add all")
					.setCta()
					.onClick(() => void this.process(status));
			})
			.addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async process(status: HTMLElement): Promise<void> {
		if (this.busy) return; // no double submit
		const lang = this.plugin.settings.preferredLanguage || "en";
		const lines = this.text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		if (!lines.length) return;

		this.busy = true;
		this.addButton?.setDisabled(true);
		const items: BulkItem[] = [];
		const failures: Failure[] = [];
		try {
			for (let i = 0; i < lines.length; i++) {
				status.setText(`Resolving ${i + 1}/${lines.length}…`);
				const line = lines[i];
				const parsed = parseBulkLine(line);
				if (!parsed) {
					failures.push({ line, reason: "expected CODE NUMBER [xQTY] [variant]" });
					continue;
				}
				try {
					const res = await this.resolve(parsed, lang);
					if ("reason" in res) failures.push({ line, reason: res.reason });
					else items.push(res);
				} catch (err) {
					console.error("[pokemon-collection] bulk line failed", line, err);
					failures.push({ line, reason: "network error" });
				}
			}
			if (items.length) await this.onResolved(items);
		} finally {
			this.busy = false;
			this.addButton?.setDisabled(false);
		}

		this.report(status, items, failures);
		// Leave only the failed lines in the box, ready to fix and retry.
		this.text = failures.map((f) => f.line).join("\n");
		this.textarea.value = this.text;
	}

	private report(status: HTMLElement, items: BulkItem[], failures: Failure[]): void {
		status.empty();
		const cards = items.reduce((n, it) => n + it.qty, 0);
		status.createEl("div", {
			text: `Added ${cards} card(s) from ${items.length} line(s).`,
		});
		const warned = items.filter((it) => it.warning);
		if (warned.length) {
			const wl = status.createEl("ul");
			for (const it of warned) wl.createEl("li", { text: `⚠ ${it.warning}` });
		}
		if (!failures.length) return;
		status.createEl("div", {
			text: `${failures.length} line(s) not recognized (left in the box above):`,
			cls: "pokemon-collection-error",
		});
		const ul = status.createEl("ul");
		for (const f of failures) ul.createEl("li", { text: `${f.line} — ${f.reason}` });
	}

	/** Resolve a line with the same code + number lookup as the search (P1). */
	private async resolve(
		p: BulkLine,
		lang: string
	): Promise<BulkItem | { reason: string }> {
		const res = await this.plugin.api.findCardByCodeNumber(
			p.code,
			p.num,
			lang,
			true
		);
		if (!res.setId) return { reason: `unknown set code "${p.code.toUpperCase()}"` };
		if (!res.brief) {
			return { reason: `no card #${p.num} in ${res.setName ?? res.setId}` };
		}
		const card = await this.plugin.api.getCard(res.brief.id, lang);
		if (!card) return { reason: "could not load card details" };

		const variant = resolveVariant(card, p.variant ?? "");
		const known = variantOptions(card).some((o) => o.value === variant);
		const warning =
			p.variant && !known && baseType(p.variant)
				? `variant "${p.variant}" not listed for ${card.name} — added as custom`
				: undefined;
		const qty = p.qty && p.qty > 0 ? p.qty : this.plugin.settings.defaultQuantity;
		const price = this.provider.priceFor(card, variant);
		const entry = await buildEntryFromCard(
			this.plugin,
			card,
			variant,
			lang,
			qty,
			price
		);
		return { entry, qty, warning };
	}
}
