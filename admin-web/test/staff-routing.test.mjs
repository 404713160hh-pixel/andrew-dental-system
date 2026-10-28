/** Exercise the actual router guard and password-change view without a network or browser. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';

function compile(source,modules,expose=''){
 const exports={};
 const compiled=ts.transpileModule(source+'\n'+expose,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports,Promise,Set,require(name){assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];}});
 return exports;
}
function guardFor(auth){
 let callback;const routes=[];
 const mockRouter={createWebHistory:()=>({}),createRouter(options){routes.push(...options.routes);return {beforeEach(cb){callback=cb;}};}};
 compile(readFileSync(new URL('../src/router.ts',import.meta.url),'utf8'),{'vue-router':mockRouter,'./stores/auth':{useAuth:()=>auth}});
 return {callback,routes};
}
const target=(path,meta={})=>({path,fullPath:path,meta});
test('the router requires a session and sends temporary-password staff to change-password',async()=>{
 const auth={user:null,restore:async()=>{},isHq:false,canManage:false,canBook:false};
 const {callback,routes}=guardFor(auth);
 assert.equal(routes.find(r=>r.path==='/staff/accounts').meta.hq,true);
 assert.deepEqual(JSON.parse(JSON.stringify(await callback(target('/staff/accounts',{hq:true})))),{path:'/login',query:{next:'/staff/accounts'}});
 auth.user={mustChangePassword:true};
 assert.equal(await callback(target('/appointments')),'/change-password');
 assert.equal(await callback(target('/change-password')),undefined);
});
test('the router grants staff account management only to HQ and denies doctor-only booking routes',async()=>{
 const auth={user:{mustChangePassword:false},restore:async()=>{},isHq:false,canManage:false,canBook:false};
 const {callback}=guardFor(auth);
 assert.equal(await callback(target('/staff/accounts',{hq:true})),'/appointments');
 assert.equal(await callback(target('/booking',{book:true})),'/appointments');
 auth.isHq=true;auth.canManage=true;auth.canBook=true;
 assert.equal(await callback(target('/staff/accounts',{hq:true})),undefined);
});
function passwordFixture(){
 const requests=[],navigation=[],auth={user:{mustChangePassword:true}};
 const source=readFileSync(new URL('../src/views/ChangePasswordView.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 const modules={vue,'vue-router':{useRouter:()=>({replace:async p=>navigation.push(p)})},
  'element-plus':{ElMessage:{success:()=>{}}},'../stores/auth':{useAuth:()=>auth},
  '../api':{errorText:e=>e.message,api:async(path,options)=>{requests.push({path,options});return path==='/me'?{mustChangePassword:false}:{changed:true};}}};
 const page=compile(source,modules,'export {currentPassword,newPassword,confirm,busy,error,save};');
 return {page,requests,navigation,auth};
}
test('password view refuses a mismatch without sending a write and refreshes principal after success',async()=>{
 const f=passwordFixture();f.page.currentPassword.value='temporary-password';f.page.newPassword.value='long-new-password';f.page.confirm.value='mismatch';
 await f.page.save();assert.equal(f.requests.length,0);assert.ok(f.page.error.value);
 f.page.confirm.value='long-new-password';await f.page.save();
 assert.equal(f.requests[0].path,'/auth/change-password');assert.equal(f.requests[0].options.body.currentPassword,'temporary-password');
 assert.equal(f.requests[1].path,'/me');assert.equal(f.auth.user.mustChangePassword,false);assert.equal(f.page.currentPassword.value,'');assert.deepEqual(f.navigation,['/appointments']);
});
