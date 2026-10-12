import { parseChainMap } from '../src/utils';

describe('parseChainMap', () => {
  it('returns an empty map for unset or blank input', () => {
    expect(parseChainMap(undefined)).toEqual({});
    expect(parseChainMap('')).toEqual({});
    expect(parseChainMap(' , ')).toEqual({});
  });

  it('parses comma-separated CAIP-2 keyed entries, trimming whitespace', () => {
    expect(parseChainMap(' eip155:84532=0xabc , eip155:11142220=0xdef, ')).toEqual({
      'eip155:84532': '0xabc',
      'eip155:11142220': '0xdef',
    });
  });

  it('splits on the first "=" only', () => {
    expect(parseChainMap('eip155:84532=https://rpc.example/?key=1')).toEqual({
      'eip155:84532': 'https://rpc.example/?key=1',
    });
  });

  it('names the variable in the error for a malformed entry', () => {
    expect(() => parseChainMap('eip155:84532', 'SPLITTER_FACTORY_ADDRESSES')).toThrow(
      /SPLITTER_FACTORY_ADDRESSES/,
    );
    expect(() => parseChainMap('=0xabc')).toThrow(/expected <key>=<value>/);
  });
});
