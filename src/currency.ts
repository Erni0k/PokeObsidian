/** Currency symbols / detection and "updated X ago" helpers. */

const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", JPY: "¥" };

/** "€" for EUR, "$" for USD; unknown codes print as "CHF ". */
export function currencySymbol(code: string | undefined): string {
	if (!code) return "";
	return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/** "€1.20" / "$1.20". */
export function formatMoney(value: number, code: string | undefined): string {
	return `${currencySymbol(code)}${value.toFixed(2)}`;
}

/** The currency a price cell is written in ("€12.00" → EUR), if it says. */
export function currencyFromText(text: string): string | undefined {
	if (/€|\bEUR\b/i.test(text)) return "EUR";
	if (/\$|\bUSD\b/i.test(text)) return "USD";
	if (/£|\bGBP\b/i.test(text)) return "GBP";
	if (/¥|\bJPY\b/i.test(text)) return "JPY";
	return undefined;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
	if (!iso) return "never";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "unknown";
	const s = Math.max(0, (now - t) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	const d = Math.floor(s / 86400);
	return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Whether a price updated at `iso` is older than `days` (never updated = stale). */
export function isStale(iso: string | undefined, days: number, now = Date.now()): boolean {
	if (!iso) return true;
	const t = new Date(iso).getTime();
	return !Number.isFinite(t) || now - t > days * 86400000;
}
