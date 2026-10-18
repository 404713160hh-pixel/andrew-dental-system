export function validateDeployment(options={}) {
  if(process.env.NODE_ENV!=='production')return;
  const origins=options.allowedOrigins||(process.env.PUBLIC_ORIGIN||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(!origins.length||origins.some(value=>{try{const url=new URL(value);return url.protocol!=='https:'||url.origin!==value;}catch{return true;}}))throw new Error('生产环境需配置准确的 HTTPS PUBLIC_ORIGIN');
  if(process.env.COOKIE_SECURE!=='1')throw new Error('生产环境需启用 COOKIE_SECURE=1');
  if(process.env.DENTAL_SEED_DEMO!=='0'&&process.env.DENTAL_PUBLIC_DEMO!=='1')throw new Error('生产环境需关闭演示初始化；公开合成数据演示须显式启用 DENTAL_PUBLIC_DEMO=1');
}
