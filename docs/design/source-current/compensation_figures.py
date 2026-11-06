"""Rebuild the monochrome compensation diagrams used by main.tex.

Run with Python + reportlab. All amounts and API names follow
docs/implementation/compensation-contract-20261105.md.
"""
from pathlib import Path
import math
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'figures'
for name, file in [('D', 'Deng.ttf'), ('B', 'Dengb.ttf')]:
    pdfmetrics.registerFont(TTFont(name, 'C:/Windows/Fonts/' + file))

def wrap(s, width, size=13, font='D'):
    result, line = [], ''
    for c in str(s):
        if c == '\n' or line and pdfmetrics.stringWidth(line + c, font, size) > width:
            result.append(line); line = '' if c == '\n' else c
        else: line += c
    if line: result.append(line)
    if len(result)>1 and len(result[-1])<3 and len(result[-2])>4:
        count=3-len(result[-1]);result[-1]=result[-2][-count:]+result[-1];result[-2]=result[-2][:-count]
    return result or ['']

class Figure:
    def __init__(self, name, title, height=720):
        self.h = height
        self.c = canvas.Canvas(str(OUT / (name + '.pdf')), pagesize=(600, height))
        self.c.setTitle(title); self.c.setAuthor('张云福')
        self.text(300, 25, title, 14, True)
    def text(self, x, y, s, size=13, bold=False, align='center', white=False):
        if white:
            lines=str(s).split('\n');w=max(pdfmetrics.stringWidth(line,'B' if bold else 'D',size) for line in lines)
            left=x-w/2 if align=='center' else x-w if align=='right' else x
            self.c.setFillGray(1);self.c.rect(left-3,self.h-y-(len(lines)-1)*(size+3)-4,w+6,size+7+(len(lines)-1)*(size+3),fill=1,stroke=0)
        self.c.setFillGray(0); self.c.setFont('B' if bold else 'D', size)
        for n, line in enumerate(str(s).split('\n')):
            fn = {'center': self.c.drawCentredString, 'left': self.c.drawString, 'right': self.c.drawRightString}[align]
            fn(x, self.h-y-n*(size+3), line)
    def line(self, x1, y1, x2, y2, dashed=False, arrow=False):
        self.c.setStrokeGray(0); self.c.setLineWidth(.85); self.c.setDash([4,3] if dashed else [])
        self.c.line(x1, self.h-y1, x2, self.h-y2)
        if arrow:
            a=math.atan2(y2-y1,x2-x1)
            self.c.setDash([])
            p=self.c.beginPath();p.moveTo(x2+7*math.cos(a+2.65),self.h-y2-7*math.sin(a+2.65));p.lineTo(x2,self.h-y2);p.lineTo(x2+7*math.cos(a-2.65),self.h-y2-7*math.sin(a-2.65))
            if arrow=='filled':p.close()
            self.c.drawPath(p,stroke=1,fill=int(arrow=='filled'))
    def rect(self,x,y,w,h,fill=1):
        self.c.setDash([]);self.c.setStrokeGray(0);self.c.setFillGray(fill);self.c.setLineWidth(.85)
        self.c.rect(x,self.h-y-h,w,h,stroke=1,fill=1)
    def save(self): self.c.save()

