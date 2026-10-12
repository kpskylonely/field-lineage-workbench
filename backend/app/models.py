from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def evidence_cols():
    return dict(
        evidence_source=mapped_column(String(64), default="推断"),
        conclusion_level=mapped_column(String(32), default="推断"),
        applicability=mapped_column(String(32), default="仅测试"),
    )


class MetaMixin:
    evidence_source: Mapped[str] = mapped_column(String(64), default="推断")
    conclusion_level: Mapped[str] = mapped_column(String(32), default="推断")
    applicability: Mapped[str] = mapped_column(String(32), default="仅测试")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class InputMaterial(Base, MetaMixin):
    """表01 输入资料清单."""

    __tablename__ = "t01_input_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_no: Mapped[str] = mapped_column(String(64), unique=True)
    material_type: Mapped[str] = mapped_column(String(64))
    system_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    repo: Mapped[str | None] = mapped_column(String(256), nullable=True)
    branch_or_tag: Mapped[str | None] = mapped_column(String(128), nullable=True)
    commit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dmp_file: Mapped[str | None] = mapped_column(String(256), nullable=True)
    version_matched: Mapped[bool] = mapped_column(Boolean, default=False)
    complete: Mapped[bool] = mapped_column(Boolean, default=False)


class DbObject(Base, MetaMixin):
    """表03 对象总览."""

    __tablename__ = "t03_db_objects"
    __table_args__ = (UniqueConstraint("schema_name", "object_name", name="uq_obj"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schema_name: Mapped[str] = mapped_column(String(64), index=True)
    object_type: Mapped[str] = mapped_column(String(32), default="TABLE")
    object_name: Mapped[str] = mapped_column(String(128), index=True)
    object_comment: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="VALID")
    preliminary_class: Mapped[str | None] = mapped_column(String(64), nullable=True)
    referenced_by_code: Mapped[bool] = mapped_column(Boolean, default=False)
    ref_system_count: Mapped[int] = mapped_column(Integer, default=0)
    ref_entry_count: Mapped[int] = mapped_column(Integer, default=0)


class DbField(Base, MetaMixin):
    """表04 数据库表字段总览（字段主表）."""

    __tablename__ = "t04_db_fields"
    __table_args__ = (
        UniqueConstraint("schema_name", "table_name", "field_name", name="uq_field"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schema_name: Mapped[str] = mapped_column(String(64), index=True)
    table_name: Mapped[str] = mapped_column(String(128), index=True)
    field_name: Mapped[str] = mapped_column(String(128), index=True)
    field_comment: Mapped[str | None] = mapped_column(String(256), nullable=True)
    field_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    data_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nullable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_pk: Mapped[bool] = mapped_column(Boolean, default=False)
    is_fk: Mapped[bool] = mapped_column(Boolean, default=False)
    dict_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dict_source_table: Mapped[str | None] = mapped_column(String(128), nullable=True)
    test_sample_values: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_ref_count: Mapped[int] = mapped_column(Integer, default=0)
    ref_system_count: Mapped[int] = mapped_column(Integer, default=0)
    ref_module_count: Mapped[int] = mapped_column(Integer, default=0)
    ref_entry_count: Mapped[int] = mapped_column(Integer, default=0)
    ref_ops: Mapped[str | None] = mapped_column(String(128), nullable=True)
    field_ref_status: Mapped[str] = mapped_column(String(32), default="待确认")
    is_core: Mapped[bool] = mapped_column(Boolean, default=False)


class DictUsage(Base, MetaMixin):
    """表09 字典、值域及字段引用."""

    __tablename__ = "t09_dict_usages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_type: Mapped[str] = mapped_column(String(32), default="定义")
    dict_name: Mapped[str] = mapped_column(String(128), index=True)
    value_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    value_label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_schema: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_table: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_field: Mapped[str | None] = mapped_column(String(128), nullable=True)
    use_schema: Mapped[str | None] = mapped_column(String(64), nullable=True)
    use_table: Mapped[str | None] = mapped_column(String(128), nullable=True)
    use_field: Mapped[str | None] = mapped_column(String(128), nullable=True)
    use_system: Mapped[str | None] = mapped_column(String(128), nullable=True)
    use_module: Mapped[str | None] = mapped_column(String(128), nullable=True)
    use_entry: Mapped[str | None] = mapped_column(String(256), nullable=True)
    use_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)


class SystemModule(Base, MetaMixin):
    """表11 系统模块清单."""

    __tablename__ = "t11_system_modules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    system_name: Mapped[str] = mapped_column(String(128), index=True)
    module_name: Mapped[str] = mapped_column(String(128))
    repo: Mapped[str | None] = mapped_column(String(256), nullable=True)
    branch: Mapped[str | None] = mapped_column(String(128), nullable=True)
    target_schema: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duty: Mapped[str | None] = mapped_column(String(256), nullable=True)


class EntryPoint(Base, MetaMixin):
    """表12 接口/任务/消息入口."""

    __tablename__ = "t12_entry_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    system_name: Mapped[str] = mapped_column(String(128), index=True)
    module_name: Mapped[str] = mapped_column(String(128))
    entry_type: Mapped[str] = mapped_column(String(32))
    entry_name: Mapped[str] = mapped_column(String(256))
    entry_class: Mapped[str | None] = mapped_column(String(256), nullable=True)
    method_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_params: Mapped[str | None] = mapped_column(String(512), nullable=True)
    return_type: Mapped[str | None] = mapped_column(String(256), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    accesses_db: Mapped[bool] = mapped_column(Boolean, default=True)
    in_table15: Mapped[bool] = mapped_column(Boolean, default=False)
    field_confirm_level: Mapped[str] = mapped_column(String(32), default="部分确认")


class FieldReference(Base, MetaMixin):
    """表15 系统-模块-入口-表-字段-操作引用（核心事实）."""

    __tablename__ = "t15_field_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    system_name: Mapped[str] = mapped_column(String(128), index=True)
    project_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    module_name: Mapped[str] = mapped_column(String(128), index=True)
    entry_type: Mapped[str] = mapped_column(String(32))
    entry_name: Mapped[str] = mapped_column(String(256), index=True)
    controller: Mapped[str | None] = mapped_column(String(256), nullable=True)
    service_method: Mapped[str | None] = mapped_column(String(256), nullable=True)
    mapper_method: Mapped[str | None] = mapped_column(String(256), nullable=True)
    op_type: Mapped[str] = mapped_column(String(32), index=True)
    schema_name: Mapped[str] = mapped_column(String(64), index=True)
    table_name: Mapped[str] = mapped_column(String(128), index=True)
    field_name: Mapped[str] = mapped_column(String(128), index=True)
    field_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sql_expr: Mapped[str | None] = mapped_column(Text, nullable=True)
    direct_access: Mapped[bool] = mapped_column(Boolean, default=True)
    via_view: Mapped[bool] = mapped_column(Boolean, default=False)
    dynamic_sql: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_level: Mapped[str] = mapped_column(String(32), default="源码命中")


class ImplicitLink(Base, MetaMixin):
    """表17 隐式关联."""

    __tablename__ = "t17_implicit_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    find_system: Mapped[str] = mapped_column(String(128))
    module_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    entry_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    child_field: Mapped[str] = mapped_column(String(256))
    parent_field: Mapped[str] = mapped_column(String(256))
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    code_location: Mapped[str | None] = mapped_column(String(512), nullable=True)
    has_fk: Mapped[bool] = mapped_column(Boolean, default=False)


class Issue(Base, MetaMixin):
    """表24 数据库现状问题."""

    __tablename__ = "t24_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_no: Mapped[str] = mapped_column(String(32), unique=True)
    category: Mapped[str] = mapped_column(String(64))
    object_name: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text)
    derived_from: Mapped[str | None] = mapped_column(String(128), nullable=True)
    impact: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk: Mapped[str] = mapped_column(String(16), default="中")
    needs_prod: Mapped[bool] = mapped_column(Boolean, default=True)
    suggestion: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="开放")


class PhaseProgress(Base):
    """P0-P7 阶段进度."""

    __tablename__ = "phase_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phase_code: Mapped[str] = mapped_column(String(8), unique=True)
    phase_name: Mapped[str] = mapped_column(String(64))
    table_count: Mapped[int] = mapped_column(Integer, default=0)
    table_ids: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32), default="未开始")
    filled_tables: Mapped[int] = mapped_column(Integer, default=0)
    gate_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    gate_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class DeriveBatch(Base):
    """推导运行批次."""

    __tablename__ = "derive_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    table_code: Mapped[str] = mapped_column(String(8), index=True)
    table_name: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="running")
    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DeriveCandidate(Base, MetaMixin):
    """推导候选行（确认前）。"""

    __tablename__ = "derive_candidates"
    __table_args__ = (
        UniqueConstraint("table_code", "object_key", name="uq_derive_obj"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    table_code: Mapped[str] = mapped_column(String(8), index=True)
    table_name: Mapped[str] = mapped_column(String(64))
    object_key: Mapped[str] = mapped_column(String(512))
    cells_json: Mapped[str] = mapped_column(Text)
    evidence_json: Mapped[str] = mapped_column(Text, default="[]")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[int] = mapped_column(Integer, default=50)
    review_status: Mapped[str] = mapped_column(String(16), default="pending")

