import { describe, expect, it } from 'vitest';
import { budgetError, formatNumberInput, parseNumberInput, rangeError } from '../numbers';

describe('number input', () => {
  it('reads a decimal comma and thousands spaces instead of dropping them', () => {
    expect(parseNumberInput('70,5')).toBe(70.5);
    expect(parseNumberInput('1 500')).toBe(1500);
    expect(parseNumberInput(' 0.25 ')).toBe(0.25);
    expect(parseNumberInput('')).toBeNull();
  });

  it('turns text that is not a number into NaN, not into «empty»', () => {
    for (const bad of ['abc', '1e5', '70,5,1', '-', ',']) expect(parseNumberInput(bad)).toBeNaN();
  });

  it('formats back with a comma', () => {
    expect(formatNumberInput(70.5)).toBe('70,5');
    expect(formatNumberInput(null)).toBe('');
  });

  it('checks member ranges and rejects NaN', () => {
    expect(rangeError('weight_kg', 70.5)).toBeNull();
    expect(rangeError('weight_kg', 705)).toMatch(/Вес/);
    expect(rangeError('age', Number.NaN)).toMatch(/Возраст/);
    expect(rangeError('age', 30.5)).toMatch(/целое/);
    expect(rangeError('height_cm', null)).toBeNull();
    expect(budgetError(-500)).not.toBeNull();
    expect(budgetError(0)).toBeNull();
  });
});