def sequence(name,title,participants,messages,business=False,fragments=()):
    # Rows expand for labels, leaving every message and guard readable at A4.
    y=151; rows=[];headers={};dividers={}
    for n,(a,b,label,returned) in enumerate(messages,1):
        for k,fragment in enumerate(fragments):
            if fragment['start']==n:headers[k]=y;y+=28
            if fragment.get('split')==n:dividers[k]=y;y+=28
        width=430 if a==b else max(200,abs(b-a)*110-12)
        lines=wrap(label,width,12.6)
        rh=max(42,18+len(lines)*15.6)
        rows.append((y,a,b,lines,returned)); y+=rh
    f=Figure(name,title,y+66)
    xs=[55+i*490/(len(participants)-1) for i in range(len(participants))]
    f.rect(10,43,580,y-25)
    for i,(label,kind) in enumerate(participants):
        x=xs[i]
        f.c.setDash([])
        if business and kind=='worker':
            f.c.circle(x,f.h-65,19,stroke=1,fill=0);f.c.circle(x,f.h-57,4,stroke=1,fill=0)
            f.line(x,61,x,72);f.line(x-8,65,x+8,65);f.line(x,72,x-7,79);f.line(x,72,x+7,79)
            f.text(x,98,'«业务工人»',12.6)
        elif business and kind=='entity':
            f.c.circle(x,f.h-65,13,stroke=1,fill=0);f.line(x-15,82,x+15,82)
            f.text(x,98,'«业务实体»',12.6)
        elif kind=='boundary':
            f.c.circle(x,f.h-65,13,stroke=1,fill=0);f.line(x-21,51,x-21,79);f.line(x-21,65,x-13,65)
            f.text(x,96,'«boundary»',12.6)
        elif kind=='control':
            f.c.circle(x,f.h-65,13,stroke=1,fill=0);f.line(x+5,49,x-3,52,arrow='open')
            f.text(x,96,'«control»',12.6)
        elif kind=='entity':
            f.c.circle(x,f.h-65,13,stroke=1,fill=0);f.line(x-15,82,x+15,82);f.text(x,98,'«entity»',12.6)
        else: f.rect(x-42,51,84,34);f.text(x,73,'平台',12)
        f.text(x,116,'\n'.join(wrap(label,103,12.6)),12.6)
        f.line(x,143,x,y,dashed=True)
    for k,fragment in enumerate(fragments):
        top=headers[k];last=rows[fragment['end']-1];bottom=last[0]+len(last[3])*15.6+25
        depth=sum(1 for j,outer in enumerate(fragments) if j!=k and outer['start']<=fragment['start'] and outer['end']>=fragment['end'])
        left=18+8*depth;right=582-8*depth
        f.c.setDash([]);f.c.setStrokeGray(0);f.c.rect(left,f.h-bottom,right-left,bottom-top,fill=0,stroke=1)
        f.rect(left,top,45,23);f.text(left+22,top+16,fragment.get('operator','alt'),12.6,True)
        f.text(left+54,top+17,'['+fragment['guard']+']',12.6,align='left',white=True)
        if k in dividers:
            d=dividers[k];f.line(left,d,right,d,dashed=True)
            f.text(left+12,d+18,'['+fragment['other']+']',12.6,align='left',white=True)
    for n,(yy,a,b,lines,returned) in enumerate(rows,1):
        xa,xb=xs[a],xs[b]; yy+=len(lines)*15.6
        label=f'{n:02} '+'\n'.join(lines)
        if a==b:
            right=xa+31 if xa<470 else xa-31
            f.line(xa,yy,right,yy,dashed=business);f.line(right,yy,right,yy+13,dashed=business);f.line(right,yy+13,xa,yy+13,dashed=business,arrow='open' if business else 'filled')
            f.text(300,yy-len(lines)*15.6+10,label,12.6,white=True)
        else:
            f.text((xa+xb)/2,yy-len(lines)*15.6+10,label,12.6,white=True)
            f.line(xa,yy+8,xb,yy+8,dashed=business or returned,arrow='open' if business or returned else 'filled')
    f.text(300,y+48,'消息为虚线箭头；接收者承担该步骤。' if business else '实线为调用，虚线为返回；边界、控制与实体各负其责。',12.6)
    f.save()

def classes(name,title,nodes,edges):
    h=65+165*len(nodes);f=Figure(name,title,h)
    for i,(head,attrs,ops) in enumerate(nodes):
        y=48+165*i;f.rect(105,y,390,128);f.rect(105,y,390,29,.95)
        f.text(300,y+20,head,13.5,True)
        f.text(116,y+47,'\n'.join(attrs),12.6,align='left')
        f.line(105,y+91,495,y+91);f.text(116,y+110,'\n'.join(ops),12.6,align='left')
    for i,edge_spec in enumerate(edges):
        a,b,label=edge_spec[:3];m1,m2=edge_spec[3:] if len(edge_spec)>3 else ('1','0..*')
        x=60 if i%2==0 else 540;edge=105 if i%2==0 else 495
        ya=48+165*a+64;yb=48+165*b+64
        f.line(edge,ya,x,ya);f.line(x,ya,x,yb);f.line(x,yb,edge,yb)
        f.text(x,(ya+yb)/2-12,label,12.5)
        f.text(edge-8 if i%2==0 else edge+8,ya-5,m1,12.5)
        f.text(edge-16 if i%2==0 else edge+20,yb+18,m2,12.5)
    f.text(300,h-12,'关联端标多重性；属性采用业务名称，物理字段见字典。',12.2);f.save()

