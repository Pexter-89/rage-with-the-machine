import type { Category, Equipment } from '../../domain/types';

const HL = 'var(--hl)';

interface IconProps {
  size?: number;
  className?: string;
}

/** The base stick figure, drawn faintly; the trained body part is drawn over it in the highlight colour. */
function Figure({ strong }: { strong: boolean }) {
  return (
    <g
      fill="none"
      stroke={strong ? HL : 'currentColor'}
      strokeOpacity={strong ? 1 : 0.55}
      strokeWidth={strong ? 2 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="4" r="2.2" />
      <path d="M12 6.6V14M8.5 8h7M8.5 8l-2 3.5-.5 3.5M15.5 8l2 3.5.5 3.5M10 14h4M10 14l-.5 4.5-.5 4M14 14l.5 4.5.5 4" />
    </g>
  );
}

const LIMB = { fill: 'none', stroke: HL, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Highlight({ category }: { category: Category }) {
  switch (category) {
    case 'legs':
      return <path {...LIMB} d="M10 14h4M10 14l-.5 4.5-.5 4M14 14l.5 4.5.5 4" />;
    case 'arms':
      return <path {...LIMB} d="M8.5 8l-2 3.5-.5 3.5M15.5 8l2 3.5.5 3.5" />;
    case 'shoulders':
      return (
        <g fill={HL}>
          <circle cx="8.4" cy="8" r="1.9" />
          <circle cx="15.6" cy="8" r="1.9" />
        </g>
      );
    case 'chest':
      return <rect x="9.2" y="8.6" width="5.6" height="3" rx="1.2" fill={HL} />;
    case 'back':
      return <path d="M8.6 8.2h6.8L13.2 14h-2.4z" fill={HL} />;
    case 'core':
      return <rect x="10.5" y="10.6" width="3" height="4" rx="0.9" fill={HL} />;
    case 'fullbody':
      return null;
  }
}

/** A small stick figure with the body part a category trains highlighted. */
export function BodyIcon({ category, size = 28, className }: IconProps & { category: Category }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <Figure strong={category === 'fullbody'} />
      <Highlight category={category} />
    </svg>
  );
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function equipmentShape(e: Equipment) {
  switch (e) {
    case 'dumbbell':
      return (
        <g {...STROKE}>
          <path d="M8 12h8" />
          <rect x="5" y="7.5" width="3" height="9" rx="1" />
          <rect x="16" y="7.5" width="3" height="9" rx="1" />
          <path d="M3 10v4M21 10v4" />
        </g>
      );
    case 'barbell':
      return (
        <g {...STROKE}>
          <path d="M1.5 12h3M9.5 12h5M19.5 12h3" />
          <rect x="4.5" y="5" width="2.6" height="14" rx="1" />
          <rect x="16.9" y="5" width="2.6" height="14" rx="1" />
          <rect x="7.4" y="7.5" width="1.8" height="9" rx="0.8" />
          <rect x="14.8" y="7.5" width="1.8" height="9" rx="0.8" />
        </g>
      );
    case 'kettlebell':
      return (
        <g {...STROKE}>
          <path d="M8.8 10V7.6a3.2 3.2 0 0 1 6.4 0V10" />
          <path d="M7.5 20.5a6 6 0 1 1 9 0z" />
        </g>
      );
    case 'machine':
      return (
        <g {...STROKE}>
          <path d="M6 3h12M8 3v18M16 3v18M12 3v8" />
          <rect x="9.2" y="11.5" width="5.6" height="2.4" rx="0.6" />
          <rect x="9.2" y="14.8" width="5.6" height="2.4" rx="0.6" />
          <rect x="9.2" y="18.1" width="5.6" height="2.4" rx="0.6" />
        </g>
      );
    case 'band':
      return (
        <g {...STROKE}>
          <path d="M5 17.5C6 4 18 4 19 17.5" strokeWidth={2.2} />
          <path d="M2.5 18h5M16.5 18h5" strokeWidth={2.6} />
        </g>
      );
    case 'bodyweight':
      return (
        <g {...STROKE}>
          <circle cx="12" cy="4.5" r="2" />
          <path d="M12 7v7M12 8.5L7.5 5M12 8.5L16.5 5M12 14l-3.5 7M12 14l3.5 7" />
        </g>
      );
  }
}

export const EQUIPMENT_NAMES: Record<Equipment, string> = {
  machine: 'Machine',
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  kettlebell: 'Kettlebell',
  band: 'Resistance band',
  bodyweight: 'Bodyweight',
};

/** Equipment pictogram (dumbbell, barbell, kettlebell, machine, band, bodyweight). */
export function EquipmentIcon({ equipment, size = 18, className }: IconProps & { equipment: Equipment }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <title>{EQUIPMENT_NAMES[equipment]}</title>
      {equipmentShape(equipment)}
    </svg>
  );
}
