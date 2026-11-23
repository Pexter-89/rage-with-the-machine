import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { formatDate } from '../../domain/dates.js';
import { formatWeight } from '../../domain/metrics.js';
import { html } from '../../lib/html.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

/** @param {number} ts */
const shortDate = (ts) => formatDate(ts).replace(/ \d{4}$/, '');

const UNIT = { e1rm: 'kg e1RM', volume: 'kg', reps: 'reps', assist: 'kg assist', bodyweight: 'kg' };

/**
 * @typedef {object} Props
 * @property {ProgressPoint[]} points
 * @property {MetricKind | 'bodyweight'} metric
 * @property {(gymId: string) => string} [colorFor] Point colour per gym; without it points use the accent colour.
 * @property {(gymId: string) => string} [gymName]
 * @property {{ date: number, value: number }[]} [trend] Drawn as a dashed line (body weight's 4-week average).
 * @property {string} [label] The canvas's accessible name.
 */

/** @param {Props} props */
export default function ProgressChart({ points, metric, colorFor, gymName, trend, label = 'Progress chart' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted').trim() || '#9aa0aa';
    const grid = css.getPropertyValue('--surface').trim() || '#2b2e35';
    const accent = css.getPropertyValue('--accent').trim() || '#2f6fde';
    const colors = colorFor ? points.map((p) => colorFor(p.gymId)) : accent;
    const config = {
      type: 'line',
      data: {
        datasets: [
          {
            data: points.map((p) => ({ x: p.date, y: p.value })),
            parsing: false,
            borderColor: text,
            borderWidth: 1,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: colors,
            pointBorderColor: colors,
          },
          ...(trend && trend.length > 1
            ? [
                {
                  data: trend.map((p) => ({ x: p.date, y: p.value })),
                  parsing: false,
                  borderColor: accent,
                  borderWidth: 2,
                  borderDash: [6, 4],
                  pointRadius: 0,
                  pointHoverRadius: 0,
                },
              ]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => (items.length ? formatDate(items[0].parsed.x) : ''),
              label: (item) => {
                if (item.datasetIndex === 1) return `4-wk avg ${formatWeight(item.parsed.y)} kg`;
                const p = points[item.dataIndex];
                const where = p && gymName ? ` · ${gymName(p.gymId)}` : '';
                return `${formatWeight(item.parsed.y)} ${UNIT[metric]}${where}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            ticks: { color: text, maxTicksLimit: 4, callback: (v) => shortDate(Number(v)) },
            grid: { color: grid },
          },
          y: {
            reverse: metric === 'assist',
            ticks: { color: text },
            grid: { color: grid },
          },
        },
      },
    };
    const chart = new Chart(canvas, config);
    return () => chart.destroy();
  }, [points, metric, colorFor, gymName, trend]);

  return html`
    <div className="chart-box">
      <canvas ref=${canvasRef} role="img" aria-label=${label} />
    </div>
  `;
}
