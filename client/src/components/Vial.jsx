import { useId } from 'react';

const LIQUID = { ok: '#E3A11A', low: '#D9531E', yes: '#E3A11A', out: 'none', unknown: 'none' };

/** A small glass vial whose fill shows stock: full at twice the "low" threshold. Dashed = not reported. */
export default function Vial({ level, quantity, low, height = 34 }) {
  const id = useId();
  const fill = quantity != null ? Math.min(1, quantity / (low * 2)) : level === 'yes' ? 0.55 : 0;
  const liquidH = LIQUID[level] === 'none' ? 0 : Math.max(3, 24 * fill);
  return (
    <svg className="vial" viewBox="0 0 20 34" height={height} width={(height * 20) / 34} aria-hidden="true">
      <defs><clipPath id={id}><rect x="3" y="6" width="14" height="26" rx="4" /></clipPath></defs>
      <rect x="5" y="1" width="10" height="5" rx="1.2" fill={level === 'unknown' ? 'var(--muted)' : 'var(--ink)'} />
      <g clipPath={`url(#${id})`}>
        <rect x="3" y="6" width="14" height="26" fill="var(--surface)" />
        <rect x="3" y={32 - liquidH} width="14" height={liquidH} fill={LIQUID[level]} />
        <rect x="5" y="9" width="2" height="18" rx="1" fill="#fff" opacity=".45" />
      </g>
      <rect x="3" y="6" width="14" height="26" rx="4" fill="none" strokeWidth="1.6"
        stroke={level === 'out' ? 'var(--signal)' : level === 'unknown' ? 'var(--muted)' : 'var(--ink)'}
        strokeDasharray={level === 'unknown' ? '2.5 2' : undefined} />
    </svg>
  );
}
