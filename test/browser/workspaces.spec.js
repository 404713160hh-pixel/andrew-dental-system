import { test, expect } from '@playwright/test';
const roles=[['customer','顾客','chen','用户名'],['frontdesk','前台','front','前台账号'],['doctor','医生','doctor','医生账号'],['manager','店长','manager','店长账号'],['hq','总部','hq','总部账号']];
async function login(page,path,name,username,label){
  await page.goto(`/${path}/login`);
  await page.getByLabel(label,{exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill('Dental2026!');
  await page.getByRole('button',{name:`进入${name}工作区`,exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${path}#home$`));
  await expect(page.locator('#main')).toBeVisible();
}
for(const [path,name,username,label]of roles)test(`${name}独立入口及按页面加载`,async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await login(page,path,name,username,label);
  await expect(page.getByRole('heading',{name:/工作顺利|每一次微笑/})).toBeVisible();
  expect(errors).toEqual([]);
});
test('顾客不能从顾客入口登录员工账号',async({page})=>{
  await page.goto('/customer/login');await page.getByLabel('用户名',{exact:true}).fill('front');await page.getByLabel('密码',{exact:true}).fill('Dental2026!');
  await page.getByRole('button',{name:'进入顾客工作区',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'账号或密码不正确'})).toBeVisible();await expect(page).toHaveURL(/\/customer\/login$/);
});
test('总部与店长不能互用登录入口',async({page})=>{
  for(const [path,name,username] of [['manager','店长','hq'],['hq','总部','manager']]){
    await page.goto(`/${path}/login`);await page.getByLabel(`${name}账号`,{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill('Dental2026!');
    await page.getByRole('button',{name:`进入${name}工作区`,exact:true}).click();
    await expect(page.getByRole('alert').filter({hasText:'账号或密码不正确'})).toBeVisible();await expect(page).toHaveURL(new RegExp(`/${path}/login$`));
  }
});
test('店长仅查看本店运营，界面与服务端均限制总部功能',async({page})=>{
  await login(page,'manager','店长','manager','店长账号');
  await expect(page.locator('.clinic-switcher')).toContainText('湘江门诊');
  const nav=page.getByRole('navigation',{name:'主要导航',exact:true});
  for(const name of ['账号与权限','系统设置','操作记录'])await expect(nav.getByRole('link',{name,exact:true})).toHaveCount(0);
  await page.goto('/manager#performance');await expect(page.getByRole('heading',{name:'门店成本与履约',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'核算季度报告',exact:true})).toHaveCount(0);await expect(page.locator('#main')).not.toContainText('芙蓉门诊');
  await page.goto('/manager#resources');await expect(page.getByRole('button',{name:'新增诊所',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'接诊排班',exact:true}).click();await page.getByRole('button',{name:'新增接诊排班',exact:true}).click();
  const clinic=page.getByRole('dialog').getByLabel('接诊诊所 *',{exact:true});await expect(clinic.locator('option[value="C001"]')).toHaveCount(1);await expect(clinic.locator('option[value="C002"]')).toHaveCount(0);
  const appointments=await page.request.get('/api/workspace?page=appointments&limit=100');expect(appointments.status()).toBe(200);
  expect((await appointments.json()).appointments.every(a=>a.clinicId==='C001')).toBe(true);
  const forgedFilter=await page.request.get('/api/workspace?page=appointments&clinicId=C002');expect(forgedFilter.status()).toBe(200);expect((await forgedFilter.json()).appointments).toEqual([]);
  expect((await page.request.get('/api/workspace?page=accounts')).status()).toBe(403);expect((await page.request.get('/api/backup')).status()).toBe(403);
});
test('总部可跨店查看资源并为店长分配门诊范围',async({page})=>{
  await login(page,'hq','总部','hq','总部账号');await expect(page.locator('.clinic-switcher')).toContainText('全部门诊');
  await page.goto('/hq#resources');await expect(page.locator('#main')).toContainText('湘江门诊');await expect(page.locator('#main')).toContainText('芙蓉门诊');
  await expect(page.getByRole('button',{name:'新增诊所',exact:true})).toBeVisible();
  await page.goto('/hq#accounts');await page.getByRole('button',{name:'建立员工账号',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('员工岗位',{exact:true}).selectOption('manager');
  await expect(dialog.getByRole('group',{name:'店长授权门诊（至少一项）'})).toBeVisible();
  await expect(dialog.locator('[name=clinicIds][value=C001]')).toBeVisible();await expect(dialog.locator('[name=clinicIds][value=C002]')).toBeVisible();
  await dialog.getByLabel('员工岗位',{exact:true}).selectOption('hq');await expect(dialog).toContainText('总部拥有全部门诊及员工授权管理权限');
});
test('导航保留工作区外壳，筛选由服务端查询，财务和员工页可访问',async({page})=>{
  const queries=[];page.on('request',request=>{if(request.url().includes('/api/'))queries.push(request.url());});
  await login(page,'hq','总部','hq','总部账号');
  const shell=await page.locator('.topbar').elementHandle();
  await page.goto('/hq#patients');await expect(page.getByRole('heading',{name:'患者档案',exact:true})).toBeVisible();
  expect(await shell.evaluate(node=>node.isConnected)).toBe(true);
  await page.goto('/hq#finance');await expect(page.locator('#main')).toContainText(/收款|财务|对账/);
  await page.goto('/hq#accounts');await expect(page.locator('#main')).toContainText(/员工|账号/);
  expect(queries.some(url=>url.includes('/api/workspace?'))).toBe(true);expect(queries.some(url=>/\/api\/state(?:\?|$)/.test(url))).toBe(false);
});
test('顾客手机登录没有水平溢出或隐藏注册控件',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/customer/login');await expect(page.getByRole('button',{name:'进入顾客工作区',exact:true})).toBeVisible();
  await expect(page.getByText('顾客注册',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('人工收款、原款退款与账单冲销界面完成同一账务链',async({page})=>{
  await login(page,'hq','总部','hq','总部账号');await page.goto('/hq#finance');
  const invoiceRow=page.getByRole('row').filter({hasText:'ADC-SIM-V001'});
  await invoiceRow.getByRole('button',{name:'登记收款',exact:true}).click();
  let dialog=page.getByRole('dialog');await dialog.getByLabel('本次收款金额（元）',{exact:true}).fill('1.00');
  await dialog.getByLabel('机构已核对的凭证编号 / 依据',{exact:true}).fill('E2E-SYNTHETIC-RECEIPT');
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'确认登记',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('收款记录已保存');
  await invoiceRow.getByRole('button',{name:'收退款明细',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('E2E-SYNTHETIC-RECEIPT');
  await page.getByRole('button',{name:'登记已核对退款',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('退款核对凭证',{exact:true}).fill('E2E-SYNTHETIC-REFUND');await dialog.getByLabel('退款原因',{exact:true}).fill('隔离数据库浏览器回归');
  await dialog.getByRole('button',{name:'确认退款登记',exact:true}).click();await expect(page.locator('#toast')).toContainText('退款记录已保存');
  await invoiceRow.getByRole('button',{name:'冲销',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('冲销原因',{exact:true}).fill('隔离数据库测试冲销保留原账单');
  await dialog.getByRole('button',{name:'确认冲销',exact:true}).click();await expect(page.locator('#toast')).toContainText('账单已冲销');await expect(page.locator('#main')).toContainText('已冲销');
});
test('医生通过附记追加说明并在详情中读取，保留原记录',async({page})=>{
  await login(page,'doctor','医生','doctor','医生账号');await page.goto('/doctor#visits');
  const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'更正附记',exact:true})}).first();
  await row.getByRole('button',{name:'更正附记',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('更正原因',{exact:true}).fill('隔离数据库浏览器回归核对');await dialog.getByLabel('附记内容',{exact:true}).fill('E2E新增附记，原诊疗内容保留');
  await dialog.getByRole('button',{name:'保存附记',exact:true}).click();await expect(page.locator('#toast')).toContainText('更正附记已保存');
  await row.getByRole('button',{name:'详情',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('E2E新增附记，原诊疗内容保留');
});
