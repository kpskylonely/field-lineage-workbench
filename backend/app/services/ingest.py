"""DMP 结构 Excel / 代码接口 Excel 导入。"""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from ..models import (
    DbField,
    DbObject,
    DictUsage,
    EntryPoint,
    InputMaterial,
    SystemModule,
)
from ..seed import refresh_field_stats

DMP_ALIASES: dict[str, tuple[str, ...]] = {
    "schema": ("数据库", "schema", "库名", "dbname"),
    "table": ("表名", "table", "tablename"),
    "table_comment": ("表注释", "表说明", "tablecomment"),
    "field": ("字段名", "field", "column", "columnname"),
    "field_comment": ("字段注释", "字段说明", "fieldcomment", "columncomment"),
    "data_type": ("数据类型", "类型", "datatype", "type"),
    "length": ("长度/精度", "长度", "精度", "length", "precision"),
    "scale": ("小数位", "scale"),
    "nullable": ("是否可空", "可空", "nullable"),
    "default": ("默认值", "default"),
    "pk": ("主键", "是否主键", "pk", "primarykey"),
    "fk": ("外键", "是否外键", "fk", "foreignkey"),
    "unique": ("唯一约束", "唯一", "unique"),
    "index": ("索引", "index"),
    "category": ("字段分类", "分类", "category"),
    "dict_type": ("字典类型", "dicttype"),
    "dict_name": ("字典/值域名称", "字典名称", "值域名称", "dictname"),
    "value_code": ("值编码", "valuecode", "code"),
    "value_label": ("值名称", "valuelabel", "label"),
    "dict_src_db": ("字典来源数据库", "dictsourcedb"),
    "dict_src_table": ("字典来源数据表", "字典来源表", "dictsourcetable"),
    "dict_src_field": ("字典来源字段", "dictsourcefield"),
    "is_core": ("是否核心字段", "核心字段", "iscore"),
    "code_used": ("是否代码使用", "代码使用"),
    "code_mode": ("代码使用方式", "usemode"),
    "remark": ("备注", "remark", "note"),
}

CODE_ALIASES: dict[str, tuple[str, ...]] = {
    "module": ("模块", "module"),
    "controller": ("controller类", "controller", "类名", "controllerclass"),
    "method": ("方法名", "method", "methodname"),
    "http_method": ("请求方式", "httpmethod", "methodtype", "http"),
    "url": ("接口url", "接口URL", "url", "path", "接口地址"),
    "params": ("入参", "params", "request", "参数"),
    "return_type": ("返回类型", "return", "returntype"),
    "file_path": ("文件路径", "filepath", "文件"),
}


def _norm(s: Any) -> str:
    if s is None:
        return ""
    t = str(s).strip().replace("\u3000", " ")
    t = re.sub(r"\s+", "", t)
    return t.lower()


def _truthy(v: Any) -> bool:
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)):
        return v != 0
    s = str(v).strip().lower()
    return s in {"1", "y", "yes", "true", "是", "有", "√", "pk", "fk"}


def _cell(row: dict[str, Any], key: str, aliases: dict[str, tuple[str, ...]]) -> Any:
    for a in aliases.get(key, ()):
        if a in row and row[a] not in (None, ""):
            return row[a]
        # normalized match
        for rk, rv in row.items():
            if _norm(rk) == _norm(a) and rv not in (None, ""):
                return rv
    return None


def _row_dict(headers: list[Any], values: list[Any]) -> dict[str, Any]:
    d: dict[str, Any] = {}
    for i, h in enumerate(headers):
        if h is None or str(h).strip() == "":
            continue
        d[str(h).strip()] = values[i] if i < len(values) else None
    return d


def _compose_type(base: Any, length: Any, scale: Any) -> str | None:
    b = (str(base).strip() if base not in (None, "") else "") or ""
    if not b:
        return None
    if "(" in b:
        return b
    ln = str(length).strip() if length not in (None, "") else ""
    sc = str(scale).strip() if scale not in (None, "") else ""
    if ln and sc and sc not in {"0", "0.0"}:
        return f"{b}({ln},{sc})"
    if ln:
        return f"{b}({ln})"
    return b


