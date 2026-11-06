"""Rebuild the simplified service-flow diagrams without rewriting main.tex.

Business rule: every dentist can provide every project. Specialties are public
profile information only. Run after compensation_figures.py if rebuilding all
figures. Figures use monochrome BCE notation and retain readable A4 text.
"""
from pathlib import Path
import math
from io import BytesIO
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'figures'
SELECTED = set()
for name, file in [('Flow', 'Deng.ttf'), ('FlowB', 'Dengb.ttf')]:
    if name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(name, 'C:/Windows/Fonts/' + file))

def wrap(value, width, size=13.5):
    lines, line = [], ''
    for ch in str(value):
        if ch == '\n' or line and pdfmetrics.stringWidth(line + ch, 'Flow', size) > width:
            lines.append(line); line = '' if ch == '\n' else ch
        else:
            line += ch
    if line: lines.append(line)
    return lines or ['']

class Figure:
    def __init__(self, name, title, height=650):
        self.h = height
        destination = str(OUT / (name + '.pdf')) if not SELECTED or name in SELECTED else BytesIO()
        self.c = canvas.Canvas(destination, pagesize=(560, height))
        self.c.setTitle(title); self.c.setAuthor('张云福')
        self.text(280, 24, title, 14.5, True)
    def text(self, x, y, value, size=13.5, bold=False, align='center', white=False):
        lines = str(value).split('\n'); font = 'FlowB' if bold else 'Flow'
        if white:
            w = max(pdfmetrics.stringWidth(t, font, size) for t in lines)
            left = x-w/2 if align=='center' else x
            self.c.setFillGray(1)
            self.c.rect(left-3, self.h-y-(len(lines)-1)*(size+3)-4,
                        w+6, size+7+(len(lines)-1)*(size+3), fill=1, stroke=0)
        self.c.setFillGray(0); self.c.setFont(font, size)
        draw = self.c.drawCentredString if align=='center' else self.c.drawString
        for i, line in enumerate(lines): draw(x, self.h-y-i*(size+3), line)
    def line(self, x1,y1,x2,y2,dashed=False,arrow=False):
        self.c.setDash([4,3] if dashed else []);self.c.setStrokeGray(0);self.c.setLineWidth(.8)
        self.c.line(x1,self.h-y1,x2,self.h-y2)
        if arrow:
            self.c.setDash([]); a=math.atan2(y2-y1,x2-x1)
            p=self.c.beginPath();p.moveTo(x2+6*math.cos(a+2.65),self.h-y2-6*math.sin(a+2.65));p.lineTo(x2,self.h-y2);p.lineTo(x2+6*math.cos(a-2.65),self.h-y2-6*math.sin(a-2.65))
            if arrow=='filled':p.close()
            self.c.drawPath(p,stroke=1,fill=int(arrow=='filled'))
    def rect(self,x,y,w,h):
        self.c.setDash([]);self.c.setFillGray(1);self.c.setStrokeGray(0);self.c.setLineWidth(.8)
        self.c.rect(x,self.h-y-h,w,h,fill=1,stroke=1)
    def save(self):self.c.save()

def symbol(f,x,y,kind):
    f.c.setDash([])
    if kind in ['worker','actor']:
        if kind=='worker':f.c.circle(x,f.h-y,19,stroke=1,fill=0)
        f.c.circle(x,f.h-y+7,4,stroke=1,fill=0)
        f.line(x,y-3,x,y+8);f.line(x-8,y+1,x+8,y+1);f.line(x,y+8,x-7,y+16);f.line(x,y+8,x+7,y+16)
    elif kind=='boundary':
        f.c.circle(x,f.h-y,13,stroke=1,fill=0);f.line(x-20,y-14,x-20,y+14);f.line(x-20,y,x-13,y)
    elif kind=='control':
        f.c.circle(x,f.h-y,13,stroke=1,fill=0);f.line(x+5,y-16,x-3,y-13,arrow='open')
    elif kind=='entity':
        f.c.circle(x,f.h-y,13,stroke=1,fill=0);f.line(x-15,y+17,x+15,y+17)
    else:
        f.rect(x-28,y-13,56,26);f.text(x,y+5,'平台',13.5)

