// Redis клиент для кэширования

import Redis from 'ioredis';
import config from '../config';
import { logger } from '../utils/logger';

class RedisClient {
  private client: Redis;
  private connected: boolean = false;
  
  constructor() {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
    });
    
    this.client.on('connect', () => {
      this.connected = true;
      logger.success('Redis connected');
    });
    
    this.client.on('error', (err) => {
      this.connected = false;
      logger.warn('Redis error:', err.message);
    });
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }
  
  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }
  
  async del(key: string): Promise<number> {
    return await this.client.del(key);
  }
  
  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }
  
  async mget(keys: string[]): Promise<(string | null)[]> {
    return await this.client.mget(keys);
  }
  
  async hset(key: string, field: string, value: string): Promise<number> {
    return await this.client.hset(key, field, value);
  }
  
  async hget(key: string, field: string): Promise<string | null> {
    return await this.client.hget(key, field);
  }
  
  async hgetall(key: string): Promise<Record<string, string>> {
    return await this.client.hgetall(key);
  }
  
  async lpush(key: string, value: string): Promise<number> {
    return await this.client.lpush(key, value);
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.lrange(key, start, stop);
  }
  
  async publish(channel: string, message: string): Promise<number> {
    return await this.client.publish(channel, message);
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  async close(): Promise<void> {
    await this.client.quit();
  }
}

export const redis = new RedisClient();
export default redis;
