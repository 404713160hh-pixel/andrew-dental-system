"""One-time, bounded revision of the current TeX compensation sections.

Run before the schema dictionary synchronizer. Does not rebuild the book from
the older external design inputs and therefore preserves the booking revisions.
"""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent

def t(s):
    escaped={'\\':r'\textbackslash{}','&':r'\&','%':r'\%','#':r'\#','$':r'\$','_':r'\_\allowbreak{}','{':r'\{','}':r'\}','\n':r'\\','/':r'/\allowbreak{}','→':r'→\allowbreak{}'}
    return ''.join(escaped.get(c,c) for c in str(s))

def table(caption,heads,rows,label,widths=None):
    widths=widths or ([2.4,12.7] if len(heads)==2 else [3.5,5.0,6.4])
    spec='@{}'+('@{\\hspace{0.16cm}}'.join('p{'+str(w)+'cm}' for w in widths))+'@{}'
    row=lambda a:' & '.join(r'\Cell{'+t(x)+'}' for x in a)+r'\\[2pt]'
    head=' & '.join(r'\bfseries \Cell{'+t(x)+'}' for x in heads)+r'\\\midrule'
    return '\n'.join([r'{\fontsize{10.5pt}{13.2pt}\selectfont\setlength{\tabcolsep}{0pt}\renewcommand{\arraystretch}{1.08}',r'\begin{longtable}{'+spec+'}',r'\caption{'+t(caption)+r'}\label{'+label+r'}\\',r'\toprule',head,r'\endfirsthead',r'\toprule',head,r'\endhead',r'\bottomrule\endlastfoot',*[row(r) for r in rows],r'\end{longtable}','}'])+'\n'

def fig(file,caption):
    return r'\begin{figure}[H]\centering\includegraphics[width=\textwidth,height=.83\textheight,keepaspectratio]{figures/'+file+r'.pdf}'+'\n'+r'\caption{'+t(caption)+r'}\label{'+file+r'}\end{figure}'+'\n'

