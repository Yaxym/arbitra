// DEX коннектор - использует ТОЛЬКО рабочие публичные API (без TheGraph)
// Solana: Raydium API, Orca API
// EVM: DexScreener API (агрегатор для всех сетей)

import axios from 'axios';
import { logger } from '../../utils/logger';
import { DexPair } from '../../models/pair';

class DexConnector {
  private cache: Map<string, { pairs: DexPair[]; timestamp: number }> = new Map();
  private cacheTtl: number = 120000; // 2 минуты

  // Получить все пары со всех DEX
  async fetchAllDexPairs(): Promise<DexPair[]> {
    const allPairs: DexPair[] = [];

    // 1. SOLANA - Raydium (стабильный API)
    try {
      const solPairs = await this.fetchRaydiumPairs();
      allPairs.push(...solPairs);
    } catch (err: any) {
      logger.warn('Raydium fetch error:', err.message);
    }

    // 2. SOLANA - Orca (стабильный API)
    try {
      const orcaPairs = await this.fetchOrcaPairs();
      allPairs.push(...orcaPairs);
    } catch (err: any) {
      logger.warn('Orca fetch error:', err.message);
    }

    // 3. EVM сети через DexScreener API (замена TheGraph)
    // DexScreener покрывает: ETH, BASE, ARB, OP, BNB, MATIC, AVAX, FTM, CRO
    const evmNetworks = [
      { id: 'ethereum', name: 'ETH' },
      { id: 'base', name: 'BASE' },
      { id: 'arbitrum', name: 'ARB' },
      { id: 'optimism', name: 'OP' },
      { id: 'bsc', name: 'BNB' },
      { id: 'polygon', name: 'MATIC' },
      { id: 'avalanche', name: 'AVAX' },
      { id: 'fantom', name: 'FTM' },
      { id: 'cronos', name: 'CRO' },
    ];

    for (const network of evmNetworks) {
      try {
        const pairs = await this.fetchDexScreenerPairs(network.id, network.name);
        allPairs.push(...pairs);
        await new Promise(r => setTimeout(r, 300)); // rate limit
      } catch (err: any) {
        logger.warn(`DexScreener ${network.name} error:`, err.message);
      }
    }

    logger.success(`Total DEX pairs: ${allPairs.length}`);
    return allPairs;
  }

  // Raydium (Solana)
  private async fetchRaydiumPairs(): Promise<DexPair[]> {
    const pairs: DexPair[] = [];

    try {
      const { data } = await axios.get('https://api.raydium.io/v2/main/pairs', { timeout: 8000 });

      if (data && Array.isArray(data)) {
        for (const pair of data.slice(0, 500)) {
          if (!pair.baseSymbol || !pair.quoteSymbol) continue;

          pairs.push({
            dex: 'raydium',
            network: 'SOL',
            baseToken: {
              symbol: pair.baseSymbol,
              address: pair.baseMint || '',
              decimals: pair.baseDecimals || 9,
            },
            quoteToken: {
              symbol: pair.quoteSymbol,
              address: pair.quoteMint || '',
              decimals: pair.quoteDecimals || 6,
            },
            poolAddress: pair.ammId || '',
            liquidity: pair.liquidity || 0,
            volume24h: pair.volume24h || 0,
            fees: 0.0025,
            last_price: pair.price || 0,
          });
        }
        logger.info(`Raydium: ${pairs.length} pairs`);
      }
    } catch (err: any) {
      logger.warn('Raydium fetch error:', err.message);
    }

    return pairs;
  }

  // Orca (Solana)
  private async fetchOrcaPairs(): Promise<DexPair[]> {
    const pairs: DexPair[] = [];

    try {
      const { data } = await axios.get('https://api.orca.so/v2/solana/whirlpools', { timeout: 8000 });

      if (data?.whirlpools) {
        for (const pool of data.whirlpools.slice(0, 300)) {
          if (!pool.tokenA?.symbol || !pool.tokenB?.symbol) continue;

          pairs.push({
            dex: 'orca',
            network: 'SOL',
            baseToken: {
              symbol: pool.tokenA.symbol || 'UNKNOWN',
              address: pool.tokenA.address || '',
              decimals: pool.tokenA.decimals || 9,
            },
            quoteToken: {
              symbol: pool.tokenB.symbol || 'USDT',
              address: pool.tokenB.address || '',
              decimals: pool.tokenB.decimals || 6,
            },
            poolAddress: pool.address || '',
            liquidity: pool.tvl || 0,
            volume24h: pool.volume?.day || 0,
            fees: (pool.feeRate || 3000) / 1000000,
            last_price: pool.price?.current || 0,
          });
        }
        logger.info(`Orca: ${pairs.length} pairs`);
      }
    } catch (err: any) {
      logger.warn('Orca fetch error:', err.message);
    }

    return pairs;
  }