def detect_workbook_kind(content: bytes) -> str:
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        scores = {"dmp": 0, "code": 0}
        for name in wb.sheetnames[:5]:
            ws = wb[name]
            first = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
            if not first:
                continue
            headers = [_norm(h) for h in first if h is not None]
            joined = "|".join(headers)
            if "表名" in joined or "tablename" in joined or "字段名" in joined:
                scores["dmp"] += 3
            if "controller" in joined or "接口url" in joined or "接口url" in headers or "url" in headers:
                scores["code"] += 3
            if "模块" in joined and ("方法名" in joined or "请求方式" in joined):
                scores["code"] += 2
            if len(wb.sheetnames) > 1 and scores["dmp"] > 0:
                scores["dmp"] += 1
        if scores["dmp"] == 0 and scores["code"] == 0:
            return "unknown"
        return "dmp" if scores["dmp"] >= scores["code"] else "code"
    finally:
        wb.close()


def ingest_dmp_xlsx(
    db: Session,
    content: bytes,
    filename: str,
    *,
    replace: bool = False,
) -> dict[str, Any]:
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    warnings: list[str] = []
    schemas_seen: set[str] = set()
    objects: dict[tuple[str, str], str | None] = {}
    fields: dict[tuple[str, str, str], dict[str, Any]] = {}
    dicts: list[dict[str, Any]] = []

    try:
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows_iter = ws.iter_rows(values_only=True)
            header_row = next(rows_iter, None)
            if not header_row:
                warnings.append(f"空 sheet：{sheet_name}")
                continue
            headers = list(header_row)
            # need 表名 + 字段名
            sample = _row_dict(headers, [None] * len(headers))
            if _cell(sample, "table", DMP_ALIASES) is None and not any(
                _norm(h) in {_norm(a) for a in DMP_ALIASES["table"]} for h in headers if h
            ):
                warnings.append(f"跳过非结构 sheet：{sheet_name}")
                continue

            for values in rows_iter:
                if not values or all(v is None or str(v).strip() == "" for v in values):
                    continue
                row = _row_dict(headers, list(values))
                schema = str(_cell(row, "schema", DMP_ALIASES) or sheet_name).strip()
                if not schema:
                    warnings.append(f"{sheet_name}: 缺数据库名，已跳过一行")
                    continue
                if str(sheet_name).strip() and schema != str(sheet_name).strip():
                    warnings.append(
                        f"{sheet_name}: 行内数据库「{schema}」与 sheet 名不一致，以 sheet 为准"
                    )
                    schema = str(sheet_name).strip()
                table = str(_cell(row, "table", DMP_ALIASES) or "").strip()
                field = str(_cell(row, "field", DMP_ALIASES) or "").strip()
                if not table or not field:
                    continue
                schemas_seen.add(schema)
                table_comment = _cell(row, "table_comment", DMP_ALIASES)
                objects[(schema, table)] = (
                    str(table_comment).strip() if table_comment not in (None, "") else objects.get((schema, table))
                )
                data_type = _compose_type(
                    _cell(row, "data_type", DMP_ALIASES),
                    _cell(row, "length", DMP_ALIASES),
                    _cell(row, "scale", DMP_ALIASES),
                )
                extras = []
                for k, label in (
                    ("default", "默认"),
                    ("unique", "唯一"),
                    ("index", "索引"),
                    ("code_used", "代码使用"),
                    ("code_mode", "使用方式"),
                ):
                    v = _cell(row, k, DMP_ALIASES)
                    if v not in (None, ""):
                        extras.append(f"{label}={v}")
                remark = _cell(row, "remark", DMP_ALIASES)
                remark_parts = [str(remark).strip()] if remark not in (None, "") else []
                remark_parts.extend(extras)
                code_used = _truthy(_cell(row, "code_used", DMP_ALIASES))
                key = (schema, table, field)
                fields[key] = {
                    "schema_name": schema,
                    "table_name": table,
                    "field_name": field,
                    "field_comment": (
                        str(_cell(row, "field_comment", DMP_ALIASES)).strip()
                        if _cell(row, "field_comment", DMP_ALIASES) not in (None, "")
                        else None
                    ),
                    "field_category": (
                        str(_cell(row, "category", DMP_ALIASES)).strip()
                        if _cell(row, "category", DMP_ALIASES) not in (None, "")
                        else None
                    ),
                    "data_type": data_type,
                    "nullable": (
                        True
                        if _cell(row, "nullable", DMP_ALIASES) in (None, "")
                        else _truthy(_cell(row, "nullable", DMP_ALIASES))
                    ),
                    "is_pk": _truthy(_cell(row, "pk", DMP_ALIASES)),
                    "is_fk": _truthy(_cell(row, "fk", DMP_ALIASES)),
                    "dict_type": (
                        str(_cell(row, "dict_type", DMP_ALIASES) or _cell(row, "dict_name", DMP_ALIASES) or "").strip()
                        or None
                    ),
                    "dict_source_table": (
                        str(_cell(row, "dict_src_table", DMP_ALIASES)).strip()
                        if _cell(row, "dict_src_table", DMP_ALIASES) not in (None, "")
                        else None
                    ),
                    "is_core": _truthy(_cell(row, "is_core", DMP_ALIASES)),
                    "field_ref_status": "源码相关" if code_used else "待确认",
                    "remark": "；".join(remark_parts) or None,
                    "evidence_source": "DMP分析结果",
                    "conclusion_level": "已验证",
                    "applicability": "仅测试",
                }
                value_code = _cell(row, "value_code", DMP_ALIASES)
                dict_name = _cell(row, "dict_name", DMP_ALIASES) or _cell(row, "dict_type", DMP_ALIASES)
                if dict_name and value_code not in (None, ""):
                    dicts.append(
                        {
                            "record_type": "定义",
                            "dict_name": str(dict_name).strip(),
                            "value_code": str(value_code).strip(),
                            "value_label": (
                                str(_cell(row, "value_label", DMP_ALIASES)).strip()
                                if _cell(row, "value_label", DMP_ALIASES) not in (None, "")
                                else None
                            ),
                            "source_type": "DMP",
                            "source_schema": (
                                str(_cell(row, "dict_src_db", DMP_ALIASES)).strip()
                                if _cell(row, "dict_src_db", DMP_ALIASES) not in (None, "")
                                else schema
                            ),
                            "source_table": (
                                str(_cell(row, "dict_src_table", DMP_ALIASES)).strip()
                                if _cell(row, "dict_src_table", DMP_ALIASES) not in (None, "")
                                else None
                            ),
                            "source_field": (
                                str(_cell(row, "dict_src_field", DMP_ALIASES)).strip()
                                if _cell(row, "dict_src_field", DMP_ALIASES) not in (None, "")
                                else None
                            ),
                            "use_schema": schema,
                            "use_table": table,
                            "use_field": field,
                            "use_mode": (
                                str(_cell(row, "code_mode", DMP_ALIASES)).strip()
                                if _cell(row, "code_mode", DMP_ALIASES) not in (None, "")
                                else None
                            ),
                            "evidence_source": "DMP分析结果",
                            "conclusion_level": "已验证",
                            "applicability": "仅测试",
                        }
                    )
    finally:
        wb.close()

    if not fields:
        raise ValueError("未解析到任何字段行，请检查表头是否包含「表名」「字段名」")

    if replace and schemas_seen:
        for sch in schemas_seen:
            db.query(DbField).filter(DbField.schema_name == sch).delete(synchronize_session=False)
            db.query(DbObject).filter(DbObject.schema_name == sch).delete(synchronize_session=False)
            db.query(DictUsage).filter(
                (DictUsage.use_schema == sch) | (DictUsage.source_schema == sch)
            ).delete(synchronize_session=False)
        db.flush()

    obj_n = field_n = dict_n = 0
    for (schema, table), comment in objects.items():
        obj = (
            db.query(DbObject)
            .filter(DbObject.schema_name == schema, DbObject.object_name == table)
            .one_or_none()
        )
        if obj is None:
            obj = DbObject(
                schema_name=schema,
                object_type="TABLE",
                object_name=table,
                object_comment=comment,
                preliminary_class="业务表",
                evidence_source="DMP分析结果",
                conclusion_level="已验证",
                applicability="仅测试",
            )
            db.add(obj)
            obj_n += 1
        else:
            if comment:
                obj.object_comment = comment
            obj.evidence_source = "DMP分析结果"
            obj.conclusion_level = "已验证"
            obj_n += 1

    for payload in fields.values():
        f = (
            db.query(DbField)
            .filter(
                DbField.schema_name == payload["schema_name"],
                DbField.table_name == payload["table_name"],
                DbField.field_name == payload["field_name"],
            )
            .one_or_none()
        )
        if f is None:
            db.add(DbField(**payload))
        else:
            for k, v in payload.items():
                setattr(f, k, v)
        field_n += 1

    # 避免重复字典值：同名字典同码只留一条
    seen_dict: set[tuple[str, str, str, str]] = set()
    for d in dicts:
        key = (d["dict_name"], d.get("value_code") or "", d.get("use_table") or "", d.get("use_field") or "")
        if key in seen_dict:
            continue
        seen_dict.add(key)
        exists = (
            db.query(DictUsage)
            .filter(
                DictUsage.dict_name == d["dict_name"],
                DictUsage.value_code == d.get("value_code"),
                DictUsage.use_table == d.get("use_table"),
                DictUsage.use_field == d.get("use_field"),
            )
            .one_or_none()
        )
        if exists is None:
            db.add(DictUsage(**d))
            dict_n += 1

    material = InputMaterial(
        material_no=f"DMP-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        material_type="DMP分析结果Excel",
        path=filename,
        dmp_file=filename,
        version_matched=True,
        complete=True,
        evidence_source="导入",
        conclusion_level="已验证",
        applicability="仅测试",
        remark=f"schemas={','.join(sorted(schemas_seen))}; fields={field_n}",
    )
    db.add(material)
    db.commit()
    refresh_field_stats(db)

    return {
        "kind": "dmp",
        "filename": filename,
        "schemas": sorted(schemas_seen),
        "counts": {
            "objects": len(objects),
            "fields": field_n,
            "dicts": dict_n,
            "object_writes": obj_n,
        },
        "warnings": warnings[:50],
        "material_id": material.id,
    }