NAMES={19:'登记医生月度账证汇总',20:'独立复核月度底稿并关闭',21:'计算医生季度业绩及10%激励基金',22:'审批激励、登记发放及本人查询'}
CASES={
19:dict(actors='总部、所属门诊店长',trigger='月份结束，制表人员整理已核对的医生收入、用品成本和运营费用。',pre='经办人具备有效员工档案和门诊授权；月份已经结束，三类金额均有账证依据。',post='生成或更新仅属于本门诊本月份的草稿，逐医生保留三类金额及来源；修订保留旧行历史。',steps=[
('1','选择门诊和自然月，填写汇总账证编号或核对说明。'),('2','逐医生录入服务收入净额、医疗用品成本、运营费用及各自来源编号。'),('3','系统检查门诊范围、医生身份、金额精度及来源必填项。预约标价和预约数量不作为收入凭据。'),('4','如确实无业务，明确选择无业务并填写依据，系统继续核对当月医生覆盖。'),('5','系统以版本校验保存草稿与来源修订，页面显示已保存版本、合计和待补项。'),('3a','[来源缺失、门诊越权、医生无效或版本冲突] 拒绝保存，保留输入并说明具体缺项。'),('5a','[月份已关闭或草稿不属于本人] 禁止直接覆盖；由总部按重开规则处理。')],fields=[('门诊、自然月','UUID、YYYY-MM；同组合唯一','确定月度核算范围'),('账证依据、无业务声明','必填编号或说明；无业务仍需明确依据','区分已核验零业务和未填报'),('医生财务行','医生ID、三类整数分金额及三类来源','跨店采用稳定员工身份'),('expectedVersion','正整数；创建之外的修改必填','防止旧页面覆盖新底稿')],rules=[('业务规则','收入按已提供服务及有效费用调整确认，付款和预收与收入区分；用品成本按实际耗用，运营费用按已核对归属金额录入。共同费用先在账证底稿中按固定制度分摊，保留动因依据，不在季度页面临时改变权重。'),('质量与权限','仅总部和所属门诊店长可制表；草稿由原制表人修订。金额使用整数分，负数调整附原来源与调整依据；每次保存写审计并保留行修订。')]),
20:dict(actors='总部、所属门诊店长',trigger='另一名具备该门诊权限的人员完成账证复核，申请关闭月度底稿。',pre='月度底稿为草稿且版本匹配；制表人与复核人的账号ID、员工ID均不同，双方员工档案有效。',post='关闭版本固定制表、复核身份及医生来源；有效季度引用期间保持锁定。',steps=[('1','复核人查看月份、总依据、各医生三类金额及来源，核对当月已发布出诊医生。'),('2','系统检查资料完整、医生覆盖及复核岗位；无业务也必须有明确依据。'),('3','复核人提交关闭及期望版本，系统锁定底稿并再次校验全部条件。'),('4','通过后保存closed、复核员工及关闭时间，记录审计。'),('5','需要更正时，由总部填写原因请求重开；系统检查是否被有效季度快照引用。'),('6','无有效季度引用才恢复草稿；之后重新保存、独立复核并关闭。'),('2a','[缺来源、漏出诊医生、制表复核身份相同或版本冲突] 拒绝关闭并给出原因。'),('5a','[已被有效季度引用] 拒绝重开；未批准季度可先作废，再按关闭规则修订和重新生成。')],fields=[('月度底稿号、状态','UUID；draft/closed','关闭的具体对象'),('制表与复核身份','各自账号ID和员工ID','同账号或同员工不能自审'),('医生覆盖','该月发布出诊医生与来源行集合','防止遗漏医生后仍关闭'),('重开原因与引用检查','总部填写原因；检查有效季度来源','保持季度快照稳定')],rules=[('业务规则','正式关闭采用已经核对的收入成本账证，未收清应收不等同缺收入。草稿、关闭和重开均校验版本；关闭后不允许覆盖来源。'),('权限与恢复','总部或所属店长可独立关闭，重开仅限总部。已批准季度的来源锁定；待核实发放不因页面刷新被当作失败。')]),
21:dict(actors='总部',trigger='自然季度已经结束，全部登记门诊的三个自然月底稿均已关闭。',pre='总部制表人有有效员工档案；服务端确定完整门诊与月份集合，不接受调用者选择部分来源。',post='同事务固化季度、月度来源及关闭版本、医生门诊业绩和跨店个人份额，形成可复算草稿。',steps=[('1','总部选择YYYY-Q1至YYYY-Q4季度并填写核算依据。'),('2','系统列出全部登记门诊与三个自然月；停用门诊也必须明确提交有依据的零业务或实际业务底稿。'),('3','逐一锁定并核验关闭来源，任何缺失或未关闭均停止生成。'),('4','按医生和门诊固化收入、用品成本、运营费用与净利润，再按同一员工身份跨店合并。'),('5','先合计全体医生的正负净利润，以合计正部的10%四舍五入至分形成基金。'),('6','按跨店后正净贡献比例分配基金，使用最大余数法补齐余分；同余按员工编号、医生ID稳定排序。'),('7','核对个人份额合计等于基金后，原子保存来源、门诊明细、份额和规则版本。'),('3a','[任一门诊月份缺失、未关闭、版本无效] 不生成部分季度，显示需补齐组合。'),('5a','[全体净利润合计不大于零] 基金为零，保留亏损明细与零份额，不生成付款。')],fields=[('季度、核算依据','YYYY-Qn及必填来源说明','固定完整自然季度'),('月度来源集合','全部登记门诊×三个自然月及关闭版本','无业务必须明确确认'),('医生门诊业绩','三类金额及有符号净利润；整数分','追溯跨店贡献及亏损'),('基金、个人份额','非负整数分、规则版本及余数顺位','10%提取与分配守恒')],rules=[('业务规则','净利润=收入净额-用品成本-运营费用。基金=四舍五入到分[max(0,全部医生净利润合计)×10%]；不能先把每位医生亏损截为零。股权60%/40%不参与激励分配。'),('事务与质量','来源、医生门诊结果及个人份额一次提交。金额使用BigInt计算，跨店后正贡献作为个人权重。零业务也必须已核对关闭，缺失不视为零。')]),
22:dict(actors='总部；员工查看本人已批准份额',trigger='总部提交季度草稿申请批准，或登记已批准份额的发放及核实结果。',pre='季度来源有效，草稿和提交状态符合操作；批准者有有效总部岗位，且账号ID和员工ID均不同于制表者。',post='批准固定个人额度；每笔发放保留待核实、成功或失败及凭证，成功与待核实占用合计不超批准份额；本人查询不返回其他员工数据。',steps=[('1','制表人核对季度草稿并提交，系统固定submitted版本。'),('2','另一名总部人员逐项核对月度来源、负贡献、基金公式及个人份额后请求批准。'),('3','系统检查岗位、不同账号和员工身份、版本与来源；通过才保存approved及批准员工。'),('4','总部选择获批个人份额，录入金额与全局唯一付款凭证，系统锁定份额后检查剩余额度。'),('5','系统登记pending，金额立即占用可发额度；这一登记不表示银行已经支付成功。'),('6','经办人员核实实际银行凭据后，登记succeeded或failed；未知结果保持pending并继续查原凭证。'),('7','员工在本人页面查看已批准份额、成功与待核实金额、失败记录和剩余额度。'),('2a','[复核不同意或来源有误] 不批准；总部作废尚未批准的快照后重新生成，旧版本保留。'),('4a','[重复凭证、额度不足、季度未批准或版本冲突] 拒绝登记，不留部分额度占用。'),('7a','[账号未关联员工档案或本人没有获批份额] 返回空列表及关联说明，不按姓名推测身份。')],fields=[('季度状态','draft/submitted/approved/voided','区分生成、送审、批准与作废'),('批准身份','有效总部账号及员工ID','按不同账号和员工阻止自审'),('发放金额、凭证','正整数分、全局唯一凭证','控制重复登记与可发余额'),('发放状态','pending/succeeded/failed、版本','未知保持pending；明确失败才释放占用')],rules=[('业务规则','个人份额在生成季度时按统一规则固定，复核页不能改权重。仅approved可登记发放；成功与pending金额合计不得超过批准额度。外部银行付款由经办人员核实后记录，系统保存凭据和状态。'),('查询与隐私','总部查看授权核算资料，店长限所属门诊月报，普通员工仅查询本人已批准份额及发放。财务来源和金额不进入公开医生资料接口。')])}

