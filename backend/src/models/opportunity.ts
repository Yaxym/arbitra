// Типы данных для арбитражных возможностей

export interface PriceLevel {
  price: number;
  size: number;
  total: number;
}

export interface OrderBook {
  bids: PriceLevel[];
  asks: PriceLevel[];
  timestamp: number;
}

export interface EffectivePrice {
  price: number;
  size: number;
  usd: number;
  skippedLevels: number;
  fallback?: boolean;
  side: 'buy' | 'sell';
  isLimit: boolean;
}

export interface ArbitrageOpportunity {
  id: string;
  pair: {
    symbol: string;
    full: string;
    base: string;
    quote: string;
    net: string;
  };
  cex: {
    id: string;
    name: string;
    tag: string;
  };
  dex: {
    id: string;
    name: string;
    network: string;
  };
  direction: 'CEX→DEX' | 'DEX→CEX';
  buyEff: EffectivePrice;
  sellEff: EffectivePrice;
  cexBook: OrderBook;
  dexBook: OrderBook;
  grossSpread: number;
  netSpread: number;
  volume24h: number;
  timestamp: number;
  depositOpen: boolean;
  withdrawOpen: boolean;
  fees: {
    cexFee: number;
    dexFee: number;
    bridgeFee: number;
    slippage: number;
    gasCost: number;
  };
}

export interface OpportunityFilters {
  minSpread?: number;
  maxSpread?: number;
  minVol?: number;
  maxVol?: number;
  networks?: string[];
  exchanges?: string[];
  onlyOpenIO?: boolean;
}
