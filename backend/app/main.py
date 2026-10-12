from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, or_, text
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import (
    DbField,
    DbObject,
    DictUsage,
    EntryPoint,
    FieldReference,
    ImplicitLink,
    InputMaterial,
    Issue,
    PhaseProgress,
    SystemModule,
)
from .seed import refresh_field_stats, seed_if_empty
from .services import derive as derive_svc
from .services import ingest as ingest_svc

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"

app = FastAPI(
    title="字段级数据血缘与重构影响分析工作台",
    description="支撑数据现状分析 P0→P7 / 29 张表框架，主线为字段级引用事实（表15）。",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FieldCreate(BaseModel):
    schema_name: str
    table_name: str
    field_name: str
    field_comment: str | None = None
    field_category: str | None = None
    data_type: str | None = None
    nullable: bool = True
    is_pk: bool = False
    is_fk: bool = False
    dict_type: str | None = None
    is_core: bool = False
    evidence_source: str = "人工登记"
    conclusion_level: str = "待确认"
    applicability: str = "仅测试"
    remark: str | None = None


class RefCreate(BaseModel):
    system_name: str
    module_name: str
    entry_type: str = "API"
    entry_name: str
    op_type: str
    schema_name: str
    table_name: str
    field_name: str
    field_role: str | None = None
    sql_expr: str | None = None
    evidence_source: str = "人工登记"
    conclusion_level: str = "待确认"
    applicability: str = "仅测试"
    remark: str | None = None


def _ensure_column(table: str, column: str, ddl: str) -> None:
    with engine.connect() as conn:
        cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
        if cols and column not in cols:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
            conn.commit()


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    # SQLite 轻量迁移
    _ensure_column("derive_candidates", "confidence", "confidence INTEGER DEFAULT 50")
    _ensure_column("t03_db_objects", "object_comment", "object_comment VARCHAR(256)")
    _ensure_column("t12_entry_points", "request_params", "request_params VARCHAR(512)")
    _ensure_column("t12_entry_points", "return_type", "return_type VARCHAR(256)")
    _ensure_column("t12_entry_points", "file_path", "file_path VARCHAR(512)")
    db = next(get_db())
    try:
        seed_if_empty(db)
    finally:
        db.close()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "field-lineage-workbench"}


