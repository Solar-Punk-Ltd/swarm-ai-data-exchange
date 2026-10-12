import { selectAccept } from '../src/tools/purchase_catalog_item/index';
import type { PaymentRequirementsAccept } from '../src/tools/purchase_catalog_item/models';

const BASE: PaymentRequirementsAccept = {
  scheme: 'exact',
  network: 'eip155:84532',
  asset: 'eip155:84532/erc20:0xUSDC',
  maxAmountRequired: '10000',
  payTo: '0xBaseClone',
};
const CELO: PaymentRequirementsAccept = {
  scheme: 'exact',
  network: 'eip155:11142220',
  asset: 'eip155:11142220/erc20:0x01C5C0122039549AD1493B8220cABEdD739BC44E',
  maxAmountRequired: '10000',
  payTo: '0xCeloClone',
};

describe('selectAccept', () => {
  it('takes the first rail when none is requested', () => {
    expect(selectAccept([BASE, CELO])).toEqual({ accept: BASE });
  });

  it('picks the requested rail by CAIP-2 network', () => {
    expect(selectAccept([BASE, CELO], 'eip155:11142220')).toEqual({ accept: CELO });
  });

  it('lists the advertised rails when the requested one is missing', () => {
    const result = selectAccept([BASE, CELO], 'eip155:1');
    expect('error' in result && result.error).toMatch(
      /does not accept payment on eip155:1.*eip155:84532, eip155:11142220/,
    );
  });

  it('errors on an empty challenge', () => {
    expect(selectAccept([])).toEqual({ error: '402 challenge carried no accepts entry.' });
  });
});
