"""Align compensation and employee dictionaries with committed SQL migrations.

Reads the real schema, extracts types/keys/nullability, and rejects undocumented
columns. This updates only the bounded employee/compensation TeX sections.
"""
from pathlib import Path
import re,json,hashlib
from update_compensation_text import t,table,fig

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
MIG=REPO/'database/migrations'
TABLES=['incentive_months','doctor_financial_sources','incentive_pools','incentive_pool_sources','doctor_quarter_results','incentive_allocations','incentive_payments']
CN=['门诊月度激励底稿','医生月度财务来源修订','季度10%激励基金','基金采用的关闭月度来源','医生门诊季度业绩','医生跨店激励份额','激励发放核实记录']

def parts(s):
    result=[];start=0;depth=0;quote=False;i=0
    while i<len(s):
        c=s[i]
        if c=="'":
            if quote and i+1<len(s) and s[i+1]=="'":i+=2;continue
            quote=not quote
        if not quote:
            if c=='(':depth+=1
            elif c==')':depth-=1
            elif c==',' and depth==0:result.append(s[start:i].strip());start=i+1
        i+=1
    result.append(s[start:].strip());return result

def parse(name,sql):
    match=re.search(r'CREATE TABLE '+re.escape(name)+r'\s*\((.*?)\n\);',sql,re.S)
    if not match:raise ValueError('missing SQL table '+name)
    fragments=parts(match.group(1));fields=[];pk=[]
    for item in fragments:
        if re.match(r'^(CHECK|UNIQUE|PRIMARY|FOREIGN|CONSTRAINT)\b',item,re.I):
            if item.startswith('PRIMARY KEY'):pk=re.search(r'\(([^)]+)\)',item).group(1).split(',')
            continue
        col=re.match(r'([a-z_]+)\s+([a-z]+(?:\[\])?)\b(.*)',item,re.S)
        if not col:raise ValueError('column syntax '+item)
        key,typ,tail=col.groups();ref=re.search(r'REFERENCES\s+(\w+)\((\w+)\)',tail)
        fields.append(dict(name=key,type=typ.upper(),nullable=not('NOT NULL' in tail or 'PRIMARY KEY' in tail),pk='PRIMARY KEY' in tail,unique='UNIQUE' in tail,reference=ref.group(1)+'.'+ref.group(2) if ref else None))
    for f in fields:
        if f['name'] in pk:f['pk']=True;f['nullable']=False
    return fields

