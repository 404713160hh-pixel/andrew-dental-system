# 当前设计文档的可编辑 TeX 源

本目录为《安德鲁牙科系统设计文档》的当前可编辑源；main.tex 为主文件，figures 和 media 包含编译所需图形与校标。使用 XeLaTeX 在本目录至少运行两轮，直到目录、图录及交叉引用稳定。需要中文字体、ctex、longtable 等宏包。PDF 的修订内容以主文件为准。

正文直接维护在 `main.tex`，编译PDF只需运行XeLaTeX。预约及接待图源为 `service_flow_figures.py`，相应详细设计的编辑脚本为 `update_service_analysis.py`；季度及员工图源为 `compensation_figures.py`。图源使用ReportLab和Windows等线字体，图表采用黑白矢量格式。

`sync_compensation_schema.py`用于结构变更后的季度及员工字段同步，读取 `database/migrations/001_booking_core.sql` 至 `008_staff_compensation.sql`，输出字典及 `compensation-model.json`。`update_compensation_text.py`保留该同步工具使用的TeX排版函数；业务正文以当前 `main.tex` 为准。
