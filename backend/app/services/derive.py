"""自动分析推导引擎：从已落库的 03/04/15 等事实表生成候选结果。

推导表（与前端过程页一致）：
  10 生产待补充需求 · 16 库源码差异 · 17 隐式关联 · 18 孤儿对象候选
  22 物理关系 · 24 现状问题清单 · 25 重构风险评估 · 26 改进建议清单 · 28 生产结构差异
"""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models import (
    DbField,
    DbObject,
    DeriveBatch,
    DeriveCandidate,
    FieldReference,
    ImplicitLink,
    Issue,
)
from ..seed import refresh_field_stats

# 前端表名 → 短码
TABLE_META: dict[str, dict[str, Any]] = {
    "10": {
        "name": "10 生产待补充需求",
        "rule": "字段在测试库有定义但零引用，或结论仅适用测试，需生产侧补证。",
        "logic": [
            "从「04 字段主表」读取零命中 / 推断级字段",
            "筛选适用范围含测试或待生产验证的对象",
            "输出生产待补充需求候选，按置信度排序供人工确认",
        ],
        "columns": ["对象", "缺口类型", "当前证据", "建议动作"],
        "deps": ["04 字段主表", "08 测试数据存在性"],
    },
    "16": {
        "name": "16 库源码差异",
        "rule": "逐字段比对库结构（表04）与源码引用（表15），标注存在性与多写冲突。",
        "logic": [
            "从「04 字段主表」读取每个 表.字段",
            "从「15 字段引用明细」统计引用面与操作类型",
            "库有码无 / 码有库无 / 多入口写同一字段 → 记为差异",
            "按影响程度与置信度给出处理建议，逐条供人工确认",
        ],
        "columns": ["差异对象", "差异类型", "库侧 (04)", "源码侧 (15)", "建议"],
        "deps": ["04 字段主表", "15 字段引用明细"],
    },
    "17": {
        "name": "17 隐式关联",
        "rule": "同源命名 / 角色后缀字段跨表共现且无 FK 时，推断为隐式关联。",
        "logic": [
            "在「04」中找出同名 *_ID / *_CODE，以及 CREATE_USER_ID→USER_ID 等角色映射",
            "优先配对「子表非 PK ↔ 父表 PK」",
            "双侧均在「15」被引用 → 高置信；仅命名启发 → 中/低置信",
        ],
        "columns": ["子端字段", "父端字段", "关联依据", "是否已有FK", "建议"],
        "deps": ["04 字段主表", "15 字段引用明细"],
    },
    "18": {
        "name": "18 孤儿对象候选",
        "rule": "对象总览中无任何表15引用命中的表/对象，列为孤儿候选。",
        "logic": [
            "读取「03 对象总览」全部 TABLE",
            "与「15」按 schema+表名求差集",
            "无引用命中 → 孤儿对象候选",
        ],
        "columns": ["对象", "类型", "引用命中", "建议"],
        "deps": ["03 对象总览", "15 字段引用明细"],
    },
    "22": {
        "name": "22 物理关系",
        "rule": "由已确认隐式关联与 FK 标记推导物理关系清单。",
        "logic": [
            "读取「17 隐式关联」候选（含本次推导）",
            "读取「04」中 is_fk=True 的字段",
            "合并去重输出物理关系候选",
        ],
        "columns": ["关系", "类型", "依据", "建议"],
        "deps": ["05 约束清单", "17 隐式关联"],
    },
    "24": {
        "name": "24 现状问题清单",
        "rule": "汇总库源码差异、隐式关联、孤儿对象三类发现，归并为统一问题清单。",
        "logic": [
            "收集「16」中的结构不一致项（最近批次）",
            "收集「17」中缺少外键约束的关系",
            "收集「18」中疑似无用对象",
            "按对象归并去重，标注问题类别与优先级",
        ],
        "columns": ["问题对象", "问题类别", "来源发现", "优先级"],
        "deps": ["16 库源码差异", "17 隐式关联", "18 孤儿对象候选"],
    },
    "25": {
        "name": "25 重构风险评估",
        "rule": "结合字段引用面（表15）与现状问题（表24），对变更对象评估风险等级。",
        "logic": [
            "从「15/04」统计每个字段被引用的接口数与系统数",
            "从「24」匹配该对象是否存在已知问题",
            "引用面越广 + 问题越严重 → 风险等级越高",
            "输出风险等级与处理建议，供重构决策确认",
        ],
        "columns": ["风险对象", "引用面", "关联问题", "风险等级"],
        "deps": ["15 字段引用明细", "24 现状问题清单"],
    },
    "26": {
        "name": "26 改进建议清单",
        "rule": "基于问题与风险生成可执行改进建议。",
        "logic": [
            "读取「24 现状问题」与「25 重构风险」最近批次",
            "按类别映射标准改进动作",
            "输出建议清单供确认后纳入改造计划",
        ],
        "columns": ["对象", "建议动作", "依据", "优先级"],
        "deps": ["24 现状问题清单", "25 重构风险评估"],
    },
    "28": {
        "name": "28 生产结构差异",
        "rule": "当前基线中标记待生产验证的对象，列为生产结构核对项。",
        "logic": [
            "扫描字段/问题中适用范围含「生产」或 needs_prod 的项",
            "输出生产环境结构差异核对清单",
        ],
        "columns": ["对象", "差异说明", "当前适用范围", "建议"],
        "deps": ["03 对象总览", "04 字段主表"],
    },
}
NAME_TO_CODE = {v["name"]: k for k, v in TABLE_META.items()}

# CREATE_USER_ID / ASSIGNEE_ID → USER_ID 等角色后缀映射
ROLE_TO_PARENT: dict[str, str] = {
    "CREATE_USER_ID": "USER_ID",
    "UPDATE_USER_ID": "USER_ID",
    "ASSIGNEE_ID": "USER_ID",
    "OWNER_ID": "USER_ID",
    "OPERATOR_ID": "USER_ID",
    "APPROVER_ID": "USER_ID",
}