def er(name,title,nodes,edges):
    h=55+165*len(nodes);f=Figure(name,title,h)
    for i,(head,fields) in enumerate(nodes):
        y=48+i*165;f.rect(94,y,412,126);f.rect(94,y,412,29,.95)
        f.text(300,y+20,head,13.3,True)
        f.text(107,y+48,'\n'.join(fields),12.3,align='left')
    for n,edge_spec in enumerate(edges,1):
        a,b,label=edge_spec[:3];m1,m2=edge_spec[3:] if len(edge_spec)>3 else ('1','0..*')
        x=43 if n%2 else 557;edge=94 if n%2 else 506
        ya=48+a*165+74;yb=48+b*165+74
        f.line(edge,ya,x,ya);f.line(x,ya,x,yb);f.line(x,yb,edge,yb)
        f.text(x,(ya+yb)/2,'R'+str(n),12.5)
        f.text(edge-12 if n%2 else edge+8,ya-6,m1,12.5)
        f.text(edge-22 if n%2 else edge+22,yb+18,m2,12.5)
    f.text(300,h-12,'PK为主键，FK为外键；R编号的精确联系见随图表。',12.2);f.save()

def states():
    f=Figure('st_quarter','月度账证、季度基金与发放的状态约束',650)
    panels=[('月度底稿',95,[('草稿','draft'),('已关闭','closed')],'独立复核、覆盖及来源完整','总部重开：未被有效季度引用'),('季度基金',280,[('草稿','draft'),('待批准','submitted'),('已批准','approved')],'完整季度来源→提交→独立批准','未批准可作废；已批准保持来源锁定'),('发放记录',490,[('待核实','pending'),('成功','succeeded'),('失败','failed')],'实际凭据查证后登记结果','结果未知保持pending，不能释放可发占用')]
    for title,y,boxes,flow,note in panels:
        f.text(38,y-28,title,13.5,True,align='left')
        xs=[150,440] if len(boxes)==2 else [110,300,490]
        start=xs[0]-88;f.c.setDash([]);f.c.setFillGray(0);f.c.circle(start,f.h-y-28,3.8,stroke=1,fill=1);f.line(start+4,y+28,xs[0]-62,y+28,arrow='open')
        for x,(cn,key) in zip(xs,boxes):
            f.rect(x-62,y,124,55);f.text(x,y+22,cn,13);f.text(x,y+41,key,12.6)
        if len(boxes)==2:
            f.line(212,y+17,378,y+17,arrow='open');f.line(378,y+38,212,y+38,arrow='open')
        elif title=='季度基金':
            f.line(172,y+28,238,y+28,arrow='open');f.line(362,y+28,428,y+28,arrow='open')
            f.rect(238,y+86,124,45);f.text(300,y+114,'作废 voided',12.6)
            f.line(110,y+55,110,y+109);f.line(110,y+109,238,y+109,arrow='open')
            f.line(300,y+55,300,y+86,arrow='open')
        else:
            f.line(172,y+16,238,y+16,arrow='open');f.line(110,y+55,110,y+78);f.line(110,y+78,490,y+78);f.line(490,y+78,490,y+55,arrow='open')
        f.text(300,y-8,flow,12.6);f.text(300,y+(153 if title=='季度基金' else 107),note,12.6)
    f.save()

def overview():
    f=Figure('uc_overview_4','经营与员工激励用例',735);f.rect(116,49,368,618)
    f.text(300,72,'安德鲁系统',14,True)
    cases=['UC-19 登记医生月度账证汇总','UC-20 独立复核月度底稿并关闭','UC-21 计算医生季度业绩及10%基金','UC-22 审批激励、登记发放及本人查询','UC-23 查看预约原因、到诊与排班统计','UC-24 维护组织、员工和岗位授权']
    def person(x,y,label):
        f.c.circle(x,f.h-y,8,stroke=1,fill=0);f.line(x,y+8,x,y+32);f.line(x-15,y+18,x+15,y+18);f.line(x,y+32,x-12,y+49);f.line(x,y+32,x+12,y+49);f.text(x,y+71,label,12.8)
    person(53,300,'总部');person(548,110,'店长');person(548,423,'员工')
    ys=[124+i*96 for i in range(6)]
    for i,y in enumerate(ys):f.line(69,318,130,y)
    for i in [0,1,4,5]:f.line(533,128,470,ys[i])
    f.line(533,441,470,ys[3])
    for label,y in zip(cases,ys):
        f.c.setFillGray(1);f.c.setStrokeGray(0);f.c.ellipse(130,f.h-y-29,470,f.h-y+29,stroke=1,fill=1);f.text(300,y+5,label,12.8)
    f.text(300,704,'关联线表示参与；员工查询限定本人已批准份额。',12.3);f.save()

