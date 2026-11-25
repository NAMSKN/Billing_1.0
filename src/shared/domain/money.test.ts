import { describe, it, expect } from 'vitest';
import {
  Money,
  quantizeMoney,
  roundToRupee,
  quantizeQuantity,
  quantizePercent,
  toPaise,
  fromPaise,
  toMillis,
  fromMillis,
  toHundredths,
  fromHundredths,
  formatMoney,
  formatQuantity,
} from './money';

describe('money quantization (ROUND_HALF_UP)', () => {
  it('quantizes money to 2 dp half-up', () => {
    expect(quantizeMoney('1.005').toString()).toBe('1.01');
    expect(quantizeMoney('1.004').toString()).toBe('1');
    expect(quantizeMoney('2.675').toString()).toBe('2.68');
  });

  it('rounds to nearest rupee half-up returning 2 dp', () => {
    expect(roundToRupee('14490.40').toFixed(2)).toBe('14490.00');
    expect(roundToRupee('9831.76').toFixed(2)).toBe('9832.00');
    expect(roundToRupee('0.50').toFixed(2)).toBe('1.00');
  });

  it('quantizes quantity to 3 dp and percent to 2 dp', () => {
    expect(quantizeQuantity('12.5005').toString()).toBe('12.501');
    expect(quantizePercent('18.005').toString()).toBe('18.01');
  });

  it('rejects non-integer JS numbers to avoid float drift', () => {
    expect(() => quantizeMoney(1.5)).toThrow(TypeError);
  });
});

describe('scaled-integer round trips (repository boundary)', () => {
  it('money <-> paise is exact', () => {
    expect(toPaise('123.45')).toBe(12345);
    expect(fromPaise(12345).toFixed(2)).toBe('123.45');
    expect(fromPaise(toPaise('12280.00')).toFixed(2)).toBe('12280.00');
  });

  it('quantity <-> millis is exact', () => {
    expect(toMillis('12.5')).toBe(12500);
    expect(fromMillis(12500).toString()).toBe('12.5');
  });

  it('percent <-> hundredths is exact', () => {
    expect(toHundredths('18')).toBe(1800);
    expect(fromHundredths(1800).toFixed(2)).toBe('18.00');
  });

  it('rejects non-integer paise input', () => {
    expect(() => fromPaise(1.5)).toThrow(TypeError);
  });
});

describe('Indian formatting', () => {
  it('groups rupees in the Indian system', () => {
    expect(formatMoney('12280')).toBe('12,280.00');
    expect(formatMoney('150000')).toBe('1,50,000.00');
    expect(formatMoney('10000000')).toBe('1,00,00,000.00');
    expect(formatMoney('-0.40')).toBe('-0.40');
    expect(formatMoney('999')).toBe('999.00');
  });

  it('formats quantities trimming trailing zeros', () => {
    expect(formatQuantity(new Money('16'))).toBe('16');
    expect(formatQuantity(new Money('2.500'))).toBe('2.5');
  });
});
