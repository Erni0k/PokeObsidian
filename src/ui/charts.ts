import { Chart } from "chart.js/auto";

/**
 * Thin wrappers around Chart.js. Each helper creates a chart on a canvas and
 * returns the instance so the caller can destroy it on re-render.
 */

const PALETTE = [
	"#f7b731",
	"#eb3b5a",
	"#3867d6",
	"#20bf6b",
	"#8854d0",
	"#fa8231",
	"#0fb9b1",
	"#a55eea",
	"#fd9644",
	"#2bcbba",
	"#4b6584",
	"#e84393",
];

function color(i: number): string {
	return PALETTE[i % PALETTE.length];
}

export function lineChart(
	canvas: HTMLCanvasElement,
	labels: string[],
	data: number[],
	label: string
): Chart {
	return new Chart(canvas, {
		type: "line",
		data: {
			labels,
			datasets: [
				{
					label,
					data,
					borderColor: color(2),
					backgroundColor: "rgba(56,103,214,0.15)",
					fill: true,
					tension: 0.25,
					pointRadius: 3,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: { y: { beginAtZero: true } },
		},
	});
}

/**
 * Price of one card over time. Points are recorded only on change, so the
 * line is stepped (a price holds until the next point) and drawn on a linear
 * time axis (real spacing, no date adapter needed).
 */
export function priceChart(
	canvas: HTMLCanvasElement,
	points: { x: number; y: number }[],
	currencySymbol: string
): Chart {
	const day = (ms: number): string => new Date(ms).toLocaleDateString();
	const money = (n: number): string => `${currencySymbol}${n.toFixed(2)}`;
	return new Chart(canvas, {
		type: "line",
		data: {
			datasets: [
				{
					label: "Price",
					data: points,
					borderColor: color(2),
					backgroundColor: "rgba(56,103,214,0.15)",
					fill: true,
					stepped: "after",
					pointRadius: 3,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						title: (items) => (items[0] ? day(items[0].parsed.x ?? 0) : ""),
						label: (item) => money(item.parsed.y ?? 0),
					},
				},
			},
			scales: {
				x: {
					type: "linear",
					ticks: { callback: (v) => day(Number(v)), maxTicksLimit: 6 },
				},
				y: { ticks: { callback: (v) => money(Number(v)) } },
			},
		},
	});
}

export function barChart(
	canvas: HTMLCanvasElement,
	labels: string[],
	data: number[],
	label: string
): Chart {
	return new Chart(canvas, {
		type: "bar",
		data: {
			labels,
			datasets: [
				{
					label,
					data,
					backgroundColor: labels.map((_, i) => color(i)),
				},
			],
		},
		options: {
			indexAxis: "y",
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: { x: { beginAtZero: true } },
		},
	});
}

export function pieChart(
	canvas: HTMLCanvasElement,
	labels: string[],
	data: number[]
): Chart {
	return new Chart(canvas, {
		type: "pie",
		data: {
			labels,
			datasets: [
				{
					data,
					backgroundColor: labels.map((_, i) => color(i)),
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { position: "right" } },
		},
	});
}
