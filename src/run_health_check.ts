import { HealthCheck } from './utils/healthCheck';
import { ExecutionConfig } from './utils/reportExporter';
import * as fs from 'fs';
import * as path from 'path';

async function runPreflight() {
  console.log('🚀 Starting Pre-flight Health Checks...');

  // 1. Load Config
  // We can reuse ReportExporter's config loading logic or just read the file directly if simple.
  // ReportExporter has a loadConfig method but it's private or bound to the instance.
  // Let's manually load strictly for health check to avoid heavy dependencies.
  
  let config = {
    base_url: process.env.BASE_URL || 'https://api.gazzer.app', // Fallback or strict fail?
    minimum_test_cases: 0,
    timeout: 30000,
    retry_attempts: 2,
    request_delay: 100
  };

  try {
    const configPath = path.resolve(__dirname, '../config/global_config.json'); // Adjust path as needed
    if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const fileConfig = JSON.parse(raw);
        config = { ...config, ...fileConfig };
    }
  } catch (e) {
      console.warn('⚠️ Could not load global_config.json, using defaults.');
  }

  // 2. Run Health Check
  const checker = new HealthCheck(config as unknown as ExecutionConfig);
  // We might want to pass an auth token if available in env
  const token = process.env.AUTH_TOKEN;

  const status = await checker.performChecks(token);

  console.log('----------------------------------------');
  console.log(`Health Status: ${status.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
  console.log('----------------------------------------');
  status.details.forEach(d => console.log(`• ${d}`));
  console.log('----------------------------------------');

  if (!status.healthy) {
    console.error('⛔ Pre-flight checks failed. Aborting test execution.');
    process.exit(1);
  } else {
    console.log('✨ Environment ready. Proceeding with tests.');
    process.exit(0);
  }
}

runPreflight().catch(err => {
  console.error('🔥 Fatal error during preflight:', err);
  process.exit(1);
});