def sequence(name,title,people,messages,business=False,note=None,fragments=()):
    """Messages: (sender, receiver, label[, return]). Keep one action per row."""
    rows=[]; y=155;headers={};dividers={}
    for number,msg in enumerate(messages,1):
        for k,fragment in enumerate(fragments):
            if fragment['start']==number:headers[k]=y;y+=29
            if fragment.get('split')==number:dividers[k]=y;y+=29
        a,b,label,*returned=msg
        xs=[54+i*452/(len(people)-1) for i in range(len(people))]
        midpoint=(xs[a]+xs[b])/2
        label_width=min(max(220,abs(xs[b]-xs[a])-16),2*(midpoint-16),2*(544-midpoint))
        lines=wrap(f'{number:02} '+label,label_width,13.5)
        rows.append((y,a,b,lines,returned[0] if returned else False))
        y+=max(37,18+len(lines)*16.5)
    f=Figure(name,title,y+55)
    f.rect(9,40,542,y-26)
    xs=[54+i*452/(len(people)-1) for i in range(len(people))]
    for x,(label,kind) in zip(xs,people):
        symbol(f,x,66,kind)
        ster={'boundary':'«boundary»','control':'«control»','entity':'«业务实体»' if business else '«entity»','worker':'«业务工人»','actor':'«业务执行者»'}.get(kind,'')
        if ster:f.text(x,103,ster,13.0)
        f.text(x,122,'\n'.join(wrap(label,102,13.5)),13.5)
        f.line(x,148,x,y,dashed=True)
    for k,fragment in enumerate(fragments):
        top=headers[k];last=rows[fragment['end']-1];bottom=last[0]+len(last[3])*16.5+19
        f.c.setDash([]);f.c.setStrokeGray(0);f.c.rect(16,f.h-bottom,528,bottom-top,fill=0,stroke=1)
        f.rect(16,top,42,23);f.text(37,top+17,fragment.get('operator','alt'),13.0,True)
        f.text(66,top+17,'['+fragment['guard']+']',13.0,align='left',white=True)
        if k in dividers:
            d=dividers[k];f.line(16,d,544,d,dashed=True)
            f.text(27,d+18,'['+fragment['other']+']',13.0,align='left',white=True)
    for i,(yy,a,b,lines,returned) in enumerate(rows,1):
        ay=yy+len(lines)*16.5;xa,xb=xs[a],xs[b]
        f.text((xa+xb)/2,yy+10,'\n'.join(lines),13.5,white=True)
        if a==b:
            x2=xa+30 if xa<470 else xa-30
            f.line(xa,ay+4,x2,ay+4,dashed=business);f.line(x2,ay+4,x2,ay+16,dashed=business);f.line(x2,ay+16,xa,ay+16,dashed=business,arrow='open' if business else 'filled')
        else:
            f.line(xa,ay+5,xb,ay+5,dashed=business or returned,arrow='open' if business or returned else 'filled')
    footer=note or ('虚线消息的箭头指向负责接收与处理的参与者。' if business else '实线为调用，虚线为返回；边界接收输入，控制组织实体协作。')
    f.text(280,y+35,footer,13.0);f.save()