def usecase(n):
    c=CASES[n];p='comp_uc'+str(n)
    out=r'\subsection{UC-'+str(n)+' '+t(NAMES[n])+'}\n'
    out+=table('UC-'+str(n)+'用例约定',['项目','内容'],[(k,c[v]) for k,v in [('执行者','actors'),('触发','trigger'),('前置条件','pre'),('成功后置条件','post')]],p+'_spec')
    out+=table('UC-'+str(n)+'基本与扩展流程',['步骤','事件、响应及分支'],c['steps'],p+'_steps',[1.4,13.7])
    out+=table('UC-'+str(n)+'关键字段',['字段','类型与限制','业务含义'],c['fields'],p+'_fields')
    out+=table('UC-'+str(n)+'业务规则与质量',['类别','约定'],c['rules'],p+'_rules')
    return out

DETAIL={
19:[('操作','saveMonth(input, expectedVersion)：创建或保存本人月度草稿'),('输入与校验','clinicId、month、reference、noActivity、医生三类金额及三类来源；服务端校验月份已结束、岗位门诊范围、医生身份和整数分。'),('数据与事务','锁定同门诊月份底稿；新增或修订doctor_financial_sources并保留旧修订，更新版本和审计；关闭状态禁止保存。'),('失败处理','来源不足、越权、非本人草稿、版本冲突均整体回滚。'),('界面与接口','月度账证页提供逐医生三类金额、依据、无业务声明及合计。GET/POST /compensation/months；PUT /compensation/months/{id}。'),('验收','同一医生跨两店保留两店来源；引用预约标价不得伪装实际收入；两人同时编辑旧版本，仅有效版本保存。')],
20:[('操作','closeMonth(id, expectedVersion)；reopenMonth(id, expectedVersion, reason)'),('关闭算法','锁定月份；核对draft状态、账证完整、出诊医生覆盖及有效门诊授权；复核者账号ID和staff.id均不同于制表者才固定closed。'),('重开算法','仅总部可重开。先检查incentive_pool_sources是否存在有效季度引用，存在即拒绝；未被引用的关闭月份可附原因重开，保持历史修订。'),('数据与并发','月份行锁和季度来源引用校验与状态、版本、审计在同一事务；季度生成也锁定被采用月份，避免关闭检查后来源被并发重开。'),('界面与接口','独立人员打开月度详情核对后关闭；重开附原因。POST /compensation/months/{id}/close；POST /compensation/months/{id}/reopen。'),('验收','同账号或同staff.id复核均被拒绝；漏出诊医生不能关闭；有效季度引用月份不能重开；无业务缺依据不能以零代替。')],
21:[('操作','createQuarter({quarter, reference})：生成完整季度快照'),('来源完整性','服务端按全部登记门诊×三个自然月读取已关闭底稿，包括停用门诊；不接收部分门诊列表或部分月份替代完整范围。'),('金额算法','按医生门诊汇总三类来源，再以staff.id跨店合并。采用BigInt，先合计含负数净利，再提取10%；权重为max(跨店净利,0)，最大余数分配，同余按员工编号及ID。'),('数据与事务','固定incentive_pools、incentive_pool_sources、doctor_quarter_results和incentive_allocations，保存采用的月度关闭版本与规则。事务失败无部分基金。'),('界面与接口','季度页展现来源覆盖、门诊展开、医生跨店合计及基金、份额。GET/POST /compensation/quarters；GET /compensation/quarters/{id}。'),('验收','甲12000元、乙-2000元，基金1000元；同一医生跨店先合并再取正权重；缺一个门诊月份必须拒绝；零业务也需有效关闭底稿。')],
22:[('操作','submitQuarter；approveQuarter；voidQuarter；createPayment；resolvePayment；myCompensation'),('批准与作废','submit将draft变为submitted；独立总部人员按expectedVersion批准。不同账号但同staff.id同样拒绝。未批准快照可附原因作废后重算，approved来源保持锁定。'),('额度算法','锁定获批份额，累计succeeded与pending，剩余额度=批准额-成功额-待核实额；本次金额不得超余额。凭证全局唯一，失败整笔回滚。'),('核实与查询','新记录为pending。实际核实后按版本转succeeded或failed，未知保持pending。本人查询从会话staff.id筛选approved份额，未关联身份返回空列表。'),('数据与事务','季度、份额及发放行锁保护状态和可发额度；状态变更及审计一起提交。银行查证在系统外进行，系统只登记核验后的凭证状态。'),('接口','POST /compensation/quarters/{id}/submit、/approve、/void；POST /compensation/allocations/{id}/payments；POST /compensation/payments/{id}/resolve；GET /compensation/me。'),('验收','同员工不同账号不能自审；并发发放两笔合计超额仅允许额度内记录；pending不释放额度，failed释放；普通员工只能查本人已批准份额。')]
}

