import { escapeLike, quoteForOrFilter } from './items.repository';

const BS = String.fromCharCode(92);

describe('item search escaping', () => {
  it('escapes LIKE wildcards and backslash', () => {
    expect(escapeLike('50%_off')).toBe(`50${BS}%${BS}_off`);
    expect(escapeLike(`a${BS}b`)).toBe(`a${BS}${BS}b`);
  });

  it('quotes a pattern for an or() filter, escaping quotes and backslashes', () => {
    expect(quoteForOrFilter('%a,b%')).toBe('"%a,b%"');
    expect(quoteForOrFilter('%a"b%')).toBe(`"%a${BS}"b%"`);
  });
});
