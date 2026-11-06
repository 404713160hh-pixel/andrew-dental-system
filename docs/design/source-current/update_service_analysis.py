"""Update only chapters 5 and 6 in the shared, current TeX source."""
from pathlib import Path
import re

P = Path(__file__).resolve().parent / 'main.tex'

def replace_rows(block, rows):
    for key, value in rows.items():
        pattern = r'^\\Cell\{' + re.escape(key) + r'\} & \\Cell\{[^\n]*$'
        replacement = r'\Cell{' + key + r'} & \Cell{' + value + r'}\\[1pt]'
        block, n = re.subn(pattern, lambda m: replacement, block, flags=re.M)
        if n != 1: raise ValueError(f'Expected one row {key}: {n}')
    return block

def apply():
    latest = P.read_text(encoding='utf8')
    a = latest.index(r'\section{领域分析')
    c6 = latest.index(r'\section{', a+12)
    b = latest.index(r'\section{', c6+12)
    body = latest[a:b]
    body = body.replace('患者、牙医、资格和治疗目录是持续存在的业务对象', '患者、牙医、展示特长和治疗目录是持续存在的业务对象')
    body = body.replace('患者—过敏原、医生—资格','患者—过敏原、医生—展示特长')
    body = body.replace('关联本身有核对、有效期或证据，使用显式关联对象。','过敏关联保存核对情况，医生特长关联保存展示信息，均使用显式关联对象。')
    body = body.replace('只有取得临床授权才可签署。','本次接诊任务和岗位权限决定谁可签署。')

    data = {
        '02': ('维护牙医档案与展示特长', '边界：医生资料页；控制：医生资料控制。', {
            '签名':r'save\allowbreak{}Doctor\allowbreak{}Profile(\allowbreak{}doctor\allowbreak{}Id,\allowbreak{} profile,\allowbreak{} specialties,\allowbreak{} expected\allowbreak{}Version)',
            '输入':'医生基本资料、必要人事信息、对外简介和展示特长',
            '执行前检查':'办理人具有医生档案维护权限；员工号唯一；医生仅提交本人资料',
            '成功结果':'医生资料与展示特长保存，患者查询只返回公开资料',
            '领域算法':'按员工号定位医生并核对版本，校验必填资料和展示文字后保存；所有医生可开展目录内全部项目，特长不参与排班或预约准入判断。',
            '数据访问':r'医生仓储保存staff及医生特长关联；公开查询只投影姓名、简介、特长与出诊信息，必要人事资料不进入患者接口。',
            '事务与并发':'医生档案、展示特长和变更记录一起提交；旧版本修改提示重新读取。',
            '失败及恢复':'员工号重复提示沿用既有档案；必填项缺失返回具体字段；版本冲突保留输入并重新核对。',
            '界面':'基本资料、人事信息、公开简介和特长分别展示；保存前可预览患者可见内容。',
            '接口':r'GET /\allowbreak{}doctors查询公开资料；POST、PUT /\allowbreak{}staff/\allowbreak{}doctors维护医生档案与展示特长。',
            '验收场景':r'1.\allowbreak{} 医生展示种植特长→仍可预约洁牙等全部目录项目。\\2.\allowbreak{} 修改或删除特长→已有班次和预约继续有效。\\3.\allowbreak{} 患者查询→不返回住址、出生日期和人事联系方式。',
        }),
        '03': (None,None,{
            '接口':r'GET /\allowbreak{}services查询项目；POST、PUT /\allowbreak{}staff/\allowbreak{}services维护内容、时长、计价单位和价格；GET /\allowbreak{}treatment-\allowbreak{}references提供独立的治疗参考价。',
        }),
        '04': (None,None,{
            '签名':r'publish\allowbreak{}Dentist\allowbreak{}Shift(\allowbreak{}dentist\allowbreak{}Id,\allowbreak{} clinic\allowbreak{}Id,\allowbreak{} interval,\allowbreak{} expected\allowbreak{}Version)',
            '输入':'医生、门诊、出诊起止时间和转场规则版本',
            '成功结果':'发布不重叠且满足营业时间与治疗位条件的出诊班次',
            '领域算法':'按医生读取全连锁班次，核对在职、出诊门诊、时间重叠及相邻异店转场间隔；再检查本店营业和治疗位条件。所有医生均可提供全部项目，特长不参与发布检查。',
            '数据访问':r'排班仓储按医生和时间查询doctor\_\allowbreak{}shifts及资源占用；受影响的原预约保留并列入协调任务。',
            '失败及恢复':'时间重叠或转场间隔不足时不发布；缩班影响预约时先协调，不能删除原预约事实。',
            '界面':'按日期查看医生跨店出诊时间，冲突直接标明门诊、时间或转场原因。',
            '接口':r'GET /\allowbreak{}shifts查询排班；POST /\allowbreak{}staff/\allowbreak{}shifts发布班次；POST /\allowbreak{}staff/\allowbreak{}shifts/\allowbreak{}\{id\}/\allowbreak{}cancel撤销班次。服务端检查门诊权限、跨店时间与资源。',
        }),
        '05': ('查询可预约时段','边界：小程序预约页；控制：号源查询控制。',{
            '输入':'患者选择的门诊、项目、医生和日期',
            '成功结果':'返回所选医生在该门诊能容纳项目时长的可预约时间，查询不占用号源',
            '领域算法':'读取项目预约时长和所选医生已发布班次，排除已有预约、暂占与停用时间，得到连续空档；医生特长随资料展示，不用于过滤项目。',
            '数据访问':'号源查询服务直接读取项目时长、医生班次和占用索引，返回候选时间与版本，不装载其他患者资料。',
            '失败及恢复':'没有可用时间则提示更换日期或医生；日期范围过大则要求缩小范围。',
            '界面':'患者依次选择门诊、项目、医生和时间；医生卡片展示特长，选中时间后进入预约确认页。',
            '验收场景':r'1.\allowbreak{} 医生特长与所选项目不同→仍返回其可用时间。\\2.\allowbreak{} 项目需要45分钟、空档仅30分钟→不返回该时间。\\3.\allowbreak{} 时间已被别人确认→刷新可选时间，不重复承诺。',
        }),
        '06': (None,None,{
            '领域算法':'按请求键查询已有处理结果；按固定顺序锁定患者、医生和治疗位，重新核对班次、项目时长及空档；条件满足时一起保存预约、占用与回执。',
        }),
        '10': (None,None,{
            '执行前检查':'当前医生承担本次接诊任务；患者身份和风险资料已核对',
            '失败及恢复':'过敏或其他风险尚未解决时保留评估；阶段依赖形成循环时返回具体路径，医生修订后再保存。',
            '接口':r'POST /\allowbreak{}visits/\allowbreak{}\{id\}/\allowbreak{}assessments；POST /\allowbreak{}treatment-\allowbreak{}plans及计划版本接口。医生身份由登录会话和本次接诊任务确定。',
        }),
        '12': (None,None,{
            '执行前检查':'当前医生承担本次接诊；具体项目已确认，过敏处理和阶段条件已满足',
        }),
        '23': ('查看预约原因、到诊与排班统计','边界：预约排班统计页；控制：预约排班统计控制。',{
            '签名':r'get\allowbreak{}Appointment\allowbreak{}Summary(\allowbreak{}scope,\allowbreak{} period)\allowbreak{}:\allowbreak{} Report',
            '输入':'门诊、医生、日期范围；查看排班时另选未来日期范围',
            '执行前检查':'店长或总部具有所选门诊的数据查看权限',
            '成功结果':'显示取消与改期原因分类数量、预约数、实际到诊数以及医生排班概览',
            '领域算法':'读取日期范围内的取消和改期事件，按原因分类计数；有效预约和实际到诊按门诊、医生、计划日期汇总，改期旧安排保留历史但不重复计算有效预约。未来排班按医生和出诊时间列示。',
            '数据访问':'预约事件仓储读取原因与变更时间；就诊仓储读取实际到诊；排班仓储读取已发布班次。查询在授权门诊和日期范围内完成。',
            '事务与并发':'只读一致快照，显示数据更新时间；不通过统计页面改写原预约或到诊事实。',
            '失败及恢复':'没有记录显示0条；原因尚未登记列为未填写，到诊结果待核实则单列待核实，不猜测为取消或已到诊。',
            '界面':'原因分类表、每日预约与到诊数量、医生排班日历；店长可从日历进入排班维护。',
            '接口':r'GET /\allowbreak{}reports/\allowbreak{}appointments查询原因及到诊统计；GET /\allowbreak{}shifts查询未来排班。',
            '验收场景':r'1.\allowbreak{} 两笔取消分别写明临时有事和时间冲突→分别计入对应原因。\\2.\allowbreak{} 原预约改至下周→本周旧安排保留改期原因，新安排在下周计为有效预约。\\3.\allowbreak{} 尚未核实到诊→显示待核实，不记为已到诊。\\4.\allowbreak{} 同一医生跨店出诊→日历显示各门诊及准确时间。',
        }),
    }
    for uc,(title,lead,rows) in data.items():
        pattern=r'\\subsubsection\{UC-'+uc+r'[^}]*\}.*?(?=\\subsubsection\{|\\section\{)'
        m=re.search(pattern,body,re.S)
        if not m:raise ValueError('Missing UC-'+uc)
        block=m[0]
        if title:block=re.sub(r'\\subsubsection\{[^}]*\}',lambda _:r'\subsubsection{UC-'+uc+' '+title+'}',block,count=1)
        if lead:block=re.sub(r'^边界[^\n]*',lambda _:lead+r'\par',block,count=1,flags=re.M)
        block=replace_rows(block,rows)
        if uc=='23':
            block=block.replace('内部分析序列（1/2）','取消改期原因与到诊统计（1/2）').replace('内部分析序列（2/2）','医生排班概览（2/2）')
        body=body[:m.start()]+block+body[m.end():]
    body=body.replace('满足相应条件后核对技能、日期、时长和资源冲突','满足相应条件后核对日期、时长和资源冲突')
    body=body.replace('不把岗位授予等同技能认证','岗位和门诊范围分别校验')
    body=body.replace('接续人资格可验证','接续人具有对应岗位与任务权限')
    body=body.replace('逐项校验接续人范围和资格','逐项校验接续人门诊范围和任务权限')
    body=body.replace('无合资格接续人','没有可承担任务的接续人')
    body=body.replace('权重为max(跨店净利,0)，最大余数分配，同余按员工编号及ID。','个人按正净贡献占比分配；先按分取整，剩下的分值依小数余数从大到小补给个人，相同则按员工编号及ID，保证合计等于基金。')
    body=body.replace('按最大余数法处理到分尾差后，甲6045.\\allowbreak{}45元、乙3454.\\allowbreak{}55元，合计9500.\\allowbreak{}00元。','计算时先保留整分：甲6045.\\allowbreak{}45元，乙3454.\\allowbreak{}54元，合计比基金少1分钱。乙的小数余数较大，这1分钱给乙，所以乙最终为3454.\\allowbreak{}55元，两人合计正好为9500.\\allowbreak{}00元。')
    body=body.replace('基金比例、总基数、个人权重、尾差以及获批版本都保存。','基金比例、利润合计、个人占比、补分顺序以及获批版本都保存，以便重新核对个人金额及其合计。')
    start=re.search(r'\\subsection\{(?:取消率与技能供需|取消改期原因、到诊与排班概览)\}',body).start()
    body=body[:start]+r'''\subsection{取消改期原因、到诊与排班概览}
患者取消或改期时填写原因，系统保留原预约、变更时间及新安排。店长按日期和门诊查看原因分类数量，识别需要联系患者或调整出诊时间的情况；改期失败时仍保留原预约，不释放原时段。\par
到店后由前台核对预约和就诊人，登记实际到诊时间。统计页面分别显示有效预约、实际到诊及待核实数量；未来排班显示医生、门诊和出诊时间。所有医生均可开展全部目录项目，特长帮助患者选医生。\par
\Needspace{9\baselineskip}
\Needspace{9\baselineskip}
'''
    body=body.replace('上表是算法示例，不是价格目录或临床建议。','')
    body=body.replace('同一就诊重复请求开单时返回同一结算单身份；费用差错以关联调整记录更正，不能通过再建一张同次就诊单规避唯一性。','同一就诊重复请求开单时返回同一结算单；费用差错追加关联调整记录。')
    body=body.replace('示例用于检验算法，不是机构经营数据。','')
    body=body.replace('医生只能查看本人明细，总部复核人可以下钻来源但不因此获得全部临床记录。','医生查看本人明细，总部复核人核对月度来源。')
    body=body.replace('专长','特长')
    body=body.replace('分析实体类图','分析类图')
    # Read again just before writing so concurrent changes outside this slice survive.
    current=P.read_text(encoding='utf8')
    aa=current.index(r'\section{领域分析');cc=current.index(r'\section{',aa+12);bb=current.index(r'\section{',cc+12)
    P.write_text(current[:aa]+body+current[bb:],encoding='utf8')
    print('Updated chapters 5 and 6 only.')

if __name__=='__main__':apply()