def resolve_table_code(name_or_code: str) -> str:
    if name_or_code in TABLE_META:
        return name_or_code
    if name_or_code in NAME_TO_CODE:
        return NAME_TO_CODE[name_or_code]
    for code, meta in TABLE_META.items():
        if meta["name"].startswith(name_or_code) or name_or_code.startswith(code):
            return code
    raise KeyError(f"未知推导表: {name_or_code}")


def _fq(schema: str, table: str, field: str | None = None) -> str:
    base = f"{schema}.{table}"
    return f"{base}.{field}" if field else base


def _add_candidate(
    rows: list[dict[str, Any]],
    *,
    object_key: str,
    cells: list[str],
    evidence: list[dict[str, str]],
    note: str | None = None,
    confidence: int = 50,
) -> None:
    rows.append(
        {
            "object_key": object_key,
            "cells": cells,
            "evidence": evidence,
            "note": note,
            "confidence": max(0, min(100, confidence)),
        }
    )


def _latest_batch_candidates(db: Session, table_code: str) -> list[DeriveCandidate]:
    batch = (
        db.query(DeriveBatch)
        .filter(DeriveBatch.table_code == table_code, DeriveBatch.status == "done")
        .order_by(DeriveBatch.id.desc())
        .first()
    )
    if not batch:
        return []
    return (
        db.query(DeriveCandidate)
        .filter(
            DeriveCandidate.table_code == table_code,
            DeriveCandidate.batch_id == batch.batch_id,
            DeriveCandidate.review_status != "no",
        )
        .all()
    )


