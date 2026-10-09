import type { TitleSummary } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { searchTitles } from './rows';

const title = (name: string, genres: string[] = [], overview = ''): TitleSummary =>
  ({ id: name, name, genres, tags: [], people: [], overview, rating: null, year: null }) as unknown as TitleSummary;

describe('searchTitles', () => {
  const titles = [title('Amélie', ['Comedy'], 'A shy waitress'), title('Sintel', ['Animation'], 'A girl searches'), title('Elephants Dream', ['Animation'])];

  it('folds accents', () => {
    expect(searchTitles(titles, 'amel').map((t) => t.name)).toEqual(['Amélie']);
  });

  it('matches one-letter queries only at the start of a word', () => {
    expect(searchTitles(titles, 'é').map((t) => t.name)).toEqual(['Elephants Dream']);
  });
});
