import * as fs from 'fs/promises';
import * as path from 'path';
import { PersistenceAdapter, PartialSession } from '../types';

/**
 * FileSystemPersistenceAdapter stores session data as JSON files in a local directory.
 * 
 * Simple but effective for local applications, CLI tools, and development.
 * 
 * @example
 * ```typescript
 * const adapter = new FileSystemPersistenceAdapter('./vdr-sessions');
 * const pipeline = new Pipeline({ ..., persistenceAdapter: adapter });
 * ```
 */
export class FileSystemPersistenceAdapter implements PersistenceAdapter {
  private baseDir: string;

  constructor(baseDir: string = './vdr-sessions') {
    this.baseDir = path.resolve(baseDir);
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  private getFilePath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.json`);
  }

  async save(session: PartialSession): Promise<void> {
    await this.ensureDir();
    const filePath = this.getFilePath(session.sessionId);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<PartialSession | null> {
    const filePath = this.getFilePath(sessionId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /**
   * List all session IDs currently stored in the baseDir.
   */
  async list(): Promise<string[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.baseDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}

/**
 * RedisPersistenceAdapter stores session data in a Redis instance.
 * 
 * Recommended for distributed agents running on multiple servers or in serverless environments.
 * 
 * @example
 * ```typescript
 * const adapter = new RedisPersistenceAdapter('redis://localhost:6379');
 * ```
 */
export class RedisPersistenceAdapter implements PersistenceAdapter {
  private redis: any;
  private prefix: string;
  private ttl: number;

  constructor(connectionString: string, options: { prefix?: string, ttl?: number } = {}) {
    this.prefix = options.prefix || 'vdr_ses:';
    this.ttl = options.ttl || 86400 * 7; // Default 7 days
    
    try {
        const Redis = require('ioredis');
        this.redis = new Redis(connectionString);
    } catch {
        console.warn("[VDR-PIPELINE] ioredis not found. RedisPersistenceAdapter will not work unless you install it.");
    }
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  async save(session: PartialSession): Promise<void> {
    if (!this.redis) return;
    const key = this.getKey(session.sessionId);
    await this.redis.set(key, JSON.stringify(session), 'EX', this.ttl);
  }

  async load(sessionId: string): Promise<PartialSession | null> {
    if (!this.redis) return null;
    const key = this.getKey(sessionId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async delete(sessionId: string): Promise<void> {
    if (!this.redis) return;
    const key = this.getKey(sessionId);
    await this.redis.del(key);
  }

  async list(): Promise<string[]> {
    if (!this.redis) return [];
    const keys = await this.redis.keys(`${this.prefix}*`);
    return keys.map((k: string) => k.replace(this.prefix, ''));
  }
}

/**
 * SQLitePersistenceAdapter stores session data in a local SQLite database.
 * 
 * Excellent for single-server durable storage.
 * 
 * @example
 * ```typescript
 * const adapter = new SQLitePersistenceAdapter('./vdr-pipeline.db');
 * ```
 */
export class SQLitePersistenceAdapter implements PersistenceAdapter {
  private db: any;
  private tableName: string;

  constructor(dbPath: string = './vdr-pipeline.db', tableName: string = 'vdr_sessions') {
    this.tableName = tableName;
    try {
        const Database = require('better-sqlite3');
        this.db = new Database(dbPath);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updatedAt INTEGER NOT NULL
          )
        `);
    } catch {
        console.warn("[VDR-PIPELINE] better-sqlite3 not found. SQLitePersistenceAdapter will not work unless you install it.");
    }
  }

  async save(session: PartialSession): Promise<void> {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, data, updatedAt)
      VALUES (?, ?, ?)
    `);
    stmt.run(session.sessionId, JSON.stringify(session), Date.now());
  }

  async load(sessionId: string): Promise<PartialSession | null> {
    if (!this.db) return null;
    const stmt = this.db.prepare(`SELECT data FROM ${this.tableName} WHERE id = ?`);
    const row = stmt.get(sessionId);
    return row ? JSON.parse(row.data) : null;
  }

  async delete(sessionId: string): Promise<void> {
    if (!this.db) return;
    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    stmt.run(sessionId);
  }

  async list(): Promise<string[]> {
    if (!this.db) return [];
    const rows = this.db.prepare(`SELECT id FROM ${this.tableName}`).all();
    return rows.map((r: any) => r.id);
  }
  
  /**
   * Remove old sessions based on a TTL in milliseconds.
   */
  async cleanup(ttlMs: number): Promise<number> {
      if (!this.db) return 0;
      const cutoff = Date.now() - ttlMs;
      const result = this.db.prepare(`DELETE FROM ${this.tableName} WHERE updatedAt < ?`).run(cutoff);
      return result.changes;
  }
}

/**
 * NoopPersistenceAdapter is the default implementation that does nothing.
 * It's essentially an in-memory-only session.
 */
export class NoopPersistenceAdapter implements PersistenceAdapter {
  async save(_session: PartialSession): Promise<void> {}
  async load(_sessionId: string): Promise<PartialSession | null> { return null; }
  async delete(_sessionId: string): Promise<void> {}
}
