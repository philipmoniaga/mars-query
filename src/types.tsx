export interface PriceUSD {
  price: string;
  denom: string;
}

export interface PriceUSD {
  price: string;
  denom: string;
}

export interface PriceSource {
  pyth: {
    contract_addr: string;
    denom_decimals: number;
    max_confidence: string;
    max_deviation: string;
    max_staleness: number;
    price_feed_id: string;
  };
}

export interface AssetParams {
  denom: string;
  price_source: PriceSource;
}

export interface UserDebts {
  amount: string;
  amount_scaled: string;
  denom: string;
  uncollateralized: boolean;
}

export interface UserCollaterals {
  amount: string;
  denom: string;
  amount_scaled: string;
  enabled: boolean;
}
