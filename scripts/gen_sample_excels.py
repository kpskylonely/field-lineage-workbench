#!/usr/bin/env python3
"""生成符合约定格式的测试 Excel：DMP 多 sheet + 代码接口分析。"""
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

DMP_HEADERS = [
    "数据库", "表名", "表注释", "字段名", "字段注释", "数据类型", "长度/精度", "小数位",
    "是否可空", "默认值", "主键", "外键", "唯一约束", "索引", "字段分类", "字典类型",
    "字典/值域名称", "值编码", "值名称", "字典来源数据库", "字典来源数据表", "字典来源字段",
    "是否核心字段", "是否代码使用", "代码使用方式", "备注",
]

CODE_HEADERS = [
    "模块", "controller类", "方法名", "请求方式", "接口URL", "入参", "返回类型", "文件路径",
]


def dmp_row(
    db, table, tcomment, field, fcomment, dtype, length="", scale="",
    nullable="是", default="", pk="", fk="", unique="", index="",
    category="业务", dict_type="", dict_name="", code="", label="",
    src_db="", src_table="", src_field="", core="否", code_used="是",
    code_mode="SELECT", remark="",
):
    return [
        db, table, tcomment, field, fcomment, dtype, length, scale,
        nullable, default, pk, fk, unique, index, category, dict_type,
        dict_name, code, label, src_db, src_table, src_field,
        core, code_used, code_mode, remark,
    ]


