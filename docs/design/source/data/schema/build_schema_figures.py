from pathlib import Path
from xml.sax.saxutils import escape
import json, heapq, math
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pypdfium2 as pdfium

BASE=Path(__file__).resolve().parent
OUT=BASE/'figures'; OUT.mkdir(exist_ok=True)
INV=json.loads((BASE/'schema_inventory.json').read_text('utf-8'))
TABLES={t['name']:t for t in INV['tables']}
pdfmetrics.registerFont(TTFont('Deng',r'C:/Windows/Fonts/Deng.ttf'))
pdfmetrics.registerFont(TTFont('DengB',r'C:/Windows/Fonts/Dengb.ttf'))
W,H=600,744

class Drawing:
    def __init__(self): self.p=[]
    def rect(self,x,y,w,h,fill='white',stroke='black',width=1): self.p.append(('rect',x,y,w,h,fill,stroke,width))
    def path(self,points,dashed=False,width=1): self.p.append(('path',points,dashed,width))
    def text(self,x,y,text,size=13,font='Deng',anchor='start'):
        self.p.append(('text',x,y,str(text),size,font,anchor))
    def write(self,stem):
        svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="600pt" height="{H}pt" viewBox="0 0 600 {H}">', f'<rect width="600" height="{H}" fill="white"/>']
        pdf=Canvas(str(OUT/f'{stem}.pdf'),pagesize=(W,H));pdf.setTitle(stem)
        for p in self.p:
            if p[0]=='rect':
                _,x,y,w,h,fill,stroke,width=p
                svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')
                pdf.setLineWidth(width);pdf.setStrokeColorRGB(0,0,0);pdf.setFillColorRGB(*([1,1,1] if fill=='white' else [.94,.94,.94]));pdf.rect(x,H-y-h,w,h,stroke=stroke!='none',fill=1)
            elif p[0]=='path':
                _,points,dashed,width=p
                coords=' '.join(f'{x},{y}' for x,y in points)
                svg.append(f'<polyline points="{coords}" fill="none" stroke="black" stroke-width="{width}"'+(' stroke-dasharray="5,4"' if dashed else '')+'/>')
                pdf.setStrokeColorRGB(0,0,0);pdf.setLineWidth(width);pdf.setDash([5,4] if dashed else [])
                path=pdf.beginPath();path.moveTo(points[0][0],H-points[0][1])
                for x,y in points[1:]: path.lineTo(x,H-y)
                pdf.drawPath(path);pdf.setDash([])
            else:
                _,x,y,text,size,font,anchor=p
                weight='bold' if font=='DengB' else 'normal'
                svg.append(f'<text x="{x}" y="{y}" font-family="DengXian,等线,sans-serif" font-weight="{weight}" font-size="{size}" text-anchor="{anchor}" fill="black">{escape(text)}</text>')
                pdf.setFillColorRGB(0,0,0);pdf.setFont(font,size)
                if anchor=='middle': pdf.drawCentredString(x,H-y,text)
                elif anchor=='end': pdf.drawRightString(x,H-y,text)
                else: pdf.drawString(x,H-y,text)
        svg.append('</svg>');(OUT/f'{stem}.svg').write_text('\n'.join(svg),'utf-8')
        pdf.showPage();pdf.save()
        doc=pdfium.PdfDocument(str(OUT/f'{stem}.pdf'));page=doc[0];image=page.render(scale=2.4).to_pil();image.save(OUT/f'{stem}.png');page.close();doc.close()

def split_name(name,maxwidth=148):
    if pdfmetrics.stringWidth(name,'Deng',12.6)<=maxwidth:return [name]
    parts=name.split('_');lines=[];line=''
    for part in parts:
        add=(line+'_'+part) if line else part
        if line and pdfmetrics.stringWidth(add,'Deng',12.6)>maxwidth:lines.append(line);line=part
        else:line=add
    if line:lines.append(line)
    return lines

class Node:
    def __init__(self,table,col,row,fields,context=False):
        self.table=table;self.fields=fields;self.context=context
        self.x=[24,218,412][col];self.y=[48,212,376,540][row];self.w=164
        self.name_lines=split_name(table)
        self.h=38+15*len(self.name_lines)+17*len(fields)
        self.h=math.ceil(self.h/2)*2
    def ports(self):
        # Two ports on every side improve fan-out without arrows sharing a tip.
        ports=[]
        for f in [.32,.68]:
            x=round((self.x+self.w*f)/2)*2;y=round((self.y+self.h*f)/2)*2
            ports += [('top',x,self.y,x,self.y-10),('bottom',x,self.y+self.h,x,self.y+self.h+10),('left',self.x,y,self.x-10,y),('right',self.x+self.w,y,self.x+self.w+10,y)]
        return ports
    def draw(self,d):
        d.rect(self.x,self.y,self.w,self.h)
        d.text(self.x+self.w/2,self.y+18,TABLES[self.table]['title']+('（参照）' if self.context else ''),13.6,'DengB','middle')
        yy=self.y+35
        for line in self.name_lines:d.text(self.x+self.w/2,yy,line,12.6,'Deng','middle');yy+=15
        d.path([(self.x,yy-8),(self.x+self.w,yy-8)],width=.65)
        yy+=9
        for field in self.fields:d.text(self.x+8,yy,field,12.7);yy+=17