def compensation_er():
    er('er_6','员工身份、登录账号与门诊岗位关系',[
      ('users',['PK id；username（UNIQUE）','password_hash；display_name；active','account_version；must_change_password','created_at']),
      ('staff',['PK id；FK user_id（NULL、UNIQUE）','employee_no（UNIQUE）；name；is_dentist','phone；specialty；active；row_version','birth_date；home_address；email','is_demo；bio；focus_areas']),
      ('role_assignments',['PK id；FK user_id；role','FK clinic_id（仅hq可空）','UNIQUE NULLS NOT DISTINCT','(user_id,role,clinic_id)']),
      ('clinics',['PK id；name；active','门诊范围由岗位授权关联','总部hq不限单个门诊'])],[(0,1,'user_id','0..1','0..1'),(0,2,'user_id'),(3,2,'clinic_id','0..1','0..*')])
    f=Figure('compensation_concept','月度账证、季度基金与个人发放的概念联系',710)
    nodes=[('月度底稿',50,70),('医生财务来源',340,70),('基金月度来源',50,240),('季度激励基金',340,240),('医生门诊业绩',50,420),('个人激励份额',340,420),('激励发放记录',340,600)]
    for label,x,y in nodes:f.rect(x,y,210,60);f.text(x+105,y+36,label,14,True)
    def h(a,b,tag,left='1',right='0..*'):
        _,xa,ya=nodes[a];_,xb,yb=nodes[b];f.line(xa+210,ya+30,xb,yb+30);f.text((xa+210+xb)/2,ya+20,tag,12.6);f.text(xa+217,ya+47,left,12.6,align='left');f.text(xb-7,yb+47,right,12.6,align='right')
    def v(a,b,tag,top='1',bottom='0..*'):
        _,xa,ya=nodes[a];_,xb,yb=nodes[b];x=xa+105;f.line(x,ya+60,x,yb);f.text(x+15,(ya+60+yb)/2,tag,12.6,align='left');f.text(x-8,ya+80,top,12.6,align='right');f.text(x-8,yb-8,bottom,12.6,align='right')
    h(0,1,'R1');v(0,2,'R2');h(2,3,'R3','3×C','1');v(3,5,'R4');h(4,5,'R5','0..*','1');v(5,6,'R6')
    f.text(300,693,'C为全部登记门诊数；同一医生各门诊业绩合并为一个份额。',12.6);f.save()
    er('er_compensation_months','激励月度底稿与不可覆盖的来源修订',[
      ('incentive_months',['PK id；FK clinic_id','month；reference；no_activity；status','source_revision；row_version','FK created_by / created_staff_id','FK closed_by / closed_staff_id']),
      ('doctor_financial_sources',['PK id；FK month_id；FK doctor_id','source_revision；doctor_name；employee_no','revenue_cents；material_cost_cents','operating_expense_cents；三类reference','UNIQUE(month_id,source_revision,doctor_id)']),
      ('staff',['PK id；FK user_id（UNIQUE）','employee_no（UNIQUE）；name；is_dentist','phone；specialty；active；row_version','birth_date；home_address；email','is_demo；bio；focus_areas'])],[(0,1,'month_id'),(2,1,'doctor_id')])
    er('er_23','季度基金、关闭月度来源与门诊业绩',[
      ('incentive_pools',['PK id；quarter；rule_version；status','net_profit_cents；fund_cents','三类total金额；clinic_count；doctor_count','FK created_by / created_staff_id','FK approved_by / approved_staff_id']),
      ('incentive_pool_sources',['PK (pool_id,month_id)；FK pool_id','FK month_id / clinic_id / closed_by','source_revision；month；reference','closed_staff_id；closed_at；no_activity','UNIQUE(pool_id,clinic_id,month)']),
      ('doctor_quarter_results',['PK id；FK pool_id / clinic_id / doctor_id','doctor_name；employee_no；clinic_name','revenue_cents；material_cost_cents','operating_expense_cents；net_profit_cents','UNIQUE(pool_id,clinic_id,doctor_id)'])],[(0,1,'pool_id'),(0,2,'pool_id')])
    er('er_24','个人激励份额与凭据核实发放',[
      ('incentive_pools',['PK id；quarter；status=approved','fund_cents；rule_version','批准人、员工身份与批准时间','一个季度仅一个非voided有效快照']),
      ('incentive_allocations',['PK id；FK pool_id / doctor_id','doctor_name；employee_no','contribution_cents；weight_cents','amount_cents；row_version','UNIQUE(pool_id,doctor_id)']),
      ('incentive_payments',['PK id；FK allocation_id','amount_cents；reference（全局唯一）','status；result_reference；row_version','FK created_by / created_staff_id','FK resolved_by / resolved_staff_id'])],[(0,1,'pool_id'),(1,2,'allocation_id')])