def classes(name,title,boundary,control,nodes,edges):
    """BCE classes, compact vertical entity stack with explicit multiplicity."""
    h=170+len(nodes)*130;f=Figure(name,title,h)
    for x,head,role,op in [(24,boundary,'boundary','展示资料；提交输入'),(304,control,'control','校验权限；组织事务')]:
        f.rect(x,45,232,82);f.text(x+116,65,'«'+role+'»',13.0);f.text(x+116,84,head,13.5,True)
        f.line(x,91,x+232,91);f.text(x+116,111,op,13.0)
    f.line(256,85,304,85,dashed=True,arrow='open')
    for i,(head,attrs,ops) in enumerate(nodes):
        y=157+i*130;f.rect(98,y,364,110)
        f.text(280,y+20,'«entity» '+head,13.5,True);f.line(98,y+29,462,y+29)
        f.text(110,y+49,'\n'.join(wrap(attrs,340,13.5)),13.5,align='left')
        f.line(98,y+75,462,y+75);f.text(110,y+96,ops,13.5,align='left')
    f.line(420,127,483,143,dashed=True);f.line(483,143,483,188+(len(nodes)-1)*130,dashed=True)
    for i in range(len(nodes)):f.line(483,188+i*130,462,188+i*130,dashed=True,arrow='open')
    for j,(a,b,label,ma,mb) in enumerate(edges):
        side=(58-33*(j//2)) if j%2==0 else 510;ex=98 if j%2==0 else 462
        ya=212+a*130;yb=212+b*130
        f.line(ex,ya,side,ya);f.line(side,ya,side,yb);f.line(side,yb,ex,yb)
        label_y=(ya+yb)/2-5 if j<2 else ya+(yb-ya)*.22
        f.text(side,label_y,label,13.0,white=True)
        f.text(ex-18 if j%2==0 else ex+18,ya-8,ma,13.0,white=True)
        f.text(ex-20 if j%2==0 else ex+22,yb+18,mb,13.0,white=True)
    f.text(280,h-12,'关联端标明多重性；边界、控制与实体分别承担业务职责。',13.0);f.save()

def business():
    f=Figure('business_overview','安德鲁牙科连锁服务边界',560)
    f.rect(25,48,400,440);symbol(f,490,248,'actor');f.text(490,285,'患者',14)
    for i,text in enumerate(['BU01 选择门诊、项目、医生和时间','BU02 到店接受医生诊疗服务','BU03 核清费用并取得结算凭据','BU04 获得连续的复诊与跨店服务']):
        yy=105+i*100;f.c.ellipse(48,f.h-yy-28,402,f.h-yy+28,fill=0,stroke=1);f.text(225,yy+5,text,14)
        f.line(402,yy,474,252)
    f.text(280,524,'椭圆表示患者获得的服务；先后顺序见业务序列。',13.5);f.save()
    sequence('BP01','BP01 编排医生跨店班次并发布号源',
        [('总部运营','worker'),('门诊店长','worker'),('安德鲁平台','system'),('医生与班次','entity')],
        [(0,2,'维护医生档案、展示特长和项目目录'),(1,2,'提交医生、门诊与出诊时间'),(2,3,'核对医生在职、全局班次和资源'),(3,2,'返回营业、时间与转场检查结论',True),(2,1,'提示调整，保留原安排',True),(1,2,'确认班次'),(2,3,'保存已发布班次及可预约时间'),(2,1,'返回发布结果',True)],True,
        '所有医生可提供所有项目；特长仅供患者选择医生。',
        fragments=[dict(start=5,end=8,split=6,guard='冲突',other='无冲突')])
    sequence('BP02','BP02 小程序选择并确认预约',
        [('门诊前台','worker'),('安德鲁平台','system'),('预约与排班','entity'),('患者','actor')],
        [(3,1,'在小程序依次选门诊、项目、医生、时间'),(1,2,'按已发布班次与项目时长查询空档'),(2,1,'返回可预约时间和医生展示特长',True),(1,3,'展示所选安排和必要资料',True),(3,1,'核对就诊人并点击确认预约'),(1,2,'重新核对时间与资源，保存唯一预约'),(2,1,'返回预约编号或时间已被占用',True),(1,3,'反馈成功回执或提示重选时间',True),(0,1,'电话代约时录入同一预约信息')],True)
    sequence('BP03','BP03 改期取消与候补邀请',
        [('门诊前台','worker'),('安德鲁平台','system'),('预约与候补','entity'),('患者','actor')],
        [(3,1,'选择改期或取消并填写原因'),(1,2,'读取原预约并核对可变更状态'),(1,2,'改期先确认新时间，成功后替换旧安排'),(1,2,'取消则保存原因并释放原时间'),(2,1,'返回结果；改期失败保留原预约',True),(1,3,'反馈新安排或取消回执',True),(1,2,'有空档时查找相同项目与时间偏好的候补'),(1,3,'向候补患者发送有期限的邀请'),(3,1,'候补患者选择时间并确认预约'),(1,2,'再次核对空档，成功才建立预约'),(1,0,'无人确认或通知失败时列联系待办')],True)
    sequence('BP04','BP04 到诊核对、医生接诊与方案确认',
        [('门诊前台','worker'),('接诊医生','worker'),('安德鲁平台','system'),('患者','actor')],
        [(3,0,'到店出示预约并说明就诊人'),(0,2,'核对预约及身份，登记实际到诊时间'),(0,1,'交接候诊患者及过敏、特殊需求'),(1,3,'检查症状，核对健康与过敏资料'),(3,1,'补充症状与过敏情况'),(1,2,'记录诊断、牙位和治疗计划'),(1,3,'说明治疗方案、项目与预计费用'),(3,1,'表达接受、疑问或拒绝'),(1,2,'保存确认结论与方案版本'),(2,1,'返回可执行范围或继续沟通待办',True)],True)
    sequence('BP05_1','BP05 执行前核对与治疗增项（1/2）',
        [('责任医生','worker'),('安德鲁平台','system'),('执行与用品','entity'),('患者','actor')],
        [(0,1,'读取本次方案、过敏和已确认范围'),(1,2,'核对本次接诊任务与阶段条件'),(2,1,'返回可执行项目和待解决风险',True),(1,0,'风险或阶段条件不满足时提示复核',True),(0,3,'有增项时解释新增治疗及费用'),(3,0,'明确接受，或提出疑问与拒绝'),(0,1,'保存患者对增项的决定'),(1,2,'仅对已确认且条件满足的项目开放执行')],True,
        '后续实际治疗、用品耗用与签署见下一图。')

def overview(name,title,cases,roles):
    h=105+82*len(cases);f=Figure(name,title,h);f.rect(115,45,330,h-95)
    for j,(role,indices) in enumerate(roles):
        xx=46 if j%2==0 else 515;yy=120+(j//2)*175
        symbol(f,xx,yy,'actor');f.text(xx,yy+38,role,13.5)
        for i in indices:f.line(xx+(18 if xx<100 else -18),yy+8,127 if xx<100 else 433,85+82*i)
    for i,case in enumerate(cases):
        yy=85+i*82;f.c.ellipse(127,f.h-yy-24,433,f.h-yy+24,fill=0,stroke=1)
        f.text(280,yy+5,'\n'.join(wrap(case,283,13.5)),13.5)
    f.text(280,h-18,'关联线表示参与；具体职责见用例规约。',13.0);f.save()

def internal():
    specs={
    '02':('维护牙医档案与展示特长','医生资料页','医生资料控制',[
        ('牙医档案','员工号、姓名、在职状态、必要人事资料','维护档案(资料,版本)'),
        ('展示特长','特长名称、简介、展示顺序','更新展示(特长,简介)'),
        ('资料变更记录','医生、修改前后内容、办理人、时间','记录变更(前后资料)')],[(0,1,'展示','1','0..*'),(0,2,'留痕','1','0..*')],
        [(0,1,'提交医生资料与展示特长'),(1,2,'按员工号读取档案并核对版本'),(2,1,'返回档案与在职状态',True),(1,3,'校验特长名称与展示文字'),(1,2,'保存必要人事资料'),(1,3,'保存特长与公开简介'),(1,4,'记录修改前后及办理人'),(1,0,'返回保存结果与公开预览',True)]),
    '03':('维护治疗目录与标准单位价格','治疗目录页','治疗标准控制',[
        ('治疗项目','项目编码、名称、内容、预约时长','维护项目(内容,时长)'),
        ('计价单位','单位名称、数量精度','核对数量(单位,数量)'),
        ('标准价格版本','项目、单位、整数分单价、生效期间','发布价格(价格,期间,版本)')],[(0,1,'采用','0..*','1'),(0,2,'定价','1','1..*')],
        [(0,1,'提交项目、时长、单位与价格'),(1,2,'检查项目编码与内容'),(1,3,'核对单位和数量精度'),(1,4,'检查生效期间有无重叠'),(4,1,'返回当前价格与差异',True),(1,0,'展示差异或需修正项目',True),(0,1,'确认发布'),(1,2,'保存项目内容与预约时长'),(1,4,'保存新的有效价格版本'),(1,0,'返回发布结果，旧引用保持',True)]),
    '04':('编排跨店医生班次并发布容量','跨店排班页','出诊编排控制',[
        ('医生档案','员工号、在职状态、出诊门诊','核对出诊身份(医生)'),
        ('医生出诊班次','医生、门诊、起止、发布状态、版本','核对跨店时间();发布班次()'),
        ('门诊服务容量','营业时间、治疗位、占用、转场间隔','检查资源(门诊,期间)')],[(0,1,'出诊','1','0..*'),(2,1,'支持','1','0..*')],
        [(0,1,'提交医生、门诊和班次时间'),(1,2,'核对医生在职与门诊出诊授权'),(1,3,'读取医生全连锁已发布班次'),(1,4,'检查营业、治疗位与转场时间'),(4,1,'返回资源与时间冲突',True),(1,0,'有冲突则提示调整，原安排不变',True),(0,1,'确认无冲突的班次'),(1,3,'保存班次及可预约时间'),(1,0,'返回已发布班次与版本',True)]),
    '05':('查询可预约时段','小程序预约页','号源查询控制',[
        ('治疗预约条件','项目、建议时长、公开状态','读取预约时长(项目)'),
        ('医生可用班次','医生、门诊、起止、发布状态','查询班次(医生,门诊,日期)'),
        ('资源占用日历','班次、预约、临时占位、停用时间','查找连续空档(班次,时长)')],[(1,2,'核对','1','1')],
        [(0,1,'选择门诊、项目、医生与日期'),(1,2,'读取项目建议时长'),(1,3,'查询所选医生已发布班次'),(3,1,'返回班次与展示特长',True),(1,4,'排除已有占用并查找连续空档'),(4,1,'返回可选时间与日历版本',True),(1,0,'展示可选时间；无空档则提示调整',True),(0,1,'选择时间进入确认页'),(1,0,'展示所选安排与必要资料',True)]),
    '06':('确认患者预约','预约确认页','预约确认控制',[
        ('患者预约资料','患者、必要联系方式、过敏声明','核对就诊人(患者,办理人)'),
        ('时段暂占','暂占号、医生门诊、起止、截止、版本','核对时段();转为正式占用()'),
        ('预约','预约号、患者、项目、医生、门诊、时间、状态','按请求查重();确认预约()')],[(0,2,'形成','1','0..*'),(1,2,'确认','0..1','0..1')],
        [(0,1,'提交确认、暂占版本和请求键'),(1,4,'按请求键查找已有预约'),(4,1,'返回已有预约或未处理结果',True),(1,2,'新请求核对就诊人与必要资料'),(1,3,'重新检查班次、时长与时间占用'),(3,1,'返回有效暂占或时间冲突',True),(1,4,'保存预约与正式占用'),(1,3,'消耗暂占并关联预约编号'),(1,0,'返回唯一预约回执',True),(1,0,'资料不足或时间冲突则提示重选',True)]),
    '10':('接诊检查并制定治疗计划','医生接诊页','接诊计划控制',[
        ('就诊','就诊号、患者、接诊医生、到诊时间、状态','核对接诊任务(医生)'),
        ('患者风险资料','过敏、特殊需求、必要病史、核对结果','记录风险处理(医生,意见)'),
        ('治疗计划','诊断、牙位、阶段、项目、价格、版本','保存诊断与方案(检查,项目)')],[(0,1,'核对','1','0..*'),(0,2,'形成','1','0..*')],
        [(0,1,'提交本次接诊与检查资料'),(1,2,'核对本次就诊和接诊任务'),(1,3,'读取患者过敏与特殊需求'),(3,1,'返回风险和待核实事项',True),(1,0,'展示风险并请医生核对',True),(0,1,'提交风险处理、诊断和治疗建议'),(1,3,'记录医生实际核对意见'),(1,4,'保存诊断、牙位、项目和阶段'),(4,1,'返回方案版本和预计费用',True),(1,0,'展示计划，交患者确认后执行',True)]),
    '12':('记录实际治疗与医疗用品耗用','治疗执行页','实际治疗控制',[
        ('治疗放行条件','本次接诊任务、已确认项目、阶段与风险核对','检查可执行范围(项目)'),
        ('实际治疗','就诊、医生、项目、单位、实际数量、价格快照','保存执行();签署本次事实()'),
        ('医疗用品耗用','执行号、用品、数量、单位、成本依据','关联耗用(执行,数量)')],[(0,1,'限定','1','0..*'),(1,2,'实际耗用','1','0..*')],
        [(0,1,'提交实际项目、数量与用品'),(1,2,'核对接诊任务、确认、阶段和风险'),(2,1,'返回允许执行范围或待核实事项',True),(1,3,'取得已确认价格并核对实际数量'),(1,4,'核对用品单位、数量与成本依据'),(1,0,'有差异则提示修正，保存实际事实',True),(0,1,'核对后确认签署'),(1,3,'保存并签署实际执行'),(1,4,'关联实际耗用，缺成本保留待补'),(1,0,'返回签署记录与结算依据',True)]),
    '14':('安排复诊及跨店诊疗交接','复诊交接页','复诊交接控制',[
        ('阶段任务','计划阶段、前置结果、项目、日期、预计时长','检查阶段条件();关联预约()'),
        ('复诊预约','患者、医生、门诊、时间、预约状态','核对空档();确认安排()'),
        ('诊疗交接','原医生、接收医生、临床摘要、接受结论','登记接收结论(医生,意见)')],[(0,1,'安排','1','0..*'),(0,2,'跨店接续','1','0..1')],None),
    '23':('查看预约原因、到诊与排班统计','预约排班统计页','预约排班统计控制',[
        ('预约事件','预约、原计划日期、状态、取消或改期原因、时间','读取期间事件(门诊,期间)'),
        ('出诊与到诊记录','门诊、医生、班次、预约数量、实际到诊时间','汇总班次与到诊(期间)'),
        ('经营统计结果','期间、门诊、原因分类数量、到诊数、班次概览','生成统计(范围,来源时间)')],[(0,2,'汇总','0..*','1'),(1,2,'汇总','0..*','1')],None),
    '24':('维护门诊组织和岗位授权','岗位授权页','组织授权控制',[
        ('门诊','门诊号、名称、地址、运营状态','维护门诊(资料,版本)'),
        ('员工档案','员工号、姓名、医生身份、在职状态、可空账号标识','维护档案(资料,版本)'),
        ('登录账号','账号ID、登录名、状态、版本','关联员工();停用账号()'),
        ('岗位授权','账号、岗位、门诊范围、有效期、变更原因','核对范围();保存授权变更()')],[(1,2,'账号关联','0..1','0..1'),(2,3,'岗位授权','1','0..*'),(0,3,'限定','1','0..*')],
        [(0,1,'提交组织、任职或离岗变更'),(1,2,'核对门诊状态与办理范围'),(1,3,'读取员工任职和未完成任务'),(1,5,'检查可授权限与制表复核职责冲突'),(5,1,'返回权限范围或冲突原因',True),(1,5,'条件通过后保存授权及变更原因'),(1,3,'离岗时保留任务交接清单'),(1,4,'停用账号或更新会话权限版本'),(1,0,'反馈生效权限和待交接任务',True)]),
    }
    for uc,(title,b,c,nodes,edges,messages) in specs.items():
        classes('class_UC_'+uc,'UC-'+uc+' 分析类图',b,c,nodes,edges)
        people=[(b,'boundary'),(c,'control')]+[(n[0],'entity') for n in nodes]
        fragments={
            '04':[dict(start=6,end=9,split=7,guard='存在营业、时间或资源冲突',other='发布条件通过')],
            '06':[dict(start=7,end=10,split=10,guard='新请求的资料与时间条件通过',other='新请求条件未通过')],
            '24':[dict(start=6,end=9,operator='opt',guard='权限、范围与版本检查通过')],
        }.get(uc,[])
        if messages:sequence('seq_UC_'+uc,'UC-'+uc+' 内部分析序列',people,messages,fragments=fragments,
                             note='已有请求直接返回原预约；新请求按下列条件确认。' if uc=='06' else None)
        if uc=='14':
            sequence('seq_UC_14_1','UC-14 阶段检查与跨店交接（1/2）',people,
                [(0,1,'提交下一阶段项目与复诊建议'),(1,2,'核对已完成阶段、日期和时长'),(2,1,'返回可排期条件',True),(1,4,'跨店时提交必要临床摘要给接收医生'),(0,1,'接收医生提交接受或补充意见'),(1,4,'保存接收结论与责任记录'),(1,0,'已接受且阶段满足时开放排期',True)])
            sequence('seq_UC_14_2','UC-14 复诊预约确认（2/2）',people,
                [(0,1,'提交患者选定的医生、门诊和时间'),(1,2,'重查阶段条件及任务版本'),(1,4,'跨店时重查接收结论'),(1,3,'核对班次、时长与空档'),(3,1,'返回可用或冲突结果',True),(1,3,'患者确认且可用时保存预约'),(1,2,'关联预约及后续责任人'),(1,0,'成功返回预约号；冲突则提示重选',True)])
        if uc=='23':
            sequence('seq_UC_23_1','UC-23 取消改期原因与到诊统计（1/2）',people,
                [(0,1,'选择门诊、医生及日期范围'),(1,2,'读取期间内取消与改期事件'),(2,1,'返回原因与事件数量',True),(1,3,'读取有效预约和实际到诊记录'),(3,1,'返回预约数、到诊数与待核实状态',True),(1,4,'按原因分类和日期形成统计'),(4,1,'返回统计及来源时间',True),(1,0,'展示原因数量与实际到诊情况',True)])
            sequence('seq_UC_23_2','UC-23 医生排班概览（2/2）',people,
                [(0,1,'选择查看未来排班日期'),(1,3,'读取所选门诊的医生已发布班次'),(3,1,'返回医生、出诊时间与预约数量',True),(1,4,'整理日期与医生排班概览'),(1,0,'展示排班与可预约时间',True),(0,1,'店长选择需要调整的班次'),(1,0,'进入排班维护，按原规则检查冲突',True)],note='统计只帮助安排后续工作；历史预约和到诊事实保持原记录。')

def build(only=()):
    global SELECTED
    SELECTED=set(only)
    OUT.mkdir(exist_ok=True)
    business();internal();schema_profiles()
    overview('uc_overview_1','患者资料、医生与预约用例',[
        'UC-01 建立患者档案并核对逐项过敏','UC-02 维护牙医档案与展示特长','UC-03 维护治疗目录与标准单位价格','UC-04 编排跨店医生班次并发布容量','UC-05 查询可预约时段','UC-06 确认患者预约'],
        [('顾客',[0,4,5]),('前台',[0,4,5]),('医生',[1,2]),('总部',[1,2,3]),('店长',[1,3])])
    overview('uc_overview_4','经营与员工激励用例',[
        'UC-19 登记医生月度账证汇总','UC-20 独立复核月度底稿并关闭','UC-21 计算医生季度业绩及10%基金','UC-22 审批激励、登记发放及本人查询','UC-23 查看预约原因、到诊与排班统计','UC-24 维护门诊组织和岗位授权'],
        [('总部',[0,1,2,3,4,5]),('店长',[0,4,5]),('医生',[3])])

def schema_profiles():
    for name,title,nodes,edges in [
        ('er_concept_2','医生与特长档案',[
            ('员工与医生档案 staff','PK id；员工号、姓名、在职状态'),
            ('特长目录 qualifications','PK id；名称、展示说明'),
            ('医生特长 dentist_qualifications','PK id；FK dentist_id；FK qualification_id')],
            [(0,2,'展示特长','1','0..*'),(1,2,'特长分类','1','0..*')]),
        ('er_9','医生特长关系模型',[
            ('特长目录 qualifications','PK id；名称、展示说明'),
            ('医生特长 dentist_qualifications','PK id；FK dentist_id；FK qualification_id')],
            [(0,1,'特长分类','1','0..*')]),
        ('er_10','治疗标准关系模型',[
            ('治疗项目目录 services','PK id；项目、单位、时长、公开状态'),
            ('服务价格版本 service_prices','PK id；FK service_id；FK clinic_id；FK approved_by')],
            [(0,1,'价格版本','1','0..*')])]:
        h=95+len(nodes)*135;f=Figure(name,title,h)
        for i,(head,fields) in enumerate(nodes):
            y=55+i*135;f.rect(95,y,370,90);f.text(280,y+25,head,13.5,True)
            f.line(95,y+35,465,y+35);f.text(108,y+59,'\n'.join(wrap(fields,340,13.5)),13.5,align='left')
        for j,(a,b,label,ma,mb) in enumerate(edges):
            x=53 if j%2==0 else 510;ex=95 if j%2==0 else 465;ya=100+a*135;yb=100+b*135
            f.line(ex,ya,x,ya);f.line(x,ya,x,yb);f.line(x,yb,ex,yb)
            f.text(x,(ya+yb)/2,label,13,white=True);f.text(ex-16 if x<100 else ex+18,ya-9,ma,13)
            f.text(ex-21 if x<100 else ex+22,yb+19,mb,13)
        f.text(280,h-15,'特长用于展示；预约依据班次、项目时长和时间占用。',13);f.save()

if __name__=='__main__':
    import sys
    build(sys.argv[1:])
