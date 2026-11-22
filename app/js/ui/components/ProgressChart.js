import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { formatDate } from '../../domain/dates.js';
import { formatWeight } from '../../domain/metrics.js';
import { html } from '../../lib/html.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

/** @param {number} ts */
const shortDate = (ts) => formatDate(ts).replace(/ \d{4}$/, '');

const UNIT = { e1rm: 'kg e1RM', volume: 'kg', reps: 'reps', assist: 'kg assist' };

/**
 * @typedef {object} Props
 * @property {ProgressPoint[]} points
 * @property {MetricKind} metric
 * @property {(gymId: string) => string} colorFor
 * @property {(gymId: string) => string} [gymName]
 */

/** @param {Props} props */
export default function ProgressChart({ points, metric, colorFor, gymName }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted').trim() || '#9aa0aa';
    const grid = css.getPropertyValue('--surface').trim() || '#2b2e35';
    const colors = points.map((p) => colorFor(p.gymId));
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
  }, [points, metric, colorFor, gymName]);

  return html`
    <div className="chart-box">
      <canvas ref=${canvasRef} role="img" aria-label="Progress chart" />
    </div>
  `;
}