class Router:
    def __init__(self,nodes):
        self.nodes=nodes;self.used={};self.portuse={}
        self.blocked=set()
        for n in nodes:
            for x in range(int(n.x)-6,int(n.x+n.w)+7,2):
                for y in range(int(n.y)-6,int(n.y+n.h)+7,2):self.blocked.add((x,y))
    def route(self,child,parent):
        starts=child.ports();ends=parent.ports();endpoints={(p[3],p[4]):(i,p) for i,p in enumerate(ends)}
        queue=[];distance={};previous={};serial=0
        for i,p in enumerate(starts):
            point=(p[3],p[4]);state=(point[0],point[1],-1,i)
            cost=self.portuse.get((child.table,i),0)*32
            distance[state]=cost;heapq.heappush(queue,(cost,serial,state));serial+=1
        final=None
        while queue:
            cost,_,state=heapq.heappop(queue)
            if cost!=distance.get(state):continue
            x,y,direction,starti=state
            if (x,y) in endpoints:
                final=state;break
            for nd,(dx,dy) in enumerate([(2,0),(-2,0),(0,2),(0,-2)]):
                xx,yy=x+dx,y+dy
                if xx<6 or xx>594 or yy<35 or yy>H-50 or (xx,yy) in self.blocked:continue
                nxt=(xx,yy,nd,starti);newcost=cost+2+(4 if direction!=-1 and nd!=direction else 0)+self.used.get((xx,yy),0)*14
                if newcost<distance.get(nxt,float('inf')):
                    distance[nxt]=newcost;previous[nxt]=state;heapq.heappush(queue,(newcost,serial,nxt));serial+=1
        if final is None:raise RuntimeError(f'No route {child.table}->{parent.table}')
        points=[];p=final
        while p in previous:points.append((p[0],p[1]));p=previous[p]
        points.append((p[0],p[1]));points.reverse()
        startport=starts[final[3]];endi,endport=endpoints[(final[0],final[1])]
        self.portuse[(child.table,final[3])]=self.portuse.get((child.table,final[3]),0)+1
        self.portuse[(parent.table,endi)]=self.portuse.get((parent.table,endi),0)+1
        for point in points:self.used[point]=self.used.get(point,0)+1
        points=[(startport[1],startport[2])]+points+[(endport[1],endport[2])]
        compressed=[points[0]]
        for i in range(1,len(points)-1):
            a,b,c=points[i-1:i+2]
            if (a[0]==b[0]==c[0]) or (a[1]==b[1]==c[1]):continue
            compressed.append(b)
        compressed.append(points[-1]);return compressed,startport,endport

def endpoint_label(d,port,label,nodes,label_rects):
    side,x,y,ox,oy=port
    size=12.7;width=pdfmetrics.stringWidth(label,'Deng',size)+1
    if side=='top':candidates=[(x+3,y-7),(x-width-3,y-7)]
    elif side=='bottom':candidates=[(x+3,y+17),(x-width-3,y+17)]
    elif side=='left':candidates=[(x-width-1,y-4),(x-width-1,y+15)]
    else:candidates=[(x+1,y-4),(x+1,y+15)]
    def overlap(a,b):return a[0]<b[2] and a[2]>b[0] and a[1]<b[3] and a[3]>b[1]
    obstacles=[(n.x,n.y,n.x+n.w,n.y+n.h) for n in nodes]+[(a-3,b-2,c+3,e+2) for a,b,c,e in label_rects]
    for tx,ty in candidates:
        box=(tx,ty-size+2,tx+width,ty+3)
        if box[0]>=1 and box[2]<=599 and all(not overlap(box,b) for b in obstacles):break
    else:
        for step in [18,30,44,58]:
            tx,ty=candidates[0]
            if side in ['left','right']:ty+=step
            else:tx+=step
            box=(tx,ty-size+2,tx+width,ty+3)
            if box[0]>=1 and box[2]<=599 and all(not overlap(box,b) for b in obstacles):break
        else:raise RuntimeError(f'Cardinality label cannot be placed: {port} {label}')
    label_rects.append(box);d.rect(box[0],box[1],box[2]-box[0],box[3]-box[1],'white','none',0);d.text(tx,ty,label,size)

