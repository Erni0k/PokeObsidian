import type { PricePoint } from "./types";

/** A price change between a baseline point and the latest one. */
export interface PriceMove {
	from: number;
	to: number;
	/** to − from, in currency units. */
	abs: number;
	/** Relative change in percent (0 when the baseline is 0). */
	pct: number;
	/** ISO timestamp of the baseline point. */
	since: string;
}

function move(base: PricePoint, last: PricePoint): PriceMove {
	const abs = last.p - base.p;
	return {
		from: base.p,
		to: last.p,
		abs,
		pct: base.p > 0 ? (abs / base.p) * 100 : 0,
		since: base.t,
	};
}

/** Change from the previous recorded point to the latest one. */
export function changeSincePrevious(points: PricePoint[]): PriceMove | undefined {
	if (points.length < 2) return undefined;
	return move(points[points.length - 2], points[points.length - 1]);
}

/**
 * Change over the last `days`. Points are recorded only on change, so the
 * price `days` ago is the last point at or before that moment; when history
 * is younger than that, the oldest point is the best known baseline.
 * Undefined when there was no change in the window.
 */
export function changeOverDays(
	points: PricePoint[],
	days: number,
	now = Date.now()
): PriceMove | undefined {
	if (points.length < 2) return undefined;
	const last = points[points.length - 1];
	const cutoff = now - days * 86400000;
	let base = points[0];
	for (const p of points) {
		if (new Date(p.t).getTime() <= cutoff) base = p;
		else break;
	}
	if (base === last) return undefined;
	return move(base, last);
}
