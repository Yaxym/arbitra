// Типы данных для торговых операций

export interface ExecutedTrade {
  id: string;
  opportunityId: string;
  buyPrice: number;
  sellPrice: number;
  amount: number;
  realizedProfit: number;
  gasCost: number;
  executedAt: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  txHash?: string;
}

export interface TradeSettings {
  minOrderUsd: number;
  maxSlippage: number;
  cexFee: number;
  dexFee: number;
  bridgeFee: number;
  gasSol: number;
  gasBase: number;
  autoExecute: boolean;
  blacklist: Set<string>;
}

export interface RiskMetrics {
  networkRisk: 'low' | 'medium' | 'high';
  volatility: number;
  liquidityScore: number;
  ioStatusScore: number;
}