def N(table,col,row,fields,context=False):return Node(table,col,row,fields,context)
FIGS=[
dict(id='er01',title='门诊、医生与治疗资源物理关系',nodes=[
N('clinics',0,0,['PK id','name / active','area']),N('dentists',1,0,['PK id','UQ employee_no','name / active']),N('qualifications',2,0,['PK id','name / issuer','active']),
N('schedules',0,2,['PK id','FK clinic_id','FK dentist_id','start_at / end_at']),N('dentist_qualifications',1,1,['PK/FK dentist_id','PK/FK qualification_id','position']),N('dentist_qualification_details',2,2,['PK/FK dentist_id','PK/FK qualification_id','certificate_no','verified_at']),N('treatments',0,1,['PK id','name / unit','unit_price / active'])],
edges=[('schedules','clinics','0..n','1'),('schedules','dentists','0..n','1'),('dentist_qualifications','dentists','0..n','1'),('dentist_qualifications','qualifications','0..n','1'),('dentist_qualification_details','dentists','0..n','1'),('dentist_qualification_details','qualifications','0..n','1')]),
dict(id='er02',title='患者档案、门诊访问与预约物理关系',nodes=[
N('clinics',0,0,['PK id','name'],True),N('patients',1,0,['PK id','FK created_clinic_id','FK merged_into_id','name / phone']),N('schedules',2,0,['PK id','FK clinic_id','FK dentist_id'],True),
N('patient_clinic_access',0,1,['PK/FK patient_id','PK/FK clinic_id','position']),N('patient_allergies',1,1,['PK/FK patient_id','PK id','name / reaction']),N('appointments',2,1,['PK id','FK patient_id / schedule_id','FK previous_id','status / start_at']),
N('patient_aliases',1,2,['PK id','UQ/FK source_id','FK target_id','identity_evidence'])],
edges=[('patients','clinics','0..n','0..1'),('patient_clinic_access','clinics','0..n','1'),('patient_clinic_access','patients','0..n','1'),('patient_allergies','patients','0..n','1'),('appointments','patients','0..n','1'),('appointments','schedules','0..n','1'),('patient_aliases','patients','0..1','1'),('patient_aliases','patients','0..n','1')],note='患者别名source_id唯一、target_id可重复；归并与改约自引用详见字典。'),
dict(id='er03',title='就诊、治疗明细与结算物理关系',nodes=[
N('appointments',0,0,['PK id','FK patient_id','status'],True),N('visits',1,0,['PK id','UQ/FK appointment_id','status / completed_at']),N('visit_addenda',2,0,['PK id','FK visit_id','original_version','content / author_name']),
N('treatments',0,1,['PK id','name / unit_price'],True),N('visit_lines',1,1,['PK/FK visit_id','PK id / FK treatment_id','quantity / unit_price']),N('settlements',2,1,['PK id / UQ number','UQ/FK visit_id','FK patient_id','total / date']),
N('settlement_lines',1,2,['PK/FK settlement_id','PK position','FK treatment_id','quantity / subtotal'])],
edges=[('visits','appointments','0..1','1'),('visit_lines','visits','0..n','1'),('visit_lines','treatments','0..n','1'),('visit_addenda','visits','0..n','1'),('settlements','visits','0..1','1'),('settlement_lines','settlements','0..n','1'),('settlement_lines','treatments','0..n','0..1')]),
dict(id='er04',title='收款、退款、冲销与日结物理关系',nodes=[
N('settlements',1,0,['PK id','FK clinic_id','total'],True),N('payments',0,1,['PK id','FK settlement_id','amount / method','recorded_at']),N('invoice_adjustments',2,1,['PK id','FK settlement_id','type = void','amount / reason']),N('refunds',0,2,['PK id','FK payment_id','amount / reference']),N('clinics',1,2,['PK id','name'],True),N('reconciliations',2,2,['PK id / FK clinic_id','business_date / revision','expected_* / observed_*','source_signature'])],
edges=[('payments','settlements','0..n','1'),('refunds','payments','0..n','1'),('invoice_adjustments','settlements','0..1','1'),('settlements','clinics','0..n','1'),('reconciliations','clinics','0..n','1')],note='冲销唯一性含type=void条件索引；recorded_by均为账号物理FK。'),
dict(id='er05',title='季度成本、报告与来源追溯物理关系',nodes=[
N('quarterReports',1,0,['PK id','quarter / status','revenue / net_profit','source_signature']),N('quarter_report_clinics',0,1,['PK/FK report_id','PK/FK clinic_id','position']),N('quarter_report_history',2,1,['PK/FK report_id','PK position','action / prior_status']),N('quarter_report_rows',1,1,['PK/FK report_id','PK position','FK clinic_id / dentist_id','FK cost_id / cost_version']),N('costs',0,2,['PK id','FK clinic_id / dentist_id','quarter / status','supplies / operations']),N('quarter_report_settlements',2,2,['PK/FK report_id','PK/FK position','PK/FK settlement_id','item_position']),N('cost_review_history',0,3,['PK/FK cost_id','PK position','user_id / action']),N('settlements',2,3,['PK id','total / date'],True)],
edges=[('quarter_report_clinics','quarterReports','0..n','1'),('quarter_report_rows','quarterReports','0..n','1'),('quarter_report_history','quarterReports','0..n','1'),('quarter_report_rows','costs','0..n','0..1'),('cost_review_history','costs','0..n','1'),('quarter_report_settlements','quarter_report_rows','0..n','1'),('quarter_report_settlements','settlements','0..n','1')],note='核算行含门诊和医生物理FK；来源关联以(report_id, position)复合FK定位核算行。'),
dict(id='er06',title='账号、安全会话与平台支撑物理关系',nodes=[
N('users',1,0,['PK id / UQ username','password_hash / role','patient_id / dentist_id','data / active']),N('sessions',0,1,['PK token_hash','FK user_id','expires_at / csrf']),N('idempotency_requests',1,1,['PK/FK user_id','PK key','request_hash / response']),N('password_reset_tokens',2,1,['PK id / UQ token_hash','FK user_id / issued_by','expires_at / consumed_at']),N('audit',0,2,['PK id','user_id / type','target_id / detail']),N('account_recovery_requests',2,2,['PK id','FK user_id','status / requested_at']),N('metadata',0,3,['PK key','value']),N('schema_migrations',1,3,['PK version','name / checksum','applied_at']),N('rate_limits',2,3,['PK key','count / expires_at']),N('settings',1,2,['PK id','cancellation_hours','fund_rate / version'])],
edges=[('sessions','users','0..n','1'),('idempotency_requests','users','0..n','1'),('password_reset_tokens','users','0..n','1'),('account_recovery_requests','users','0..n','1'),('audit','users','0..n','1','logical')],note='audit.user_id为逻辑引用；恢复凭证另以issued_by物理引用签发账号。')
]