MEANINGS={
'id':'稳定全局标识，自动生成UUID','user_id':'关联登录账号；staff.user_id可空且唯一，岗位授权中必填','employee_no':'唯一员工编号，跨门诊保持同一编号；公开医生DTO不返回','name':'员工姓名','phone':'内部人员联系电话；公开医生DTO不返回','specialty':'岗位或医生专长说明','is_dentist':'是否牙医；支持非医生员工与医生采用同一员工主体','active':'当前可用标记；停用保留历史','row_version':'乐观并发版本；成功状态变更递增','is_demo':'合成演示资料标记；不接受普通表单伪造','bio':'对外展示的个人简介','focus_areas':'对外展示的专长项目数组','birth_date':'内部人事出生日期；公开医生DTO不返回','home_address':'内部人事家庭住址；公开医生DTO不返回','email':'内部人事电子邮箱；公开医生DTO不返回','username':'小写规范化登录名，唯一','password_hash':'不可逆安全密码散列，不保存明文密码','display_name':'账号显示姓名，不作为员工身份关联依据','account_version':'账号并发与会话有效性版本，正整数','must_change_password':'首次或临时凭据是否必须更改密码','role':'front、doctor、manager、hq；同一账号可承担多岗位',
'clinic_id':'来源门诊的稳定ID','clinic_name':'采用时的门诊名称快照','doctor_id':'牙医员工ID，引用staff.id；跨店统一识别','doctor_name':'来源或季度生成时的医生姓名快照','month_id':'对应门诊月度底稿','month':'自然月首日，接口使用YYYY-MM','reference':'月度总依据、季度核算依据或付款凭证，按所属表解释','no_activity':'明确核验的零业务声明，不能由缺来源推定','status':'本对象的受控状态，具体集合见表后规则','source_revision':'月度医生来源修订号；保存追加，关闭及重开不改此号','created_by':'创建或制表账号','created_staff_id':'创建或制表时的有效员工身份','updated_by':'最近保存或状态变更账号','closed_by':'独立关闭月份的复核账号','closed_staff_id':'独立关闭月份的复核员工','closed_at':'复核关闭时刻','created_at':'记录创建时刻，保存为带时区时间','updated_at':'最近保存或状态变更时刻',
'revenue_cents':'已核对服务收入净额，可含有依据的负数调整；单位分','material_cost_cents':'已核对医疗用品耗用净成本；单位分','operating_expense_cents':'已核对归属医生的运营费用；单位分','revenue_reference':'服务收入账证或调整来源编号；零金额亦明确填写','material_reference':'用品成本账证或调整来源编号；零金额亦明确填写','expense_reference':'运营费用账证或调整来源编号；零金额亦明确填写',
'pool_id':'所属季度基金快照','quarter':'已结束的自然季度，格式YYYY-Q1至YYYY-Q4','rule_version':'固定规则版本quarterly-positive-contribution-v1','total_revenue_cents':'采用的全部医生门诊收入合计；单位分','total_material_cost_cents':'采用的全部医生门诊用品成本合计；单位分','total_operating_expense_cents':'采用的全部医生门诊运营费用合计；单位分','net_profit_cents':'收入减用品成本减运营费，允许为负；单位分','fund_cents':'全体净利合计正部的10%，四舍五入至分','clinic_count':'采用的全部登记门诊数量，必须大于零','doctor_count':'季度中按员工ID去重后的医生数','submitted_at':'制表人提交季度草稿的时刻','approved_by':'独立总部批准账号','approved_staff_id':'独立总部批准员工','approved_at':'季度批准时刻','void_reason':'未批准快照作废的具体原因','voided_by':'作废经办账号','voided_at':'作废时刻',
'contribution_cents':'该医生跨全部门诊合并后的有符号净利润分','weight_cents':'max(该医生跨店净利润,0)，作为统一分配权重','amount_cents':'该份额批准金额，或单笔付款占用金额；单位分','allocation_id':'本次付款对应的获批医生份额','result_reference':'实际核实成功或失败的凭证编号，与所有付款凭证交叉去重','resolved_by':'实际核实付款结果的经办账号','resolved_staff_id':'实际核实付款结果的员工身份','resolved_at':'实际核实结果时刻'
}
RULES={
'incentive_months':'同门诊与自然月唯一。month为月首日，reference去空格后1—500字；source_revision和row_version为正整数。状态仅draft、closed；closed时复核账号、员工及时间同时非空，且复核账号及员工分别不同于制表身份。关闭还检查当月已发布出诊医生覆盖；有效季度引用阻止保存或重开。',
'doctor_financial_sources':'同(month_id,source_revision,doctor_id)唯一。三类金额各在±1000000000000分内，三类来源编号各1—500字。每次保存追加新revision，旧行由append-only触发器禁止更新和删除；季度按采用的source_revision读取。',
'incentive_pools':'quarter符合YYYY-Qn；rule_version固定为quarterly-positive-contribution-v1。status为draft、submitted、approved、voided；每季度仅一个非voided快照。净利等于三类合计相减，基金等于非负净利的10%四舍五入至分。批准时账号、员工和时间齐全，且账号及员工分别不同于制表者；作废必须有原因、经办人和时间。',
'incentive_pool_sources':'联合主键(pool_id,month_id)，且(pool_id,clinic_id,month)唯一。source_revision为正整数。固定采用时门诊、月份、总依据、零业务声明和关闭复核身份。append-only触发器禁止覆盖或删除；生成时必须覆盖全部登记门诊三个自然月。',
'doctor_quarter_results':'同(pool_id,clinic_id,doctor_id)唯一，净利必须等于收入减两类成本。季度门诊医生明细通过append-only触发器保持不变；同一医生跨店合并不重复计入集团总额。',
'incentive_allocations':'同(pool_id,doctor_id)唯一。weight_cents=max(contribution_cents,0)，amount_cents非负，row_version为正整数。最大余数法使全部个人金额严格等于fund_cents；同余按员工编号、医生ID稳定排序。支付触发器更新版本；本人读取以会话员工ID筛选。',
'incentive_payments':'reference全局唯一且1—500字；result_reference非空时同样为1—500字，两类凭证通过事务锁交叉去重。新记录必须pending；只可依据凭据从pending转succeeded或failed，终态及原始额度不可改写，记录禁止删除。触发器锁定approved份额，成功与pending合计不超额度；未知继续pending，明确失败释放占用。'
}

