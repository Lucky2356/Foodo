import { describe, expect, it } from 'vitest';
import { matchesSearch, searchTokens } from '../recipes';

describe('recipe search', () => {
  const find = (query: string, text: string) => matchesSearch(text, searchTokens(query));

  it('ignores word order and endings', () => {
    expect(find('творожный сыр', 'Сырники · Сыр творожный, яйца')).toBe(true);
    expect(find('курица', 'Бирьяни с курицей')).toBe(true);
    expect(find('Гречка', 'Гречка с грибами')).toBe(true);
  });

  it('matches word starts, not letters inside a word', () => {
    expect(find('ёж', 'Салат свежий')).toBe(false);
    expect(find('ёжики', 'Ёжики из фарша')).toBe(true);
  });

  it('needs every word of the query', () => {
    expect(find('плов курица', 'Плов с говядиной')).toBe(false);
  });
});