def build():
    sequence('BP09','BP09 月度账证登记、独立复核与关闭', [('门诊店长','worker'),('独立复核人','worker'),('安德鲁平台','system'),('月度账证底稿','entity')],[
      (0,2,'提交月份、总依据及各医生三类账证',False),(2,3,'检查身份、期间、金额与来源完整',False),(3,2,'返回录入校验结论与缺项',True),(2,0,'反馈需补正项目，保留草稿',True),(2,3,'保存月度草稿及来源版本',False),(1,2,'独立核对后请求关闭月份',False),(2,3,'重核不同账号员工、版本及医生覆盖',False),(3,2,'返回关闭条件的校验结论',True),(2,1,'拒绝关闭并列明原因',True),(2,3,'固定关闭版本与复核身份',False),(2,1,'返回已关闭版本',True)],True,fragments=[dict(start=4,end=11,split=5,guard='录入资料未通过',other='录入资料通过'),dict(start=9,end=11,split=10,guard='关闭条件不满足',other='关闭条件全部满足')])
    sequence('BP10_1','BP10 完整季度来源与医生跨店基金计算（1/2）',[('总部制表人','worker'),('安德鲁平台','system'),('已关闭月度底稿','entity'),('季度业绩与份额','entity')],[
      (0,1,'选择已结束季度并填写计算依据',False),(1,2,'读取全部门诊三个自然月的关闭底稿',False),(2,1,'返回完整来源矩阵或缺项',True),(1,0,'停止生成并显示需要补齐的来源',True),(1,3,'按医生门诊固化三类金额及业绩',False),(3,3,'先跨店合并，再合计正负净利润',False),(3,3,'提取合计正部的10%，按正贡献分配到分',False),(3,1,'返回基金、门诊展开、个人份额及规则',True),(1,0,'反馈完整草稿；零基金不生成发放',True)],True,fragments=[dict(start=4,end=9,split=5,guard='来源缺失、未关闭或无效',other='全部门诊三个月来源完整有效')])
    sequence('BP10_2','BP10 独立批准、发放核实与本人查询（2/2）',[('总部制表人','worker'),('总部复核人','worker'),('安德鲁平台','system'),('季度与发放记录','entity'),('牙医','worker')],[
      (0,2,'提交季度草稿供独立复核',False),(1,2,'核对来源、基金与份额后申请批准',False),(2,3,'校验不同账号员工、版本与来源',False),(3,2,'返回批准条件的校验结论',True),(2,1,'拒绝批准并显示具体原因',True),(2,3,'固定批准状态与个人额度',False),(0,2,'有可发余额时提交金额与唯一付款凭证',False),(2,3,'锁定份额核对额度后登记待核实',False),(0,2,'核对实际付款结果并登记成功或失败',False),(2,3,'成功保留支出；明确失败释放占用',False),(4,2,'查询本人已批准季度份额和发放',False),(2,4,'返回本人额度、待核实、成功及余额',True)],True,fragments=[dict(start=5,end=12,split=6,guard='批准条件不满足',other='批准条件全部满足')])
    data=[
    ('19','登记医生月度账证汇总',[('月度激励底稿',['门诊、自然月、状态、版本','总账证依据、制表员工'],['检查月份及草稿归属()']),('医生财务来源',['医生、收入分、用品成本分','运营费用分、三类来源编号'],['检查三类来源完整()']),('员工与医生身份',['稳定员工号、岗位、门诊','账号关联、在职状态'],['检查岗位与数据范围()'])],[(0,1,'包含'),(2,1,'归属')],
      [('月度底稿页','boundary'),('薪酬应用服务','control'),('月度激励底稿','entity'),('医生财务来源','entity'),('员工身份','entity')],[(0,1,'提交月份、门诊、依据及医生行',False),(1,4,'检查有效岗位及门诊范围',False),(4,1,'返回员工身份与授权范围',True),(1,2,'检查已结束月份、草稿归属与版本',False),(1,3,'检查金额格式、医生及三类凭据',False),(3,1,'返回录入校验结论及缺项',True),(1,0,'拒绝保存并显示原因，保留输入',True),(1,2,'原子保存草稿与来源修订并写审计',False),(2,1,'返回新版本和完整底稿',True),(1,0,'展示保存成功的底稿',True)]),
    ('20','独立复核月度底稿并关闭',[('月度激励底稿',['门诊、月份、制表与复核员工','draft/closed、版本'],['关闭()；重开(reason)']),('出诊医生覆盖',['门诊、月份、已发布班次医生','底稿已包含医生'],['检查遗漏医生()']),('季度来源引用',['基金号、月份号、关闭版本','有效季度状态'],['检查是否允许重开()'])],[(0,1,'核验'),(0,2,'被引用')],
      [('月度复核页','boundary'),('薪酬应用服务','control'),('月度激励底稿','entity'),('出诊覆盖','entity'),('季度来源引用','entity')],[(0,1,'提交关闭请求及期望版本',False),(1,2,'锁定月份并检查不同账号和员工',False),(1,3,'核对该月已发布出诊医生覆盖',False),(3,1,'返回已出诊医生及底稿覆盖结论',True),(1,0,'拒绝关闭并显示具体原因',True),(1,2,'固定关闭状态与独立复核身份',False),(2,1,'返回新的关闭版本',True),(1,0,'展示已关闭月度底稿',True)]),
    ('21','计算季度医生业绩及10%基金',[('季度激励基金',['季度、状态、制表员工、规则版本','总净利润分、基金分'],['检查完整季度来源()']),('医生门诊季度业绩',['基金、医生、门诊、三类汇总','含负数净利润分'],['按医生跨店合并()']),('个人激励份额',['医生、正净贡献分、份额分','最大余数顺位'],['最大余数法分配到分()'])],[(0,1,'包含'),(0,2,'分配')],
      [('季度核算页','boundary'),('薪酬应用服务','control'),('月度来源集合','entity'),('季度激励基金','entity'),('个人份额','entity')],[(0,1,'提交已结束季度和计算依据',False),(1,2,'锁定全部门诊三个自然月来源',False),(2,1,'返回关闭版本与缺项列表',True),(1,0,'拒绝生成并列出需要补齐的来源',True),(1,3,'按医生门诊固化三类金额及净利润',False),(3,1,'返回包含亏损的医生跨店合计',True),(1,3,'按全体净利正部提取10%至分',False),(1,4,'按正贡献最大余数分配，稳定处理同余',False),(4,1,'返回份额与基金守恒结果',True),(1,3,'同事务保存来源、明细、份额和审计',False),(1,0,'展示快照及逐门诊来源',True)]),
    ('22','审批激励、登记发放及本人查询',[('季度激励基金',['制表与批准员工、版本','draft/submitted/approved/voided'],['提交()；独立批准()']),('个人激励份额',['医生员工、批准额度分','成功与待核实占用分'],['计算剩余可发额度()']),('激励发放记录',['金额分、唯一凭证、版本','pending/succeeded/failed'],['登记付款结果()'])],[(0,1,'包含'),(1,2,'发放')],
      [('季度与发放页','boundary'),('薪酬应用服务','control'),('季度激励基金','entity'),('个人份额','entity'),('发放记录','entity')],[(0,1,'制表人提交季度草稿',False),(1,2,'核对制表归属及版本后置为待批准',False),(0,1,'另一总部员工请求批准',False),(1,2,'锁定并检查不同账号员工、来源及版本',False),(2,1,'返回批准条件校验结论',True),(1,0,'拒绝批准并说明具体原因',True),(1,2,'固定批准状态与批准员工',False),(1,0,'反馈已批准季度及个人额度',True),(0,1,'员工查询本人已批准份额',False),(1,3,'按会话员工过滤已批准份额和发放',False),(3,1,'返回本人份额与发放记录',True),(1,0,'展示本人结果；未关联身份显示说明',True)])]
    for uc,title,nodes,edges,people,messages in data:
        classes('class_UC_'+uc,'UC-'+uc+' 分析实体类图',nodes,edges)
        fragments={'19':[dict(start=7,end=10,split=8,guard='权限、来源或版本校验失败',other='全部校验通过')],
                   '20':[dict(start=5,end=8,split=6,guard='身份、来源、覆盖或版本不符',other='全部关闭条件通过')],
                   '21':[dict(start=4,end=11,split=5,guard='来源缺失、未关闭或版本无效',other='全部登记门诊三个月完整关闭')],
                   '22':[dict(start=6,end=8,split=7,guard='批准条件不满足',other='独立批准条件通过'),dict(start=9,end=12,operator='opt',guard='员工请求查询本人激励')]}
        sequence('seq_UC_'+uc,'UC-'+uc+' 内部分析序列'+('（1/2）' if uc in ['20','22'] else ''),people,messages,fragments=fragments[uc])
        if uc=='20':
            sequence('seq_UC_20_reopen','UC-20 总部重开与季度引用检查（2/2）',people,[(0,1,'总部提交重开原因及期望版本',False),(1,2,'锁定关闭月份并检查版本',False),(1,4,'检查有效季度对该月份的引用',False),(4,1,'返回有效引用及季度状态',True),(1,0,'拒绝重开，保持原关闭来源',True),(1,2,'重开为草稿并保存原因审计',False),(2,1,'返回新草稿版本，源修订不变',True),(1,0,'反馈重开成功，可补正后重新复核',True)],fragments=[dict(start=5,end=8,split=6,guard='月份存在有效季度引用',other='无有效引用且权限及版本通过')])
        if uc=='22':
            sequence('seq_UC_22_payments','UC-22 发放占额与实际结果核实（2/2）',people,[(0,1,'提交个人份额、金额和唯一付款凭证',False),(1,2,'核对季度已批准',False),(1,3,'锁定份额，累计成功及待核实占用',False),(3,1,'返回剩余可发额度',True),(1,0,'拒绝登记，不产生额度占用',True),(1,4,'登记待核实并占用本次金额',False),(1,0,'返回待核实记录及剩余额度',True),(0,1,'核对实际凭证后提交成功或失败',False),(1,4,'按待核实状态及期望版本登记结果',False),(4,1,'返回成功或失败；未知仍保持待核实',True),(1,0,'展示付款结果与最新额度',True)],fragments=[dict(start=5,end=7,split=6,guard='未批准、凭证重复或金额超额',other='已批准且凭证和额度通过'),dict(start=8,end=11,operator='opt',guard='经办人员实际核实付款结果')])
    classes('class_UC_02','UC-02 分析实体类图',[
      ('牙医档案',['员工号、姓名、出生日期、在职状态','家庭住址、电话、电子邮箱','专长、个人简介、关联账号'],['维护人事资料(资料,版本)']),
      ('展示特长',['特长名称、展示说明、公开状态'],['维护展示(名称,说明)']),
      ('牙医特长',['牙医编号、特长编号、展示顺序','简介与展示说明'],['更新特长(医生,内容,版本)'])],[(0,2,'持有'),(1,2,'授予')])
    classes('class_UC_24','UC-24 分析实体类图',[
      ('门诊',['门诊号、名称、地址、运营状态'],['维护门诊(资料,版本)']),
      ('员工档案',['唯一员工号、姓名、是否牙医、在职状态','user_id关联；必要人事联系资料'],['维护档案(资料,版本)']),
      ('登录账号',['账号ID、登录名、状态、账号版本'],['关联唯一员工()；停用账号()']),
      ('岗位授权',['账号、岗位、门诊范围'],['核对岗位与门诊()'])],[(1,2,'关联','0..1','0..1'),(2,3,'授权'),(0,3,'限定')])
    states();overview();compensation_er()
    # Simplified service rules are the final authoritative diagrams.
    from service_flow_figures import build as build_service_flows
    build_service_flows()

if __name__=='__main__': build()
