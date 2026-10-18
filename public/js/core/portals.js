// core/portals.js — one responsibility within the dental workspace.
import { user } from './context.js';

export const portals = {
  customer: {role:'customer',base:'/customer',name:'顾客',eyebrow:'YOUR PERSONAL CARE',title:'每一个微笑，<br>都值得认真对待。',description:'从第一次预约，到每一次复诊。<br>让你的口腔照护，安心而从容。',loginTitle:'欢迎回来',loginDescription:'登录顾客账户，安排就诊并查看你的照护记录。',features:[['calendar','预约适合你的时间','选择门诊、医生与接诊时段。'],['user','一份完整的个人档案','维护联系方式、过敏申报与紧急联系人。'],['file','清楚了解每次就诊','查看治疗记录和结算明细。']],demo:'chen'},
  front: {role:'front',base:'/frontdesk',name:'前台',eyebrow:'FRONT DESK OPERATIONS',title:'接待有序，<br>让每次就诊顺利开始。',description:'核对患者资料，协调预约与接诊。<br>把需要衔接的每一步，安排妥当。',loginTitle:'前台工作台',loginDescription:'使用机构分配的前台账号登录，处理门诊日常接待。',features:[['users','患者资料与身份核对','登记档案，沿用跨门诊患者编号。'],['calendar','预约与到诊安排','代办预约、调整时段、登记到诊或未出席。'],['wallet','结算与排班衔接','生成费用结算单，维护授权门诊接诊时段。']],demo:'front'},
  clinical: {role:'clinical',base:'/doctor',name:'医生',eyebrow:'CLINICAL WORKSPACE',title:'专注诊疗，<br>让每一份记录完整清晰。',description:'从接诊安排，到实际治疗。<br>在自己的工作区，延续患者照护。',loginTitle:'医生诊疗工作台',loginDescription:'使用机构分配的医生账号登录，查看本人接诊并记录治疗。',features:[['calendar','掌握接诊安排','查看授权范围内的预约与患者就诊信息。'],['shield','核对过敏与特殊需求','治疗前了解已申报的过敏情况。'],['tooth','记录与完成实际治疗','填写诊疗记录，逐项保存治疗及数量。']],demo:'doctor'},
  manager: {role:'manager',base:'/manager',name:'店长',eyebrow:'LOCAL CLINIC OPERATIONS',title:'照顾好每一家门店，<br>把日常运营安排妥当。',description:'协调接诊，核对账务，审核成本。<br>在授权门诊内连接团队与患者。',loginTitle:'店长运营工作台',loginDescription:'使用机构分配的店长账号登录，处理授权门诊的日常运营、账务与成本。',features:[['clinic','门店接诊与排班','查看授权门诊患者与诊疗，协调本店接诊时段。'],['wallet','账务核对与退款','核验收退款凭据，保留冲销与营业日核对记录。'],['chart','本店成本与履约','登记并审核本店季度成本，查看门诊预约履约情况。']],demo:'manager'},
  hq: {role:'hq',base:'/hq',name:'总部',eyebrow:'CHAIN MANAGEMENT',title:'连接每一家门诊，<br>让连锁经营清晰有据。',description:'统一资源与权限，掌握跨店经营。<br>让每一份决策，都有可追溯的依据。',loginTitle:'总部管理工作台',loginDescription:'使用总部账号登录，管理连锁资源、员工授权、全链季度核算与运营规则。',features:[['clinic','统一连锁资源','维护门诊、医生、资格、治疗目录与跨店排班。'],['users','员工与患者主档','分配岗位及门诊范围，核验账号恢复与患者归并。'],['chart','全链核算与审计','核算并批准季度报告，维护全链规则与导出业务资料。']],demo:'hq'},
};

export const portal = Object.values(portals).find(item => location.pathname === item.base || location.pathname.startsWith(item.base + '/')) || portals.customer;

export const portalForRole = role => portals[role];

export function setPortalLocation(workspace=false){history.replaceState(null,'',workspace?`${portal.base}${location.hash||'#home'}`:`${portal.base}/login`);}