@app.post("/api/ingest/dmp")
async def ingest_dmp(
    file: UploadFile = File(...),
    replace: bool = Form(False),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    try:
        return ingest_svc.ingest_dmp_xlsx(db, content, file.filename or "dmp.xlsx", replace=replace)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(400, f"DMP Excel 解析失败: {e}") from e


@app.post("/api/ingest/code")
async def ingest_code(
    file: UploadFile = File(...),
    system_name: str = Form(...),
    replace: bool = Form(False),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    try:
        return ingest_svc.ingest_code_xlsx(
            db, content, file.filename or "code.xlsx", system_name=system_name, replace=replace
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(400, f"代码 Excel 解析失败: {e}") from e


@app.post("/api/ingest/auto")
async def ingest_auto(
    file: UploadFile = File(...),
    system_name: str | None = Form(None),
    replace: bool = Form(False),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    kind = ingest_svc.detect_workbook_kind(content)
    name = file.filename or "upload.xlsx"
    try:
        if kind == "dmp":
            return ingest_svc.ingest_dmp_xlsx(db, content, name, replace=replace)
        if kind == "code":
            if not system_name or not system_name.strip():
                raise HTTPException(400, "识别为代码分析 Excel，请提供 system_name")
            return ingest_svc.ingest_code_xlsx(
                db, content, name, system_name=system_name, replace=replace
            )
        raise HTTPException(400, "无法识别 Excel 类型，请使用「DMP结构」或「代码接口」专用入口")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(400, f"导入失败: {e}") from e


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)) -> dict[str, Any]:
    phases = db.query(PhaseProgress).order_by(PhaseProgress.phase_code).all()
    field_count = db.query(DbField).count()
    ref_count = db.query(FieldReference).count()
    issue_count = db.query(Issue).count()
    zero_hit = db.query(DbField).filter(DbField.source_ref_count == 0).count()
    multi_write = (
        db.query(
            FieldReference.schema_name,
            FieldReference.table_name,
            FieldReference.field_name,
            func.count(func.distinct(FieldReference.entry_name)),
        )
        .filter(FieldReference.op_type == "UPDATE")
        .group_by(
            FieldReference.schema_name,
            FieldReference.table_name,
            FieldReference.field_name,
        )
        .having(func.count(func.distinct(FieldReference.entry_name)) > 1)
        .count()
    )
    gates = [
        {
            "code": "G1",
            "name": "字段主表可检索",
            "passed": field_count > 0,
            "detail": f"字段主表 {field_count} 条",
        },
        {
            "code": "G2",
            "name": "表15可按字段反查入口",
            "passed": ref_count > 0,
            "detail": f"引用事实 {ref_count} 条",
        },
        {
            "code": "G3",
            "name": "生产验证完成",
            "passed": False,
            "detail": "P7 尚未开始，测试结论不得终裁生产",
        },
    ]
    return {
        "summary": {
            "fields": field_count,
            "references": ref_count,
            "issues": issue_count,
            "zero_hit_fields": zero_hit,
            "multi_write_fields": multi_write,
            "objects": db.query(DbObject).count(),
            "entries": db.query(EntryPoint).count(),
            "dicts": db.query(DictUsage).count(),
        },
        "phases": [
            {
                "phase_code": p.phase_code,
                "phase_name": p.phase_name,
                "table_count": p.table_count,
                "table_ids": p.table_ids,
                "status": p.status,
                "filled_tables": p.filled_tables,
                "gate_code": p.gate_code,
                "gate_passed": p.gate_passed,
                "note": p.note,
            }
            for p in phases
        ],
        "gates": gates,
        "tables_framework": [
            {"id": "01", "phase": "P0", "name": "输入资料清单"},
            {"id": "02", "phase": "P0", "name": "DMP导入结果及异常记录"},
            {"id": "03", "phase": "P1", "name": "对象总览"},
            {"id": "04", "phase": "P1", "name": "表字段总览（字段主表）", "core": True},
            {"id": "05", "phase": "P1", "name": "约束清单"},
            {"id": "06", "phase": "P1", "name": "索引清单"},
            {"id": "07", "phase": "P1", "name": "DDL基线"},
            {"id": "08", "phase": "P2", "name": "数据存在性清单"},
            {"id": "09", "phase": "P2", "name": "字典值域及字段引用", "core": True},
            {"id": "10", "phase": "P2", "name": "生产待补数据需求"},
            {"id": "11", "phase": "P3", "name": "系统模块清单"},
            {"id": "12", "phase": "P3", "name": "接口/任务/消息入口"},
            {"id": "13", "phase": "P3", "name": "SQL/ORM访问"},
            {"id": "14", "phase": "P3", "name": "Entity-表-字段映射"},
            {"id": "15", "phase": "P4", "name": "字段操作引用清单（核心）", "core": True},
            {"id": "16", "phase": "P4", "name": "数据库-源码差异"},
            {"id": "17", "phase": "P4", "name": "隐式关联清单"},
            {"id": "18", "phase": "P4", "name": "孤儿对象候选"},
            {"id": "19", "phase": "P5", "name": "业务对象-表映射"},
            {"id": "20", "phase": "P5", "name": "业务数据字典"},
            {"id": "21", "phase": "P5", "name": "状态值域和流转规则"},
            {"id": "22", "phase": "P5", "name": "物理关系表"},
            {"id": "23", "phase": "P5", "name": "业务关系确认表"},
            {"id": "24", "phase": "P6", "name": "现状问题清单"},
            {"id": "25", "phase": "P6", "name": "重构风险评估"},
            {"id": "26", "phase": "P6", "name": "改进建议清单"},
            {"id": "27", "phase": "P7", "name": "生产数据补充需求"},
            {"id": "28", "phase": "P7", "name": "生产结构差异"},
            {"id": "29", "phase": "P7", "name": "业务确认记录"},
        ],
    }


def _serialize_field(f: DbField) -> dict[str, Any]:
    return {
        "id": f.id,
        "full_name": f"{f.schema_name}.{f.table_name}.{f.field_name}",
        "schema_name": f.schema_name,
        "table_name": f.table_name,
        "field_name": f.field_name,
        "field_comment": f.field_comment,
        "field_category": f.field_category,
        "data_type": f.data_type,
        "nullable": f.nullable,
        "is_pk": f.is_pk,
        "is_fk": f.is_fk,
        "dict_type": f.dict_type,
        "dict_source_table": f.dict_source_table,
        "test_sample_values": f.test_sample_values,
        "source_ref_count": f.source_ref_count,
        "ref_system_count": f.ref_system_count,
        "ref_module_count": f.ref_module_count,
        "ref_entry_count": f.ref_entry_count,
        "ref_ops": f.ref_ops,
        "field_ref_status": f.field_ref_status,
        "is_core": f.is_core,
        "evidence_source": f.evidence_source,
        "conclusion_level": f.conclusion_level,
        "applicability": f.applicability,
        "remark": f.remark,
    }


def _serialize_ref(r: FieldReference) -> dict[str, Any]:
    return {
        "id": r.id,
        "system_name": r.system_name,
        "module_name": r.module_name,
        "entry_type": r.entry_type,
        "entry_name": r.entry_name,
        "op_type": r.op_type,
        "schema_name": r.schema_name,
        "table_name": r.table_name,
        "field_name": r.field_name,
        "full_field": f"{r.schema_name}.{r.table_name}.{r.field_name}",
        "field_role": r.field_role,
        "sql_expr": r.sql_expr,
        "direct_access": r.direct_access,
        "dynamic_sql": r.dynamic_sql,
        "evidence_level": r.evidence_level,
        "evidence_source": r.evidence_source,
        "conclusion_level": r.conclusion_level,
        "applicability": r.applicability,
        "remark": r.remark,
    }


@app.get("/api/fields")
def list_fields(
    q: str | None = None,
    schema: str | None = None,
    table: str | None = None,
    zero_hit: bool = False,
    core_only: bool = False,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = db.query(DbField)
    if schema:
        query = query.filter(DbField.schema_name == schema)
    if table:
        query = query.filter(DbField.table_name == table)
    if zero_hit:
        query = query.filter(DbField.source_ref_count == 0)
    if core_only:
        query = query.filter(DbField.is_core.is_(True))
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                DbField.field_name.ilike(like),
                DbField.table_name.ilike(like),
                DbField.field_comment.ilike(like),
                DbField.schema_name.ilike(like),
            )
        )
    rows = query.order_by(
        DbField.schema_name, DbField.table_name, DbField.field_name
    ).all()
    return [_serialize_field(f) for f in rows]


@app.get("/api/fields/{field_id}")
def get_field(field_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    f = db.get(DbField, field_id)
    if not f:
        raise HTTPException(404, "字段不存在")
    refs = (
        db.query(FieldReference)
        .filter_by(
            schema_name=f.schema_name,
            table_name=f.table_name,
            field_name=f.field_name,
        )
        .order_by(FieldReference.system_name, FieldReference.entry_name)
        .all()
    )
    return {
        "field": _serialize_field(f),
        "references": [_serialize_ref(r) for r in refs],
        "can_declare_unused": False
        if refs
        else f.applicability in ("已确认生产", "可能适用生产"),
        "gate_hint": "G2：宣布字段/表无用前，须保证表15可按字段反查全部入口；零命中仍须生产验证。",
    }


@app.post("/api/fields")
def create_field(payload: FieldCreate, db: Session = Depends(get_db)) -> dict[str, Any]:
    exists = (
        db.query(DbField)
        .filter_by(
            schema_name=payload.schema_name,
            table_name=payload.table_name,
            field_name=payload.field_name,
        )
        .first()
    )
    if exists:
        raise HTTPException(400, "字段已存在")
    row = DbField(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_field(row)


@app.get("/api/references")
def list_references(
    q: str | None = None,
    system: str | None = None,
    op_type: str | None = None,
    schema: str | None = None,
    table: str | None = None,
    field: str | None = None,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = db.query(FieldReference)
    if system:
        query = query.filter(FieldReference.system_name == system)
    if op_type:
        query = query.filter(FieldReference.op_type == op_type)
    if schema:
        query = query.filter(FieldReference.schema_name == schema)
    if table:
        query = query.filter(FieldReference.table_name == table)
    if field:
        query = query.filter(FieldReference.field_name == field)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                FieldReference.entry_name.ilike(like),
                FieldReference.module_name.ilike(like),
                FieldReference.field_name.ilike(like),
                FieldReference.table_name.ilike(like),
                FieldReference.system_name.ilike(like),
            )
        )
    rows = query.order_by(
        FieldReference.schema_name,
        FieldReference.table_name,
        FieldReference.field_name,
        FieldReference.system_name,
    ).all()
    return [_serialize_ref(r) for r in rows]


@app.post("/api/references")
def create_reference(payload: RefCreate, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = FieldReference(**payload.model_dump())
    db.add(row)
    db.commit()
    refresh_field_stats(db)
    db.refresh(row)
    return _serialize_ref(row)


@app.get("/api/impact")
def impact_analysis(
    schema: str = Query(...),
    table: str = Query(...),
    field: str = Query(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """验收口令：给定 Schema.表.字段，列出全部系统/模块/入口/操作。"""
    return _build_lineage_chain(db, schema, table, field)["impact"]


def _build_lineage_chain(
    db: Session, schema: str, table: str, field: str
) -> dict[str, Any]:
    """串联：对象 → 字段 → 引用入口 → 字典 → 问题 → 闸门决策。"""
    f = (
        db.query(DbField)
        .filter_by(schema_name=schema, table_name=table, field_name=field)
        .first()
    )
    obj = (
        db.query(DbObject)
        .filter_by(schema_name=schema, object_name=table)
        .first()
    )
    refs = (
        db.query(FieldReference)
        .filter_by(schema_name=schema, table_name=table, field_name=field)
        .order_by(
            FieldReference.system_name,
            FieldReference.module_name,
            FieldReference.entry_name,
        )
        .all()
    )

    dict_type = f.dict_type if f else None
    dict_rows = []
    if dict_type:
        dict_rows = (
            db.query(DictUsage)
            .filter(DictUsage.dict_name == dict_type)
            .order_by(DictUsage.record_type, DictUsage.value_code)
            .all()
        )
    else:
        dict_rows = (
            db.query(DictUsage)
            .filter(
                DictUsage.use_schema == schema,
                DictUsage.use_table == table,
                DictUsage.use_field == field,
            )
            .all()
        )

    target = f"{schema}.{table}.{field}"
    short = f"{table}.{field}"
    issues = (
        db.query(Issue)
        .filter(
            or_(
                Issue.object_name == target,
                Issue.object_name == short,
                Issue.object_name == field,
                Issue.object_name.contains(field),
            )
        )
        .order_by(Issue.issue_no)
        .all()
    )

    links = (
        db.query(ImplicitLink)
        .filter(
            or_(
                ImplicitLink.child_field.contains(target),
                ImplicitLink.parent_field.contains(target),
                ImplicitLink.child_field.contains(short),
                ImplicitLink.parent_field.contains(short),
            )
        )
        .all()
    )

    by_system: dict[str, Any] = {}
    for r in refs:
        bucket = by_system.setdefault(
            r.system_name,
            {"system": r.system_name, "modules": {}, "refs": []},
        )
        bucket["refs"].append(_serialize_ref(r))
        mod = bucket["modules"].setdefault(
            r.module_name,
            {"module": r.module_name, "entries": {}},
        )
        ent = mod["entries"].setdefault(
            r.entry_name,
            {
                "entry_name": r.entry_name,
                "entry_type": r.entry_type,
                "ops": [],
                "roles": [],
            },
        )
        if r.op_type not in ent["ops"]:
            ent["ops"].append(r.op_type)
        if r.field_role and r.field_role not in ent["roles"]:
            ent["roles"].append(r.field_role)

    tree = []
    for sys_name in sorted(by_system.keys()):
        s = by_system[sys_name]
        modules = []
        for mod_name, mod in sorted(s["modules"].items()):
            modules.append(
                {
                    "module": mod_name,
                    "entries": list(mod["entries"].values()),
                }
            )
        tree.append({"system": sys_name, "modules": modules, "ref_count": len(s["refs"])})

    update_entries = sorted({r.entry_name for r in refs if r.op_type == "UPDATE"})
    systems = sorted(by_system.keys())
    multi_write = len(update_entries) > 1
    zero_hit = len(refs) == 0

    # 闸门决策（可检查，不是口号）
    decisions = []
    if zero_hit:
        decisions.append(
            {
                "code": "D-ZERO",
                "title": "零命中字段",
                "level": "阻断终裁",
                "passed": False,
                "action": "不得宣布废弃；登记 P7 生产字段使用补证，确认后再归档。",
            }
        )
    else:
        decisions.append(
            {
                "code": "D-G2",
                "title": "表15可反查入口",
                "level": "闸门通过",
                "passed": True,
                "action": f"已定位 {len(refs)} 条引用、{len(systems)} 个系统；改字段前须导出影响清单。",
            }
        )
    if multi_write:
        decisions.append(
            {
                "code": "D-MULTI",
                "title": "多入口写入冲突",
                "level": "高风险",
                "passed": False,
                "action": "统一状态权威（过程事件写状态），禁止多个入口各自 UPDATE 同一语义。",
            }
        )
    if links:
        decisions.append(
            {
                "code": "D-IMPLICIT",
                "title": "存在隐式关联",
                "level": "需确认",
                "passed": False,
                "action": "补 FK 或质量校验任务；业务关系确认前不改关联键语义。",
            }
        )
    prod_ok = (f.applicability if f else "") == "已确认生产"
    decisions.append(
        {
            "code": "D-P7",
            "title": "生产适用范围",
            "level": "通过" if prod_ok else "待生产验证",
            "passed": prod_ok,
            "action": "当前结论仅基于测试 DMP+源码；生产结构/使用确认前不做表分类终裁。",
        }
    )

    next_steps = []
    if zero_hit:
        next_steps.append("打开问题 I003 类项，创建/关联生产补证需求（表27）")
    if multi_write:
        next_steps.append("对照表15 UPDATE 入口，明确唯一权威写方")
    if dict_type:
        next_steps.append(f"核对字典 {dict_type} 定义与业务表实际值是否一致（表09）")
    if issues:
        next_steps.append("在问题清单闭环处置建议，并回写结论等级")
    if not next_steps:
        next_steps.append("补充业务语义确认（表20/21/23），再进入重构设计")

    spine = [
        {
            "step": 1,
            "name": "业务对象/表",
            "value": f"{schema}.{table}",
            "detail": (obj.preliminary_class if obj else None) or "物理表",
            "status": "ok" if obj else "warn",
        },
        {
            "step": 2,
            "name": "字段",
            "value": field,
            "detail": (f.field_comment if f else None)
            or (f.field_category if f else "字段"),
            "status": "ok" if f else "warn",
        },
        {
            "step": 3,
            "name": "引用入口",
            "value": f"{len(refs)} 条 / {len(systems)} 系统",
            "detail": "、".join(systems) if systems else "表15零命中",
            "status": "ok" if refs else "danger",
        },
        {
            "step": 4,
            "name": "字典/值域",
            "value": dict_type or "无绑定字典",
            "detail": f"{len(dict_rows)} 条定义/使用记录",
            "status": "ok" if dict_rows else "muted",
        },
        {
            "step": 5,
            "name": "问题与风险",
            "value": f"{len(issues)} 项",
            "detail": "、".join(i.issue_no for i in issues) or "未提炼问题",
            "status": "danger" if issues else "ok",
        },
        {
            "step": 6,
            "name": "闸门决策",
            "value": f"{sum(1 for d in decisions if d['passed'])}/{len(decisions)} 通过",
            "detail": "可检查、可阻断终裁",
            "status": "ok" if all(d["passed"] for d in decisions if d["code"] != "D-P7") and not zero_hit else "warn",
        },
    ]

    impact = {
        "target": target,
        "field": _serialize_field(f) if f else None,
        "total_refs": len(refs),
        "systems": systems,
        "ops": sorted({r.op_type for r in refs}),
        "update_entries": update_entries,
        "multi_write": multi_write,
        "by_system": {k: v["refs"] for k, v in by_system.items()},
        "references": [_serialize_ref(r) for r in refs],
        "refactor_risk": "高"
        if multi_write or len(systems) >= 3
        else ("中" if refs else "低（仍需生产验证）"),
        "gate": {
            "may_declare_unused": False,
            "reason": "零命中≠可废弃；须 P7 生产验证。有引用则必须先导出口径影响清单。",
        },
    }

    return {
        "target": target,
        "spine": spine,
        "object": {
            "schema_name": schema,
            "object_name": table,
            "preliminary_class": obj.preliminary_class if obj else None,
            "ref_entry_count": obj.ref_entry_count if obj else 0,
            "referenced_by_code": obj.referenced_by_code if obj else False,
        }
        if obj or True
        else None,
        "field": _serialize_field(f) if f else {
            "schema_name": schema,
            "table_name": table,
            "field_name": field,
            "full_name": target,
        },
        "tree": tree,
        "references": [_serialize_ref(r) for r in refs],
        "dicts": [
            {
                "record_type": d.record_type,
                "dict_name": d.dict_name,
                "value_code": d.value_code,
                "value_label": d.value_label,
                "source_type": d.source_type,
                "use_system": d.use_system,
                "use_entry": d.use_entry,
                "use_mode": d.use_mode,
                "evidence_source": d.evidence_source,
                "conclusion_level": d.conclusion_level,
                "applicability": d.applicability,
            }
            for d in dict_rows
        ],
        "issues": [
            {
                "issue_no": i.issue_no,
                "category": i.category,
                "object_name": i.object_name,
                "description": i.description,
                "risk": i.risk,
                "suggestion": i.suggestion,
                "derived_from": i.derived_from,
                "conclusion_level": i.conclusion_level,
                "applicability": i.applicability,
            }
            for i in issues
        ],
        "implicit_links": [
            {
                "child_field": x.child_field,
                "parent_field": x.parent_field,
                "find_system": x.find_system,
                "code_location": x.code_location,
                "has_fk": x.has_fk,
            }
            for x in links
        ],
        "decisions": decisions,
        "next_steps": next_steps,
        "impact": impact,
        "narrative": (
            f"字段 {target} "
            + (
                f"被 {len(systems)} 个系统、{len(refs)} 条入口引用"
                if refs
                else "在当前源码扫描范围内零命中"
            )
            + ("，存在多入口 UPDATE 冲突" if multi_write else "")
            + (f"，关联问题 {', '.join(i.issue_no for i in issues)}" if issues else "")
            + "。"
        ),
    }


@app.get("/api/lineage/chain")
def lineage_chain(
    schema: str = Query(...),
    table: str = Query(...),
    field: str = Query(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """反向视角：数据库 → 表 → 字段 → 系统 → 模块 → 接口。"""
    data = _build_lineage_chain(db, schema, table, field)
    data["perspective"] = "field"
    data["perspective_label"] = "反向：库表字段 → 系统模块接口"
    data["path"] = [
        "数据库/Schema",
        "表",
        "字段",
        "系统",
        "模块",
        "接口/任务",
    ]
    return data


@app.get("/api/lineage/hotspots")
def lineage_hotspots(db: Session = Depends(get_db)) -> dict[str, Any]:
    """需要优先串联分析的字段热点。"""
    fields = db.query(DbField).all()
    hotspots = []
    for f in fields:
        refs = (
            db.query(FieldReference)
            .filter_by(
                schema_name=f.schema_name,
                table_name=f.table_name,
                field_name=f.field_name,
            )
            .all()
        )
        updates = {r.entry_name for r in refs if r.op_type == "UPDATE"}
        systems = {r.system_name for r in refs}
        reasons = []
        score = 0
        if len(updates) > 1:
            reasons.append("多写冲突")
            score += 50
        if len(systems) >= 3:
            reasons.append("跨系统引用")
            score += 30
        if not refs:
            reasons.append("零命中")
            score += 40
        if f.is_core:
            score += 10
        if f.dict_type:
            score += 5
        issue_hit = (
            db.query(Issue)
            .filter(Issue.object_name.contains(f.field_name))
            .count()
        )
        if issue_hit:
            reasons.append(f"{issue_hit}个问题")
            score += 20 * issue_hit
        if reasons:
            hotspots.append(
                {
                    "schema_name": f.schema_name,
                    "table_name": f.table_name,
                    "field_name": f.field_name,
                    "full_name": f"{f.schema_name}.{f.table_name}.{f.field_name}",
                    "comment": f.field_comment,
                    "reasons": reasons,
                    "score": score,
                    "ref_count": len(refs),
                    "system_count": len(systems),
                    "update_count": len(updates),
                    "is_core": f.is_core,
                }
            )
    hotspots.sort(key=lambda x: (-x["score"], x["full_name"]))

    # 推荐默认分析目标
    default = hotspots[0] if hotspots else None
    return {"hotspots": hotspots, "default": default}


@app.get("/api/lineage/systems")
def lineage_systems(db: Session = Depends(get_db)) -> dict[str, Any]:
    """正向视角左侧：系统清单及触及的库表字段规模。"""
    refs = db.query(FieldReference).all()
    modules = db.query(SystemModule).all()
    entries = db.query(EntryPoint).all()

    by_sys: dict[str, dict[str, Any]] = {}
    for m in modules:
        by_sys.setdefault(
            m.system_name,
            {
                "system_name": m.system_name,
                "modules": set(),
                "entries": set(),
                "schemas": set(),
                "tables": set(),
                "fields": set(),
                "ops": set(),
                "ref_count": 0,
                "update_count": 0,
                "duties": [],
            },
        )
        by_sys[m.system_name]["modules"].add(m.module_name)
        if m.duty:
            by_sys[m.system_name]["duties"].append(m.duty)

    for e in entries:
        bucket = by_sys.setdefault(
            e.system_name,
            {
                "system_name": e.system_name,
                "modules": set(),
                "entries": set(),
                "schemas": set(),
                "tables": set(),
                "fields": set(),
                "ops": set(),
                "ref_count": 0,
                "update_count": 0,
                "duties": [],
            },
        )
        bucket["modules"].add(e.module_name)
        bucket["entries"].add(e.entry_name)

    for r in refs:
        bucket = by_sys.setdefault(
            r.system_name,
            {
                "system_name": r.system_name,
                "modules": set(),
                "entries": set(),
                "schemas": set(),
                "tables": set(),
                "fields": set(),
                "ops": set(),
                "ref_count": 0,
                "update_count": 0,
                "duties": [],
            },
        )
        bucket["modules"].add(r.module_name)
        bucket["entries"].add(r.entry_name)
        bucket["schemas"].add(r.schema_name)
        bucket["tables"].add(f"{r.schema_name}.{r.table_name}")
        bucket["fields"].add(f"{r.schema_name}.{r.table_name}.{r.field_name}")
        bucket["ops"].add(r.op_type)
        bucket["ref_count"] += 1
        if r.op_type == "UPDATE":
            bucket["update_count"] += 1

    systems = []
    for name, b in by_sys.items():
        score = b["ref_count"] + b["update_count"] * 2 + len(b["fields"])
        systems.append(
            {
                "system_name": name,
                "module_count": len(b["modules"]),
                "entry_count": len(b["entries"]),
                "schema_count": len(b["schemas"]),
                "table_count": len(b["tables"]),
                "field_count": len(b["fields"]),
                "ref_count": b["ref_count"],
                "update_count": b["update_count"],
                "ops": sorted(b["ops"]),
                "duty_summary": "；".join(b["duties"][:2]) if b["duties"] else "",
                "score": score,
            }
        )
    systems.sort(key=lambda x: (-x["score"], x["system_name"]))
    return {"systems": systems, "default": systems[0] if systems else None}


def _build_system_lineage(
    db: Session,
    system: str,
    module: str | None = None,
    entry: str | None = None,
) -> dict[str, Any]:
    """正向：系统 → 模块 → 接口 → 数据库 → 表 → 字段。"""
    q = db.query(FieldReference).filter(FieldReference.system_name == system)
    if module:
        q = q.filter(FieldReference.module_name == module)
    if entry:
        q = q.filter(FieldReference.entry_name == entry)
    refs = q.order_by(
        FieldReference.module_name,
        FieldReference.entry_name,
        FieldReference.schema_name,
        FieldReference.table_name,
        FieldReference.field_name,
    ).all()

    mod_rows = (
        db.query(SystemModule).filter(SystemModule.system_name == system).all()
    )
    entry_rows = (
        db.query(EntryPoint).filter(EntryPoint.system_name == system).all()
    )
    if module:
        entry_rows = [e for e in entry_rows if e.module_name == module]

    # 系统 → 模块 → 接口 → schema → table → fields
    tree: dict[str, Any] = {}
    for r in refs:
        mod = tree.setdefault(
            r.module_name,
            {"module": r.module_name, "entries": {}},
        )
        ent = mod["entries"].setdefault(
            r.entry_name,
            {
                "entry_name": r.entry_name,
                "entry_type": r.entry_type,
                "databases": {},
            },
        )
        dbucket = ent["databases"].setdefault(
            r.schema_name,
            {"schema_name": r.schema_name, "tables": {}},
        )
        tb = dbucket["tables"].setdefault(
            r.table_name,
            {"table_name": r.table_name, "fields": {}},
        )
        fd = tb["fields"].setdefault(
            r.field_name,
            {
                "field_name": r.field_name,
                "full_name": f"{r.schema_name}.{r.table_name}.{r.field_name}",
                "ops": [],
                "roles": [],
                "refs": [],
            },
        )
        if r.op_type not in fd["ops"]:
            fd["ops"].append(r.op_type)
        if r.field_role and r.field_role not in fd["roles"]:
            fd["roles"].append(r.field_role)
        fd["refs"].append(_serialize_ref(r))

    modules_out = []
    for mod_name, mod in sorted(tree.items()):
        entries_out = []
        for en_name, en in sorted(mod["entries"].items()):
            dbs_out = []
            for sch, dbucket in sorted(en["databases"].items()):
                tables_out = []
                for tname, tb in sorted(dbucket["tables"].items()):
                    tables_out.append(
                        {
                            "table_name": tname,
                            "full_table": f"{sch}.{tname}",
                            "fields": sorted(
                                tb["fields"].values(),
                                key=lambda x: x["field_name"],
                            ),
                        }
                    )
                dbs_out.append(
                    {"schema_name": sch, "tables": tables_out}
                )
            entries_out.append(
                {
                    "entry_name": en_name,
                    "entry_type": en["entry_type"],
                    "databases": dbs_out,
                    "field_count": sum(
                        len(t["fields"])
                        for d in dbs_out
                        for t in d["tables"]
                    ),
                }
            )
        modules_out.append({"module": mod_name, "entries": entries_out})

    # 扁平触达面：按库表字段汇总
    field_touch: dict[str, Any] = {}
    for r in refs:
        key = f"{r.schema_name}.{r.table_name}.{r.field_name}"
        ft = field_touch.setdefault(
            key,
            {
                "full_name": key,
                "schema_name": r.schema_name,
                "table_name": r.table_name,
                "field_name": r.field_name,
                "ops": set(),
                "entries": set(),
                "modules": set(),
            },
        )
        ft["ops"].add(r.op_type)
        ft["entries"].add(r.entry_name)
        ft["modules"].add(r.module_name)

    field_surface = [
        {
            "full_name": v["full_name"],
            "schema_name": v["schema_name"],
            "table_name": v["table_name"],
            "field_name": v["field_name"],
            "ops": sorted(v["ops"]),
            "entry_count": len(v["entries"]),
            "module_count": len(v["modules"]),
            "writes": "UPDATE" in v["ops"],
        }
        for v in field_touch.values()
    ]
    field_surface.sort(
        key=lambda x: (-int(x["writes"]), -x["entry_count"], x["full_name"])
    )

    schemas = sorted({r.schema_name for r in refs})
    tables = sorted({f"{r.schema_name}.{r.table_name}" for r in refs})
    fields = sorted(field_touch.keys())
    update_entries = sorted({r.entry_name for r in refs if r.op_type == "UPDATE"})

    scope = system
    if module:
        scope += f" / {module}"
    if entry:
        scope += f" / {entry}"

    spine = [
        {
            "step": 1,
            "name": "系统",
            "value": system,
            "detail": f"{len(mod_rows)} 个模块登记",
            "status": "ok",
        },
        {
            "step": 2,
            "name": "模块",
            "value": module or f"{len({r.module_name for r in refs})} 个",
            "detail": "、".join(sorted({r.module_name for r in refs}))[:80]
            or "无引用模块",
            "status": "ok" if refs else "warn",
        },
        {
            "step": 3,
            "name": "接口/任务",
            "value": entry or f"{len({r.entry_name for r in refs})} 个",
            "detail": f"登记入口 {len(entry_rows)} · 有库访问引用 {len({r.entry_name for r in refs})}",
            "status": "ok" if refs else "danger",
        },
        {
            "step": 4,
            "name": "数据库",
            "value": f"{len(schemas)} 个 Schema",
            "detail": "、".join(schemas) or "未触及库",
            "status": "ok" if schemas else "danger",
        },
        {
            "step": 5,
            "name": "表",
            "value": f"{len(tables)} 张",
            "detail": "、".join(tables[:4]) + ("…" if len(tables) > 4 else ""),
            "status": "ok" if tables else "danger",
        },
        {
            "step": 6,
            "name": "字段",
            "value": f"{len(fields)} 个",
            "detail": f"其中写入类 {sum(1 for f in field_surface if f['writes'])} 个",
            "status": "ok" if fields else "danger",
        },
    ]

    decisions = []
    if not refs:
        decisions.append(
            {
                "code": "S-EMPTY",
                "title": "系统无字段级引用",
                "level": "待补盘",
                "passed": False,
                "action": "检查入口是否未落入表15，或该系统确实不直连业务库。",
            }
        )
    else:
        decisions.append(
            {
                "code": "S-TOUCH",
                "title": "已摸清触达面",
                "level": "可分析",
                "passed": True,
                "action": f"本系统触及 {len(tables)} 表 / {len(fields)} 字段；改库前先按字段反查。",
            }
        )
    if len(update_entries) > 1:
        decisions.append(
            {
                "code": "S-WRITE",
                "title": "多接口写入",
                "level": "高风险",
                "passed": False,
                "action": "梳理各 UPDATE 接口职责，避免同一字段多入口争写。",
            }
        )

    next_steps = [
        "在下方点选字段，切换到反向视角看该字段被哪些系统使用",
        "对写入字段优先做影响分析与问题提炼",
    ]
    if update_entries:
        next_steps.insert(0, f"核对写入接口：{'、'.join(update_entries[:3])}")

    return {
        "perspective": "system",
        "perspective_label": "正向：系统 → 模块 → 接口 → 库表字段",
        "path": ["系统", "模块", "接口/任务", "数据库", "表", "字段"],
        "scope": scope,
        "system_name": system,
        "module_name": module,
        "entry_name": entry,
        "spine": spine,
        "tree": modules_out,
        "field_surface": field_surface,
        "modules_registered": [
            {
                "module_name": m.module_name,
                "duty": m.duty,
                "repo": m.repo,
                "target_schema": m.target_schema,
            }
            for m in mod_rows
        ],
        "entries_registered": [
            {
                "module_name": e.module_name,
                "entry_type": e.entry_type,
                "entry_name": e.entry_name,
                "in_table15": e.in_table15,
            }
            for e in entry_rows
        ],
        "references": [_serialize_ref(r) for r in refs],
        "summary": {
            "ref_count": len(refs),
            "module_count": len({r.module_name for r in refs}),
            "entry_count": len({r.entry_name for r in refs}),
            "schema_count": len(schemas),
            "table_count": len(tables),
            "field_count": len(fields),
            "update_entries": update_entries,
        },
        "decisions": decisions,
        "next_steps": next_steps,
        "narrative": (
            f"系统「{system}」"
            + (f" / 模块「{module}」" if module else "")
            + (f" / 接口「{entry}」" if entry else "")
            + (
                f" 沿链路触及 {len(schemas)} 个库、{len(tables)} 张表、{len(fields)} 个字段"
                if refs
                else " 当前没有落入表15的字段级库访问记录"
            )
            + (
                f"，其中 {len(update_entries)} 个接口存在 UPDATE"
                if update_entries
                else ""
            )
            + "。"
        ),
    }


@app.get("/api/lineage/from-system")
def lineage_from_system(
    system: str = Query(...),
    module: str | None = None,
    entry: str | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _build_system_lineage(db, system, module, entry)


@app.get("/api/objects")
def list_objects(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(DbObject).order_by(DbObject.schema_name, DbObject.object_name).all()
    return [
        {
            "id": o.id,
            "schema_name": o.schema_name,
            "object_type": o.object_type,
            "object_name": o.object_name,
            "object_comment": o.object_comment,
            "preliminary_class": o.preliminary_class,
            "referenced_by_code": o.referenced_by_code,
            "ref_system_count": o.ref_system_count,
            "ref_entry_count": o.ref_entry_count,
            "evidence_source": o.evidence_source,
            "conclusion_level": o.conclusion_level,
            "applicability": o.applicability,
        }
        for o in rows
    ]


@app.get("/api/dicts")
def list_dicts(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(DictUsage).order_by(DictUsage.dict_name, DictUsage.record_type).all()
    return [
        {
            "id": d.id,
            "record_type": d.record_type,
            "dict_name": d.dict_name,
            "value_code": d.value_code,
            "value_label": d.value_label,
            "source_type": d.source_type,
            "source_schema": d.source_schema,
            "source_table": d.source_table,
            "use_schema": d.use_schema,
            "use_table": d.use_table,
            "use_field": d.use_field,
            "use_system": d.use_system,
            "use_module": d.use_module,
            "use_entry": d.use_entry,
            "use_mode": d.use_mode,
            "evidence_source": d.evidence_source,
            "conclusion_level": d.conclusion_level,
            "applicability": d.applicability,
        }
        for d in rows
    ]


@app.get("/api/issues")
def list_issues(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(Issue).order_by(Issue.issue_no).all()
    return [
        {
            "id": i.id,
            "issue_no": i.issue_no,
            "category": i.category,
            "object_name": i.object_name,
            "description": i.description,
            "derived_from": i.derived_from,
            "impact": i.impact,
            "risk": i.risk,
            "needs_prod": i.needs_prod,
            "suggestion": i.suggestion,
            "status": i.status,
            "evidence_source": i.evidence_source,
            "conclusion_level": i.conclusion_level,
            "applicability": i.applicability,
        }
        for i in rows
    ]


@app.get("/api/modules")
def list_modules(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(SystemModule).all()
    return [
        {
            "id": m.id,
            "system_name": m.system_name,
            "module_name": m.module_name,
            "repo": m.repo,
            "branch": m.branch,
            "target_schema": m.target_schema,
            "duty": m.duty,
            "evidence_source": m.evidence_source,
            "conclusion_level": m.conclusion_level,
            "applicability": m.applicability,
        }
        for m in rows
    ]


@app.get("/api/entries")
def list_entries(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(EntryPoint).all()
    return [
        {
            "id": e.id,
            "system_name": e.system_name,
            "module_name": e.module_name,
            "entry_type": e.entry_type,
            "entry_name": e.entry_name,
            "entry_class": e.entry_class,
            "method_name": e.method_name,
            "request_params": e.request_params,
            "return_type": e.return_type,
            "file_path": e.file_path,
            "in_table15": e.in_table15,
            "field_confirm_level": e.field_confirm_level,
            "evidence_source": e.evidence_source,
            "conclusion_level": e.conclusion_level,
            "applicability": e.applicability,
        }
        for e in rows
    ]


@app.get("/api/materials")
def list_materials(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(InputMaterial).all()
    return [
        {
            "id": m.id,
            "material_no": m.material_no,
            "material_type": m.material_type,
            "system_name": m.system_name,
            "path": m.path,
            "repo": m.repo,
            "branch_or_tag": m.branch_or_tag,
            "commit_id": m.commit_id,
            "dmp_file": m.dmp_file,
            "version_matched": m.version_matched,
            "complete": m.complete,
            "evidence_source": m.evidence_source,
            "conclusion_level": m.conclusion_level,
            "applicability": m.applicability,
        }
        for m in rows
    ]


@app.get("/api/derive/catalog")
def derive_catalog() -> list[dict[str, Any]]:
    return derive_svc.catalog()


@app.get("/api/derive/summary")
def derive_summary(db: Session = Depends(get_db)) -> dict[str, Any]:
    return derive_svc.summary(db)


@app.post("/api/derive/run")
def derive_run(
    table: str = Query(..., description="推导表编号或名称，如 16 或 16 库源码差异；传 all 跑全部"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        if table.strip().lower() in {"all", "*", "全部"}:
            return derive_svc.run_all_derives(db)
        return derive_svc.run_derive(db, table)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/derive/{table}/candidates")
def derive_candidates(table: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        return derive_svc.list_candidates(db, table)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


class DeriveReviewBody(BaseModel):
    candidate_ids: list[int]
    status: str = Field(description="pending|ok|no")


@app.get("/api/trace")
def trace_by_key(key: str = Query(..., description="object_key 或 SCHEMA.TABLE.FIELD"), db: Session = Depends(get_db)) -> dict[str, Any]:
    """通用追溯：推导候选 key 或字段/表全名均可。"""
    return derive_svc.resolve_trace_key(db, key)


@app.get("/api/derive/candidates/{candidate_id}/trace")
def derive_candidate_trace(candidate_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """展开候选：返回对比两侧（如库04 vs 源码15）的原文事实。"""
    try:
        return derive_svc.trace_candidate(db, candidate_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/api/derive/review")
def derive_review(body: DeriveReviewBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        return derive_svc.set_review(db, body.candidate_ids, body.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/derive/{table}/apply")
def derive_apply(table: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        return derive_svc.apply_confirmed(db, table)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/api/analyze/auto")
def analyze_auto(db: Session = Depends(get_db)) -> dict[str, Any]:
    """一键：刷新字段统计 + 跑完全部推导表。"""
    return derive_svc.run_all_derives(db)


@app.get("/api/implicit-links")
def list_implicit(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(ImplicitLink).all()
    return [
        {
            "id": x.id,
            "find_system": x.find_system,
            "module_name": x.module_name,
            "entry_name": x.entry_name,
            "child_field": x.child_field,
            "parent_field": x.parent_field,
            "evidence": x.evidence,
            "code_location": x.code_location,
            "has_fk": x.has_fk,
            "evidence_source": x.evidence_source,
            "conclusion_level": x.conclusion_level,
            "applicability": x.applicability,
        }
        for x in rows
    ]


@app.post("/api/admin/refresh-stats")
def admin_refresh(db: Session = Depends(get_db)) -> dict[str, str]:
    refresh_field_stats(db)
    return {"status": "refreshed"}


@app.post("/api/admin/reseed")
def admin_reseed(db: Session = Depends(get_db)) -> dict[str, str]:
    """清空并重新灌入演示数据（仅本地演示用）。"""
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(delete(table))
    db.commit()
    seed_if_empty(db)
    return {"status": "reseeded"}


DIST = FRONTEND / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(DIST / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        # API / docs stay on FastAPI routes; everything else is the SPA shell.
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
elif (FRONTEND / "index.html").exists():
    # Dev fallback: old static shell if dist not built yet.
    assets = FRONTEND / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(FRONTEND / "index.html")
