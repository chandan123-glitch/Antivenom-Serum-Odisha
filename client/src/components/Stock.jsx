import Vial from './Vial.jsx';
import { LEVEL_LABEL, stockLevel } from '../lib.js';

export default function Stock({ f, low }) {
  const lvl = stockLevel(f, low);
  const big = f.quantity != null ? f.quantity : lvl === 'yes' ? 'Yes' : lvl === 'unknown' ? '–' : 0;
  return (
    <span className={`stock stock-${lvl}`}>
      <Vial level={lvl} quantity={f.quantity} low={low} />
      <span className="stock-text">
        <strong>{big}</strong>
        <span>{LEVEL_LABEL[lvl]}</span>
      </span>
    </span>
  );
}
