import { describe, it, expect } from 'vitest';
import { Money } from './money';
import { amountInWords } from './amountWords';

describe('amountInWords (Indian numbering)', () => {
  it('whole rupees', () => {
    expect(amountInWords(new Money('14490.00'))).toBe(
      'INR Fourteen Thousand Four Hundred Ninety Only',
    );
    expect(amountInWords(new Money('9832.00'))).toBe(
      'INR Nine Thousand Eight Hundred Thirty Two Only',
    );
  });

  it('with paise', () => {
    expect(amountInWords(new Money('2210.40'))).toBe(
      'INR Two Thousand Two Hundred Ten and Forty Paise Only',
    );
    expect(amountInWords(new Money('1.05'))).toBe('INR One and Five Paise Only');
  });

  it('lakhs and crores', () => {
    expect(amountInWords(new Money('150000.00'))).toBe('INR One Lakh Fifty Thousand Only');
    expect(amountInWords(new Money('10000000.00'))).toBe('INR One Crore Only');
    expect(amountInWords(new Money('12500000.00'))).toBe(
      'INR One Crore Twenty Five Lakh Only',
    );
  });

  it('zero', () => {
    expect(amountInWords(new Money('0.00'))).toBe('INR Zero Only');
  });

  it('rejects negatives', () => {
    expect(() => amountInWords(new Money('-1.00'))).toThrow(RangeError);
  });
});
