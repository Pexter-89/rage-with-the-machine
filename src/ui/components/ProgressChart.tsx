import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import type { ChartConfiguration } from 'chart.js';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/metrics';
import type { MetricKind, ProgressPoint } from '../../domain/progress';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

const shortDate = (ts: number) => formatDate(ts).replace(/ \d{4}$/, '');

const UNIT: Record<MetricKind, string> = { e1rm: 'kg e1RM', volume: 'kg', reps: 'reps', assist: 'kg assist' };

interface Props {
  points: ProgressPoint[];
  metric: MetricKind;
  colorFor: (gymId: string) => string;
  gymName?: (gymId: string) => string;
}

export default function ProgressChart({ points, metric, colorFor, gymName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted').trim() || '#9aa0aa';
    const grid = css.getPropertyValue('--surface').trim() || '#2b2e35';
    const colors = points.map((p) => colorFor(p.gymId));
    const config: ChartConfiguration<'line', { x: number; y: number }[]> = {
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
              title: (items) => (items.length ? formatDate(items[0].parsed.x as number) : ''),
              label: (item) => {
                const p = points[item.dataIndex];
                const where = p && gymName ? ` · ${gymName(p.gymId)}` : '';
                return `${formatWeight(item.parsed.y as number)} ${UNIT[metric]}${where}`;
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

  return (
    <div className="chart-box">
      <canvas ref={canvasRef} role="img" aria-label="Progress chart" />
    </div>
  );
}
