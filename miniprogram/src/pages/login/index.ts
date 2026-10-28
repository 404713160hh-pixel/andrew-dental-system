import type { AuthConfig, LoginResult, PatientInput } from '../../types';
import { api, errorMessage, RequestError } from '../../utils/api';
import { emptyProfile, profileError } from '../../utils/format';
import { setSession, session } from '../../utils/session';

type Notice = {policyVersion:string;controller:string;contact:string;retention:string};
type Status = {accepted:boolean;minor:boolean;policyVersion:string};
function isMinor(birthDate:string) {
  if (!birthDate) return false;
  const birth=new Date(birthDate+'T00:00:00+08:00');
  const anniversary=new Date(birth);anniversary.setUTCFullYear(anniversary.getUTCFullYear()+14);
  return Date.now()<anniversary.getTime();
}
Page({
  data: { mode:'login',username:'',password:'',code:'',linkedBirthDate:'',profile:emptyProfile(),busy:false,loading:false,error:'',config:null as AuthConfig|null,notice:null as Notice|null,acceptedNotice:false,acceptedSensitive:false,guardianName:'',guardianRelationship:'',guardianAccepted:false,minor:false },
  onLoad() { void this.load(); },
  async load() {
    this.setData({loading:true,error:''});
    try {
      const [config,notice]=await Promise.all([api<AuthConfig>('/auth/config'),api<Notice>('/privacy/notice')]);
      this.setData({config,notice});
      const current=session();
      if(current && !config.demoAccounts.some(account=>account.portal==='patient'&&account.username===current.user.username)) {
        const status=await api<Status>('/privacy/status');
        if(!status.accepted)this.setData({mode:'consent',minor:status.minor});
      }
    } catch(error) { this.setData({error:errorMessage(error)}); }
    finally { this.setData({loading:false}); }
  },
  mode(event:WechatMiniprogram.BaseEvent) { if(!this.data.busy)this.setData({mode:String(event.currentTarget.dataset.mode),error:'',minor:false,acceptedNotice:false,acceptedSensitive:false,guardianAccepted:false}); },
  input(event:WechatMiniprogram.CustomEvent<{value:string}>) { this.setData({[String(event.currentTarget.dataset.field)]:event.detail.value}); },
  linkedDate(event:WechatMiniprogram.CustomEvent<{value:string}>) { this.setData({linkedBirthDate:event.detail.value,minor:isMinor(event.detail.value)}); },
  profileChange(event:WechatMiniprogram.CustomEvent<PatientInput>) { this.setData({profile:event.detail,minor:isMinor(event.detail.birthDate)}); },
  consentChange(event:WechatMiniprogram.CustomEvent<{value:string[]}>) { const selected=event.detail.value;this.setData({acceptedNotice:selected.includes('notice'),acceptedSensitive:selected.includes('sensitive'),guardianAccepted:selected.includes('guardian')}); },
  consent() {
    if(!this.data.notice||!this.data.acceptedNotice||!this.data.acceptedSensitive)throw new Error('请阅读隐私告知并分别确认信息和健康信息处理。');
    if(this.data.minor&&(!this.data.guardianAccepted||!this.data.guardianName.trim()||!this.data.guardianRelationship.trim()))throw new Error('未满14周岁需由父母或其他监护人填写并确认同意。');
    return {policyVersion:this.data.notice.policyVersion,noticeAccepted:true,sensitiveAccepted:true,guardian:this.data.minor?{name:this.data.guardianName.trim(),relationship:this.data.guardianRelationship.trim(),accepted:true}:null};
  },
  async submit() {
    if(this.data.busy)return;
    const username=this.data.username.trim();
    try {
      if(this.data.mode==='consent') {
        const consent=this.consent();this.setData({busy:true,error:''});await api('/privacy/consent','POST',consent);this.navigate();return;
      }
      if(!username||!this.data.password)throw new Error('请填写账号和密码。');
      if(this.data.mode==='register'||this.data.mode==='linked') {
        if(!/^[a-zA-Z0-9._-]{3,80}$/.test(username)||this.data.password.length<12)throw new Error('账号需为3至80位字母、数字、点、下划线或短横线；密码至少12位。');
        if(this.data.mode==='register') {const error=profileError(this.data.profile);if(error)throw new Error(error);}
        if(this.data.mode==='linked'&&(!this.data.code.trim()||!this.data.linkedBirthDate))throw new Error('请填写前台提供的一次性凭证及已有档案出生日期。');
      }
      const consent=this.data.mode==='register'||this.data.mode==='linked'?this.consent():null;
      this.setData({busy:true,error:''});
      const result=this.data.mode==='register'
       ?await api<LoginResult>('/auth/register','POST',{username,password:this.data.password,profile:this.data.profile,consent})
       :this.data.mode==='linked'
        ?await api<LoginResult>('/auth/register-linked','POST',{username,password:this.data.password,code:this.data.code.trim(),birthDate:this.data.linkedBirthDate,consent})
        :await api<LoginResult>('/auth/login','POST',{username,password:this.data.password,portal:'patient'});
      await this.finish(result);
    } catch(error) {this.setData({error:error instanceof RequestError&&error.uncertain&&['register','linked'].includes(this.data.mode)?'注册结果待确认。请先切换账号登录，用相同账号和密码核对。':errorMessage(error)});}
    finally {this.setData({busy:false});}
  },
  async demo(event:WechatMiniprogram.BaseEvent) {
    if(this.data.busy||!this.data.config?.demoLoginEnabled)return;
    this.setData({busy:true,error:''});
    try {await this.finish(await api<LoginResult>('/auth/demo','POST',{username:String(event.currentTarget.dataset.username),portal:'patient'}),true);}
    catch(error) {this.setData({error:errorMessage(error)});} finally {this.setData({busy:false});}
  },
  async finish(result:LoginResult,demo=false) {
    setSession(result);
    if(!demo) {const status=await api<Status>('/privacy/status');if(!status.accepted){this.setData({mode:'consent',minor:status.minor});return;}}
    this.navigate();
  },
  navigate() {wx.showToast({title:'登录成功',icon:'success'});if(getCurrentPages().length>1)wx.navigateBack();else wx.switchTab({url:'/pages/home/index'});}
});
