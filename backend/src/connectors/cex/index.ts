// CEX коннектор через CCXT - поддерживает 15 бирж

import ccxt from 'ccxt';
import config from '../../config';
import { logger } from '../../utils/logger';
import { ExchangeError } from '../../utils/errors';
import { CexPair, TokenNetwork } from '../../models/pair';

// Конфигурация всех 15 CEX
const CEX_CONFIG: Record<string, any> = {
  mexc: { class: ccxt.mexc, rateLimit: 100 },
  binance: { class: ccxt.binance, rateLimit: 50 },
  bybit: { class: ccxt.bybit, rateLimit: 50 },
  okx: { class: ccxt.okx, rateLimit: 100 },
  gate: { class: ccxt.gate, rateLimit: 100 },
  kucoin: { class: ccxt.kucoin, rateLimit: 100 },
  htx: { class: ccxt.htx, rateLimit: 100 },
  bitget: { class: ccxt.bitget, rateLimit: 50 },
  kraken: { class: ccxt.kraken, rateLimit: 200 },
  coinbase: { class: ccxt.coinbase, rateLimit: 100 },
  bitfinex: { class: ccxt.bitfinex, rateLimit: 150 },
  cryptodotcom: { class: ccxt.crypto, rateLimit: 100 },
  bingx: { class: ccxt.bingx, rateLimit: 100 },
  xt: { class: ccxt.xt, rateLimit: 100 },
  poloniex: { class: ccxt.poloniex, rateLimit: 150 },
};

class CexConnector {
  private exchanges: Map<string, ccxt.Exchange> = new Map();
  private initialized: boolean = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    for (const [id, cfg] of Object.entries(CEX_CONFIG)) {
      try {
        const keys = config.cexKeys[id as keyof typeof config.cexKeys];
        const exchangeOptions: any = {
          enableRateLimit: true,
          rateLimit: cfg.rateLimit,
        };

        // Добавляем API ключи если есть
        if (keys && keys.apiKey) {
          exchangeOptions.apiKey = keys.apiKey;
          exchangeOptions.secret = keys.secret;
          if ('password' in keys && keys.password) {
            exchangeOptions.password = keys.password;
          }
        }

        const exchange = new cfg.class(exchangeOptions);
        this.exchanges.set(id, exchange);
        logger.info(`CEX ${id} initialized`);
      } catch (err: any) {
        logger.warn(`CEX ${id} init failed:`, err.message);
      }
    }