def internal(n):
    out=r'\subsubsection{UC-'+str(n)+' '+t(NAMES[n])+'}\n'
    out+='边界负责呈现与输入；薪酬应用服务检查会话、门诊范围、版本并组织事务，实体维护月份、季度、份额和发放状态。\\par\n'
    out+=fig('class_UC_'+str(n),'UC-'+str(n)+' 分析实体类图')
    out+=fig('seq_UC_'+str(n),'UC-'+str(n)+' 内部分析序列'+('（1/2）' if n in [20,22] else ''))
    if n==20:out+=fig('seq_UC_20_reopen','UC-20 总部重开与季度引用检查（2/2）')
    if n==22:out+=fig('seq_UC_22_payments','UC-22 发放占额与实际结果核实（2/2）')
    out+=table('UC-'+str(n)+'详细操作与表示设计',['项目','详细设计'],DETAIL[n],'comp_uc'+str(n)+'_detail')
    return out

def run():
    p=ROOT/'main.tex';s=p.read_text(encoding='utf-8')
    old={19:'归集医疗用品成本和医生运营费用',20:'复核经营期间并关账',22:'复核激励分配并登记发放'}
    for n,name in old.items(): s=s.replace(name,NAMES[n])
    start=s.index(r'\subsection{UC-19 ');end=s.index(r'\subsection{UC-23 ',start)
    s=s[:start]+''.join(usecase(n) for n in range(19,23))+s[end:]
    start=s.index(r'\subsubsection{UC-19 ');end=s.index(r'\subsubsection{UC-23 ',start)
    s=s[:start]+''.join(internal(n) for n in range(19,23))+s[end:]
    start=re.search(r'\\begin\{figure\}\[H\]\\centering\\includegraphics\[[^\]]*\]\{figures/st_quarter.pdf\}',s).start()
    end=s.index(r'\subsection{内部协作与操作契约}',start)
    state_rows=[('月度底稿','draft→closed','来源与出诊医生覆盖完整，独立复核通过；版本不符或自审拒绝。'),('月度底稿','closed→draft','总部附原因重开，且没有有效季度引用。'),('季度基金','draft→submitted→approved','完整来源生成草稿，提交后由不同账号及不同员工的总部人员批准。'),('季度基金','draft/submitted→voided','未批准快照可作废并留原因，随后重新生成；已批准不允许作废或重开来源。'),('发放记录','pending→succeeded/failed','依据实际核实结果登记；未知继续pending，占用额度；明确失败才释放。')]
    s=s[:start]+fig('st_quarter','月度账证、季度基金与发放状态')+table('激励核算状态与转移约定',['对象','状态转移','事件、条件与动作'],state_rows,'comp_state',[2.5,4.2,8.2])+s[end:]
    # Replace the API summary rows with the actual shared service contract.
    apis={19:'GET/POST /compensation/months；PUT /compensation/months/{id}',20:'POST /compensation/months/{id}/close；POST /compensation/months/{id}/reopen',21:'GET/POST /compensation/quarters；GET /compensation/quarters/{id}',22:'POST /compensation/quarters/{id}/submit、/approve、/void；POST /compensation/allocations/{id}/payments；POST /compensation/payments/{id}/resolve；GET /compensation/me'}
    for n,api in apis.items():
        s=re.sub(r'\\Cell\{\\mbox\{UC-'+str(n)+r'\}\} & \\Cell\{[^\n]*',lambda m:r'\Cell{\mbox{UC-'+str(n)+r'}} & \Cell{'+t(api)+r'。}\\[1pt]',s)
    # Explicitly describe verified ledger inputs rather than implying invoice
    # harvesting or appointment-price revenue in the implemented quarter path.
    s=s.replace('总部按医生跨店归集季度收入、医疗用品成本及运营费用，计算净利润，并按10\\%提取激励基金。','总部以独立复核关闭的月度账证汇总为来源，按医生跨店归集季度收入、医疗用品成本及运营费用，计算净利润，并按10\\%提取激励基金。')
    s=s.replace('医生运营费用；收入来自已签署且已出具账单的实际执行及有效调整，不以收清、收款人或开单人归属。','医生运营费用；收入依据已核对服务及有效调整账证，不以收清、收款人或开单人归属。')
    s=s.replace('原始季度结果','原季度结果')
    # Keep the adopted mathematical example, while replacing its source-control
    # subsection to match month closure and immutable quarter snapshots.
    previous=r'\subsection{成本分摊与关账}'
    a=s.index(previous if previous in s else r'\subsection{账证归集与月度独立复核}');b=s.index(r'\subsection{季度净利润与10\%基金}',a)
    s=s[:a]+r'\subsection{账证归集与月度独立复核}'+'\n'+t('医生月度账证汇总按门诊和自然月登记收入净额、医疗用品成本及运营费用，并逐类保存来源编号。共同费用先按经批准的制度在账证底稿中归属医生，季度核算不临时改变分摊规则。预约项目的参考价格和预约数量不自动形成服务收入；预收款与实际收入分别核对。')+r'\par'+'\n'+t('月度草稿由原制表人修订并保留历史来源行；不同账号且不同员工的授权人员检查三类来源和当月出诊医生覆盖后关闭。全部登记门诊都进入季度来源范围，停用或无业务门诊也明确提交零业务依据。总部重开月份须写原因，已被有效季度快照引用的月份保持锁定。')+r'\par'+'\n'+t('季度快照固定全部门诊三个自然月的关闭版本、医生门诊明细和个人份额。未批准且有误的快照先作废再重新生成；批准后的额度及其来源保持稳定。发放登记先占用额度，实际查证结果明确为成功或失败，未知结果继续待核实。')+r'\par'+'\n'+s[b:]
    s=s.replace('60\\%/\\allowbreak{}40\\%股权比例不参与激励计算。','60\\%/\\allowbreak{}40\\%股权比例不参与激励计算。')
    # Employee portal paragraph, not implementation-control wording in UI.
    needle=r'\subsection{员工工作台与组件}'
    pos=s.index(needle)+len(needle)
    paragraph='\n'+t('员工工作台设置“薪酬与激励”。总部按月登记账证、查看完整季度来源、生成和提交基金快照，由另一名已关联员工身份的总部人员批准后登记发放；店长管理所属门诊月度底稿。每名员工通过本人入口查询已批准季度份额、付款状态及余额。员工档案与账号关联采用唯一员工号，财务金额不进入公开医生展示。')+r'\par'+'\n'
    if '员工工作台设置“薪酬与激励”' not in s:s=s[:pos]+paragraph+s[pos:]
    # Uniform natural-person assertion replaced with the actual identity checks.
    s=s.replace('按自然员工实施制审分离。','以有效员工档案、不同账号ID和不同员工ID实施制审分离。')
    s=s.replace('审批按自然员工分离','审批校验不同账号及不同员工ID')
    s=s.replace('所有审批与实际发放检查有效岗位、任务、门诊和自然员工','所有审批与实际发放检查有效岗位、任务、门诊和员工身份')
    p.write_text(s,encoding='utf-8')

if __name__=='__main__':run()
