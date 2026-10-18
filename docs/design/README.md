# 设计文档与可编辑图源

本设计使用 csu-word-report 和 csu-academic-report 两个技能，分别生成可编辑Word与XeLaTeX/PDF。模型与源码核对截至2026-10-18，排版及发布收尾于2026-10-19。Word和PDF使用同一内容模型，分页随排版引擎不同。

- 完整正文：愿景、调研、现状与改进业务序列、四角色权限、24份用例规约、分析类图与序列、状态机、架构、数据库、事务、安全、部署和测试追溯。
- 图集：28张图，其中六张物理ER分图覆盖38表；字段字典296项，58组DDL外键，区分逻辑引用。
- Word目录、图录、SEQ/REF与页码保留为可更新域，已由Windows Word更新保存。嵌入图形为图片，SVG图源可分别编辑。

## 源文件

source/body.json为统一内容模型；data/usecases.json和traceability.json为用例和追溯；data/schema/schema_inventory.json为内存DDL核对结果。figures/含可编辑SVG、矢量PDF及PNG。latex/main.tex及其media/、figures/是自包含TeX工程。template/保留本次使用的两个技能说明和必要模板/生成工具，未包含个人档案规则。

## 重建

在Python环境安装python-docx、Pillow、ReportLab、pypdfium2、lxml。已有body.json时运行 python build_report.py；Word另用template/csu-word-report/scripts/update_fields.ps1更新域并保存。TeX进入latex目录，以XeLaTeX编译main.tex至少两轮，确认目录和交叉引用稳定。TeX字体有Windows宋体和其他CJK字体回退。

更新内容时修改data中的材料及build_content.py，再运行 python build_content.py 和 python build_report.py。图形重建脚本build_diagrams.py和data/schema/build_schema_figures.py当前使用Windows等线字体路径，其他系统需指定等效字体；已嵌入字体的PDF图源可直接用于编译，不必重画。

应用的本地测试历史截止2026-10-15，后续GitHub发布、Actions执行和上线状态以仓库README与Actions为准。源码包含合成演示账号，正式实例必须使用独立空库、关闭示例数据，并重新分配口令。人工收退款不是外部支付接入，文档不代表临床生产验收。
