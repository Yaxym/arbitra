// PostgreSQL клиент для хранения данных

import { Pool, QueryResult } from 'pg';
import config from '../config';
import { logger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';

class PostgresClient {
  public pool: Pool;
  private connected: boolean = false;
  
  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    this.pool.on('connect', () => {
      this.connected = true;
      logger.success('PostgreSQL connected');
    });
    
    this.pool.on('error', (err) => {
      this.connected = false;
      logger.error('PostgreSQL error:', err.message);
    });
  }
  
  async query(text: string, params?: any[]): Promise<QueryResult> {
    try {
      const result = await this.pool.query(text, params);
      return result;
    } catch (err: any) {
      throw new DatabaseError(err.message);
    }
  }
  
  async init(): Promise<void> {
    // Создаем таблицу пар если не существует
    await this.query(`
      CREATE TABLE IF NOT EXISTS pairs (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        base VARCHAR(16) NOT NULL,
        quote VARCHAR(16) NOT NULL,
        venue VARCHAR(32) NOT NULL,
        venue_type VARCHAR(8) NOT NULL,
        network VARCHAR(16),
        pool_address VARCHAR(128),
        base_address VARCHAR(128),
        quote_address VARCHAR(128),
        base_decimals NUMERIC(10,4),
        quote_decimals NUMERIC(10,4),
        liquidity_usd NUMERIC(20,4),
        volume_24h_usd NUMERIC(20,4),
        fee_percent NUMERIC(8,4),
        active BOOLEAN DEFAULT TRUE,
        deposit_enabled BOOLEAN DEFAULT TRUE,
        withdraw_enabled BOOLEAN DEFAULT TRUE,
        discovered_at TIMESTAMP DEFAULT NOW(),
        last_seen_at TIMESTAMP DEFAULT NOW(),
        is_new_listing BOOLEAN DEFAULT FALSE,
        UNIQUE(symbol, venue)
      )
    `);

    // Таблица новых листингов
    await this.query(`
      CREATE TABLE IF NOT EXISTS new_listings (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(32) NOT NULL,
        base VARCHAR(16) NOT NULL,
        quote VARCHAR(16) NOT NULL,
        venue VARCHAR(32) NOT NULL,
        detected_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(symbol, venue)
      )
    `);
    
    // Создаем таблицы если не существуют
    await this.query(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id SERIAL PRIMARY KEY,
        pair_symbol VARCHAR(32) NOT NULL,
        pair_full VARCHAR(64),
        pair_net VARCHAR(16),
        cex_id VARCHAR(32) NOT NULL,
        dex_id VARCHAR(32) NOT NULL,
        direction VARCHAR(16) NOT NULL,
        gross_spread DECIMAL(10, 4) NOT NULL,
        net_spread DECIMAL(10, 4) NOT NULL,
        volume_24h DECIMAL(20, 2),
        detected_at TIMESTAMP DEFAULT NOW(),
        deposit_open BOOLEAN DEFAULT TRUE,
        withdraw_open BOOLEAN DEFAULT TRUE
      )
    `);
    
    await this.query(`
      CREATE TABLE IF NOT EXISTS executed_trades (
        id SERIAL PRIMARY KEY,
        opportunity_id INTEGER REFERENCES opportunities(id),
        buy_price DECIMAL(30, 12),
        sell_price DECIMAL(30, 12),
        amount DECIMAL(30, 12),
        realized_profit DECIMAL(20, 4),
        gas_cost DECIMAL(20, 8),
        tx_hash VARCHAR(128),
        status VARCHAR(16) DEFAULT 'pending',
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await this.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        symbol VARCHAR(32) PRIMARY KEY,
        added_at TIMESTAMP DEFAULT NOW(),
        reason TEXT
      )
    `);
    
    await this.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Индексы для ускорения поиска
    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_pairs_symbol ON pairs(symbol);
      CREATE INDEX IF NOT EXISTS idx_pairs_base ON pairs(base);
      CREATE INDEX IF NOT EXISTS idx_pairs_venue ON pairs(venue);
      CREATE INDEX IF NOT EXISTS idx_pairs_network ON pairs(network);
      CREATE INDEX IF NOT EXISTS idx_pairs_active ON pairs(active) WHERE active = TRUE;
      CREATE INDEX IF NOT EXISTS idx_opportunities_pair ON opportunities(pair_symbol);
      CREATE INDEX IF NOT EXISTS idx_opportunities_cex ON opportunities(cex_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_dex ON opportunities(dex_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_detected ON opportunities(detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_spread ON opportunities(net_spread DESC);
    `);
    
    logger.success('Database initialized');
  }
  
  async saveOpportunity(opp: any): Promise<number> {
    const result = await this.query(
      `INSERT INTO opportunities 
       (pair_symbol, pair_full, pair_net, cex_id, dex_id, direction, gross_spread, net_spread, volume_24h, deposit_open, withdraw_open)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        opp.pair.symbol,
        opp.pair.full,
        opp.pair.net,
        opp.cex.id,
        opp.dex.id,
        opp.direction,
        opp.grossSpread,
        opp.netSpread,
        opp.volume24h,
        opp.depositOpen,
        opp.withdrawOpen,
      ]
    );
    return result.rows[0].id;
  }
  
  async getRecentOpportunities(limit: number = 100): Promise<any[]> {
    const result = await this.query(
      `SELECT * FROM opportunities ORDER BY detected_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
  
  async addToBlacklist(symbol: string, reason?: string): Promise<void> {
    await this.query(
      `INSERT INTO blacklist (symbol, reason) VALUES ($1, $2)
       ON CONFLICT (symbol) DO UPDATE SET reason = $2, added_at = NOW()`,
      [symbol.toUpperCase(), reason || null]
    );
  }
  
  async getBlacklist(): Promise<string[]> {
    const result = await this.query(`SELECT symbol FROM blacklist`);
    return result.rows.map(r => r.symbol);
  }
  
  async removeFromBlacklist(symbol: string): Promise<void> {
    await this.query(`DELETE FROM blacklist WHERE symbol = $1`, [symbol.toUpperCase()]);
  }
  
  async saveSettings(key: string, value: any): Promise<void> {
    await this.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  }
  
  async getSettings(key: string): Promise<any | null> {
    const result = await this.query(`SELECT value FROM settings WHERE key = $1`, [key]);
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
  }
  
  async isConnected(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  
  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const postgres = new PostgresClient();
export default postgres;
