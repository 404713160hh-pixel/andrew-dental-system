import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'test/browser',fullyParallel:false,workers:1,retries:process.env.CI?1:0,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:3227',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure',...(process.env.DENTAL_BROWSER_CHANNEL?{channel:process.env.DENTAL_BROWSER_CHANNEL}:{})},
  webServer:{command:'node server/index.js',url:'http://127.0.0.1:3227/api/health',reuseExistingServer:false,timeout:30000,
    env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:'3227',PUBLIC_ORIGIN:'http://127.0.0.1:3227',COOKIE_SECURE:'0',DENTAL_SEED_DEMO:'1',DENTAL_DB_PATH:process.env.DENTAL_E2E_DATABASE}}
});
