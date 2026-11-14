import { checkContactValues, escapeLikeTerm } from './customer-normalize';

describe('escapeLikeTerm', () => {
  it('escapes % and _ and drops commas', () => {
    expect(escapeLikeTerm('50%_a,b')).toBe('50\\%\\_ab');
  });
});

describe('checkContactValues', () => {
  it('converts Arabic-Indic digits', () => {
    expect(checkContactValues({ phone: '٠٥٠٠٠٠١٢٣٤' }).phone).toBe(
      '0500001234',
    );
  });
  it('rejects letters, short and long numbers', () => {
    expect(checkContactValues({ phone: 'abc' }).error).toBeDefined();
    expect(checkContactValues({ phone: '123' }).error).toBeDefined();
    expect(checkContactValues({ phone: '0'.repeat(30) }).error).toBeDefined();
  });
  it('rejects a plate over 20 chars', () => {
    expect(checkContactValues({ plate: 'x'.repeat(21) }).error).toBeDefined();
  });
  it('accepts empty', () => {
    expect(checkContactValues({}).error).toBeUndefined();
  });
});