def derive_16(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    fields = db.query(DbField).all()
    field_keys = {(f.schema_name, f.table_name, f.field_name) for f in fields}

    for f in fields:
        if f.source_ref_count == 0:
            conf = 85 if not f.is_core else 70
            _add_candidate(
                rows,
                object_key=f"db_only:{_fq(f.schema_name, f.table_name, f.field_name)}",
                cells=[
                    _fq(f.schema_name, f.table_name, f.field_name),
                    "库有码无",
                    f"{f.data_type or '—'} · {f.field_comment or '无注释'}",
                    "表15 零命中",
                    "确认是否废弃或补扫源码",
                ],
                evidence=[
                    {"t": "04 字段主表", "ref": f"{f.field_name} · {f.data_type or '—'}"},
                    {"t": "15 字段引用明细", "ref": "0 处引用"},
                ],
                note="源码未发现对该字段的访问",
                confidence=conf,
            )

    refs = db.query(FieldReference).all()
    seen_missing: set[tuple[str, str, str]] = set()
    missing_entries: dict[tuple[str, str, str], list[FieldReference]] = defaultdict(list)
    for r in refs:
        key = (r.schema_name, r.table_name, r.field_name)
        if key in field_keys:
            continue
        missing_entries[key].append(r)
        if key in seen_missing:
            continue
        seen_missing.add(key)

    for key, rlist in missing_entries.items():
        systems = {r.system_name for r in rlist}
        conf = 95 if len(systems) >= 2 else 80
        sample = rlist[0]
        _add_candidate(
            rows,
            object_key=f"code_only:{_fq(*key)}",
            cells=[
                _fq(*key),
                "码有库无",
                "—",
                f"{len(rlist)} 处引用 · {len(systems)} 系统",
                "补 DDL 或修正源码映射",
            ],
            evidence=[
                {"t": "15 字段引用明细", "ref": f"{sample.entry_name} · {sample.op_type}"},
            ],
            note="引用事实指向的字段在表04中不存在",
            confidence=conf,
        )

    writers: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for r in refs:
        if r.op_type in {"UPDATE", "INSERT", "DELETE"}:
            writers[(r.schema_name, r.table_name, r.field_name)].add(r.entry_name)
    for key, entries in writers.items():
        if len(entries) < 2:
            continue
        _add_candidate(
            rows,
            object_key=f"multi_write:{_fq(*key)}",
            cells=[
                _fq(*key),
                "多入口写入",
                "字段存在于表04" if key in field_keys else "库侧未见定义",
                f"{len(entries)} 个入口写：{', '.join(sorted(entries)[:3])}",
                "明确权威写入方，避免语义冲突",
            ],
            evidence=[
                {"t": "15 字段引用明细", "ref": f"{len(entries)} 处写操作"},
            ],
            confidence=90,
        )

    return rows


def derive_17(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    fields = db.query(DbField).all()
    by_name: dict[str, list[DbField]] = defaultdict(list)
    for f in fields:
        by_name[f.field_name.upper()].append(f)

    ref_tables = {
        (r.schema_name, r.table_name, r.field_name.upper())
        for r in db.query(FieldReference).all()
    }

    emitted: set[str] = set()

    def emit(child: DbField, parent: DbField, basis: str, conf: int) -> None:
        if (child.schema_name, child.table_name) == (parent.schema_name, parent.table_name):
            return
        child_fq = _fq(child.schema_name, child.table_name, child.field_name)
        parent_fq = _fq(parent.schema_name, parent.table_name, parent.field_name)
        key = f"impl:{child_fq}->{parent_fq}"
        if key in emitted:
            return
        emitted.add(key)
        both_ref = (
            child.schema_name,
            child.table_name,
            child.field_name.upper(),
        ) in ref_tables and (
            parent.schema_name,
            parent.table_name,
            parent.field_name.upper(),
        ) in ref_tables
        if both_ref:
            conf = min(100, conf + 15)
        elif conf < 40:
            conf = 40
        _add_candidate(
            rows,
            object_key=key,
            cells=[
                child_fq,
                parent_fq,
                basis + (" · 双侧均有源码引用" if both_ref else " · 命名推断"),
                "是" if child.is_fk else "否",
                "核对父表与级联" if child.is_fk else "补 FK 或在代码层固化关联约束",
            ],
            evidence=[
                {"t": "04 字段主表", "ref": basis},
                {"t": "15 字段引用明细", "ref": "双侧引用" if both_ref else "命名启发"},
            ],
            confidence=conf,
        )

    # 1) 同名 *_ID / *_CODE 跨表
    for name, group in by_name.items():
        if not (name.endswith("_ID") or name.endswith("_CODE") or name in {"ID", "CODE"}):
            continue
        if len(group) < 2:
            continue
        pks = [f for f in group if f.is_pk]
        non_pks = [f for f in group if not f.is_pk]
        if pks and non_pks:
            for parent in pks:
                for child in non_pks:
                    emit(child, parent, f"同名 {name} · 子→父PK", 78)
        else:
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    # 偏好：is_pk 作为父
                    if a.is_pk and not b.is_pk:
                        emit(b, a, f"同名 {name}", 65)
                    elif b.is_pk and not a.is_pk:
                        emit(a, b, f"同名 {name}", 65)
                    else:
                        emit(a, b, f"同名 {name} · 对等共现", 55)

    # 2) 角色后缀 → 标准父键（CREATE_USER_ID → USER_ID）
    for child in fields:
        cname = child.field_name.upper()
        if cname not in ROLE_TO_PARENT:
            continue
        parent_name = ROLE_TO_PARENT[cname]
        for parent in by_name.get(parent_name, []):
            if parent.is_pk or parent.field_name.upper() == parent_name:
                emit(
                    child,
                    parent,
                    f"角色映射 {cname}→{parent_name}",
                    72 if parent.is_pk else 60,
                )

    # 按置信度排序，限制爆炸
    rows.sort(key=lambda r: (-r["confidence"], r["object_key"]))
    return rows[:40]


def derive_18(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    referenced = {
        (r.schema_name, r.table_name) for r in db.query(FieldReference).all()
    }
    for obj in db.query(DbObject).filter(DbObject.object_type == "TABLE").all():
        hit = (obj.schema_name, obj.object_name) in referenced
        if hit and obj.referenced_by_code:
            continue
        conf = 88 if not hit else 55
        _add_candidate(
            rows,
            object_key=f"orphan:{obj.schema_name}.{obj.object_name}",
            cells=[
                f"{obj.schema_name}.{obj.object_name}",
                obj.object_type,
                "有引用" if hit else "无引用命中",
                "生产确认后归档或纳入扫描白名单",
            ],
            evidence=[
                {"t": "03 对象总览", "ref": obj.object_name},
                {"t": "15 字段引用明细", "ref": "无引用命中" if not hit else "弱引用"},
            ],
            confidence=conf,
        )
    return rows


def derive_10(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for f in db.query(DbField).all():
        need = (
            f.field_ref_status == "零命中"
            or "生产" in (f.applicability or "")
            or f.conclusion_level == "推断"
        )
        if not need:
            continue
        if f.field_ref_status != "零命中" and f.applicability == "可能适用生产":
            continue
        gap = "零引用待生产核实" if f.field_ref_status == "零命中" else "证据仅测试范围"
        conf = 80 if f.field_ref_status == "零命中" else 60
        _add_candidate(
            rows,
            object_key=f"prod_gap:{_fq(f.schema_name, f.table_name, f.field_name)}",
            cells=[
                _fq(f.schema_name, f.table_name, f.field_name),
                gap,
                f"{f.conclusion_level} / {f.applicability}",
                "生产抽样或补扫生产库结构",
            ],
            evidence=[{"t": "04 字段主表", "ref": f"{f.field_name} · {f.field_ref_status}"}],
            confidence=conf,
        )
    rows.sort(key=lambda r: -r["confidence"])
    return rows


def derive_22(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for link in db.query(ImplicitLink).all():
        _add_candidate(
            rows,
            object_key=f"phys:seed:{link.child_field}->{link.parent_field}",
            cells=[
                f"{link.child_field} → {link.parent_field}",
                "隐式关联",
                link.evidence or "表17",
                "评估是否升级为物理外键",
            ],
            evidence=[{"t": "17 隐式关联", "ref": link.child_field}],
            confidence=75 if link.conclusion_level == "已确认" else 60,
        )
    for c in _latest_batch_candidates(db, "17"):
        cells = json.loads(c.cells_json)
        if len(cells) < 2:
            continue
        _add_candidate(
            rows,
            object_key=f"phys:derive:{c.object_key}",
            cells=[
                f"{cells[0]} → {cells[1]}",
                "推导关联",
                cells[2] if len(cells) > 2 else "命名共现",
                cells[4] if len(cells) > 4 else "确认后固化",
            ],
            evidence=[{"t": "17 隐式关联", "ref": c.object_key}],
            confidence=max(50, c.confidence - 5),
        )
    for f in db.query(DbField).filter(DbField.is_fk.is_(True)).all():
        _add_candidate(
            rows,
            object_key=f"phys:fk:{_fq(f.schema_name, f.table_name, f.field_name)}",
            cells=[
                _fq(f.schema_name, f.table_name, f.field_name),
                "已声明 FK",
                "表04 is_fk=true",
                "核对父表与级联策略",
            ],
            evidence=[{"t": "04 字段主表", "ref": f"{f.field_name} · FK"}],
            confidence=92,
        )
    return rows


def derive_24(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    mapping = {
        "16": ("结构差异", "高", 0),
        "17": ("缺少外键约束", "中", -5),
        "18": ("疑似无用对象", "低", 0),
    }
    seen_obj: set[str] = set()
    for code, (category, priority, conf_adj) in mapping.items():
        for c in _latest_batch_candidates(db, code):
            cells = json.loads(c.cells_json)
            obj = cells[0] if cells else c.object_key
            dedupe = f"{category}:{obj}"
            if dedupe in seen_obj:
                continue
            seen_obj.add(dedupe)
            # 17 已有 FK 的不进问题清单
            if code == "17" and len(cells) > 3 and cells[3] == "是":
                continue
            src = TABLE_META[code]["name"]
            _add_candidate(
                rows,
                object_key=f"issue:{code}:{c.object_key}",
                cells=[obj, category, src.split(" ", 1)[0] + "发现", priority],
                evidence=[{"t": src, "ref": cells[1] if len(cells) > 1 else c.object_key}],
                confidence=max(40, min(95, c.confidence + conf_adj)),
            )
    for i in db.query(Issue).all():
        dedupe = f"{i.category}:{i.object_name}"
        if dedupe in seen_obj:
            continue
        seen_obj.add(dedupe)
        _add_candidate(
            rows,
            object_key=f"issue:db:{i.issue_no}",
            cells=[i.object_name, i.category, i.derived_from or "已登记", i.risk],
            evidence=[{"t": "24 现状问题清单", "ref": i.issue_no}],
            note=i.description[:80] if i.description else None,
            confidence=70 if i.conclusion_level == "已确认" else 55,
        )
    rows.sort(key=lambda r: (-{"高": 3, "中": 2, "低": 1}.get(r["cells"][3], 0), -r["confidence"]))
    return rows


def derive_25(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    issue_by_obj: dict[str, list[Issue]] = defaultdict(list)
    for i in db.query(Issue).all():
        issue_by_obj[i.object_name].append(i)

    # 也纳入最近 24 候选
    pending_issues: dict[str, str] = {}
    for c in _latest_batch_candidates(db, "24"):
        cells = json.loads(c.cells_json)
        if cells:
            pending_issues[cells[0]] = cells[1] if len(cells) > 1 else "问题"

    for f in db.query(DbField).all():
        if f.source_ref_count == 0 and not f.is_core:
            continue
        fq = _fq(f.schema_name, f.table_name, f.field_name)
        related = (
            issue_by_obj.get(fq)
            or issue_by_obj.get(f.field_name)
            or issue_by_obj.get(f"{f.table_name}.{f.field_name}")
            or []
        )
        if not related:
            related = [i for i in db.query(Issue).all() if f.field_name in (i.object_name or "")]

        pending_cat = pending_issues.get(fq)

        if f.ref_entry_count >= 3 or f.ref_system_count >= 2:
            risk = "高"
            conf = 85
        elif related or pending_cat or f.ref_entry_count >= 1:
            risk = "中" if (related or pending_cat) else "低"
            conf = 70 if related or pending_cat else 55
        else:
            if not f.is_core:
                continue
            risk = "低"
            conf = 50

        if related:
            if any(i.risk == "高" for i in related) or risk == "高":
                risk = "高"
                conf = max(conf, 88)
            elif risk == "低":
                risk = "中"

        surface = f"{f.ref_entry_count} 接口 / {f.ref_system_count} 系统"
        issue_txt = related[0].category if related else (pending_cat or "无")
        _add_candidate(
            rows,
            object_key=f"risk:{fq}",
            cells=[fq, surface, issue_txt, risk],
            evidence=[
                {"t": "15 字段引用明细", "ref": f"{f.field_name} · {f.source_ref_count} 处"},
                *([{"t": "24 现状问题清单", "ref": related[0].issue_no}] if related else []),
            ],
            note="引用面广，变更需设置兼容期" if risk == "高" else None,
            confidence=conf,
        )
    rows.sort(key=lambda r: (-{"高": 3, "中": 2, "低": 1}.get(r["cells"][3], 0), -r["confidence"]))
    return rows


def derive_26(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    advice_map = {
        "库有码无": "生产确认使用率后归档或删除",
        "码有库无": "补齐 DDL 或修正 ORM 映射",
        "多入口写入": "收敛权威写入入口，状态走事件",
        "缺少外键约束": "评估补 FK 或代码层校验",
        "疑似无用对象": "确认后下线或移入归档区",
        "引用耦合": "改造前强制导出表15引用清单",
        "结构差异": "对齐库结构与源码定义",
        "重构风险": "变更前导出引用面并设兼容窗口",
        "无FK高依赖": "补约束或质量校验任务",
        "多写冲突": "收敛权威写入入口",
    }
    seen: set[str] = set()
    for code in ("24", "25"):
        for c in _latest_batch_candidates(db, code):
            cells = json.loads(c.cells_json)
            obj = cells[0] if cells else c.object_key
            cat = cells[1] if len(cells) > 1 else ""
            if code == "25":
                cat = cells[2] if len(cells) > 2 and cells[2] != "无" else "重构风险"
                priority = cells[3] if len(cells) > 3 else "中"
            else:
                priority = cells[3] if len(cells) > 3 else cells[-1] if cells else "中"
            dedupe = f"{obj}:{advice_map.get(cat, cat)}"
            if dedupe in seen:
                continue
            seen.add(dedupe)
            action = advice_map.get(cat, "纳入重构清单并指定责任人")
            _add_candidate(
                rows,
                object_key=f"advice:{code}:{c.object_key}",
                cells=[obj, action, cat or c.table_code, priority],
                evidence=[{"t": TABLE_META[code]["name"], "ref": obj}],
                confidence=max(45, c.confidence - 5),
            )
    for i in db.query(Issue).all():
        action = i.suggestion or advice_map.get(i.category, "跟进改造")
        dedupe = f"{i.object_name}:{action}"
        if dedupe in seen:
            continue
        seen.add(dedupe)
        _add_candidate(
            rows,
            object_key=f"advice:issue:{i.issue_no}",
            cells=[i.object_name, action, i.category, i.risk],
            evidence=[{"t": "24 现状问题清单", "ref": i.issue_no}],
            confidence=65,
        )
    return rows


def derive_28(db: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for f in db.query(DbField).all():
        if f.applicability in {"仅测试", "待生产验证"} or f.conclusion_level == "推断":
            conf = 75 if f.applicability == "待生产验证" else 55
            _add_candidate(
                rows,
                object_key=f"prod_struct:{_fq(f.schema_name, f.table_name, f.field_name)}",
                cells=[
                    _fq(f.schema_name, f.table_name, f.field_name),
                    "测试结论待生产核对",
                    f.applicability,
                    "生产环境结构比对",
                ],
                evidence=[{"t": "04 字段主表", "ref": f"{f.field_name} · {f.applicability}"}],
                confidence=conf,
            )
    for i in db.query(Issue).filter(Issue.needs_prod.is_(True)).all():
        _add_candidate(
            rows,
            object_key=f"prod_struct:issue:{i.issue_no}",
            cells=[
                i.object_name,
                (i.description or "")[:60],
                "问题需生产补证",
                i.suggestion or "生产验证",
            ],
            evidence=[{"t": "24 现状问题清单", "ref": i.issue_no}],
            confidence=70,
        )
    return rows


DERIVERS = {
    "10": derive_10,
    "16": derive_16,
    "17": derive_17,
    "18": derive_18,
    "22": derive_22,
    "24": derive_24,
    "25": derive_25,
    "26": derive_26,
    "28": derive_28,
}

RUN_ORDER = ["16", "17", "18", "10", "22", "24", "25", "26", "28"]


def run_derive(db: Session, table_code: str, *, replace: bool = True) -> dict[str, Any]:
    code = resolve_table_code(table_code)
    meta = TABLE_META[code]
    fn = DERIVERS[code]
    batch_id = uuid.uuid4().hex[:12]
    batch = DeriveBatch(
        batch_id=batch_id,
        table_code=code,
        table_name=meta["name"],
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(batch)
    db.flush()

    # 保留人工确认状态（按 object_key）
    prev_reviews: dict[str, str] = {}
    if replace:
        for c in db.query(DeriveCandidate).filter(DeriveCandidate.table_code == code).all():
            prev_reviews[c.object_key] = c.review_status
        db.query(DeriveCandidate).filter(DeriveCandidate.table_code == code).delete()

    raw = fn(db)
    seen: set[str] = set()
    uniq_rows = []
    for r in raw:
        if r["object_key"] in seen:
            continue
        seen.add(r["object_key"])
        uniq_rows.append(r)

    uniq_rows.sort(key=lambda r: (-r.get("confidence", 50), r["object_key"]))

    for r in uniq_rows:
        status = prev_reviews.get(r["object_key"], "pending")
        # 已应用的保持 applied；存疑/确认保留
        if status not in {"pending", "ok", "no", "applied"}:
            status = "pending"
        db.add(
            DeriveCandidate(
                batch_id=batch_id,
                table_code=code,
                table_name=meta["name"],
                object_key=r["object_key"],
                cells_json=json.dumps(r["cells"], ensure_ascii=False),
                evidence_json=json.dumps(r["evidence"], ensure_ascii=False),
                note=r.get("note"),
                confidence=int(r.get("confidence", 50)),
                review_status=status,
                evidence_source="推导引擎",
                conclusion_level="推断" if status == "pending" else ("已确认" if status in {"ok", "applied"} else "存疑"),
                applicability="仅测试",
            )
        )

    batch.candidate_count = len(uniq_rows)
    batch.status = "done"
    batch.finished_at = datetime.utcnow()
    db.commit()
    return {
        "batch_id": batch_id,
        "table_code": code,
        "table_name": meta["name"],
        "candidate_count": len(uniq_rows),
        "rule": meta["rule"],
        "logic": meta["logic"],
        "columns": meta["columns"],
        "deps": meta["deps"],
        "preserved_reviews": sum(1 for s in prev_reviews.values() if s != "pending"),
    }


def run_all_derives(db: Session) -> dict[str, Any]:
    refresh_field_stats(db)
    results = []
    for code in RUN_ORDER:
        results.append(run_derive(db, code, replace=True))
    return {
        "ran": len(results),
        "total_candidates": sum(r["candidate_count"] for r in results),
        "results": results,
    }


def list_candidates(db: Session, table_code: str) -> dict[str, Any]:
    code = resolve_table_code(table_code)
    meta = TABLE_META[code]
    items = (
        db.query(DeriveCandidate)
        .filter(DeriveCandidate.table_code == code)
        .order_by(DeriveCandidate.confidence.desc(), DeriveCandidate.id.asc())
        .all()
    )
    batch = (
        db.query(DeriveBatch)
        .filter(DeriveBatch.table_code == code, DeriveBatch.status == "done")
        .order_by(DeriveBatch.id.desc())
        .first()
    )
    return {
        "table_code": code,
        "table_name": meta["name"],
        "rule": meta["rule"],
        "logic": meta["logic"],
        "columns": meta["columns"],
        "deps": meta["deps"],
        "batch_id": batch.batch_id if batch else None,
        "updated_at": batch.finished_at.isoformat() + "Z" if batch and batch.finished_at else None,
        "rows": [
            {
                "id": c.id,
                "object_key": c.object_key,
                "cells": json.loads(c.cells_json),
                "evidence": json.loads(c.evidence_json),
                "note": c.note,
                "confidence": c.confidence,
                "review_status": c.review_status,
            }
            for c in items
        ],
        "stats": {
            "total": len(items),
            "pending": sum(1 for c in items if c.review_status == "pending"),
            "ok": sum(1 for c in items if c.review_status == "ok"),
            "no": sum(1 for c in items if c.review_status == "no"),
            "applied": sum(1 for c in items if c.review_status == "applied"),
            "avg_confidence": round(sum(c.confidence for c in items) / len(items)) if items else 0,
        },
    }


def summary(db: Session) -> dict[str, Any]:
    """过程页用：各推导表最近批次统计。"""
    tables = []
    total = 0
    for code, meta in TABLE_META.items():
        batch = (
            db.query(DeriveBatch)
            .filter(DeriveBatch.table_code == code, DeriveBatch.status == "done")
            .order_by(DeriveBatch.id.desc())
            .first()
        )
        items = (
            db.query(DeriveCandidate).filter(DeriveCandidate.table_code == code).all()
            if batch
            else []
        )
        st = {
            "table_code": code,
            "table_name": meta["name"],
            "batch_id": batch.batch_id if batch else None,
            "updated_at": batch.finished_at.isoformat() + "Z" if batch and batch.finished_at else None,
            "total": len(items),
            "pending": sum(1 for c in items if c.review_status == "pending"),
            "ok": sum(1 for c in items if c.review_status == "ok"),
            "no": sum(1 for c in items if c.review_status == "no"),
            "applied": sum(1 for c in items if c.review_status == "applied"),
        }
        total += st["total"]
        tables.append(st)
    return {"tables": tables, "total_candidates": total}


def set_review(db: Session, candidate_ids: list[int], status: str) -> dict[str, Any]:
    if status not in {"pending", "ok", "no"}:
        raise ValueError("status 必须是 pending|ok|no")
    updated = 0
    for cid in candidate_ids:
        c = db.get(DeriveCandidate, cid)
        if not c:
            continue
        if c.review_status == "applied":
            continue
        c.review_status = status
        c.conclusion_level = "已确认" if status == "ok" else ("存疑" if status == "no" else "推断")
        updated += 1
    db.commit()
    return {"updated": updated, "status": status}


def _parse_fq_field(fq: str) -> tuple[str, str, str] | None:
    parts = fq.split(".")
    if len(parts) < 3:
        return None
    return parts[0], parts[1], ".".join(parts[2:])  # rare multi-dot field


def _parse_fq_table(fq: str) -> tuple[str, str] | None:
    parts = fq.split(".")
    if len(parts) < 2:
        return None
    return parts[0], parts[1]


def _field_props(f: DbField) -> list[dict[str, str]]:
    return [
        {"k": "全名", "v": _fq(f.schema_name, f.table_name, f.field_name)},
        {"k": "注释", "v": f.field_comment or "—"},
        {"k": "类型", "v": f.data_type or "—"},
        {"k": "可空", "v": "是" if f.nullable else "否"},
        {"k": "主键", "v": "是" if f.is_pk else "否"},
        {"k": "外键", "v": "是" if f.is_fk else "否"},
        {"k": "核心", "v": "是" if f.is_core else "否"},
        {"k": "引用状态", "v": f.field_ref_status or "—"},
        {"k": "源码引用数", "v": str(f.source_ref_count or 0)},
        {"k": "结论等级", "v": f.conclusion_level or "—"},
        {"k": "适用范围", "v": f.applicability or "—"},
        {"k": "证据来源", "v": f.evidence_source or "—"},
    ]


def _ref_row(r: FieldReference) -> dict[str, str]:
    return {
        "system": r.system_name,
        "module": r.module_name,
        "entry": r.entry_name,
        "op": r.op_type,
        "role": r.field_role or "—",
        "expr": r.sql_expr or "—",
        "level": r.evidence_level or r.conclusion_level or "—",
    }


def _lookup_field(db: Session, schema: str, table: str, field: str) -> DbField | None:
    return (
        db.query(DbField)
        .filter_by(schema_name=schema, table_name=table, field_name=field)
        .first()
    )


def _lookup_refs(
    db: Session, schema: str, table: str, field: str | None = None, *, writes_only: bool = False
) -> list[FieldReference]:
    q = db.query(FieldReference).filter_by(schema_name=schema, table_name=table)
    if field:
        q = q.filter_by(field_name=field)
    rows = q.order_by(FieldReference.system_name, FieldReference.entry_name).all()
    if writes_only:
        rows = [r for r in rows if r.op_type in {"UPDATE", "INSERT", "DELETE"}]
    return rows


def _side(
    *,
    key: str,
    title: str,
    source_table: str,
    present: bool,
    summary: str,
    props: list[dict[str, str]] | None = None,
    records: list[dict[str, str]] | None = None,
    empty_hint: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "title": title,
        "source_table": source_table,
        "present": present,
        "summary": summary,
        "props": props or [],
        "records": records or [],
        "empty_hint": empty_hint,
    }


def _sides_for_field(
    db: Session,
    fq: str,
    *,
    writes_only: bool = False,
    db_title: str = "库侧 · 04 字段主表",
    code_title: str = "源码侧 · 15 字段引用明细",
) -> list[dict[str, Any]]:
    parsed = _parse_fq_field(fq)
    if not parsed:
        return []
    sch, tb, fd = parsed
    field = _lookup_field(db, sch, tb, fd)
    refs = _lookup_refs(db, sch, tb, fd, writes_only=writes_only)
    return [
        _side(
            key="db",
            title=db_title,
            source_table="04 字段主表",
            present=field is not None,
            summary=_fq(sch, tb, fd) if field else f"{_fq(sch, tb, fd)}（表04 无此字段）",
            props=_field_props(field) if field else [],
            empty_hint=None if field else "DMP / 字段主表中未登记该字段",
        ),
        _side(
            key="code",
            title=code_title,
            source_table="15 字段引用明细",
            present=len(refs) > 0,
            summary=f"{len(refs)} 处引用" + ("（仅写操作）" if writes_only else ""),
            records=[_ref_row(r) for r in refs],
            empty_hint=None if refs else "表15 中无任何入口访问该字段",
        ),
    ]


def _sides_for_impl(db: Session, child_fq: str, parent_fq: str) -> list[dict[str, Any]]:
    sides: list[dict[str, Any]] = []
    for label, fq, side_key in (("子端", child_fq, "child"), ("父端", parent_fq, "parent")):
        parsed = _parse_fq_field(fq)
        if not parsed:
            continue
        sch, tb, fd = parsed
        field = _lookup_field(db, sch, tb, fd)
        refs = _lookup_refs(db, sch, tb, fd)
        sides.append(
            _side(
                key=side_key,
                title=f"{label} · 04 字段 + 15 引用",
                source_table="04 字段主表",
                present=field is not None,
                summary=fq,
                props=(_field_props(field) if field else []) + [{"k": "源码引用", "v": f"{len(refs)} 处"}],
                records=[_ref_row(r) for r in refs],
                empty_hint=None if field else "字段主表未找到",
            )
        )
    return sides


def _sides_for_orphan(db: Session, table_fq: str) -> list[dict[str, Any]]:
    parsed = _parse_fq_table(table_fq)
    if not parsed:
        return []
    sch, tb = parsed
    obj = db.query(DbObject).filter_by(schema_name=sch, object_name=tb).first()
    refs = _lookup_refs(db, sch, tb)
    return [
        _side(
            key="obj",
            title="对象侧 · 03 对象总览",
            source_table="03 对象总览",
            present=obj is not None,
            summary=table_fq,
            props=[
                {"k": "类型", "v": obj.object_type if obj else "—"},
                {"k": "初步分类", "v": (obj.preliminary_class if obj else None) or "—"},
                {"k": "被源码引用", "v": "是" if obj and obj.referenced_by_code else "否"},
                {"k": "入口数", "v": str(obj.ref_entry_count if obj else 0)},
                {"k": "结论", "v": (obj.conclusion_level if obj else None) or "—"},
            ]
            if obj
            else [],
            empty_hint=None if obj else "对象总览中未找到",
        ),
        _side(
            key="code",
            title="源码侧 · 15 字段引用明细",
            source_table="15 字段引用明细",
            present=len(refs) > 0,
            summary=f"该表共 {len(refs)} 处字段引用",
            records=[_ref_row(r) for r in refs[:50]],
            empty_hint=None if refs else "表15 对该表零命中",
        ),
    ]


def _sides_for_issue(db: Session, issue_no: str) -> list[dict[str, Any]]:
    issue = db.query(Issue).filter_by(issue_no=issue_no).first()
    sides: list[dict[str, Any]] = []
    if issue:
        sides.append(
            _side(
                key="issue",
                title="问题清单 · 已登记",
                source_table="24 现状问题清单",
                present=True,
                summary=f"{issue.issue_no} · {issue.object_name}",
                props=[
                    {"k": "类别", "v": issue.category or "—"},
                    {"k": "对象", "v": issue.object_name or "—"},
                    {"k": "描述", "v": (issue.description or "—")[:200]},
                    {"k": "风险", "v": issue.risk or "—"},
                    {"k": "建议", "v": issue.suggestion or "—"},
                    {"k": "来源", "v": issue.derived_from or "—"},
                    {"k": "状态", "v": issue.status or "—"},
                ],
            )
        )
        # 对象若像字段全名，继续展开库/码两侧
        if issue.object_name and _parse_fq_field(issue.object_name):
            sides.extend(_sides_for_field(db, issue.object_name))
        elif issue.object_name and "→" in issue.object_name:
            parts = [p.strip() for p in issue.object_name.replace("->", "→").split("→")]
            if len(parts) == 2 and _parse_fq_field(parts[0]) and _parse_fq_field(parts[1]):
                sides.extend(_sides_for_impl(db, parts[0], parts[1]))
    else:
        sides.append(
            _side(
                key="issue",
                title="问题清单",
                source_table="24 现状问题清单",
                present=False,
                summary=issue_no,
                empty_hint="未找到该问题编号",
            )
        )
    return sides


def _resolve_object_key(db: Session, key: str, *, depth: int = 0) -> tuple[str, list[dict[str, Any]]]:
    """按 object_key 递归展开对比侧。支持 issue:/advice:/phys: 等包装前缀。"""
    if not key or depth > 8:
        return "", []

    # —— 一次差异 / 字段级 ——
    if key.startswith(("db_only:", "code_only:", "multi_write:")):
        kind, fq = key.split(":", 1)
        hints = {
            "db_only": "库侧有定义，源码侧表15零命中——核对是否废弃或扫描遗漏。",
            "code_only": "源码引用了该字段，库侧表04无定义——补 DDL 或修正映射。",
            "multi_write": "多个入口写同一字段——核对权威写入方与语义冲突。",
        }
        return hints[kind], _sides_for_field(db, fq, writes_only=(kind == "multi_write"))

    if key.startswith("impl:"):
        body = key[len("impl:") :]
        if "->" in body:
            child_fq, parent_fq = body.split("->", 1)
            return (
                "两侧字段按命名/角色推断为隐式关联——核对是否父子关系、是否应补 FK。",
                _sides_for_impl(db, child_fq, parent_fq),
            )

    if key.startswith("orphan:"):
        return (
            "对象在总览中存在，但源码引用命中为空或极弱——确认是否可归档。",
            _sides_for_orphan(db, key[len("orphan:") :]),
        )

    if key.startswith("prod_gap:"):
        fq = key[len("prod_gap:") :]
        return "生产待补充：结合字段定义与引用状态核对。", _sides_for_field(db, fq)

    if key.startswith("risk:"):
        fq = key[len("risk:") :]
        return "重构风险：对照库定义与源码引用面。", _sides_for_field(db, fq)

    if key.startswith("prod_struct:issue:"):
        return (
            "生产结构核对（来自已登记问题）。",
            _sides_for_issue(db, key[len("prod_struct:issue:") :]),
        )

    if key.startswith("prod_struct:"):
        fq = key[len("prod_struct:") :]
        return "生产结构核对：测试结论待生产验证。", _sides_for_field(db, fq)

    # —— 物理关系 ——
    if key.startswith("phys:fk:"):
        return "已声明外键字段——核对父表与级联。", _sides_for_field(db, key[len("phys:fk:") :])

    if key.startswith("phys:seed:"):
        body = key[len("phys:seed:") :]
        if "->" in body:
            a, b = body.split("->", 1)
            return "已落库的隐式关联——评估是否升级为物理外键。", _sides_for_impl(db, a, b)

    if key.startswith("phys:derive:"):
        hint, sides = _resolve_object_key(db, key[len("phys:derive:") :], depth=depth + 1)
        return (f"由推导关联生成：{hint}" if hint else "由推导关联生成。"), sides

    # —— 问题汇总 / 建议（可能嵌套一次推导的 key）——
    if key.startswith("issue:db:"):
        return "已登记问题原文。", _sides_for_issue(db, key[len("issue:db:") :])

    if key.startswith("issue:"):
        # issue:{code}:{inner_key}
        rest = key[len("issue:") :]
        if ":" in rest:
            code, inner = rest.split(":", 1)
            hint, sides = _resolve_object_key(db, inner, depth=depth + 1)
            src = TABLE_META.get(code, {}).get("name", code)
            return (f"汇总自「{src}」：{hint}" if hint else f"汇总自「{src}」。"), sides

    if key.startswith("advice:issue:"):
        return "改进建议所依据的问题。", _sides_for_issue(db, key[len("advice:issue:") :])

    if key.startswith("advice:"):
        # advice:{code}:{inner}
        rest = key[len("advice:") :]
        if ":" in rest:
            code, inner = rest.split(":", 1)
            hint, sides = _resolve_object_key(db, inner, depth=depth + 1)
            src = TABLE_META.get(code, {}).get("name", code)
            return (f"建议依据「{src}」：{hint}" if hint else f"建议依据「{src}」。"), sides

    # 尝试把裸字段全名当 key
    if _parse_fq_field(key):
        return "字段级事实对照。", _sides_for_field(db, key)

    return "", []


def resolve_trace_key(db: Session, key: str) -> dict[str, Any]:
    """按任意 object_key / 字段全名追溯，供事实表与推导表共用。"""
    hint, sides = _resolve_object_key(db, key)
    if not sides and _parse_fq_field(key):
        hint, sides = "字段级事实对照。", _sides_for_field(db, key)
    if not sides and _parse_fq_table(key) and key.count(".") == 1:
        hint, sides = "对象级事实对照。", _sides_for_orphan(db, key)
    return {
        "object_key": key,
        "compare_hint": hint or "展开核对原文事实",
        "diff_type": key.split(":")[0] if ":" in key else "事实",
        "sides": sides,
    }


def trace_candidate(db: Session, candidate_id: int) -> dict[str, Any]:
    """展开任意推导候选：按 object_key 追溯到 03/04/15/问题 等原文。"""
    c = db.get(DeriveCandidate, candidate_id)
    if not c:
        raise KeyError(f"候选不存在: {candidate_id}")

    cells = json.loads(c.cells_json)
    evidence = json.loads(c.evidence_json)
    compare_hint, sides = _resolve_object_key(db, c.object_key)

    # 再用单元格里的对象名补一刀（汇总表有时 object_key 包装深）
    if len(sides) < 2 and cells:
        obj = cells[0]
        if _parse_fq_field(obj):
            extra = _sides_for_field(db, obj)
            # 去重 key
            have = {s["key"] for s in sides}
            sides.extend([s for s in extra if s["key"] not in have])
            if not compare_hint:
                compare_hint = "按候选对象回溯库/码事实。"
        elif "→" in obj or "->" in obj:
            parts = [p.strip() for p in obj.replace("->", "→").split("→")]
            if len(parts) == 2:
                extra = _sides_for_impl(db, parts[0], parts[1])
                have = {s["key"] for s in sides}
                sides.extend([s for s in extra if s["key"] not in have])

    if not sides:
        compare_hint = c.note or compare_hint or "展开核对前序证据来源"
        for i, ev in enumerate(evidence):
            sides.append(
                _side(
                    key=f"ev{i}",
                    title=ev.get("t", "证据"),
                    source_table=ev.get("t", ""),
                    present=True,
                    summary=ev.get("ref", ""),
                    props=[{"k": "摘要", "v": ev.get("ref", "")}],
                )
            )

    return {
        "id": c.id,
        "table_code": c.table_code,
        "table_name": c.table_name,
        "object_key": c.object_key,
        "cells": cells,
        "evidence": evidence,
        "note": c.note,
        "confidence": c.confidence,
        "review_status": c.review_status,
        "compare_hint": compare_hint,
        "diff_type": cells[1] if len(cells) > 1 else (cells[0] if cells else ""),
        "sides": sides,
    }


def apply_confirmed(db: Session, table_code: str) -> dict[str, Any]:
    """将 review_status=ok 的候选写入正式表（17→ImplicitLink，其余→Issue）。"""
    code = resolve_table_code(table_code)
    oks = (
        db.query(DeriveCandidate)
        .filter(DeriveCandidate.table_code == code, DeriveCandidate.review_status == "ok")
        .all()
    )
    written = 0
    if code == "17":
        for c in oks:
            cells = json.loads(c.cells_json)
            child, parent = cells[0], cells[1]
            exists = (
                db.query(ImplicitLink)
                .filter_by(child_field=child, parent_field=parent)
                .first()
            )
            if not exists:
                db.add(
                    ImplicitLink(
                        find_system="推导引擎",
                        module_name="自动分析",
                        entry_name=None,
                        child_field=child,
                        parent_field=parent,
                        evidence=cells[2] if len(cells) > 2 else "命名共现",
                        has_fk=cells[3] == "是" if len(cells) > 3 else False,
                        evidence_source="推导引擎",
                        conclusion_level="已确认",
                        applicability="待生产验证",
                    )
                )
                written += 1
            c.review_status = "applied"
    elif code in {"24", "16", "18", "10", "25", "26", "28", "22"}:
        for c in oks:
            cells = json.loads(c.cells_json)
            obj = cells[0]
            if code == "24":
                category, priority = cells[1], cells[3] if len(cells) > 3 else "中"
                desc = f"来自自动汇总：{cells[2] if len(cells) > 2 else ''}"
            elif code == "25":
                category, priority = "重构风险", cells[3] if len(cells) > 3 else "中"
                desc = f"引用面 {cells[1]}；关联问题 {cells[2]}"
            elif code == "16":
                category = cells[1]
                priority = "高" if "多入口" in cells[1] or "码有库无" in cells[1] else "中"
                desc = f"库侧={cells[2]}；源码侧={cells[3]}"
            else:
                category = cells[1] if len(cells) > 1 else TABLE_META[code]["name"]
                priority = cells[-1] if cells else "中"
                if priority not in {"高", "中", "低"}:
                    priority = "中"
                desc = " · ".join(cells[1:3])

            issue_no = f"D{code}-{c.id}"
            exists = db.query(Issue).filter_by(issue_no=issue_no).first()
            if not exists:
                db.add(
                    Issue(
                        issue_no=issue_no,
                        category=category,
                        object_name=obj,
                        description=desc,
                        derived_from=TABLE_META[code]["name"],
                        impact=None,
                        risk=priority if priority in {"高", "中", "低"} else "中",
                        needs_prod=True,
                        suggestion=cells[-1] if cells else None,
                        status="开放",
                        evidence_source="推导引擎",
                        conclusion_level="已确认",
                        applicability="待生产验证",
                    )
                )
                written += 1
            c.review_status = "applied"
    db.commit()
    return {"table_code": code, "applied": len(oks), "written": written}


def catalog() -> list[dict[str, Any]]:
    return [
        {"table_code": k, "table_name": v["name"], "deps": v["deps"], "columns": v["columns"]}
        for k, v in TABLE_META.items()
    ]