def field_table(name,fields):
    rows=[]
    for f in fields:
        if f['name'] not in MEANINGS:raise ValueError('missing dictionary meaning '+name+'.'+f['name'])
        keys=['NULL' if f['nullable'] else 'NN']
        if f['pk']:keys.append('PK')
        if f['unique']:keys.append('UNIQUE')
        if f['reference']:keys.append('FK→'+f['reference'])
        rows.append((f['name'],f['type'],'；'.join(keys),MEANINGS[f['name']]))
    return table(name+'字段',['字段','类型','键与空值','含义及限制'],rows,'schema_'+name,[3.6,2.1,3.7,5.3])

def run():
    sql=(MIG/'008_staff_compensation.sql').read_text(encoding='utf-8')
    schemas={name:parse(name,sql) for name in TABLES}
    staff=parse('staff',(MIG/'001_booking_core.sql').read_text(encoding='utf-8'))
    for migration in sorted(MIG.glob('*.sql')):
        for key,typ,tail in re.findall(r'ALTER TABLE staff ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)\s+([a-z]+(?:\[\])?)([^;]*);',migration.read_text(encoding='utf-8')):
            if any(f['name']==key for f in staff):continue
            staff.append(dict(name=key,type=typ.upper(),nullable='NOT NULL' not in tail,pk=False,unique='UNIQUE' in tail,reference=None))
    # The original case explicitly requests these private personnel fields.
    assert {'birth_date','home_address','email'} <= {f['name'] for f in staff},'Wait for staff migration to be final before synchronizing.'
    schemas['staff']=staff
    core=(MIG/'001_booking_core.sql').read_text(encoding='utf-8')
    users=parse('users',core);roles=parse('role_assignments',core)
    for migration in sorted(MIG.glob('*.sql')):
        for key,typ,tail in re.findall(r'ALTER TABLE users ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)\s+([a-z]+(?:\[\])?)([^;]*);',migration.read_text(encoding='utf-8')):
            if any(f['name']==key for f in users):continue
            users.append(dict(name=key,type=typ.upper(),nullable='NOT NULL' not in tail,pk=False,unique='UNIQUE' in tail,reference=None))
    schemas['users']=users;schemas['role_assignments']=roles
    p=ROOT/'main.tex';s=p.read_text(encoding='utf-8')
    a=s.index(r'\subsubsection{医生门诊季度业绩（doctor\_quarter\_results）}') if r'\subsubsection{医生门诊季度业绩（doctor\_quarter\_results）}' in s else s.index(r'\subsubsection{门诊月度激励底稿（')
    b=s.index(r'\subsubsection{跨店代收内部清算',a)
    body=''
    for name,cn in zip(TABLES,CN):
        body+=r'\subsubsection{'+t(cn)+'（'+t(name)+r'）}'+'\n'+field_table(name,schemas[name])+t('约束：'+RULES[name])+r'\par'+'\n'
    s=s[:a]+body+s[b:]
    a=s.index(r'\subsubsection{登录账号');b=s.index(r'\subsubsection{患者主档',a)
    identity=r'\subsubsection{登录账号（users）}'+'\n'+t('账号负责认证，员工通过staff.user_id关联本人账号；患者通过患者档案关联本人账号。员工号和账号名分别保持稳定唯一，显示姓名不用于推断数据权限。')+r'\par'+'\n'+field_table('users',users)+t('约束：username小写且唯一，active控制账号启停；account_version为正整数。临时密码流程由must_change_password控制，停用与密码变更使旧会话失效，保留历史经办记录。')+r'\par'+'\n'
    identity+=r'\subsubsection{岗位与门诊授权（role\_assignments）}'+'\n'+field_table('role_assignments',roles)+t('约束：role取front、doctor、manager、hq；总部hq的clinic_id必须为空，其他岗位必须绑定门诊。同(user_id,role,clinic_id)唯一，空值按同值处理。服务端从会话读取当前账号与岗位，每项操作再检查员工状态及门诊范围；独立复核同时比较账号和staff.id。')+r'\par'+'\n'
    s=s[:a]+identity+s[b:]
    a=s.index(r'\subsubsection{员工与医生档案（staff）}')
    b=s.index(r'\subsubsection{登录账号',a)
    body=r'\subsubsection{员工与医生档案（staff）}'+'\n'+t('员工档案保存稳定员工编号和可选唯一账号关联，医生与非医生共享员工主体。出生日期、家庭住址和电子邮箱用于内部人事管理；公开医生资料不返回这三项。')+r'\par'+'\n'+field_table('staff',staff)+t('约束：employee_no唯一；user_id可空且唯一，关联users.id。is_dentist区分牙医和非医生员工；active停用不删除历史。row_version为正整数。医生档案、非医生员工档案及账号授权分别由相应管理入口维护；制表和复核同时核对账号与员工编号。')+r'\par'+'\n'
    s=s[:a]+body+s[b:]
    # Remove the reversed, non-existent users.staff_id relationship and keep the
    # actual staff.user_id direction in both the identity dictionary and FK set.
    lines=s.splitlines();clean=[]
    for line in lines:
        if line.startswith(r'\Cell{users.\allowbreak{}staff\_\allowbreak{}id}'):continue
        if line.startswith(r'\Cell{staff.\allowbreak{}user\_\allowbreak{}id}') or line.startswith(r'\Cell{staff.user\_\allowbreak{}id}'):continue
        if line.startswith(r'\Cell{') and any(line.startswith(r'\Cell{'+t(name)+r'.') or line.startswith(r'\Cell{'+t(name)+r'.\allowbreak{}') for name in TABLES+['role_assignments']):
            # Only rows in the old full FK relation table start with table.column.
            continue
        clean.append(line)
    s='\n'.join(clean)+'\n'
    # Add generated relationships to the full FK table before the next subsection.
    a=s.index(r'\caption{完整外键关系}');b=s.index(r'\end{longtable}',a)
    relation_rows=[]
    for name,fields in schemas.items():
        for f in fields:
            if f['reference']:
                relation_rows.append((name+'.'+f['name'],f['reference'],'可空' if f['nullable'] else '非空','子端唯一' if f['unique'] else '子端可多条'))
    row=lambda r:' & '.join(r'\Cell{'+t(x)+'}' for x in r)+r'\\[1pt]'
    s=s[:b]+'\n'.join(map(row,relation_rows))+'\n'+s[b:]
    # Replace only the old quarterly relational views; keep the system safeguard
    # view er_25 and the clinical conceptual models intact.
    a=s.index(r'\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/er_23.pdf}') if r'\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/er_23.pdf}' in s else s.index(r'\begin{figure}[H]\centering\includegraphics[width=\textwidth,height=.83\textheight,keepaspectratio]{figures/compensation_concept.pdf}')
    b=s.index(r'\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/er_25.pdf}',a)
    relations=[('er_compensation_months','激励月度底稿与不可覆盖的来源修订',[('R1','incentive_months ← doctor_financial_sources.month_id','1 / 0..*'),('R2','staff ← doctor_financial_sources.doctor_id','1 / 0..*')]),('er_23','季度基金、关闭月度来源与门诊业绩',[('R1','incentive_pools ← incentive_pool_sources.pool_id','1 / 0..*'),('R2','incentive_pools ← doctor_quarter_results.pool_id','1 / 0..*')]),('er_24','个人激励份额与凭据核实发放',[('R1','incentive_pools ← incentive_allocations.pool_id','1 / 0..*'),('R2','incentive_allocations ← incentive_payments.allocation_id','1 / 0..*')])]
    block=fig('compensation_concept','月度账证、季度基金与个人发放概念联系')
    block+=table('激励概念关系',['编号','业务联系','数量'],[('R1','月度底稿包含医生财务来源','1 / 0..*'),('R2','月度底稿被季度来源采用','1 / 0..*'),('R3','季度基金采用全部登记门诊三个自然月','1 / 3×C'),('R4','季度基金形成医生个人份额','1 / 0..*'),('R5','同医生各门诊业绩合并为个人份额','0..* / 1'),('R6','个人份额分次登记发放','1 / 0..*')],'comp_concept_rel',[1.2,10,3.7])
    for file,title,rows in relations:
        block+=fig(file,title)+table(title+'关联',['编号','外键联系','父/子对象数'],rows,file+'_relations',[1.2,10,3.7])
    s=s[:a]+block+s[b:]
    a=s.index(r'\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/er_6.pdf}') if r'\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/er_6.pdf}' in s else s.index(r'\begin{figure}[H]\centering\includegraphics[width=\textwidth,height=.83\textheight,keepaspectratio]{figures/er_6.pdf}')
    b=s.index(r'\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/er_7.pdf}',a)
    s=s[:a]+fig('er_6','员工身份、登录账号与门诊岗位关系')+table('员工与岗位关系',['编号','外键联系','父/子对象数'],[('R1','users ← staff.user_id','0..1 / 0..1'),('R2','users ← role_assignments.user_id','1 / 0..*'),('R3','clinics ← role_assignments.clinic_id','0..1 / 0..*')],'employee_identity_rel',[1.2,10,3.7])+s[b:]
    # Canonical staff key and quarterly result mapping in explanatory prose.
    s=s.replace('按dentist\\_\\allowbreak{}id求和的查询视图','按doctor\\_\\allowbreak{}id求和的查询视图')
    s=s.replace('doctor\\_\\allowbreak{}quarter\\_\\allowbreak{}results按医生×门诊×季度','doctor\\_\\allowbreak{}quarter\\_\\allowbreak{}results按基金快照×门诊×医生')
    s=s.replace('门诊经营有效期外的月份凭日期和范围证据排除','全部登记门诊的零业务月份明确复核关闭')
    lines=[]
    transaction_rows={
      '月度关账与迟到更正':('激励月度底稿与修订','incentive_months、doctor_financial_sources','期间事务序列锁及月份行锁；版本校验、不同账号与员工ID、医生覆盖和账证完整；源行修订追加，已引用月份保持锁定','冲突或缺项整体回滚；总部仅可重开无有效季度引用的月份，重开原因进入审计。'),
      '季度业绩及10\\%激励':('季度业绩及10%激励','基金、关闭来源、医生门诊结果及个人份额','全部登记门诊×三个自然月完整关闭；冻结source_revision；先合计正负净利再取10%，跨店后按正贡献分配至分，份额合计等于基金','缺项即拒绝。未批准且有误快照作废后重算；已批准来源保持锁定。'),
      '激励实际发放':('激励实际发放','incentive_payments及获批份额','支付触发器锁定份额并核对approved；唯一凭证交叉去重，成功与pending合计不得超过amount_cents','未知保持pending，明确failed才释放；终态与原始额度不可改写，记录不可删除。')}
    for line in s.splitlines():
        if '；季度范围逐月依据' in line:
            line=line[:line.index('；季度范围逐月依据')]+t('；激励季度范围包含全部登记门诊的三个自然月，停用或无业务门诊也须提供经复核的月度依据。')+r'\par'
        for prefix,values in transaction_rows.items():
            if line.startswith(r'\Cell{'+prefix+'}'):
                line=' & '.join(r'\Cell{'+t(v)+'}' for v in values)+r'\\[1pt]'
        line=line.replace('重大重开需独立批准并重建受影响季度结果','经营账务更正保留新依据；已批准激励采用的月报版本保持锁定，后续调整另附原来源')
        line=line.replace('总部制表与复核不能由同一自然人完成同一事项','总部制表与复核由不同责任人员承担，系统同时比较账号ID与员工ID')
        line=line.replace('不返回住址与出生日期','不返回员工号、电话、出生日期、家庭住址和电子邮箱')
        line=line.replace(r'同一users.\allowbreak{}staff\_\allowbreak{}id不得审批自己制单',r'同一staff.id不得审批自己制单')
        lines.append(line)
    s='\n'.join(lines)+'\n'
    # Remove old quarter-only index names/columns; output the real new indexes.
    s='\n'.join(line for line in s.splitlines() if not (line.startswith(r'\Cell{') and any(line.startswith(r'\Cell{'+t(n)+'}') for n in ['doctor_quarter_results','incentive_payments']) and '查询' not in line))+'\n'
    s='\n'.join(line for line in s.splitlines() if not line.startswith('激励月度查询利用'))+'\n'
    a=s.index(r'\subsection{查询、索引与数据访问方式}');b=s.index(r'\section{业务逻辑、接口与表示层}',a)
    old=s[a:b]
    note=t('激励月度查询利用incentive_month_period(month,clinic_id,status)；季度有效版本由incentive_one_live_quarter部分唯一索引保证；来源引用检索使用incentive_sources_month(month_id,pool_id)，付款汇总使用incentive_payments_allocation(allocation_id,status)。创建、关闭、重开及季度状态变更使用同一期间事务序列锁；付款触发器锁定个人份额并核对批准状态与累计占用。')+r'\par'+'\n'
    s=s[:b]+note+s[b:]
    p.write_text(s,encoding='utf-8')
    manifest=dict(schema='database/migrations/008_staff_compensation.sql',schemaSha256=hashlib.sha256(sql.encode()).hexdigest(),tables=schemas,fieldCount=sum(len(schemas[n]) for n in TABLES),staffFieldCount=len(staff),relations=relation_rows)
    (ROOT/'compensation-model.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'tables':len(TABLES),'fields':manifest['fieldCount'],'staffFields':len(staff)},ensure_ascii=False))

if __name__=='__main__':run()