def ingest_code_xlsx(
    db: Session,
    content: bytes,
    filename: str,
    *,
    system_name: str,
    replace: bool = False,
) -> dict[str, Any]:
    system_name = system_name.strip()
    if not system_name:
        raise ValueError("导入代码分析结果必须指定 system_name")

    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    warnings: list[str] = []
    modules: set[str] = set()
    entries: list[dict[str, Any]] = []

    try:
        # 通常只有一个 sheet；遍历全部
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows_iter = ws.iter_rows(values_only=True)
            header_row = next(rows_iter, None)
            if not header_row:
                continue
            headers = list(header_row)
            ok = any(_norm(h) in {_norm(a) for a in CODE_ALIASES["module"]} for h in headers if h)
            ok = ok and (
                any(_norm(h) in {_norm(a) for a in CODE_ALIASES["url"]} for h in headers if h)
                or any(_norm(h) in {_norm(a) for a in CODE_ALIASES["controller"]} for h in headers if h)
            )
            if not ok:
                warnings.append(f"跳过非接口 sheet：{sheet_name}")
                continue
            for values in rows_iter:
                if not values or all(v is None or str(v).strip() == "" for v in values):
                    continue
                row = _row_dict(headers, list(values))
                module = str(_cell(row, "module", CODE_ALIASES) or "").strip()
                url = str(_cell(row, "url", CODE_ALIASES) or "").strip()
                http = str(_cell(row, "http_method", CODE_ALIASES) or "GET").strip().upper()
                if not module or not url:
                    warnings.append(f"{sheet_name}: 缺模块或 URL，已跳过")
                    continue
                modules.add(module)
                entry_name = f"{http} {url}" if not url.upper().startswith(("GET ", "POST ", "PUT ", "DELETE ", "PATCH ")) else url
                entries.append(
                    {
                        "system_name": system_name,
                        "module_name": module,
                        "entry_type": "API",
                        "entry_name": entry_name,
                        "entry_class": (
                            str(_cell(row, "controller", CODE_ALIASES)).strip()
                            if _cell(row, "controller", CODE_ALIASES) not in (None, "")
                            else None
                        ),
                        "method_name": (
                            str(_cell(row, "method", CODE_ALIASES)).strip()
                            if _cell(row, "method", CODE_ALIASES) not in (None, "")
                            else None
                        ),
                        "request_params": (
                            str(_cell(row, "params", CODE_ALIASES)).strip()
                            if _cell(row, "params", CODE_ALIASES) not in (None, "")
                            else None
                        ),
                        "return_type": (
                            str(_cell(row, "return_type", CODE_ALIASES)).strip()
                            if _cell(row, "return_type", CODE_ALIASES) not in (None, "")
                            else None
                        ),
                        "file_path": (
                            str(_cell(row, "file_path", CODE_ALIASES)).strip()
                            if _cell(row, "file_path", CODE_ALIASES) not in (None, "")
                            else None
                        ),
                        "accesses_db": True,
                        "in_table15": False,
                        "field_confirm_level": "待确认",
                        "evidence_source": "代码分析结果",
                        "conclusion_level": "已验证",
                        "applicability": "仅测试",
                    }
                )
    finally:
        wb.close()

    if not entries:
        raise ValueError("未解析到任何接口行，请检查表头是否包含「模块」「接口URL」")

    if replace:
        db.query(EntryPoint).filter(EntryPoint.system_name == system_name).delete(synchronize_session=False)
        db.query(SystemModule).filter(SystemModule.system_name == system_name).delete(synchronize_session=False)
        db.flush()

    mod_n = 0
    for module in modules:
        m = (
            db.query(SystemModule)
            .filter(SystemModule.system_name == system_name, SystemModule.module_name == module)
            .one_or_none()
        )
        if m is None:
            db.add(
                SystemModule(
                    system_name=system_name,
                    module_name=module,
                    duty="代码分析结果导入",
                    evidence_source="代码分析结果",
                    conclusion_level="已验证",
                    applicability="仅测试",
                )
            )
            mod_n += 1

    ent_n = 0
    for payload in entries:
        e = (
            db.query(EntryPoint)
            .filter(
                EntryPoint.system_name == payload["system_name"],
                EntryPoint.module_name == payload["module_name"],
                EntryPoint.entry_name == payload["entry_name"],
            )
            .one_or_none()
        )
        if e is None:
            db.add(EntryPoint(**payload))
        else:
            for k, v in payload.items():
                setattr(e, k, v)
        ent_n += 1

    material = InputMaterial(
        material_no=f"CODE-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        material_type="代码分析结果Excel",
        system_name=system_name,
        path=filename,
        version_matched=True,
        complete=True,
        evidence_source="导入",
        conclusion_level="已验证",
        applicability="仅测试",
        remark=f"system={system_name}; entries={ent_n}",
    )
    db.add(material)
    db.commit()

    return {
        "kind": "code",
        "filename": filename,
        "system": system_name,
        "counts": {"modules": len(modules), "entries": ent_n, "module_writes": mod_n},
        "warnings": warnings[:50],
        "material_id": material.id,
    }