  // DexScreener для EVM сетей
  private async fetchDexScreenerPairs(chainId: string, networkName: string): Promise<DexPair[]> {
    const pairs: DexPair[] = [];

    try {
      // DexScreener не имеет endpoint для получения ВСЕХ пар сети
      // Поэтому запрашиваем топ пары по популярным токенам
      // Используем поиск по USDT pairs для каждой сети
      const { data } = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${chainId}`,
        { timeout: 5000 }
      );

      if (data.pairs && Array.isArray(data.pairs)) {
        // Фильтруем и берем топ по ликвидности
        const filtered = data.pairs
          .filter((p: any) =>
            p.chainId === chainId &&
            p.liquidity?.usd > 1000 &&
            p.baseToken?.symbol &&
            p.quoteToken?.symbol
          )
          .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
          .slice(0, 200); // Лимит 200 пар на сеть

        for (const pair of filtered) {
          pairs.push({
            dex: 'dexscreener',
            network: networkName,
            baseToken: {
              symbol: pair.baseToken.symbol,
              address: pair.baseToken.address || '',
              decimals: pair.baseToken.decimals || 18,
            },
            quoteToken: {
              symbol: pair.quoteToken.symbol,
              address: pair.quoteToken.address || '',
              decimals: pair.quoteToken.decimals || 18,
            },
            poolAddress: pair.pairAddress || '',
            liquidity: pair.liquidity?.usd || 0,
            volume24h: pair.volume?.h24 || 0,
            fees: 0.003,
            last_price: parseFloat(pair.priceUsd) || 0,
          });
        }
        logger.info(`DexScreener ${networkName}: ${pairs.length} pairs`);
      }
    } catch (err: any) {
      logger.warn(`DexScreener ${networkName} error:`, err.message);
    }

    return pairs;
  }

  // Получить цену для конкретной пары через DexScreener
  async getPrice(dex: string, network: string, baseSymbol: string, quoteSymbol: string): Promise<number> {
    try {
      const query = `${baseSymbol}/${quoteSymbol}`;
      const { data } = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${query}`,
        { timeout: 3000 }
      );

      if (data.pairs && Array.isArray(data.pairs)) {
        const pair = data.pairs.find((p: any) =>
          p.baseToken?.symbol?.toUpperCase() === baseSymbol.toUpperCase() &&
          p.quoteToken?.symbol?.toUpperCase() === quoteSymbol.toUpperCase() &&
          p.chainId === network.toLowerCase()
        );

        if (pair && pair.priceUsd) {
          return parseFloat(pair.priceUsd);
        }
      }
    } catch (e) {
      // Ignore errors
    }

    return 0;
  }

  // Получить кэшированные пары
  async getCachedPairs(network?: string): Promise<DexPair[]> {
    const now = Date.now();
    const key = network || 'all';
    const cached = this.cache.get(key);

    if (cached && now - cached.timestamp < this.cacheTtl) {
      return cached.pairs;
    }

    let pairs: DexPair[];
    if (network === 'SOL') {
      pairs = [...await this.fetchRaydiumPairs(), ...await this.fetchOrcaPairs()];
    } else if (network) {
      const chainId = network.toLowerCase();
      pairs = await this.fetchDexScreenerPairs(chainId, network);
    } else {
      pairs = await this.fetchAllDexPairs();
    }

    this.cache.set(key, { pairs, timestamp: now });
    return pairs;
  }

  getDexList(): string[] {
    return ['raydium', 'orca', 'dexscreener'];
  }

  getNetworkList(): string[] {
    return ['SOL', 'ETH', 'BASE', 'ARB', 'OP', 'BNB', 'MATIC', 'AVAX', 'FTM', 'CRO'];
  }
}

export const dexConnector = new DexConnector();
export default dexConnector;
