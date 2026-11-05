import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';

function fixture(){
 const requests=[],navigation=[],exports={};
 const auth={loadConfig:async()=>{},login:async(...args)=>requests.push(args)};
 const source=readFileSync(new URL('../src/views/LoginView.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 const compiled=ts.transpileModule(source+'\nexport {roleAccounts,selectedAccount,selectAccount,username,password,busy,error,login};',
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const modules={vue:{...vue,onMounted:()=>{}},'vue-router':{useRoute:()=>({query:{}}),useRouter:()=>({replace:async path=>navigation.push(path)})},
  '../components/SiteIcp.vue':{},'@element-plus/icons-vue':{},'../stores/auth':{useAuth:()=>auth},'../api':{errorText:error=>error.message}};
 vm.runInNewContext(compiled,{exports,require(name){assert.ok(name in modules,name);return modules[name];}});
 return {page:exports,requests,navigation};
}

test('staff role presets fill accounts without submitting and clear stale passwords only when switching identity',()=>{
 const {page,requests}=fixture();
 assert.deepEqual(Array.from(page.roleAccounts,item=>item.username),['hq','manager.a','front.a','doctor.a']);
 page.password.value='old-password';page.error.value='old error';page.selectAccount('manager.a');
 assert.equal(page.username.value,'manager.a');assert.equal(page.selectedAccount.value,'manager.a');assert.equal(page.password.value,'');assert.equal(page.error.value,'');
 page.password.value='typed-password';page.selectAccount('manager.a');assert.equal(page.password.value,'typed-password');
 page.selectAccount('doctor.a');assert.equal(page.password.value,'');
 page.username.value='custom.staff';assert.equal(page.selectedAccount.value,'');
 page.busy.value=true;page.selectAccount('hq');assert.equal(page.username.value,'custom.staff');assert.equal(requests.length,0);
});

test('staff presets retain normal password login and cannot submit an empty password',async()=>{
 const {page,requests,navigation}=fixture();page.selectAccount('front.a');
 await page.login();assert.equal(requests.length,0);assert.ok(page.error.value);
 page.password.value='synthetic-fixture-password';await page.login();
 assert.deepEqual(requests,[['front.a','synthetic-fixture-password',false]]);assert.deepEqual(navigation,['/appointments']);
});
