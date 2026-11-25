import { UNIT_LABEL, UNIT_VALUES } from '@shared/domain/units';
import { Select } from './ui';

/**
 * Dropdown restricting a line-item / product unit to the canonical set
 * (mm, inch, cm, nos). Keeps an out-of-set legacy value selectable so old
 * finalized documents still display their original unit without silent change.
 */
export function UnitSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (unit: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const isKnown = (UNIT_VALUES as readonly string[]).includes(value);
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    >
      {!isKnown && value !== '' && <option value={value}>{value} (legacy)</option>}
      {value === '' && <option value="">— unit —</option>}
      {UNIT_VALUES.map((u) => (
        <option key={u} value={u}>
          {UNIT_LABEL[u]}
        </option>
      ))}
    </Select>
  );
}
