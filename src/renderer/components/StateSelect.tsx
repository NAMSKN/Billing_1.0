import { INDIA_STATES, stateNameFor } from '@shared/domain/indiaStates';
import { Select } from './ui';

/**
 * State dropdown that emits both the GST state code and name. Free-text state
 * entry is not allowed; selection drives tax determination (intra vs inter).
 */
export function StateSelect({
  code,
  onChange,
  id,
  disabled,
}: {
  code: string;
  onChange: (code: string, name: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      id={id}
      value={code}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value, stateNameFor(e.target.value))}
    >
      <option value="">Select state…</option>
      {INDIA_STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name} ({s.code})
        </option>
      ))}
    </Select>
  );
}