result=[];covered=set()
for fig in FIGS:
    H=max(n.y+n.h for n in fig['nodes'])+72
    d=Drawing();d.text(W/2,22,fig['title'],15,'DengB','middle')
    nodes={n.table:n for n in fig['nodes']};router=Router(list(nodes.values()));labels=[]
    for relation in fig['edges']:
        child,parent,clabel,plabel,*kind=relation
        points,cp,pp=router.route(nodes[child],nodes[parent]);d.path(points,dashed=bool(kind and kind[0]=='logical'),width=.95);labels += [(cp,clabel),(pp,plabel)]
    for n in nodes.values():n.draw(d);covered.add(n.table)
    label_rects=[]
    for port,label in labels:endpoint_label(d,port,label,list(nodes.values()),label_rects)
    d.path([(18,H-36),(50,H-36)]);d.text(56,H-32,'DDL外键',12.7);d.path([(153,H-36),(185,H-36)],True);d.text(191,H-32,'逻辑引用',12.7)
    d.text(300,H-32,'PK主键  FK外键  UQ唯一；基数按业务必填解释',12.7)
    note=fig.get('note','仅画本组主要关系；其他跨图FK、物理可空声明与完整字段见数据字典。')
    # Long explanatory text is kept outside nodes; split at CJK-friendly length.
    d.text(18,H-9,note,11.8)
    d.write(fig['id'])
    result.append({'id':fig['id'],'title':fig['title'],'path':str((OUT/f"{fig['id']}.png").resolve()),'svg':str((OUT/f"{fig['id']}.svg").resolve()),'pdf':str((OUT/f"{fig['id']}.pdf").resolve()),'tables':list(nodes),'width_pt':W,'height_pt':H,'min_node_font_pt':12.6,'insert_width_cm':15.6,'font_at_insert_pt':round(12.6*442.205/W,2),'physical_fk_scope':'显示本组主要关系；全部物理FK与跨图关系见schema_inventory.json','notes':note})
assert covered==set(TABLES),f'Missing tables: {set(TABLES)-covered}'
(BASE/'figures.json').write_text(json.dumps({'figures':result,'covered_table_count':len(covered),'all_table_count':len(TABLES),'page':'portrait A4, body width 15.6 cm','legend':'solid: physical FK; dashed: service-layer logical reference','nullability_note':'PK按业务设计为必填；物理DDL未显式NOT NULL处如实见数据字典。'},ensure_ascii=False,indent=2),'utf-8')
print(json.dumps({'figures':len(result),'covered_tables':len(covered),'output':str(OUT)},ensure_ascii=False))
