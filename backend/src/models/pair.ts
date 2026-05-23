// Типы данных для торговых пар

export interface TokenNetwork {
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  contractAddress?: string;
  withdrawFee?: number;
}

export interface CexPair {
  symbol: string;        // "BTC/USDT"
  base: string;          // "BTC"
  quote: string;         // "USDT"
  exchange: string;      // "mexc", "binance", etc.
  active: boolean;
  precision: {
    amount: number;
    price: number;
  };
  limits: {
    amount: { min: number; max: number };
    cost: { min: number; max: number };
  };
  discoveredAt: number;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  networks: TokenNetwork[];
}

export interface DexPair {
  dex: string;
  network: string;
  baseToken: {
    symbol: string;
    address: string;
    decimals: number;
  };
  quoteToken: {
    symbol: string;
    address: string;
    decimals: number;
  };
  poolAddress: string;
  liquidity: number;
  volume24h: number;
  fees: number;
}

export interface UnifiedPair {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  type: 'cex' | 'dex';
  exchange: string;
  network?: string;
  active: boolean;
  liquidity?: number;
  volume24h?: number;
  lastPrice?: number;
  discoveredAt: number;
}
