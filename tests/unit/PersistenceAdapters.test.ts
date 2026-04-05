import { FileSystemPersistenceAdapter, NoopPersistenceAdapter } from '../../src/core/PersistenceAdapters';
import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const TEST_DIR = './test-sessions';

describe('Persistence Adapters', () => {
    describe('FileSystemPersistenceAdapter', () => {
        const adapter = new FileSystemPersistenceAdapter(TEST_DIR);

        beforeEach(async () => {
            try {
                await fs.rm(TEST_DIR, { recursive: true, force: true });
            } catch {}
        });

        afterEach(async () => {
            try {
                await fs.rm(TEST_DIR, { recursive: true, force: true });
            } catch {}
        });

        it('should save and load a session', async () => {
            const session = {
                sessionId: 'session-1',
                pipelineId: 'agent-1',
                events: [],
                createdAt: Date.now()
            };

            await adapter.save(session);
            const loaded = await adapter.load('session-1');
            expect(loaded).toEqual(session);
        });

        it('should return null if session not found', async () => {
            const loaded = await adapter.load('non-existent');
            expect(loaded).toBeNull();
        });

        it('should delete a session', async () => {
            const session = { sessionId: 's1', pipelineId: 'p1', events: [], createdAt: 0 };
            await adapter.save(session);
            await adapter.delete('s1');
            const loaded = await adapter.load('s1');
            expect(loaded).toBeNull();
        });

        it('should list all sessions', async () => {
            await adapter.save({ sessionId: 's1', pipelineId: 'p1', events: [], createdAt: 0 });
            await adapter.save({ sessionId: 's2', pipelineId: 'p1', events: [], createdAt: 0 });
            
            const list = await adapter.list();
            expect(list).toContain('s1');
            expect(list).toContain('s2');
            expect(list.length).toBe(2);
        });
    });

    describe('NoopPersistenceAdapter', () => {
        const adapter = new NoopPersistenceAdapter();

        it('should do nothing gracefully', async () => {
            await adapter.save({ sessionId: 's1', pipelineId: 'p1', events: [], createdAt: 0 });
            const loaded = await adapter.load('s1');
            expect(loaded).toBeNull();
            await adapter.delete('s1');
        });
    });
});