    this.initialized = true;
    logger.success(`Initialized ${this.exchanges.size} CEX connectors`);
  }

  // Получить все торговые пары с биржи
  async fetchAllPairs(exchangeId: string): Promise<CexPair[]> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) {
      throw new ExchangeError(exchangeId, 'Exchange not found');
    }

    try {
      await exchange.loadMarkets();
      const markets = exchange.markets;
      const pairs: CexPair[] = [];

      for (const [symbol, market] of Object.entries(markets)) {
        const m = market as any;
        if (m.spot && m.active) {
          const quote = m.quote?.toUpperCase() || '';
          // Фильтруем только пары с USDT/USDC/BUSD/USD/EUR/BTC/ETH
          if (['USDT', 'USDC', 'BUSD', 'USD', 'EUR', 'BTC', 'ETH'].includes(quote)) {
            pairs.push({
              symbol: m.symbol,
              base: m.base,
              quote: m.quote,
              exchange: exchangeId,
              active: m.active,
              precision: {
                amount: m.precision?.amount || 8,
                price: m.precision?.price || 8,
              },
              limits: {
                amount: {
                  min: m.limits?.amount?.min || 0,
                  max: m.limits?.amount?.max || Infinity,
                },
                cost: {
                  min: m.limits?.cost?.min || 0,
                  max: m.limits?.cost?.max || Infinity,
                },
              },
              discoveredAt: Date.now(),
              depositEnabled: m.info?.depositEnabled ?? true,
              withdrawEnabled: m.info?.withdrawEnabled ?? true,
              networks: this.extractNetworks(m),
            });
          }
        }
      }

      logger.info(`CEX ${exchangeId}: found ${pairs.length} pairs`);
      return pairs;
    } catch (err: any) {
      logger.error(`CEX ${exchangeId} fetch pairs error:`, err.message);
      return [];
    }
  }

  // Получить пары со всех подключенных бирж
  async fetchAllPairsFromAllExchanges(): Promise<CexPair[]> {
    const allPairs: CexPair[] = [];
    
    for (const exchangeId of this.exchanges.keys()) {
      try {
        const pairs = await this.fetchAllPairs(exchangeId);
        allPairs.push(...pairs);
        // Rate limiting между биржами
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        logger.warn(`Failed to fetch from ${exchangeId}:`, err.message);
      }
    }

    return allPairs;
  }

  // Получить стакан
  async getOrderbook(exchangeId: string, symbol: string, limit: number = 50): Promise<{ bids: any[], asks: any[], timestamp: number }> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) {
      throw new ExchangeError(exchangeId, 'Exchange not found');
    }

    try {
      const ob = await exchange.fetchOrderBook(symbol, limit);
      return {
        bids: ob.bids.map(([price, size]: [number, number]) => ({
          price, size, total: price * size
        })),
        asks: ob.asks.map(([price, size]: [number, number]) => ({
          price, size, total: price * size
        })),
        timestamp: Date.now()
      };
    } catch (err: any) {
      throw new ExchangeError(exchangeId, `Orderbook error: ${err.message}`);
    }
  }

  // Проверка статуса депозита/вывода
  async getDepositWithdrawStatus(exchangeId: string, currency: string): Promise<{ deposit: boolean; withdraw: boolean; fee?: number }> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) {
      throw new ExchangeError(exchangeId, 'Exchange not found');
    }

    try {
      const currencyInfo = await exchange.currency(currency);
      return {
        deposit: currencyInfo.deposit ?? true,
        withdraw: currencyInfo.withdraw ?? true,
        fee: currencyInfo.fee,
      };
    } catch (err: any) {
      logger.warn(`CEX ${exchangeId} currency status error:`, err.message);
      return { deposit: true, withdraw: true };
    }
  }

  // Извлечение сетей токена
  private extractNetworks(market: any): TokenNetwork[] {
    const networks: TokenNetwork[] = [];
    
    if (market.info?.chains) {
      for (const [chain, info] of Object.entries(market.info.chains)) {
        const chainInfo = info as any;
        networks.push({
          network: this.normalizeNetwork(chain),
          depositEnabled: chainInfo.depositEnable ?? true,
          withdrawEnabled: chainInfo.withdrawEnable ?? true,
          contractAddress: chainInfo.contractAddress,
          withdrawFee: chainInfo.withdrawFee,
        });
      }
    } else if (market.info?.networkList) {
      for (const net of market.info.networkList) {
        networks.push({
          network: this.normalizeNetwork(net.network),
          depositEnabled: net.depositEnable ?? true,
          withdrawEnabled: net.withdrawEnable ?? true,
          contractAddress: net.contractAddress,
          withdrawFee: net.withdrawFee,
        });
      }
    }

    return networks;
  }

  // Нормализация названий сетей
  private normalizeNetwork(raw: string): string {
    const mapping: Record<string, string> = {
      'ETH': 'ETH', 'ERC20': 'ETH', 'ethereum': 'ETH',
      'BSC': 'BNB', 'BEP20': 'BNB', 'bsc': 'BNB',
      'SOL': 'SOL', 'solana': 'SOL',
      'MATIC': 'MATIC', 'polygon': 'MATIC',
      'ARB': 'ARB', 'arbitrum': 'ARB',
      'OP': 'OP', 'optimism': 'OP',
      'BASE': 'BASE', 'base': 'BASE',
      'AVAX': 'AVAX', 'avalanche': 'AVAX', 'C-Chain': 'AVAX',
      'FTM': 'FTM', 'fantom': 'FTM',
      'TRX': 'TRX', 'TRC20': 'TRX', 'tron': 'TRX',
      'LINEA': 'LINEA', 'linea': 'LINEA',
      'ZKSYNC': 'ZKSYNC', 'zksync': 'ZKSYNC', 'era': 'ZKSYNC',
      'BLAST': 'BLAST', 'blast': 'BLAST',
      'MANTLE': 'MANTLE', 'mantle': 'MANTLE',
    };
    return mapping[raw] || raw.toUpperCase();
  }

  getConnectedExchanges(): string[] {
    return Array.from(this.exchanges.keys());
  }
}

export const cexConnector = new CexConnector();
export default cexConnector;
