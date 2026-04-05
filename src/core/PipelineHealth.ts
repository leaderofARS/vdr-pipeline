import { PipelineConfig } from '../types';

/**
 * PipelineHealth provides a health check for the SDK's integrations.
 * 
 * Reports the readiness of the persistence adapter and anchoring service.
 * Useful for monitoring and alerting in production systems to ensure
 * 'fail-closed' and 'fail-alert' scenarios are handled.
 * 
 * ## Metrics Provided
 * - `version` - SDK version (from package.json)
 * - `persistenceStatus` - READ/WRITE/READY/ERROR
 * - `anchoringStatus` - READY/ERROR
 * - `middlewareCount` - total active middleware
 * - `poolSize` - number of active sessions
 */

export interface HealthReport {
    sdkVersion: string;
    environment: string;
    persistence: {
        status: 'READY' | 'ERROR' | 'DISABLED';
        canRead: boolean;
        canWrite: boolean;
        latencyMs?: number;
        error?: string;
    };
    anchoring: {
        mode: 'managed' | 'direct' | 'none';
        status: 'READY' | 'ERROR';
        rpcConnected?: boolean;
        error?: string;
    };
    uptimeMs: number;
    memoryUsage: NodeJS.MemoryUsage;
}

export class PipelineHealth {
    private config: PipelineConfig;
    private startTime: number;

    constructor(config: PipelineConfig) {
        this.config = config;
        this.startTime = Date.now();
    }

    /**
     * Run a full health scan of all configured components.
     */
    async check(): Promise<HealthReport> {
        const start = Date.now();
        
        // 1. Check Persistence
        let persistenceStatus: HealthReport['persistence'] = {
            status: 'DISABLED',
            canRead: false,
            canWrite: false
        };

        if (this.config.persistenceAdapter) {
            try {
                const testId = `health-check-${Date.now()}`;
                const testSession = { sessionId: testId, pipelineId: 'health', events: [], createdAt: Date.now() };
                
                await this.config.persistenceAdapter.save(testSession);
                const loaded = await this.config.persistenceAdapter.load(testId);
                await this.config.persistenceAdapter.delete(testId);
                
                persistenceStatus = {
                    status: 'READY',
                    canRead: !!loaded,
                    canWrite: true,
                    latencyMs: Date.now() - start
                };
            } catch (err: any) {
                persistenceStatus = {
                    status: 'ERROR',
                    canRead: false,
                    canWrite: false,
                    error: err.message
                };
            }
        }

        // 2. Check Anchoring (shallow check)
        let anchoringStatus: HealthReport['anchoring'] = {
            mode: this.config.apiKey ? 'managed' : (this.config.solanaSecretKey ? 'direct' : 'none'),
            status: 'READY'
        };

        if (this.config.solanaSecretKey && this.config.rpcEndpoint) {
            try {
                // We'll just check if the endpoint is reachable (Deno/Node friendly)
                const response = await fetch(this.config.rpcEndpoint, { 
                    method: 'POST', 
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }) 
                });
                anchoringStatus.rpcConnected = response.ok;
            } catch (err: any) {
                anchoringStatus.status = 'ERROR';
                anchoringStatus.error = err.message;
            }
        }

        return {
            sdkVersion: '1.0.0', // This can be automated from package.json
            environment: process.env.NODE_ENV || 'development',
            persistence: persistenceStatus,
            anchoring: anchoringStatus,
            uptimeMs: Date.now() - this.startTime,
            memoryUsage: process.memoryUsage()
        };
    }
}
