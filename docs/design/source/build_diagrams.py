"""Deterministic monochrome report diagrams; editable SVG and vector PDF share geometry."""
from pathlib import Path
from html import escape
import json, math
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'figures'; OUT.mkdir(exist_ok=True)
for name,file in [('Diagram','Deng.ttf'),('DiagramBold','Dengb.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
CAT=[]
class Figure:
    def __init__(self,id,title,h=680):
        self.id,self.title,self.h=id,title,h
        self.c=canvas.Canvas(str(OUT/(id+'.pdf')),pagesize=(600,h))
        self.c.setTitle(title);self.c.setAuthor('张云福')
        self.svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="{h}" viewBox="0 0 600 {h}"><rect width="600" height="{h}" fill="white"/>']
    def line(self,x1,y1,x2,y2,dashed=False,width=1,arrow=False):
        c=self.c;c.setLineWidth(width);c.setStrokeColorRGB(0,0,0);c.setDash([5,4] if dashed else [])
        c.line(x1,self.h-y1,x2,self.h-y2)
        self.svg.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="black" stroke-width="{width}"'+(' stroke-dasharray="5 4"' if dashed else '')+'/>')
        if arrow:
            angle=math.atan2(y2-y1,x2-x1);a=7
            for theta in [angle+2.65,angle-2.65]:
                self.line(x2,y2,x2+a*math.cos(theta),y2+a*math.sin(theta),width=width)
    def text(self,x,y,value,size=14,bold=False,anchor='middle'):
        font='DiagramBold' if bold else 'Diagram'; self.c.setFont(font,size); self.c.setFillColorRGB(0,0,0)
        for i,line in enumerate(str(value).split('\n')):
            yy=y+i*(size+4)
            {'middle':self.c.drawCentredString,'start':self.c.drawString,'end':self.c.drawRightString}[anchor](x,self.h-yy,line)
            self.svg.append(f'<text x="{x}" y="{yy}" font-family="DengXian,Microsoft YaHei,sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" text-anchor="{anchor}" fill="black">{escape(line)}</text>')
    def rect(self,x,y,w,h,label='',size=14,dashed=False):
        self.c.setDash([5,4] if dashed else []);self.c.setLineWidth(1);self.c.setFillColorRGB(1,1,1)
        self.c.rect(x,self.h-y-h,w,h,fill=1,stroke=1)
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="white" stroke="black"'+(' stroke-dasharray="5 4"' if dashed else '')+'/>')
        if label:self.text(x+w/2,y+h/2+size/3-(len(label.split('\n'))-1)*(size+4)/2,label,size)
    def ellipse(self,x,y,w,h,label,size=14,black=False):
        self.c.setDash([]);self.c.setFillColorRGB(*((0,0,0) if black else (1,1,1)));self.c.ellipse(x,self.h-y-h,x+w,self.h-y,fill=1,stroke=1)
        self.svg.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{"black" if black else "white"}" stroke="black"/>')
        self.text(x+w/2,y+h/2+size/3-(len(label.split('\n'))-1)*(size+4)/2,label,size)
    def actor(self,x,y,label,kind='actor'):
        if kind=='entity':
            self.ellipse(x-16,y,32,32,''); self.line(x-23,y+35,x+23,y+35)
        else:
            self.ellipse(x-8,y,16,16,'');self.line(x,y+16,x,y+40);self.line(x-18,y+25,x+18,y+25);self.line(x,y+40,x-16,y+57);self.line(x,y+40,x+16,y+57)
            if kind=='worker':self.line(x-17,y-5,x-8,y-5);self.line(x-17,y-5,x-17,y+7)
        self.text(x,y+(55 if kind=='entity' else 77),label,13)
    def save(self):
        self.svg.append('</svg>');(OUT/(self.id+'.svg')).write_text('\n'.join(self.svg),encoding='utf-8')
        self.c.showPage();self.c.save()
        doc=pdfium.PdfDocument(OUT/(self.id+'.pdf'));doc[0].render(scale=3).to_pil().save(OUT/(self.id+'.png'));doc.close()
        CAT.append({'id':self.id,'title':self.title,'path':str(OUT/(self.id+'.png')),'pdf':str(OUT/(self.id+'.pdf')),'svg':str(OUT/(self.id+'.svg'))})

def sequence(id,title,participants,messages,note='',system=False):
    h=min(760,205+len(messages)*50)
    f=Figure(id,title,h);f.rect(4,4,592,h-8);f.text(15,25,'sd '+title,14,True,'start')
    xs=[64+i*472/(len(participants)-1) for i in range(len(participants))]
    for x,(label,kind) in zip(xs,participants):
        if kind in ['worker','actor','entity']:f.actor(x,42,label,kind)
        else:f.rect(x-45,42,90,66,label,13)
        f.line(x,133,x,h-72,True)
    for n,message in enumerate(messages):
        a,b,label=message[:3];reply=len(message)>3 and message[3]=='return'
        y=163+n*50
        # Long calls wrap above their own arrow, never beyond the canvas.
        maxw=min(535,max(150,abs(xs[a]-xs[b])+18))
        lines=[];part=''
        for ch in label:
            if ch=='\n' or (part and pdfmetrics.stringWidth(part+ch,'Diagram',13)>maxw):
                lines.append(part);part='' if ch=='\n' else ch
            else:part+=ch
        if part:lines.append(part)
        cx=(xs[a]+xs[b])/2
        textw=max(pdfmetrics.stringWidth(t,'Diagram',13) for t in lines)
        cx=max(textw/2+12,min(588-textw/2,cx))
        f.text(cx,y-10-(len(lines)-1)*17,'\n'.join(lines),13)
        if a==b:
            f.line(xs[a],y,xs[a]+22,y,dashed=not system)
            f.line(xs[a]+22,y,xs[a]+22,y+12,dashed=not system)
            f.line(xs[a]+22,y+12,xs[a],y+12,dashed=not system,arrow=True)
        else:f.line(xs[a],y,xs[b],y,dashed=not system or reply,arrow=True)
        if system and not reply and participants[b][1]!='actor':f.rect(xs[b]-3,y,6,16)
    if note:f.text(300,h-42,note,12.5)
    f.save()

f=Figure('business_usecases','连锁门诊业务用例图',460)
f.rect(80,30,405,330);f.text(282,56,'安德鲁牙科连锁业务边界',16,True)
f.actor(548,120,'顾客','actor')
for y,label in [(100,'获取预约服务'),(193,'接受门诊诊疗'),(286,'获得费用结算')]:
    f.ellipse(155,y,265,57,label,15)
    f.line(420,y+28,528,160)
f.text(300,402,'内部经营核对不冒充外部业务价值，由独立业务序列图表达',13)
f.text(300,434,'外部业务执行者仅列顾客；内部岗位职责由业务序列图表达',13)
f.save()

sequence('current_booking','现状预约与建档', [('前台','worker'),('患者档案','entity'),('预约记录','entity'),('顾客','actor')],[
 (3,0,'1 提出电话预约'),(0,3,'2 询问身份与联系方式'),(3,0,'3 提供资料和就诊意向'),(0,1,'4 核对或登记患者'),(0,2,'5 人工核对牙医时段'),(0,2,'6 登记预约与特殊需求'),(0,3,'7 告知预约安排')], '现状为依据案例重建的业务模型，未假定已存在统一平台')
sequence('current_clinical','现状到诊诊疗与结算',[('前台','worker'),('医生','worker'),('病历及预约资料','entity'),('结算单','entity'),('顾客','actor')],[
 (4,0,'1 到店说明预约'),(0,2,'2 核对身份及预约'),(0,1,'3 交接患者情况'),(1,2,'4 查阅过敏与既往记录'),(1,2,'5 记录实际治疗明细'),(0,3,'6 汇总治疗费用'),(0,4,'7 交付明细并核对费用')], '案例未明确的纸面载体、退款制度与核验细节不作为既定事实')
sequence('current_management','现状季度经营核对',[('总部人员','worker'),('诊所成本','entity'),('结算单','entity'),('季度报告','entity')],[
 (0,1,'1 收集用品及运营成本'),(0,2,'2 汇总各店开单金额'),(0,3,'3 人工核对季度业绩'),(0,3,'4 计算连锁净利润'),(0,3,'5 按净利润提取基金')], '总部为连锁内部业务工人；现状未假定已有实时集中数据')
sequence('improved_booking','改进预约与核对',[('前台','worker'),('患者档案','entity'),('统一预约台账','entity'),('顾客','actor')],[
 (3,2,'1 自助选择已发布号源'),(2,1,'2 关联本人有效档案'),(2,2,'3 校验冲突并登记预约'),(0,2,'4 查看授权门诊预约'),(0,3,'5 核对身份并询问健康'),(3,0,'6 确认身份与健康申报'),(0,1,'7 记录人工核实资料'),(0,2,'8 登记实际到诊')], '统一台账承担拟自动化责任；现实身份与健康核实仍由前台承担')
sequence('improved_clinical','改进诊疗与收款',[('前台','worker'),('医生','worker'),('患者诊疗档案','entity'),('结算账簿','entity'),('顾客','actor')],[
 (1,2,'1 查阅病历，记录治疗'),(1,2,'2 完成诊疗并冻结原记录'),(0,2,'3 核对已完成治疗'),(0,3,'4 生成唯一明细结算单'),(0,4,'5 说明费用并核验凭据'),(0,3,'6 登记人工确认收款'),(4,3,'7 查询本人费用与余额')], '追加附记与退款均留独立记录，不覆盖已完成记录和原单')
sequence('improved_management','改进成本审核与基金确认',[('店长','worker'),('总部人员','worker'),('成本记录','entity'),('结算账簿','entity'),('季度报告','entity')],[
 (0,2,'1 录入本店成本与凭据'),(0,2,'2 核对并审核本店成本'),(1,3,'3 汇总全连锁有效开单'),(1,4,'4 引用审核成本并核算'),(1,4,'5 核对全连锁来源签名'),(1,4,'6 确认基金总额')], '店长限授权门诊，总部负责全连锁核算；来源变更需重算')

def usecase_figure(id,title,actors,cases):
    h=160+len(cases)*65;f=Figure(id,title,h);f.rect(148,20,310,h-80);f.text(303,46,title,15,True)
    actor_y={}
    for i,(key,label) in enumerate(actors):
        y=95+i*(max(100,h-230)/max(1,len(actors)-1));actor_y[key]=y+35;f.actor(62,y,label)
    for i,(label,who) in enumerate(cases):
        y=77+i*65;f.ellipse(180,y,245,47,label,13.5)
        for a in who:f.line(84,actor_y[a],180,y+23)
    f.text(300,h-19,'连线表示参与；编号与系统用例规约一致',12.5);f.save()
usecase_figure('customer_usecases','顾客端系统边界',[('c','顾客')],[('UC-01 维护本人资料','c'),('UC-02 预约就诊','c'),('UC-03 调整预约','c'),('UC-04 查询诊疗费用','c'),('UC-21 修改本人密码','c'),('UC-22 恢复账号密码','c')])
usecase_figure('front_doctor_usecases','员工端接诊协作',[('f','前台'),('d','医生')],[('UC-05 维护患者档案','f'),('UC-06 维护排班','f'),('UC-08 管理预约出席','f'),('UC-09 记录并完成诊疗','d'),('UC-10 生成结算单','f'),('UC-13 登记收款','f'),('UC-16 营业日资金核对','f'),('UC-17 追加诊疗附记','d')])
usecase_figure('manager_usecases','店长端门诊运营',[('m','店长')],[('UC-05/08 患者与接待','m'),('UC-06 维护本店排班','m'),('UC-09/10 诊疗与开单','m'),('UC-13/14/15 收退款冲销','m'),('UC-16/17 日结与附记','m'),('UC-11/23 本店指标与成本','m')])
usecase_figure('hq_usecases','总部端连锁治理',[('h','总部')],[('UC-06 维护连锁门诊','h'),('UC-07 维护牙医资格','h'),('UC-11/12 全连锁业绩基金','h'),('UC-18/19 跨店归并绑定','h'),('UC-20 配发与管理员工','h'),('UC-22 核验签发恢复码','h'),('UC-23 核对各店成本','h'),('UC-24 导出全连锁业务','h')])

f=Figure('analysis_classes','预约与诊疗分析类图',750)
boxes=[
 (28,30,'<<boundary>>\n预约界面',['预约输入、结果'],['提交预约()','反馈结果()']),
 (332,30,'<<control>>\n预约控制',['用例上下文'],['协调预约()','处理冲突()']),
 (28,260,'<<entity>>\n患者',['编号、健康申报'],['核验档案()','发起预约()']),
 (332,260,'<<entity>>\n排班',['时段、门诊、牙医'],['核验号源()','检查占用()']),
 (28,490,'<<entity>>\n预约',['状态、前一预约'],['建立()、取消()','登记到诊()']),
 (332,490,'<<entity>>\n就诊',['治疗明细、状态'],['保存明细()','完成()'])]
for x,y,title,attrs,ops in boxes:
 f.rect(x,y,240,175);f.text(x+120,y+23,title,14,True)
 f.line(x,y+54,x+240,y+54);f.text(x+13,y+77,'\n'.join(attrs),13,anchor='start')
 f.line(x,y+96,x+240,y+96);f.text(x+13,y+120,'\n'.join(ops),13,anchor='start')
# Dependencies are dashed; domain associations are solid with multiplicities at ends.
f.line(268,112,332,112,True,arrow=True);f.text(300,96,'请求',12.5)
f.line(452,205,452,260,True,arrow=True)
f.line(332,185,166,260,True,arrow=True)
f.line(148,435,148,490);f.text(160,451,'1',13,anchor='start');f.text(160,482,'0..n',13,anchor='start')
f.text(118,469,'拥有',12.5,anchor='end')
f.line(452,435,452,464);f.line(452,464,270,464);f.line(270,464,270,525);f.line(270,525,268,525)
f.text(464,451,'1',13,anchor='start');f.text(270,517,'0..n',13,anchor='start');f.text(349,454,'安排',12.5)
f.line(268,600,332,600);f.text(274,589,'1',13,anchor='start');f.text(326,589,'0..1',13,anchor='end')
f.text(300,627,'产生',12.5)
f.text(300,710,'分析操作表示职责；实现映射为服务函数，不声称存在同名class',13);f.save()
sequence('analysis_booking','预约用例的分析序列',[('顾客','actor'),('预约界面\n<<boundary>>','b'),('预约控制\n<<control>>','c'),('排班\n<<entity>>','e'),('预约\n<<entity>>','e')],[
 (0,1,'1 提交预约资料'),(1,2,'2 协调预约()'),(2,3,'3 核验号源并检查占用()'),
 (3,2,'4 返回核验结果','return'),(2,4,'5 [无冲突] 建立()'),(4,2,'6 返回预约编号','return'),
 (2,1,'7 反馈预约结果','return'),(1,0,'8 反馈确认或冲突原因','return')],
 '控制先核验本人档案与范围；冲突分支不建立预约\n以上为分析职责，实现以同一事务完成检查与写入',True)
sequence('analysis_finance','收款用例的设计序列',[('前台','actor'),('财务界面\n<<boundary>>','b'),('财务服务\n<<service>>','c'),('财务仓储\n<<mapper>>','e'),('审计记录\n<<storage>>','e')],[
 (0,1,'1 输入金额与凭据'),(1,2,'2 携幂等键请求收款'),(2,3,'3 同事务核对原单与欠款'),
 (3,2,'4 返回账单与余额','return'),(2,3,'5 核验金额并追加收款'),(2,4,'6 追加脱敏审计'),
 (2,3,'7 提交事务'),(2,1,'8 返回结果与新余额','return'),(1,0,'9 反馈收款结果','return')],
 '事务由domain/db边界协调；审计与收款一起提交或回滚\n仓储为实现职责合并视图，同键异内容拒绝，不是新增class',True)

def path(f,points,label='',label_at=None,size=13):
 for i,(a,b) in enumerate(zip(points,points[1:])):f.line(*a,*b,arrow=i==len(points)-2)
 if label and label_at:f.text(*label_at,label,size)

f=Figure('appointment_states','预约状态机',710)
for x,y,label in [(45,70,'booked 已预约'),(350,70,'attended 已到诊'),(45,320,'no_show 爽约'),(350,320,'cancelled 已取消')]:f.rect(x,y,205,75,label,14)
f.ellipse(135,18,15,15,'',black=True);path(f,[(142,33),(142,70)],'建立预约',(207,47))
path(f,[(250,107),(350,107)],'登记到诊\n[已到开始时刻]',(300,64),12.5)
path(f,[(125,145),(125,320)],'登记爽约\n[已到结束时刻]',(204,218),12.5)
path(f,[(70,320),(70,178),(45,178),(45,107)],'更正爽约\n[原因且未满]',(53,268),12.5)
path(f,[(250,130),(295,130),(295,357),(350,357)],'取消 / 改期\n[角色与截止允许]',(389,237),12.5)
f.text(300,492,'到诊动作创建唯一open就诊；爽约更正先恢复booked\n改期取消原预约并新建booked，以previous_id关联原预约',13)
f.text(300,566,'所有修改需权限与version校验；取消及更正均记录原因\n顾客自助取消/改期受截止小时限制，员工仍需授权门诊范围',13)
f.text(300,663,'状态与守卫对应appointments.js；非法迁移不落库',13);f.save()
f=Figure('clinical_states','诊疗记录状态机',470)
f.rect(25,120,220,75,'open 接诊中',14);f.rect(350,120,220,75,'completed 已完成',14)
f.ellipse(126,35,15,15,'',black=True);path(f,[(134,50),(134,120)],'登记到诊 / 创建就诊',(273,84))
path(f,[(245,157),(350,157)],'完成\n[已有治疗明细]',(298,112),12.5)
path(f,[(75,120),(75,78),(25,78),(25,155)],'保存明细()',(75,53),12.5)
f.text(300,292,'open可按版本保存明细；完成后原记录锁定\ncompleted中的追加附记创建新对象，保持本状态不变',13)
f.text(300,390,'完成守卫与锁定规则对应clinical.js；不虚构退回编辑流程',13);f.save()

f=Figure('architecture','应用分层与模块依赖',710)
layers=[(30,'顾客 / 前台 / 医生 / 店长 / 总部五门户\n页面、组件、状态、API客户端'),(165,'Node.js HTTP\n会话 / Origin / CSRF / 限流 / 幂等'),(300,'查询与业务服务\nworkspace / patients / appointments / clinical / finance / accounts / reports'),(445,'Repository与事务\n字段白名单 / 参数SQL / 批量关联 / savepoint'),(580,'SQLite及版本迁移\n38表 / 类型列 / 关系子表 / 追加账簿 / 升级快照')]
for y,label in layers:f.rect(25,y,550,85,label,14)
for i in range(4):f.line(300,layers[i][0]+85,300,layers[i+1][0],arrow=True)
f.text(300,698,'所有岗位共享后端；授权与范围过滤在服务端执行',13);f.save()

f=Figure('deployment','单实例部署与备份拓扑',650)
for x,y,w,h,label in [(150,20,300,75,'浏览器\n顾客 / 前台 / 医生\n店长 / 总部'),(150,160,300,80,'Nginx HTTPS反向代理\n域名与TLS证书'),(150,310,300,80,'Node.js单实例应用\n127.0.0.1:3210宿主绑定'),(20,475,260,80,'持久化SQLite卷\n业务库及升级快照'),(320,475,260,80,'备份服务与备份卷\n6小时快照 / 保留28份')]:f.rect(x,y,w,h,label,14)
for a,b,c,d in [(300,95,300,160),(300,240,300,310),(250,390,150,475),(280,515,320,515)]:f.line(a,b,c,d,arrow=True)
f.text(300,610,'拓扑为已提供配置；公网、容器、TLS与异地灾备尚待目标环境验收',12.5);f.save()

f=Figure('conceptual_er','核心业务概念ER图',750)
nodes={'p':(25,40,'患者'),'d':(230,40,'牙医'),'c':(435,40,'门诊'),
 'a':(25,220,'预约'),'s':(230,220,'排班'),
 'v':(25,400,'就诊'),'t':(435,400,'治疗项目'),
 'i':(25,580,'结算单'),'l':(230,580,'治疗明细')}
for x,y,label in nodes.values():f.rect(x,y,140,65,label,16)
for x,y1,y2,m1,m2,label in [(95,105,220,'1','0..n','发起'),(300,105,220,'1','0..n','执业'),(95,285,400,'1','0..1','形成'),(95,465,580,'1','0..1','开单')]:
 f.line(x,y1,x,y2);f.text(x+12,y1+21,m1,13,anchor='start');f.text(x+12,y2-10,m2,13,anchor='start');f.text(x-15,(y1+y2)/2,label,13,anchor='end')
f.line(165,252,230,252);f.text(174,239,'0..n',13,anchor='start');f.text(222,239,'1',13,anchor='end');f.text(198,279,'指派',13)
# Orthogonal routes keep every relationship outside the intervening entity boxes.
for a,b in [((505,105),(505,175)),((505,175),(402,175)),((402,175),(402,252)),((402,252),(370,252))]:f.line(*a,*b)
f.text(517,126,'1',13,anchor='start');f.text(386,242,'0..n',13,anchor='start');f.text(451,165,'发布',13)
for a,b in [((165,432),(195,432)),((195,432),(195,612)),((195,612),(230,612))]:f.line(*a,*b)
f.text(177,420,'1',13);f.text(212,599,'0..n',13);f.text(207,526,'包含',13,anchor='start')
for a,b in [((505,465),(505,612)),((505,612),(370,612))]:f.line(*a,*b)
f.text(517,487,'1',13,anchor='start');f.text(384,599,'0..n',13,anchor='start');f.text(455,599,'引用',13)
f.text(300,687,'概念联系与基数；预约唯一关联至多一次就诊，每次就诊属于一家门诊\n患者及牙医可跨门诊；物理外键、快照字段与其余实体另见分域ER',13);f.save()

f=Figure('colored_model','四架构型的职责映射',610)
for x,y,w,h,label in [(30,30,235,115,'<<角色>>\n顾客 / 医生 / 前台\n店长 / 总部'),(335,30,235,115,'<<事物>>\n患者 / 牙医 / 门诊\n保持跨事件稳定身份'),(30,245,235,115,'<<时刻时段>>\n预约 / 就诊 / 收款\n记录发生时段及参与方'),(335,245,235,115,'<<描述>>\n治疗项目 / 资格类别\n提供目录标准与说明')]:f.rect(x,y,w,h,label,14)
f.line(147,145,147,245,arrow=True);f.line(453,145,453,245,arrow=True);f.line(265,302,335,302,arrow=True)
f.text(300,455,'示例：患者以顾客角色委托预约，预约在所选排班时段建立\n预约再经过到诊事件创建就诊，状态变化保留事件时间与原因',14)
f.text(300,565,'为保持灰度打印，本图以架构型文字代替颜色，不改变分析语义',13);f.save()
sequence('archetype_sequence','事物委托描述创建时刻时段',[('患者\n<<事物>>','e'),('预约规则\n<<描述>>','e'),('预约\n<<时刻时段>>','e')],[
 (0,1,'1 委托判定预约资格'),(1,0,'2 返回档案、时段规则结果','return'),
 (0,2,'3 [规则满足] 发起并建立预约'),(2,0,'4 返回预约关联','return'),
 (2,2,'5 到诊事件改变状态')], '概念职责示例；规则由服务与settings实现，不新增同名class或表',True)
f=Figure('financial_states','结算金额派生状态与冲销',730)
for x,y,label in [(45,85,'unpaid 尚未收款'),(350,85,'partial 部分收款'),(350,335,'paid 已收足'),(45,335,'void 已冲销')]:f.rect(x,y,205,75,label,14)
path(f,[(250,115),(350,115)],'收取部分款',(300,96),12.5)
path(f,[(350,142),(250,142)],'退至净收为零',(300,175),12.5)
path(f,[(475,160),(475,335)],'补足欠款',(514,248),12.5)
path(f,[(430,335),(430,160)],'部分退款',(387,248),12.5)
path(f,[(250,102),(300,102),(300,372),(350,372)],'一次收足',(290,302),12.5)
path(f,[(350,390),(278,390),(278,215),(220,215),(220,160)],'全部退款',(245,235),12.5)
path(f,[(125,160),(125,335)],'冲销\n[净收为零]',(171,282),12.5)
f.text(300,470,'图示常规正应收账单：0净收为unpaid，0<净收<应收为partial\n净收=应收为paid；存在冲销记录时优先派生为void',13)
f.text(300,542,'退款回到相应金额状态；冲销由有权店长或总部独立确认\n净收=收款−退款；有效应收=原单金额−冲销金额',13)
f.text(300,614,'原单、收退款与冲销流水保留；金额整数分、事务校验\n零应收账单按金额公式派生paid，不套用“未收款”标签',13)
f.text(300,700,'对应financeSummary，非settlements表的持久化status枚举',13);f.save()
f=Figure('dentist_states','牙医资源对象状态机',480)
f.rect(25,140,220,75,'active 有效',14);f.rect(350,140,220,75,'inactive 停用',14)
path(f,[(245,157),(350,157)],'总部停用\n[无未来有效预约]',(298,112),12.5)
path(f,[(350,197),(245,197)],'总部重新启用\n[有效资格及完整资料]',(298,250),12.5)
f.text(300,340,'两方向均需授权及version校验；历史关联保留\n有效牙医至少具有一项有效资格，资格类别另行维护',13)
f.text(300,425,'对应resources.js；停用牙医、门诊或资格不删除历史诊疗',13);f.save()
(ROOT/'figures.json').write_text(json.dumps(CAT,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'figures':len(CAT),'directory':str(OUT)},ensure_ascii=False))
