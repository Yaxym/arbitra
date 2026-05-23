// Типы данных для настроек пользователя

export interface UserSettings {
  minVol: number;
  maxVol: number;
  minSpread: number;
  minOrderUsd: number;
  maxSlippage: number;
  refreshInterval: number;
  cexFee: number;
  cexWd: number;
  dexFee: number;
  bridgeFee: number;
  gasSol: number;
  gasBase: number;
  onlyOpenIO: boolean;
  warnClosedIO: boolean;
  autoCheckIO: boolean;
  blacklist: string[];
  enabledCex: string[];
  enabledDex: string[];
  enabledNetworks: string[];
}

export const defaultSettings: UserSettings = {
  minVol: 500,
  maxVol: 50000,
  minSpread: 1.5,
  minOrderUsd: 100,
  maxSlippage: 1.0,
  refreshInterval: 8,
  cexFee: 0.1,
  cexWd: 1.0,
  dexFee: 0.3,
  bridgeFee: 0.2,
  gasSol: 0.005,
  gasBase: 0.15,
  onlyOpenIO: false,
  warnClosedIO: true,
  autoCheckIO: true,
  blacklist: [],
  enabledCex: ['mexc', 'binance', 'bybit', 'okx', 'kucoin'],
  enabledDex: ['raydium', 'orca', 'jupiter', 'aerodrome', 'uniswap-base'],
  enabledNetworks: ['SOL', 'BASE', 'ETH', 'ARB'],
};
