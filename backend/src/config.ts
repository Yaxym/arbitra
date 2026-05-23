import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://arbitra:secure_password@localhost:5432/arbitra',
  
  // RPC URLs
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  ethRpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  baseRpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  arbRpcUrl: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  opRpcUrl: process.env.OP_RPC_URL || 'https://mainnet.optimism.io',
  
  // CEX API Keys (все опциональны)
  cexKeys: {
    mexc: { apiKey: process.env.MEXC_API_KEY || '', secret: process.env.MEXC_SECRET || '' },
    binance: { apiKey: process.env.BINANCE_API_KEY || '', secret: process.env.BINANCE_SECRET || '' },
    bybit: { apiKey: process.env.BYBIT_API_KEY || '', secret: process.env.BYBIT_SECRET || '' },
    okx: { 
      apiKey: process.env.OKX_API_KEY || '', 
      secret: process.env.OKX_SECRET || '', 
      password: process.env.OKX_PASSPHRASE || '' 
    },
    gate: { apiKey: process.env.GATE_API_KEY || '', secret: process.env.GATE_SECRET || '' },
    kucoin: { 
      apiKey: process.env.KUCOIN_API_KEY || '', 
      secret: process.env.KUCOIN_SECRET || '', 
      password: process.env.KUCOIN_PASSPHRASE || '' 
    },
    htx: { apiKey: process.env.HTX_API_KEY || '', secret: process.env.HTX_SECRET || '' },
    bitget: { 
      apiKey: process.env.BITGET_API_KEY || '', 
      secret: process.env.BITGET_SECRET || '', 
      password: process.env.BITGET_PASSPHRASE || '' 
    },
    kraken: { apiKey: process.env.KRAKEN_API_KEY || '', secret: process.env.KRAKEN_SECRET || '' },
    coinbase: { apiKey: process.env.COINBASE_API_KEY || '', secret: process.env.COINBASE_SECRET || '' },
    bitfinex: { apiKey: process.env.BITFINEX_API_KEY || '', secret: process.env.BITFINEX_SECRET || '' },
    cryptodotcom: { apiKey: process.env.CRYPTO_API_KEY || '', secret: process.env.CRYPTO_SECRET || '' },
    bingx: { apiKey: process.env.BINGX_API_KEY || '', secret: process.env.BINGX_SECRET || '' },
    xt: { apiKey: process.env.XT_API_KEY || '', secret: process.env.XT_SECRET || '' },
    poloniex: { apiKey: process.env.POLONIEX_API_KEY || '', secret: process.env.POLONIEX_SECRET || '' },
  },
  
  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
};

export default config;