def write_dmp():
    wb = Workbook()
    # sheet1 KINGBASE_PROD
    ws = wb.active
    ws.title = "KINGBASE_PROD"
    ws.append(DMP_HEADERS)
    rows = [
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "PROJECT_ID", "项目主键", "NUMBER", "18", "", "否", "", "是", "", "是", "是", "主键", "", "", "", "", "", "", "", "是", "是", "SELECT/JOIN", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "PROJECT_CODE", "项目编码", "VARCHAR2", "64", "", "否", "", "", "", "是", "是", "业务", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "PROJECT_NAME", "项目名称", "VARCHAR2", "128", "", "否", "", "", "", "", "是", "业务", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "PROJECT_STATUS", "项目状态", "VARCHAR2", "16", "", "是", "'DRAFT'", "", "", "", "是", "状态", "STATUS", "项目状态", "DRAFT", "草稿", "KINGBASE_PROD", "SYS_DICT", "DICT_CODE", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "PROJECT_STATUS", "项目状态", "VARCHAR2", "16", "", "是", "", "", "", "", "", "状态", "STATUS", "项目状态", "ACTIVE", "在建", "KINGBASE_PROD", "SYS_DICT", "DICT_CODE", "是", "是", "SELECT", "字典多值展开"),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "PROJECT_STATUS", "项目状态", "VARCHAR2", "16", "", "是", "", "", "", "", "", "状态", "STATUS", "项目状态", "CLOSED", "结项", "KINGBASE_PROD", "SYS_DICT", "DICT_CODE", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "ORG_CODE", "组织编码", "VARCHAR2", "32", "", "是", "", "", "是", "", "是", "外键", "", "", "", "", "PUBLIC_SERVICE", "ORG_UNIT", "ORG_CODE", "否", "是", "JOIN", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_INFO", "项目主表", "CREATE_TIME", "创建时间", "TIMESTAMP", "", "", "是", "SYSDATE", "", "", "", "", "审计", "", "", "", "", "", "", "", "否", "否", "", "系统自动"),
        dmp_row("KINGBASE_PROD", "PROJECT_STAGE", "项目阶段", "STAGE_ID", "阶段主键", "NUMBER", "18", "", "否", "", "是", "", "", "是", "主键", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_STAGE", "项目阶段", "PROJECT_ID", "项目ID", "NUMBER", "18", "", "否", "", "", "是", "", "是", "外键", "", "", "", "", "KINGBASE_PROD", "PROJECT_INFO", "PROJECT_ID", "是", "是", "JOIN", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_STAGE", "项目阶段", "STAGE_CODE", "阶段编码", "VARCHAR2", "32", "", "否", "", "", "", "", "是", "业务", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_STAGE", "项目阶段", "STAGE_NAME", "阶段名称", "VARCHAR2", "64", "", "是", "", "", "", "", "", "业务", "", "", "", "", "", "", "", "否", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_METRIC", "项目指标", "METRIC_ID", "指标主键", "NUMBER", "18", "", "否", "", "是", "", "", "是", "主键", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_METRIC", "项目指标", "METRIC_CODE", "指标编码", "VARCHAR2", "32", "", "否", "", "", "", "", "是", "业务", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_METRIC", "项目指标", "METRIC_VALUE", "指标值", "NUMBER", "18", "2", "是", "", "", "", "", "", "业务", "", "", "", "", "", "", "", "否", "是", "SELECT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_LOG", "项目日志", "LOG_ID", "日志ID", "NUMBER", "18", "", "否", "", "是", "", "", "是", "主键", "", "", "", "", "", "", "", "否", "是", "INSERT", ""),
        dmp_row("KINGBASE_PROD", "PROJECT_LOG", "项目日志", "OPERATOR", "操作人", "VARCHAR2", "64", "", "是", "", "", "", "", "", "审计", "", "", "", "", "", "", "", "否", "是", "INSERT", ""),
    ]
    for r in rows:
        ws.append(r)

    # sheet2 PUBLIC_SERVICE
    ws2 = wb.create_sheet("PUBLIC_SERVICE")
    ws2.append(DMP_HEADERS)
    rows2 = [
        dmp_row("PUBLIC_SERVICE", "ORG_UNIT", "组织单元", "ORG_CODE", "组织编码", "VARCHAR2", "32", "", "否", "", "是", "", "是", "是", "主键", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("PUBLIC_SERVICE", "ORG_UNIT", "组织单元", "ORG_NAME", "组织名称", "VARCHAR2", "128", "", "否", "", "", "", "", "是", "业务", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("PUBLIC_SERVICE", "ORG_UNIT", "组织单元", "PARENT_CODE", "上级组织", "VARCHAR2", "32", "", "是", "", "", "是", "", "是", "外键", "", "", "", "", "PUBLIC_SERVICE", "ORG_UNIT", "ORG_CODE", "否", "否", "", ""),
        dmp_row("PUBLIC_SERVICE", "REGION", "行政区划", "REGION_CODE", "区划编码", "VARCHAR2", "12", "", "否", "", "是", "", "", "是", "主键", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("PUBLIC_SERVICE", "REGION", "行政区划", "REGION_NAME", "区划名称", "VARCHAR2", "64", "", "否", "", "", "", "", "是", "业务", "", "", "", "", "", "", "", "是", "是", "SELECT", ""),
        dmp_row("PUBLIC_SERVICE", "SYS_DICT", "系统字典", "DICT_CODE", "字典编码", "VARCHAR2", "32", "", "否", "", "是", "", "", "是", "主键", "", "", "", "", "", "", "", "否", "否", "", "系统表"),
        dmp_row("PUBLIC_SERVICE", "SYS_DICT", "系统字典", "DICT_LABEL", "字典标签", "VARCHAR2", "64", "", "是", "", "", "", "", "", "字典", "", "", "", "", "", "", "", "否", "否", "", ""),
    ]
    for r in rows2:
        ws2.append(r)

    path = OUT / "sample_dmp_structure.xlsx"
    wb.save(path)
    print("wrote", path)
    return path


def write_code():
    wb = Workbook()
    ws = wb.active
    ws.title = "接口清单"
    ws.append(CODE_HEADERS)
    rows = [
        ["项目全景", "ProjectOverviewController", "overview", "GET", "/project/overview", "projectId", "Result", "hologram/project/ProjectOverviewController.java"],
        ["项目全景", "ProjectOverviewController", "summary", "POST", "/project/summary", "SummaryDTO", "Result", "hologram/project/ProjectOverviewController.java"],
        ["项目地图", "ProjectMapController", "listProjects", "GET", "/map/projects", "bbox,zoom", "Result", "hologram/map/ProjectMapController.java"],
        ["项目台账", "ProjectLedgerController", "create", "POST", "/project/create", "ProjectDTO", "Result", "public/ledger/ProjectLedgerController.java"],
        ["项目台账", "ProjectLedgerController", "getByCode", "GET", "/project/{code}", "code", "Result", "public/ledger/ProjectLedgerController.java"],
    ]
    for r in rows:
        ws.append(r)
    path = OUT / "sample_code_apis.xlsx"
    wb.save(path)
    print("wrote", path)
    return path


if __name__ == "__main__":
    write_dmp()
    write_code()
