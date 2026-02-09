import { APIRequestContext, request } from '@playwright/test';
import { ExecutionConfig } from './reportExporter';

export interface HealthStatus {
  healthy: boolean;
  checks: {
    apiReachable: boolean;
    authValid: boolean;
    databaseConnected?: boolean;
  };
  details: string[];
}

export class HealthCheck {
  private config: ExecutionConfig;
  private baseURL: string;

  constructor(config: ExecutionConfig) {
    this.config = config;
    const rawUrl = config.base_url || 'https://api.gazzer.app';
    this.baseURL = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  }

  /**
   * Performs a comprehensive pre-flight check of the environment.
   * Checks API connectivity and Authentication validity (if token provided).
   */
  async performChecks(authToken?: string): Promise<HealthStatus> {
    const status: HealthStatus = {
      healthy: true,
      checks: { apiReachable: false, authValid: false },
      details: []
    };

    const context = await request.newContext({
      baseURL: this.baseURL,
      extraHTTPHeaders: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
      ignoreHTTPSErrors: true
    });

    try {
      // 1. Check API Reachability (using a lightweight endpoint, e.g., health or root)
      // If no dedicated health endpoint, use a known public endpoint or root
      const healthEndpoint = '/api/v1/public/health'; // Hypothetical, falling back to root if 404
      
      const pingStart = Date.now();
      let response = await context.get(healthEndpoint);
      let duration = Date.now() - pingStart;

      if (response.status() === 404) {
          // Fallback to root or another known endpoint if health check is missing
          response = await context.get('/');
      }

      if (response.ok() || response.status() === 401 || response.status() === 403 || response.status() === 404) {
         // Even 401/403 means the server is reachable. 404 means route doesn't exist but server responded.
         // Connection refused would throw.
         status.checks.apiReachable = true;
         status.details.push(`API reachable at ${this.baseURL} (${duration}ms)`);
      } else {
         status.checks.apiReachable = false; // 500s or other severe errors might indicate unhealth
         status.healthy = false;
         status.details.push(`API responding with ${response.status()} at ${this.baseURL}`);
      }

      // 2. Check Auth Validity if token provided
      if (authToken && status.checks.apiReachable) {
        // Try a protected endpoint. 
        // We'll assume a lightweight protected endpoint exists, or use a known one.
        // For Gazzer, let's try getting profile or addresses with limit=1
        const authResponse = await context.get('/api/v1/client/addresses?limit=1');
        
        if (authResponse.ok()) {
            status.checks.authValid = true;
            status.details.push('Authentication token is valid.');
        } else if (authResponse.status() === 401 || authResponse.status() === 403) {
            status.checks.authValid = false;
            status.healthy = false;
            status.details.push('Authentication token is invalid or expired (401/403).');
        } else {
            // Other error, maybe auth is fine but endpoint failed. 
            // We'll mark as valid-ish but warn.
            status.checks.authValid = true; 
            status.details.push(`Auth check inconclusive (${authResponse.status()}), assuming valid for now.`);
        }
      } else {
          status.details.push('Skipping auth check (no token provided or API unreachable).');
      }

    } catch (error) {
      status.healthy = false;
      status.checks.apiReachable = false;
      status.details.push(`API Unreachable: ${(error as Error).message}`);
    } finally {
      await context.dispose();
    }

    return status;
  }
}
