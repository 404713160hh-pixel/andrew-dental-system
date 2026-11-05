# 当前设计文档的可编辑 TeX 源

本目录为《安德鲁牙科系统设计文档》的当前可编辑源；main.tex 为主文件，figures 和 media 包含编译所需图形与校标。使用 XeLaTeX 在本目录至少运行两轮，直到目录、图录及交叉引用稳定。需要中文字体、ctex、longtable 等宏包。PDF 的修订内容以主文件为准。

员工与季度激励模型采用数据库迁移及共享接口中的实际命名。图文修订源为 `update_compensation_text.py`，字典同步源为 `sync_compensation_schema.py`，黑白矢量图源为 `compensation_figures.py`。如需重建该模块，依次运行这三个脚本，再编译TeX。图源需要ReportLab和Windows等线字体；字典脚本读取仓库的 `database/migrations/001_booking_core.sql` 至 `008_staff_compensation.sql`，生成 `compensation-model.json` 记录字段、外键及迁移哈希。

这组脚本仅替换员工及季度模块对应内容，保留当前预约章节；外部旧版整本生成器不作为本目录重建入口。
