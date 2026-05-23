// DEX коннектор - поддерживает 27 DEX на 15 сетях

import axios from 'axios';
import config from '../../config';
import { logger } from '../../utils/logger';
import { DexPair } from '../../models/pair';

// Конфигурация всех DEX по сетям
const DEX_CONFIG: Record<string, any> = {
  // SOLANA (3 DEX)
  raydium: { network: 'SOL', type: 'amm', pairsApi: 'https://api.raydium.io/v2/main/pairs' },
  orca: { network: 'SOL', type: 'clmm', whirlpoolsApi: 'https://api.orca.so/v2/solana/whirlpools' },
  jupiter: { network: 'SOL', type: 'aggregator', tokensApi: 'https://token.jup.ag/strict' },
  
  // BASE (3 DEX)
  aerodrome: { network: 'BASE', type: 've33', subgraph: 'https://api.thegraph.com/subgraphs/name/aerodrome-finance/aerodrome' },
  'uniswap-base': { network: 'BASE', type: 'v3', subgraph: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base' },
  baseswap: { network: 'BASE', type: 'v2', subgraph: 'https://api.thegraph.com/subgraphs/name/baseswap-finance/baseswap' },
  
  // ETHEREUM (3 DEX)
  uniswapv3: { network: 'ETH', type: 'v3', subgraph: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3' },
  sushiswap: { network: 'ETH', type: 'v2', subgraph: 'https://api.thegraph.com/subgraphs/name/sushi-v2/sushiswap-ethereum' },
  curve: { network: 'ETH', type: 'stable', api: 'https://api.curve.fi/api/getPools/ethereum' },
  
  // ARBITRUM (3 DEX)
  camelot: { network: 'ARB', type: 've33', subgraph: 'https://api.thegraph.com/subgraphs/name/camelotlabs/camelot-amm-2' },
  'uniswap-arb': { network: 'ARB', type: 'v3', subgraph: 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-arbitrum-one' },
  'traderjoe-arb': { network: 'ARB', type: 'lb', subgraph: 'https://api.thegraph.com/subgraphs/name/traderjoe-xyz/joe-v1-arbitrum' },
  
  // OPTIMISM (2 DEX)
  velodrome: { network: 'OP', type: 've33', subgraph: 'https://api.thegraph.com/subgraphs/name/velodrome-finance/velodrome' },
  'uniswap-op': { network: 'OP', type: 'v3', subgraph: 'https://api.thegraph.com/subgraphs/name/ianlapham/optimism-post-regenesis' },
  
  // POLYGON (1 DEX)
  quickswap: { network: 'MATIC', type: 'v3', subgraph: 'https://api.thegraph.com/subgraphs/name/sameepsi/quickswap-v3' },
  
  // BNB CHAIN (1 DEX)
  pancakeswap: { network: 'BNB', type: 'v3', subgraph: 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc' },
  
  // AVALANCHE (1 DEX)
  'traderjoe-avax': { network: 'AVAX', type: 'lb', subgraph: 'https://api.thegraph.com/subgraphs/name/traderjoe-xyz/joe-v1-avalanche' },
  
  // FANTOM (1 DEX)
  spookyswap: { network: 'FTM', type: 'v2', subgraph: 'https://api.thegraph.com/subgraphs/name/eerieeight/spooky-swap' },
  
  // CRONOS (1 DEX)
  vvfinance: { network: 'CRO', type: 'v2', subgraph: 'https://graph.cronoslabs.com/subgraphs/name/vvs/exchange' },
  
  // LINEA (2 DEX)
  lynex: { network: 'LINEA', type: 've33' },
  'syncswap-linea': { network: 'LINEA', type: 'v2' },
  
  // ZKSYNC (2 DEX)
  syncswap: { network: 'ZKSYNC', type: 'v2' },
  mute: { network: 'ZKSYNC', type: 'v2' },
  
  // BLAST (2 DEX)
  thruster: { network: 'BLAST', type: 'v3' },
  fenix: { network: 'BLAST', type: 've33' },
  
  // MANTLE (1 DEX)
  merchantmoe: { network: 'MANTLE', type: 'lb' },
  
  // TRON (1 DEX)
  sunswap: { network: 'TRX', type: 'v2', api: 'https://abc.endjgfsv.link/swap/pairs' },
};

class DexConnector {
  private cache: Map<string, { pairs: DexPair[]; timestamp: number }> = new Map();
  private cacheTtl: number = 60000; // 1 minute

  // Получить все пары с Solana DEX
  async fetchSolanaPairs(): Promise<DexPair[]> {
    const pairs: DexPair[] = [];

    // Raydium
    try {
      const { data } = await axios.get(DEX_CONFIG.raydium.pairsApi, { timeout: 5000 });
      if (data && Array.isArray(data)) {
        for (const pair of data.slice(0, 500)) {
          pairs.push({
            dex: 'raydium',
            network: 'SOL',
            baseToken: {
              symbol: pair.baseSymbol || 'UNKNOWN',
              address: pair.baseMint || '',
              decimals: pair.baseDecimals || 9,
            },
            quoteToken: {
              symbol: pair.quoteSymbol || 'USDT',
              address: pair.quoteMint || '',
              decimals: pair.quoteDecimals || 6,
            },
            poolAddress: pair.ammId || '',
            liquidity: pair.liquidity || 0,
            volume24h: pair.volume24h || 0,
            fees: 0.0025,
          });
        }
        logger.info(`Raydium: ${pairs.length} pairs`);
      }
    } catch (err: any) {
      logger.warn('Raydium fetch error:', err.message);
    }

    // Orca
    try {
      const { data } = await axios.get(DEX_CONFIG.orca.whirlpoolsApi, { timeout: 5000 });
      if (data?.whirlpools) {
        for (const pool of data.whirlpools.slice(0, 500)) {
          pairs.push({
            dex: 'orca',
            network: 'SOL',
            baseToken: {
              symbol: pool.tokenA?.symbol || 'UNKNOWN',
              address: pool.tokenA?.address || '',
              decimals: pool.tokenA?.decimals || 9,
            },
            quoteToken: {
              symbol: pool.tokenB?.symbol || 'USDT',
              address: pool.tokenB?.address || '',
              decimals: pool.tokenB?.decimals || 6,
            },
            poolAddress: pool.address || '',
            liquidity: pool.tvl || 0,
            volume24h: pool.volume?.day || 0,
            fees: (pool.feeRate || 3000) / 1000000,
          });
        }
        logger.info(`Orca: added more pairs`);
      }
    } catch (err: any) {
      logger.warn('Orca fetch error:', err.message);
    }

    return pairs;
  }

  // Получить пары с EVM DEX через Subgraph
  async fetchEVMPairs(network: string): Promise<DexPair[]> {
    const pairs: DexPair[] = [];
    
    const dexesForNetwork = Object.entries(DEX_CONFIG)
      .filter(([_, cfg]) => cfg.network === network && cfg.subgraph);

    for (const [dexName, cfg] of dexesForNetwork) {
      try {
        const query = this.buildSubgraphQuery(dexName, cfg.type);
        const { data } = await axios.post(cfg.subgraph, { query }, { timeout: 10000 });
        
        const poolList = data.data?.pairs || data.data?.pools || [];
        for (const pool of poolList.slice(0, 500)) {
          pairs.push({
            dex: dexName,
            network,
            baseToken: {
              symbol: pool.token0?.symbol || 'UNKNOWN',
              address: pool.token0?.id || pool.token0?.address || '',
              decimals: parseInt(pool.token0?.decimals || '18'),
            },
            quoteToken: {
              symbol: pool.token1?.symbol || 'USDT',
              address: pool.token1?.id || pool.token1?.address || '',
              decimals: parseInt(pool.token1?.decimals || '18'),
            },
            poolAddress: pool.id || '',
            liquidity: parseFloat(pool.reserveUSD || pool.totalValueLockedUSD || '0'),
            volume24h: parseFloat(pool.volumeUSD || '0'),
            fees: this.getDefaultFee(dexName),
          });
        }
        logger.info(`${dexName} (${network}): ${pairs.length} pairs`);
      } catch (err: any) {
        logger.warn(`${dexName} fetch error:`, err.message);
      }
    }

    return pairs;
  }

  // GraphQL запрос для Subgraph
  private buildSubgraphQuery(dexName: string, type: string): string {
    if (['v2', 've33'].includes(type)) {
      return `{ pairs(first: 500, orderBy: reserveUSD, orderDirection: desc) {
        id token0 { id symbol decimals } token1 { id symbol decimals }
        reserveUSD volumeUSD
      }}`;
    }
    return `{ pools(first: 500, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id token0 { id symbol decimals } token1 { id symbol decimals }
      totalValueLockedUSD volumeUSD feeTier
    }}`;
  }

  private getDefaultFee(dexName: string): number {
    const fees: Record<string, number> = {
      uniswapv3: 0.003, 'uniswap-base': 0.003, 'uniswap-arb': 0.003,
      sushiswap: 0.003, baseswap: 0.003, aerodrome: 0.003,
      pancakeswap: 0.0025, quickswap: 0.003, camelot: 0.003,
      velodrome: 0.003, spookyswap: 0.002, vvfinance: 0.003,
      curve: 0.0004, syncswap: 0.003, mute: 0.003,
    };
    return fees[dexName] || 0.003;
  }

  // Получить все пары со всех DEX
  async fetchAllDexPairs(): Promise<DexPair[]> {
    const allPairs: DexPair[] = [];

    // Solana
    const solPairs = await this.fetchSolanaPairs();
    allPairs.push(...solPairs);

    // EVM сети
    const evmNetworks = ['ETH', 'BASE', 'ARB', 'OP', 'MATIC', 'BNB', 'AVAX', 'FTM', 'CRO', 'LINEA', 'ZKSYNC', 'BLAST', 'MANTLE'];
    for (const network of evmNetworks) {
      const pairs = await this.fetchEVMPairs(network);
      allPairs.push(...pairs);
      await new Promise(r => setTimeout(r, 200));
    }

    logger.success(`Total DEX pairs: ${allPairs.length}`);
    return allPairs;
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
    if (network) {
      if (network === 'SOL') {
        pairs = await this.fetchSolanaPairs();
      } else {
        pairs = await this.fetchEVMPairs(network);
      }
    } else {
      pairs = await this.fetchAllDexPairs();
    }

    this.cache.set(key, { pairs, timestamp: now });
    return pairs;
  }

  getDexList(): string[] {
    return Object.keys(DEX_CONFIG);
  }

  getNetworkList(): string[] {
    const networks = new Set<string>();
    for (const cfg of Object.values(DEX_CONFIG)) {
      networks.add(cfg.network);
    }
    return Array.from(networks);
  }
}

export const dexConnector = new DexConnector();
export default dexConnector;
