import { Fragment, useEffect, useRef, useState } from "react";
import {
  applyDerive,
  fetchDeriveCandidates,
  fetchDeriveSummary,
  fetchDeriveTrace,
  fetchEntries,
  fetchFields,
  fetchModules,
  fetchObjects,
  fetchReferences,
  fetchTraceByKey,
  ingestAuto,
  ingestCode,
  ingestDmp,
  reviewDerive,
  runAnalyzeAuto,
  runDerive,
  type DerivePayload,
  type DeriveSummary,
  type DeriveTrace,
  type TraceSide,
} from "./api";
import { DbBloodlineView, SysBloodlineView, type DemoEntry, type DemoField, type DemoRef } from "./DemoViews";
import { BaseLibraryView } from "./BaseLibraryView";

type Node = {
  name: string;
  type: "系统" | "模块" | "接口" | "库" | "表" | "字段";
  meta?: string;
  children?: Node[];
};

// 表15 字段引用明细（核心事实表）：每行 = 一个接口对一个字段的一次访问
// 库-表-字段-系统-模块-接口 全链路均由此表派生
type Fact = {
  system: string; module: string; api: string; method: "GET" | "POST";
  op: "SELECT" | "INSERT"; schema: string; table: string; field: string;
};

const facts: Fact[] = [
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_CODE" },
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_NAME" },
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_STATUS" },
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_STAGE", field: "STAGE_CODE" },
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_STAGE", field: "STAGE_NAME" },
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "PUBLIC_SERVICE", table: "PUB.ORG_UNIT", field: "ORG_CODE" },
  { system: "全息平台", module: "项目全景", api: "GET /project/overview", method: "GET", op: "SELECT", schema: "PUBLIC_SERVICE", table: "PUB.ORG_UNIT", field: "ORG_NAME" },
  { system: "全息平台", module: "项目全景", api: "POST /project/summary", method: "POST", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_CODE" },
  { system: "全息平台", module: "项目全景", api: "POST /project/summary", method: "POST", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_NAME" },
  { system: "全息平台", module: "项目全景", api: "POST /project/summary", method: "POST", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_METRIC", field: "METRIC_CODE" },
  { system: "全息平台", module: "项目全景", api: "POST /project/summary", method: "POST", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_METRIC", field: "METRIC_VALUE" },
  { system: "全息平台", module: "项目地图", api: "GET /map/projects", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_CODE" },
  { system: "全息平台", module: "项目地图", api: "GET /map/projects", method: "GET", op: "SELECT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "GEO_POINT" },
  { system: "全息平台", module: "项目地图", api: "GET /map/projects", method: "GET", op: "SELECT", schema: "PUBLIC_SERVICE", table: "PUB.REGION", field: "REGION_CODE" },
  { system: "全息平台", module: "项目地图", api: "GET /map/projects", method: "GET", op: "SELECT", schema: "PUBLIC_SERVICE", table: "PUB.REGION", field: "REGION_NAME" },
  { system: "公共服务平台", module: "项目台账", api: "POST /project/create", method: "POST", op: "INSERT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_CODE" },
  { system: "公共服务平台", module: "项目台账", api: "POST /project/create", method: "POST", op: "INSERT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "PROJECT_NAME" },
  { system: "公共服务平台", module: "项目台账", api: "POST /project/create", method: "POST", op: "INSERT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_INFO", field: "CREATE_TIME" },
  { system: "公共服务平台", module: "项目台账", api: "POST /project/create", method: "POST", op: "INSERT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_LOG", field: "LOG_ID" },
  { system: "公共服务平台", module: "项目台账", api: "POST /project/create", method: "POST", op: "INSERT", schema: "KINGBASE_PROD", table: "EXEC_USER.PROJECT_LOG", field: "OPERATOR" },
];

// 表04 字段主表：字段业务含义、类型、变更风险
const fieldMeta: Record<string, { label: string; type: string; risk: "高" | "中" | "低" }> = {
  PROJECT_CODE: { label: "项目编码", type: "varchar(64) · NOT NULL", risk: "高" },
  PROJECT_NAME: { label: "项目名称", type: "varchar(128) · NOT NULL", risk: "高" },
  PROJECT_STATUS: { label: "项目状态", type: "varchar(16)", risk: "中" },
  CREATE_TIME: { label: "创建时间", type: "timestamp", risk: "低" },
  GEO_POINT: { label: "地理坐标", type: "varchar(64)", risk: "中" },
};

const PRIMARY_SCHEMA = "KINGBASE_PROD";
const PRIMARY_TABLE = "EXEC_USER.PROJECT_INFO";
function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

// 由事实表派生某字段的调用方树：系统 → 模块 → 接口
function usageTreeFor(field: string): Node[] {
  const rows = facts.filter((f) => f.table === PRIMARY_TABLE && f.field === field);
  return uniq(rows.map((r) => r.system)).map((system) => {
    const sysRows = rows.filter((r) => r.system === system);
    const modules = uniq(sysRows.map((r) => r.module));
    const apiCount = uniq(sysRows.map((r) => r.api)).length;
    return {
      name: system, type: "系统" as const, meta: `${modules.length} 个模块 · ${apiCount} 个接口`,
      children: modules.map((module) => ({
        name: module, type: "模块" as const,
        children: uniq(sysRows.filter((r) => r.module === module).map((r) => r.api)).map((api) => {
          const op = sysRows.find((r) => r.api === api)!.op;
          return { name: api, type: "接口" as const, meta: `API · ${op}` };
        }),
      })),
    };
  });
}

// 由事实表派生某接口的触达树：库 → 表 → 字段
function assetTreeFor(api: string): Node[] {
  const rows = facts.filter((f) => f.api === api);
  return uniq(rows.map((r) => r.schema)).map((schema) => {
    const dbRows = rows.filter((r) => r.schema === schema);
    const tables = uniq(dbRows.map((r) => r.table));
    return {
      name: schema, type: "库" as const, meta: `${tables.length} 张表`,
      children: tables.map((table) => {
        const tblRows = dbRows.filter((r) => r.table === table);
        return {
          name: table, type: "表" as const, meta: `${tblRows[0].op} · ${tblRows.length} 个字段`,
          children: tblRows.map((r) => ({ name: r.field, type: "字段" as const })),
        };
      }),
    };
  });
}

function Mark({ kind }: { kind: "table" | "field" | "shield" | "search" | "arrow" | "flow" | "check" | "graph" }) {
  const paths = {
    table: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M9 9v11"/></>,
    field: <><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></>,
    shield: <path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    flow: <><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 8v8M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h9"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    graph: <><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="12" r="2.3"/><path d="M8 7.2 16 11M8 16.8 16 13"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

function TreeNode({ node, depth = 0, onOpen }: { node: Node; depth?: number; onOpen: (api?: string) => void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = Boolean(node.children?.length);
  const style = { marginLeft: `${depth * 28}px` };
  return <div className="tree-node" style={style}>
    <div className={`tree-row ${!hasChildren ? "tree-leaf" : ""}`}>
      {hasChildren ? <button className="twisty" onClick={() => setOpen(!open)} aria-label={open ? "收起" : "展开"}>{open ? "−" : "+"}</button> : <span className="leaf-dot" />}
      <span className={`node-type type-${node.type}`}>{node.type}</span>
      <span className="node-name">{node.name}</span>
      {node.meta && <span className="node-meta">{node.meta}</span>}
      {node.type === "接口" && <button onClick={() => onOpen(node.name)} className="open-link">查看触达面 <Mark kind="arrow" /></button>}
    </div>
    {hasChildren && open && <div className="tree-children">{node.children!.map((child) => <TreeNode key={`${child.type}-${child.name}`} node={child} depth={depth + 1} onOpen={onOpen} />)}</div>}
  </div>;
}

const apiLabels: Record<string, string> = {
  "GET /project/overview": "项目全景查询",
  "POST /project/summary": "项目摘要生成",
  "GET /map/projects": "项目地图列表",
  "POST /project/create": "项目建档写入",
};

type LineageFact = Fact;

type SysApiItem = {
  id: string;
  method: string;
  path: string;
  label: string;
  op: string;
  tables: number;
  fields: number;
  dbs: number;
  className?: string;
  filePath?: string;
};

/** 数据库视角总览：切库 → 表卡片墙（对标 demo 点库看表） */
function DbOverview({
  schemas, selectedSchema, onSelectSchema, tables, selectedTable, onSelectTable,
}: {
  schemas: { name: string; tableCount: number; fieldCount: number }[];
  selectedSchema: string;
  onSelectSchema: (s: string) => void;
  tables: { name: string; comment?: string; fields: number; refs: number; core: number }[];
  selectedTable: string;
  onSelectTable: (t: string) => void;
}) {
  const cur = schemas.find((s) => s.name === selectedSchema);
  return <section className="sys-overview db-overview">
    <div className="sys-overview-head">
      <div className="sys-picker">
        <span>数据库</span>
        <div className="sys-chips">
          {schemas.map((s) => (
            <button key={s.name} type="button" className={`sys-chip ${s.name === selectedSchema ? "on" : ""}`} onClick={() => onSelectSchema(s.name)}>
              {s.name}
              <em>{s.tableCount}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="sys-kpis">
        <div><b>{cur?.tableCount ?? tables.length}</b><span>业务表</span></div>
        <div><b>{cur?.fieldCount ?? 0}</b><span>字段</span></div>
        <div><b>{tables.filter((t) => t.refs > 0).length}</b><span>有引用</span></div>
        <div><b>{tables.reduce((n, t) => n + t.core, 0)}</b><span>核心字段</span></div>
      </div>
    </div>
    <div className="sys-overview-title">
      <h2>{selectedSchema}</h2>
      <p>表卡片总览 · 点表查看字段与下游调用</p>
    </div>
    <div className="db-table-board">
      {tables.length === 0 ? <div className="viz-empty">该库暂无表结构，请先导入 DMP 结构 Excel</div> : tables.map((t) => (
        <button key={t.name} type="button" className={`db-table-card ${selectedTable === t.name ? "chosen" : ""}`} onClick={() => onSelectTable(t.name)}>
          <div className="db-table-top">
            <small>表</small>
            <b>{t.name.includes(".") ? t.name.split(".").pop() : t.name}</b>
          </div>
          {t.comment && <span className="db-table-cmt">{t.comment}</span>}
          <div className="db-table-foot">
            <span>{t.fields} 字段</span>
            <span>{t.refs} 引用</span>
            {t.core > 0 && <span className="core">{t.core} 核心</span>}
          </div>
        </button>
      ))}
    </div>
  </section>;
}

/** 单系统全局视角：模块分栏看接口（对标 demo 系统/模块树） */
function SystemOverview({
  systems, system, selectedApi, onSelectApi, onSelectSystem, lineage, entryMeta,
}: {
  systems: string[];
  system: string;
  selectedApi: string;
  onSelectApi: (api: string) => void;
  onSelectSystem: (sys: string) => void;
  lineage: LineageFact[];
  entryMeta?: Record<string, { label?: string; className?: string; filePath?: string }>;
}) {
  const rows = lineage.filter((f) => f.system === system);
  const modules = uniq(rows.map((r) => r.module));
  // 无引用事实时，仍展示 entryMeta 中该系统的接口
  const orphanApis = Object.keys(entryMeta || {}).filter((k) => {
    const m = entryMeta![k];
    return (m as { system?: string }).system === system || (!rows.length && systems.includes(system));
  });

  const apiCount = Math.max(uniq(rows.map((r) => r.api)).length, orphanApis.filter((a) => entryMeta?.[a]).length);
  const tableCount = uniq(rows.map((r) => r.table)).length;
  const fieldCount = rows.length;

  const moduleBlocks = (() => {
    const fromFacts = modules.map((module) => {
      const modRows = rows.filter((r) => r.module === module);
      const apisInMod: SysApiItem[] = uniq(modRows.map((r) => r.api)).map((api) => {
        const apiRows = modRows.filter((r) => r.api === api);
        const first = apiRows[0];
        const meta = entryMeta?.[api];
        return {
          id: api,
          method: first.method,
          path: api.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, ""),
          label: meta?.label ?? apiLabels[api] ?? api,
          op: first.op,
          tables: uniq(apiRows.map((r) => r.table)).length,
          fields: apiRows.length,
          dbs: uniq(apiRows.map((r) => r.schema)).length,
          className: meta?.className,
          filePath: meta?.filePath,
        };
      });
      return { module, apis: apisInMod, tables: uniq(modRows.map((r) => r.table)).length, fields: modRows.length };
    });
    if (fromFacts.length) return fromFacts;
    // 仅有入口清单、尚无表15时：按 entryMeta 的 module 分组
    const byMod: Record<string, SysApiItem[]> = {};
    Object.entries(entryMeta || {}).forEach(([api, meta]) => {
      const sys = (meta as { system?: string; module?: string }).system;
      const mod = (meta as { module?: string }).module || "未归类";
      if (sys && sys !== system) return;
      if (!byMod[mod]) byMod[mod] = [];
      const method = api.split(" ")[0] || "GET";
      byMod[mod].push({
        id: api,
        method,
        path: api.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, ""),
        label: meta.label ?? api,
        op: "—",
        tables: 0,
        fields: 0,
        dbs: 0,
        className: meta.className,
        filePath: meta.filePath,
      });
    });
    return Object.entries(byMod).map(([module, apis]) => ({ module, apis, tables: 0, fields: 0 }));
  })();

  return <section className="sys-overview">
    <div className="sys-overview-head">
      <div className="sys-picker">
        <span>系统</span>
        <div className="sys-chips">
          {systems.map((s) => (
            <button key={s} type="button" className={`sys-chip ${s === system ? "on" : ""}`} onClick={() => onSelectSystem(s)}>
              {s}
              <em>{uniq(lineage.filter((f) => f.system === s).map((f) => f.api)).length
                || Object.values(entryMeta || {}).filter((m) => (m as { system?: string }).system === s).length
                || 0}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="sys-kpis">
        <div><b>{moduleBlocks.length}</b><span>模块</span></div>
        <div><b>{apiCount || moduleBlocks.reduce((n, b) => n + b.apis.length, 0)}</b><span>接口</span></div>
        <div><b>{tableCount}</b><span>触达表</span></div>
        <div><b>{fieldCount}</b><span>字段引用</span></div>
      </div>
    </div>
    <div className="sys-overview-title">
      <h2>{system}</h2>
      <p>按模块展开全部接口 · 点接口看触达库表字段</p>
    </div>
    <div className="sys-mod-board" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(moduleBlocks.length, 1), 3)}, minmax(220px, 1fr))` }}>
      {moduleBlocks.length === 0 ? <div className="viz-empty">该系统暂无模块/接口，请先导入代码分析 Excel</div> : moduleBlocks.map((block) => (
        <div key={block.module} className="sys-mod-col">
          <div className="sys-mod-head">
            <div><small>模块</small><b>{block.module}</b></div>
            <div className="sys-mod-meta"><span>{block.apis.length} 接口</span><span>{block.tables} 表</span></div>
          </div>
          <div className="sys-api-list">
            {block.apis.map((a) => (
              <button key={a.id} type="button" className={`sys-api-card ${selectedApi === a.id ? "chosen" : ""}`} onClick={() => onSelectApi(a.id)}>
                <div className="sys-api-top">
                  <i className={`api-verb verb-${a.method}`}>{a.method}</i>
                  <code>{a.path}</code>
                  {a.op !== "—" && <i className={`viz-op op-${a.op}`}>{a.op}</i>}
                </div>
                <span className="sys-api-label">{a.label}</span>
                <div className="sys-api-foot">
                  {a.className && <span title={a.className}>{a.className}</span>}
                  <span>{a.dbs} 库</span>
                  <span>{a.tables} 表</span>
                  <span>{a.fields} 字段</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  </section>;
}

/** 接口触达面：按库→表卡片展示字段 chip（对标 demo 单表/Diff 的可读性） */
function ApiTouchBoard({
  apiId, lineage, onJumpField,
}: {
  apiId: string;
  lineage: LineageFact[];
  onJumpField?: (schema: string, table: string, field: string) => void;
}) {
  const rows = lineage.filter((f) => f.api === apiId);
  if (!rows.length) {
    return <div className="touch-board"><div className="viz-empty">该接口尚无字段引用事实（表15）。导入代码 Excel 只登记了入口，需后续补字段引用。</div></div>;
  }
  const schemas = uniq(rows.map((r) => r.schema));
  return <div className="touch-board">
    {schemas.map((schema) => {
      const tables = uniq(rows.filter((r) => r.schema === schema).map((r) => r.table));
      return <div key={schema} className="touch-schema">
        <div className="touch-schema-head"><small>库</small><b>{schema}</b><em>{tables.length} 表</em></div>
        <div className="touch-tables">
          {tables.map((table) => {
            const tRows = rows.filter((r) => r.schema === schema && r.table === table);
            const op = tRows[0]?.op || "SELECT";
            const fields = uniq(tRows.map((r) => r.field));
            const short = table.includes(".") ? table.split(".").pop()! : table;
            return <div key={table} className={`touch-table ${op === "INSERT" || op === "UPDATE" || op === "DELETE" ? "write" : "read"}`}>
              <div className="touch-table-head">
                <span>表</span>
                <b>{short}</b>
                <i className={`viz-op op-${op}`}>{op}</i>
              </div>
              <div className="touch-fields">
                {fields.map((f) => (
                  <button key={f} type="button" className="touch-field" onClick={() => onJumpField?.(schema, table, f)}>{f}</button>
                ))}
              </div>
            </div>;
          })}
        </div>
      </div>;
    })}
  </div>;
}

// 由事实表派生接口清单
const apis = uniq(facts.map((f) => f.api)).map((api) => {
  const rows = facts.filter((f) => f.api === api);
  const first = rows[0];
  const [method, path] = api.split(" ");
  return {
    id: api, api, method: first.method, path, label: apiLabels[api] ?? api,
    system: first.system, module: first.module, op: first.op,
    tables: uniq(rows.map((r) => r.table)).length,
    fields: rows.length,
    dbs: uniq(rows.map((r) => r.schema)).length,
  };
});

type Phase = {
  no: string;
  name: string;
  desc: string;
  tables: number;
  status: "已完成" | "进行中" | "待开始";
  steps: string[];
  outputs: string[];
};

const defaultPhases: Phase[] = [
  {
    no: "P0", name: "输入与导入", desc: "归集源码与金仓 DMP，记录导入结果与异常。",
    tables: 2, status: "已完成",
    steps: ["输入资料清单登记", "DMP 导入与异常记录"],
    outputs: ["01 输入资料清单", "02 DMP导入结果"],
  },
  {
    no: "P1", name: "数据库结构还原", desc: "从 DMP 还原对象、字段、约束、索引与 DDL 基线。",
    tables: 8, status: "已完成",
    steps: ["对象与字段总览还原", "约束 / 索引 / DDL 基线重建", "字典值域与测试数据核查"],
    outputs: ["03 对象总览", "04 字段主表", "05 约束清单", "06 索引清单", "07 DDL基线", "08 测试数据存在性", "09 字典值域", "10 生产待补充需求"],
  },
  {
    no: "P2", name: "系统与访问归集", desc: "扫描源码，归集系统模块、接口入口与数据访问语句。",
    tables: 4, status: "已完成",
    steps: ["系统 / 模块 / 工程归集", "接口任务消息入口登记", "SQL·ORM 与 Entity 映射解析"],
    outputs: ["11 系统模块清单", "12 接口入口清单", "13 SQL·ORM访问", "14 Entity映射"],
  },
  {
    no: "P3", name: "字段引用事实", desc: "汇总字段级引用明细（核心事实表），构建库→表→字段→系统→模块→接口链路。",
    tables: 4, status: "进行中",
    steps: ["字段引用明细回填（表15）", "引用汇总与差异比对", "隐式关联与孤儿对象识别"],
    outputs: ["15 字段引用明细", "16 库源码差异", "17 隐式关联", "18 孤儿对象候选"],
  },
  {
    no: "P4", name: "业务语义还原", desc: "补齐业务对象、数据字典、状态流转与物理/业务关系。",
    tables: 5, status: "待开始",
    steps: ["业务对象-表映射", "数据字典与状态值域整理", "物理关系与业务关系确认"],
    outputs: ["19 业务对象映射", "20 业务数据字典", "21 状态值域流转", "22 物理关系", "23 业务关系确认"],
  },
  {
    no: "P5", name: "问题与重构决策", desc: "汇总现状问题，评估重构风险并形成改进建议。",
    tables: 3, status: "待开始",
    steps: ["现状问题清单归集", "重构风险评估", "改进建议生成"],
    outputs: ["24 现状问题清单", "25 重构风险评估", "26 改进建议清单"],
  },
  {
    no: "P6", name: "生产落地确认", desc: "补充生产数据需求，记录结构差异与业务确认。",
    tables: 3, status: "待开始",
    steps: ["生产数据补充需求", "生产环境结构差异记录", "业务确认闭环"],
    outputs: ["27 生产数据补充", "28 生产结构差异", "29 业务确认记录"],
  },
];

// 每张表的生成方式：解析（DMP/源码自动解析）· 上传（Excel 模版）· 推导（由前序表生成）
// deps 与后端 derive.TABLE_META 对齐，供前序/后续链路图使用
type Gen = { kind: "解析" | "上传" | "推导"; via: string; deps?: string[] };
const tableGen: Record<string, Gen> = {
  "01 输入资料清单": { kind: "上传", via: "人工登记 / Excel 上传" },
  "02 DMP导入结果": { kind: "解析", via: "金仓 DMP 导入自动生成" },
  "03 对象总览": { kind: "解析", via: "DMP 结构解析" },
  "04 字段主表": { kind: "解析", via: "DMP 结构解析" },
  "05 约束清单": { kind: "解析", via: "DMP 结构解析" },
  "06 索引清单": { kind: "解析", via: "DMP 结构解析" },
  "07 DDL基线": { kind: "解析", via: "DMP DDL 提取" },
  "08 测试数据存在性": { kind: "解析", via: "测试库采样比对" },
  "09 字典值域": { kind: "解析", via: "DMP + 源码常量解析" },
  "10 生产待补充需求": { kind: "推导", via: "由结构与测试数据差集推导", deps: ["04 字段主表", "08 测试数据存在性"] },
  "11 系统模块清单": { kind: "解析", via: "源码扫描" },
  "12 接口入口清单": { kind: "解析", via: "源码扫描" },
  "13 SQL·ORM访问": { kind: "解析", via: "源码 SQL / ORM 解析" },
  "14 Entity映射": { kind: "解析", via: "源码 ORM 注解解析" },
  "15 字段引用明细": { kind: "解析", via: "源码扫描回填（核心事实表）" },
  "16 库源码差异": { kind: "推导", via: "库结构 (04) vs 源码引用 (15) 比对", deps: ["04 字段主表", "15 字段引用明细"] },
  "17 隐式关联": { kind: "推导", via: "同名/角色字段跨表共现推断", deps: ["04 字段主表", "15 字段引用明细"] },
  "18 孤儿对象候选": { kind: "推导", via: "对象清单与引用事实差集", deps: ["03 对象总览", "15 字段引用明细"] },
  "19 业务对象映射": { kind: "上传", via: "业务人员补录 / Excel 上传" },
  "20 业务数据字典": { kind: "上传", via: "业务人员补录 / Excel 上传" },
  "21 状态值域流转": { kind: "上传", via: "业务人员补录 / Excel 上传" },
  "22 物理关系": { kind: "推导", via: "由约束与隐式关联推导", deps: ["05 约束清单", "17 隐式关联"] },
  "23 业务关系确认": { kind: "上传", via: "业务人员确认 / Excel 上传" },
  "24 现状问题清单": { kind: "推导", via: "汇总差异、隐式、孤儿三类发现", deps: ["16 库源码差异", "17 隐式关联", "18 孤儿对象候选"] },
  "25 重构风险评估": { kind: "推导", via: "结合引用面与现状问题评级", deps: ["15 字段引用明细", "24 现状问题清单"] },
  "26 改进建议清单": { kind: "推导", via: "基于问题与风险生成建议", deps: ["24 现状问题清单", "25 重构风险评估"] },
  "27 生产数据补充": { kind: "上传", via: "生产侧补录 / Excel 上传" },
  "28 生产结构差异": { kind: "推导", via: "测试结论待生产核对项", deps: ["03 对象总览", "04 字段主表"] },
  "29 业务确认记录": { kind: "上传", via: "业务确认闭环 / Excel 上传" },
};
function fallbackGen(table: string): Gen {
  return tableGen[table] ?? { kind: "解析", via: "自动解析生成" };
}
function tableNo(name: string) {
  return name.split(" ")[0];
}
/** 哪些表把本表列为 deps（后续消费方） */
function consumersOf(table: string): string[] {
  return Object.entries(tableGen)
    .filter(([, g]) => (g.deps ?? []).includes(table))
    .map(([n]) => n);
}
/** 过程页推导链路分层（与引擎 RUN_ORDER 一致的心智模型） */
const DERIVE_LAYERS: { label: string; hint: string; tables: string[] }[] = [
  { label: "事实基线", hint: "解析落库，推导只读这些表", tables: ["03 对象总览", "04 字段主表", "05 约束清单", "08 测试数据存在性", "15 字段引用明细"] },
  { label: "一次推导", hint: "直接从事实表算出候选", tables: ["16 库源码差异", "17 隐式关联", "18 孤儿对象候选", "10 生产待补充需求", "28 生产结构差异"] },
  { label: "二次汇总", hint: "吃一次推导结果再归并", tables: ["22 物理关系", "24 现状问题清单"] },
  { label: "决策产出", hint: "风险 → 建议，供改造落地", tables: ["25 重构风险评估", "26 改进建议清单"] },
];

type TableProgress = "未开始" | "已生成" | "确认中" | "待应用" | "已完成";
type DeriveTableStat = NonNullable<DeriveSummary["tables"]>[number];

function progressOfDerive(st: DeriveTableStat | undefined): TableProgress {
  if (!st || st.total === 0) return "未开始";
  if (st.pending === 0 && st.ok === 0 && (st.applied > 0 || st.no === st.total)) return "已完成";
  if (st.pending === 0 && st.ok > 0) return "待应用";
  if (st.ok > 0 || st.no > 0 || st.applied > 0) return "确认中";
  return "已生成";
}

function progressPct(st: DeriveTableStat | undefined): number {
  if (!st || st.total === 0) return 0;
  const done = st.applied + st.no;
  const reviewed = st.ok + st.no + st.applied;
  // 生成 30% + 确认 40% + 应用 30%
  const gen = 30;
  const conf = Math.round((reviewed / st.total) * 40);
  const app = st.pending === 0 && st.ok === 0 ? 30 : Math.round((st.applied / st.total) * 30);
  return Math.min(100, gen + conf + app);
}

// 链路的六个环节
const CHAIN = ["库", "表", "字段", "系统", "模块", "接口"] as const;
type Seg = (typeof CHAIN)[number];

// 过程表 → 结果页的联动：该表汇入结果页的哪个视图、支撑链路的哪几个环节、主要字段预览
type TableInfo = { mode: "data" | "interface"; label: string; chain: Seg[]; columns: string[]; total: number; rows: string[][] };
const tableInfo: Record<string, TableInfo> = {
  "03 对象总览": { mode: "interface", label: "库表对象", chain: ["库", "表"], total: 62,
    columns: ["Schema", "对象类型", "对象名称", "是否被源码引用", "对象初步用途"],
    rows: [
      ["KINGBASE_PROD", "TABLE", "EXEC_USER.PROJECT_INFO", "是", "项目主档"],
      ["KINGBASE_PROD", "TABLE", "EXEC_USER.PROJECT_LOG", "是", "操作日志"],
      ["PUBLIC_SERVICE", "TABLE", "PUB.ORG_UNIT", "是", "组织单位"],
    ] },
  "04 字段主表": { mode: "data", label: "字段清单", chain: ["库", "表", "字段"], total: 486,
    columns: ["表名", "字段名", "字段注释", "数据类型", "是否核心字段", "是否代码使用"],
    rows: [
      ["EXEC_USER.PROJECT_INFO", "PROJECT_CODE", "项目编码", "varchar(64)", "是", "是"],
      ["EXEC_USER.PROJECT_INFO", "PROJECT_NAME", "项目名称", "varchar(128)", "是", "是"],
      ["EXEC_USER.PROJECT_INFO", "CREATE_TIME", "创建时间", "timestamp", "否", "是"],
    ] },
  "11 系统模块清单": { mode: "data", label: "系统 / 模块归属", chain: ["系统", "模块"], total: 9,
    columns: ["系统/服务", "工程名称", "模块", "入口类型", "数据源名称"],
    rows: [
      ["全息平台", "holo-web", "项目全景", "REST API", "kingbase_prod"],
      ["全息平台", "holo-web", "项目地图", "REST API", "kingbase_prod"],
      ["公共服务平台", "pub-svc", "项目台账", "REST API", "kingbase_prod"],
    ] },
  "12 接口入口清单": { mode: "interface", label: "接口清单", chain: ["系统", "模块", "接口"], total: 34,
    columns: ["系统/服务", "模块", "接口/任务/消息名称", "是否访问数据库", "触发表/对象"],
    rows: [
      ["全息平台", "项目全景", "GET /project/overview", "是", "PROJECT_INFO"],
      ["全息平台", "项目地图", "GET /map/projects", "是", "PROJECT_INFO"],
      ["公共服务平台", "项目台账", "POST /project/create", "是", "PROJECT_INFO"],
    ] },
  "13 SQL·ORM访问": { mode: "interface", label: "SQL 访问事实", chain: ["表", "字段", "接口"], total: 118,
    columns: ["接口/任务", "Mapper/DAO", "操作类型", "表/对象", "涉及字段列表"],
    rows: [
      ["GET /project/overview", "ProjectMapper.selectOverview", "SELECT", "PROJECT_INFO", "PROJECT_CODE, PROJECT_NAME, PROJECT_STATUS"],
      ["POST /project/create", "ProjectMapper.insert", "INSERT", "PROJECT_INFO", "PROJECT_CODE, PROJECT_NAME, CREATE_TIME"],
    ] },
  "14 Entity映射": { mode: "interface", label: "ORM 映射", chain: ["模块", "表", "字段"], total: 73,
    columns: ["Entity/Model类", "数据库表", "字段/属性", "操作类型", "是否写入"],
    rows: [
      ["ProjectInfo", "EXEC_USER.PROJECT_INFO", "projectCode", "SELECT", "否"],
      ["ProjectInfo", "EXEC_USER.PROJECT_INFO", "createTime", "INSERT", "是"],
    ] },
  "15 字段引用明细": { mode: "data", label: "字段引用事实（核心）", chain: ["库", "表", "字段", "系统", "模块", "接口"], total: 512,
    columns: ["系统", "模块", "接口/任务/消息名称", "操作类型", "Schema", "表名", "字段名", "字段使用角色"],
    rows: [
      ["全息平台", "项目全景", "GET /project/overview", "SELECT", "KINGBASE_PROD", "EXEC_USER.PROJECT_INFO", "PROJECT_CODE", "查询返回"],
      ["全息平台", "项目全景", "GET /project/overview", "SELECT", "KINGBASE_PROD", "EXEC_USER.PROJECT_INFO", "PROJECT_STATUS", "过滤条件"],
      ["公共服务平台", "项目台账", "POST /project/create", "INSERT", "KINGBASE_PROD", "EXEC_USER.PROJECT_INFO", "PROJECT_CODE", "写入"],
    ] },
  "25 重构风险评估": { mode: "data", label: "变更风险", chain: ["表", "字段"], total: 21,
    columns: ["风险对象", "对象类型", "风险描述", "影响系统/模块", "风险等级"],
    rows: [
      ["PROJECT_INFO.PROJECT_CODE", "字段", "被 4 个接口引用，变更需兼容期", "全息平台 / 项目全景", "高"],
      ["PROJECT_INFO.PROJECT_STATUS", "字段", "状态值域未统一", "全息平台 / 项目全景", "中"],
    ] },
};

// 推导过程：把「由前序表生成」的逻辑与逐条候选结果显性化，供人工确认
type DeriveEv = { t: string; ref: string };
type DeriveRow = { cells: string[]; evidence: DeriveEv[]; note?: string };
type Derivation = { rule: string; logic: string[]; columns: string[]; rows: DeriveRow[] };
const derivations: Record<string, Derivation> = {
  "16 库源码差异": {
    rule: "逐字段比对 DMP 结构定义与源码 ORM 映射，标注类型 / 存在性不一致项。",
    logic: [
      "从「04 字段主表」读取每个 表.字段 的数据类型与是否可空",
      "从「14 Entity映射」读取源码中对应属性的类型与读写方式",
      "两侧逐项比对：类型不符 / 库有源码无 / 源码有库无 → 记为差异",
      "按影响程度给出处理建议，逐条供人工确认",
    ],
    columns: ["差异对象", "差异类型", "库定义 (04)", "源码定义 (14)", "建议"],
    rows: [
      { cells: ["PROJECT_INFO.PROJECT_STATUS", "类型不一致", "varchar(16)", "String（枚举未约束）", "补充值域约束"], evidence: [{ t: "04 字段主表", ref: "PROJECT_STATUS · varchar(16)" }, { t: "14 Entity映射", ref: "projectStatus · String" }] },
      { cells: ["PROJECT_INFO.GEO_POINT", "源码未映射", "varchar(64)", "—", "确认是否废弃字段"], evidence: [{ t: "04 字段主表", ref: "GEO_POINT · varchar(64)" }], note: "源码 Entity 未发现该属性" },
      { cells: ["PROJECT_LOG.OPERATOR", "库无定义", "—", "String operator", "补充 DDL 或确认为临时字段"], evidence: [{ t: "14 Entity映射", ref: "ProjectLog.operator" }] },
    ],
  },
  "24 现状问题清单": {
    rule: "汇总库源码差异、隐式关联、孤儿对象三类发现，归并为统一问题清单。",
    logic: [
      "收集「16 库源码差异」中的结构不一致项",
      "收集「17 隐式关联」中缺少外键约束的关系",
      "收集「18 孤儿对象候选」中疑似无用对象",
      "按对象归并去重，标注问题类别与优先级",
    ],
    columns: ["问题对象", "问题类别", "来源发现", "优先级"],
    rows: [
      { cells: ["PROJECT_INFO.PROJECT_STATUS", "字段值域未约束", "结构差异", "高"], evidence: [{ t: "16 库源码差异", ref: "PROJECT_STATUS 类型不一致" }] },
      { cells: ["PROJECT_LOG → PROJECT_INFO", "缺少外键约束", "隐式关联", "中"], evidence: [{ t: "17 隐式关联", ref: "PROJECT_LOG.PROJECT_CODE ↔ PROJECT_INFO" }] },
      { cells: ["EXEC_USER.TEMP_IMPORT", "疑似无用对象", "孤儿对象", "低"], evidence: [{ t: "18 孤儿对象候选", ref: "TEMP_IMPORT 无引用命中" }] },
    ],
  },
  "25 重构风险评估": {
    rule: "结合字段引用面（表15）与现状问题（表24），对每个变更对象评估风险等级。",
    logic: [
      "从「15 字段引用明细」统计每个字段被引用的接口数与系统数",
      "从「24 现状问题清单」匹配该对象是否存在已知问题",
      "引用面越广 + 问题越严重 → 风险等级越高",
      "输出风险等级与处理建议，供重构决策确认",
    ],
    columns: ["风险对象", "引用面 (15)", "关联问题 (24)", "风险等级"],
    rows: [
      { cells: ["PROJECT_INFO.PROJECT_CODE", "4 接口 / 2 系统", "无", "高"], evidence: [{ t: "15 字段引用明细", ref: "PROJECT_CODE · 4 处引用" }], note: "引用面广，变更需设置兼容期" },
      { cells: ["PROJECT_INFO.PROJECT_STATUS", "2 接口 / 1 系统", "值域未约束", "中"], evidence: [{ t: "15 字段引用明细", ref: "PROJECT_STATUS · 2 处" }, { t: "24 现状问题清单", ref: "值域未约束" }] },
    ],
  },
};
function derivationFor(table: string, g: Gen, cols: string[]): Derivation {
  const d = derivations[table];
  if (d) return d;
  const deps = g.deps ?? [];
  return {
    rule: g.via,
    logic: [
      deps.length ? `读取前序表：${deps.join("、")}` : "读取前序步骤产出",
      `按规则「${g.via}」计算候选结果`,
      "输出候选供人工逐条确认后落库",
    ],
    columns: cols,
    rows: [],
  };
}

// 系统配置模型：阶段 → 步骤 → 产出表模版，均可由管理员配置
type OutputCfg = { name: string; kind: Gen["kind"]; columns: string[] };
type PhaseCfg = { no: string; name: string; desc: string; status: Phase["status"]; steps: string[]; outputs: OutputCfg[] };
const defaultPhaseCfg: PhaseCfg[] = defaultPhases.map((p) => ({
  no: p.no, name: p.name, desc: p.desc, status: p.status, steps: [...p.steps],
  outputs: p.outputs.map((o) => ({ name: o, kind: fallbackGen(o).kind, columns: tableInfo[o]?.columns ?? [] })),
}));
const GEN_KINDS: Gen["kind"][] = ["解析", "上传", "推导"];
const STATUSES: Phase["status"][] = ["已完成", "进行中", "待开始"];

export default function App() {
  const [page, setPage] = useState<"workbench" | "process" | "table" | "config" | "tpledit" | "trace" | "lineage">("process");
  const [editTarget, setEditTarget] = useState<{ pi: number; oi: number } | null>(null);
  const openTplEditor = (pi: number, oi: number) => { setEditTarget({ pi, oi }); setPage("tpledit"); };
  const [mode, setMode] = useState<"data" | "interface">("data");
  const [focusTable, setFocusTable] = useState<string | null>(null);
  const [currentTable, setCurrentTable] = useState<string>("15 字段引用明细");

  const [phaseCfg, setPhaseCfg] = useState<PhaseCfg[]>(defaultPhaseCfg);
  const phases: Phase[] = [];
  phaseCfg.forEach((p) => {
    phases.push({
      no: p.no, name: p.name, desc: p.desc, tables: p.outputs.length,
      status: p.status, steps: p.steps, outputs: p.outputs.map((o) => o.name),
    });
  });
  const totalTables = phases.reduce((sum, p) => sum + p.tables, 0);
  const phaseOf = (table: string) => phases.find((p) => p.outputs.includes(table));
  const evidenceOf = (table: string) => {
    const st = phaseOf(table)?.status;
    return {
      source: "源码扫描 + 金仓 DMP",
      level: st === "已完成" ? "已验证" : st === "进行中" ? "部分验证" : "待验证",
      scope: "当前扫描范围（6 个工程 / 1 个 DMP）",
    };
  };
  const genOf = (table: string): Gen => {
    for (const p of phaseCfg) {
      const o = p.outputs.find((x) => x.name === table);
      if (o) { const f = fallbackGen(table); return { kind: o.kind, via: f.via, deps: f.deps }; }
    }
    return fallbackGen(table);
  };

  const updatePhase = (i: number, patch: Partial<PhaseCfg>) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPhase = () => setPhaseCfg((cfg) => [...cfg, { no: `P${cfg.length}`, name: "新阶段", desc: "阶段说明", status: "待开始", steps: [], outputs: [] }]);
  const removePhase = (i: number) => setPhaseCfg((cfg) => cfg.filter((_, idx) => idx !== i));
  const updateStep = (pi: number, si: number, val: string) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, steps: p.steps.map((s, j) => (j === si ? val : s)) } : p)));
  const addStep = (pi: number) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, steps: [...p.steps, "新步骤"] } : p)));
  const removeStep = (pi: number, si: number) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, steps: p.steps.filter((_, j) => j !== si) } : p)));
  const updateOutput = (pi: number, oi: number, patch: Partial<OutputCfg>) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, outputs: p.outputs.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : p)));
  const addOutput = (pi: number) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, outputs: [...p.outputs, { name: "新产出表", kind: "解析", columns: [] }] } : p)));
  const removeOutput = (pi: number, oi: number) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, outputs: p.outputs.filter((_, j) => j !== oi) } : p)));
  const updateColumn = (pi: number, oi: number, ci: number, val: string) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, outputs: p.outputs.map((o, j) => (j === oi ? { ...o, columns: o.columns.map((c, k) => (k === ci ? val : c)) } : o)) } : p)));
  const addColumn = (pi: number, oi: number) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, outputs: p.outputs.map((o, j) => (j === oi ? { ...o, columns: [...o.columns, `列${o.columns.length + 1}`] } : o)) } : p)));
  const removeColumn = (pi: number, oi: number, ci: number) => setPhaseCfg((cfg) => cfg.map((p, idx) => (idx === pi ? { ...p, outputs: p.outputs.map((o, j) => (j === oi ? { ...o, columns: o.columns.filter((_, k) => k !== ci) } : o)) } : p)));
  const resetCfg = () => setPhaseCfg(defaultPhaseCfg);

  const [bulkEdit, setBulkEdit] = useState<Record<string, boolean>>({});
  const parseCols = (text: string) => text.split(/[\n\t,;]+/).map((c) => c.trim()).filter(Boolean);
  const [rowMark, setRowMark] = useState<Record<string, "ok" | "no">>({});

  const [genDone, setGenDone] = useState<Record<string, string>>({});
  const [ingestMsg, setIngestMsg] = useState<string>("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestKind, setIngestKind] = useState<"auto" | "dmp" | "code">("auto");
  const [ingestSystem, setIngestSystem] = useState("全息平台");
  const [ingestReplace, setIngestReplace] = useState(false);
  const [deriveLive, setDeriveLive] = useState<DerivePayload | null>(null);
  const [deriveBusy, setDeriveBusy] = useState(false);
  const [deriveSummary, setDeriveSummary] = useState<DeriveSummary | null>(null);
  const [traceOpenId, setTraceOpenId] = useState<number | null>(null);
  const [factTraceKey, setFactTraceKey] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<(DeriveTrace & { key?: string }) | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceMeta, setTraceMeta] = useState<{ title: string; subtitle: string; cells?: string[]; review_status?: string } | null>(null);
  const [factLive, setFactLive] = useState<{
    fields: Awaited<ReturnType<typeof fetchFields>>;
    refs: Awaited<ReturnType<typeof fetchReferences>>;
    objects: Awaited<ReturnType<typeof fetchObjects>>;
    modules: Awaited<ReturnType<typeof fetchModules>>;
    entries: Awaited<ReturnType<typeof fetchEntries>>;
  } | null>(null);

  const loadWorkbenchFacts = async () => {
    try {
      const [fields, refs, objects, modules, entries] = await Promise.all([
        fetchFields(), fetchReferences(), fetchObjects(), fetchModules(), fetchEntries(),
      ]);
      setFactLive({ fields, refs, objects, modules, entries });
      return { fields, refs, objects, modules, entries };
    } catch {
      setFactLive(null);
      return null;
    }
  };
  const uploadTarget = useRef<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDerive = async (table: string) => {
    try {
      const data = await fetchDeriveCandidates(table);
      setDeriveLive(data);
      return data;
    } catch {
      setDeriveLive(null);
      return null;
    }
  };

  const backFromTrace = () => {
    setPage("table");
    setTraceOpenId(null);
    setFactTraceKey(null);
    setTraceData(null);
    setTraceMeta(null);
  };

  const renderTracePanel = (data: { diff_type: string; compare_hint: string; sides: TraceSide[]; confidence?: number }) => {
    const left = data.sides[0];
    const right = data.sides[1];
    const extra = data.sides.slice(2);
    const both = !!(left && right);
    const leftOk = !!left?.present;
    const rightOk = !!right?.present;
    const clash = both && leftOk !== rightOk;
    const verdict = !both ? "单侧核对"
      : clash ? (leftOk && !rightOk ? "仅左侧有 · 右侧缺失" : "仅右侧有 · 左侧缺失")
      : (leftOk && rightOk ? "两侧均有 · 需对照内容" : "两侧均无");

    const propMap = (side?: TraceSide) => {
      const m = new Map<string, string>();
      (side?.props ?? []).forEach((p) => m.set(p.k, p.v));
      return m;
    };
    const lm = propMap(left);
    const rm = propMap(right);
    const keys = Array.from(new Set([...lm.keys(), ...rm.keys()])).filter((k) =>
      ["类型", "注释", "主键", "外键", "引用状态", "源码引用数", "源码引用", "类别", "风险", "可空", "核心"].includes(k)
    );
    const diffRows = keys.map((k) => {
      const a = lm.get(k);
      const b = rm.get(k);
      const same = a !== undefined && b !== undefined && a === b;
      const missL = a === undefined;
      const missR = b === undefined;
      return { k, a: a ?? "—", b: b ?? "—", same, missL, missR, differ: !same && !missL && !missR };
    });

    const renderPresence = (side: TraceSide | undefined, label: string) => {
      if (!side) return null;
      const ok = side.present;
      return <button type="button" className={`dq-side ${ok ? "ok" : "miss"}`} onClick={() => side.source_table && openTableData(side.source_table)}>
        <span className="dq-side-lab">{label}</span>
        <strong className="dq-side-state">{ok ? "有" : "无"}</strong>
        <code className="dq-side-src">{side.title}</code>
        <span className="dq-side-sum">{side.summary}</span>
        {!ok && <em className="dq-side-hint">{side.empty_hint || "此侧无记录"}</em>}
        {ok && side.records.length > 0 && <em className="dq-side-hint">{side.records.length} 处引用</em>}
      </button>;
    };

    const renderEvidence = (side: TraceSide, tone: "db" | "code") => {
      const refs = side.records;
      const systems = Array.from(new Set(refs.map((r) => r.system)));
      return <section className={`dq-evidence ${tone} ${side.present ? "has" : "miss"}`}>
        <header>
          <button type="button" onClick={() => side.source_table && openTableData(side.source_table)}>{side.title}</button>
          <i className={side.present ? "ok" : "no"}>{side.present ? "有证据" : "无证据"}</i>
        </header>
        {!side.present ? <div className="dq-empty"><p>{side.empty_hint || "此侧无记录"}</p></div> : <>
          {side.props.length > 0 && <div className="dq-kv">{side.props.slice(0, 10).map((p) => <div key={p.k}><em>{p.k}</em><b>{p.v}</b></div>)}</div>}
          {refs.length > 0 && <div className="dq-ref-map">
            <div className="dq-ref-head">访问轨迹 · {refs.length}</div>
            {systems.map((sys) => <div key={sys} className="dq-ref-sys">
              <div className="dq-ref-sys-name">{sys}</div>
              <ul>{refs.filter((r) => r.system === sys).map((rec, i) => <li key={i}>
                <span className="dq-path"><i>{rec.module}</i><b>→</b><code>{rec.entry}</code></span>
                <em className={`viz-op op-${rec.op}`}>{rec.op}</em>
                {rec.expr !== "—" && <small>{rec.expr}</small>}
              </li>)}</ul>
            </div>)}
          </div>}
        </>}
      </section>;
    };

    return <div className="dq-page">
      <section className={`dq-verdict ${clash ? "clash" : both && leftOk && rightOk ? "both" : "neutral"}`}>
        <div className="dq-verdict-type">{data.diff_type || "差异对照"}</div>
        <p>{data.compare_hint}</p>
        <div className="dq-verdict-meta">
          <span>{verdict}</span>
          {data.confidence != null && data.confidence > 0 && <span>置信 {data.confidence}%</span>}
        </div>
      </section>

      {both && <section className="dq-presence">
        {renderPresence(left, "左侧")}
        <div className={`dq-vs ${clash ? "clash" : "ok"}`} aria-hidden>
          <span>{clash ? "≠" : "≈"}</span>
          <small>{clash ? "不一致" : "可对照"}</small>
        </div>
        {renderPresence(right, "右侧")}
      </section>}

      {both && diffRows.length > 0 && <section className="dq-diff">
        <div className="dq-sec-title">属性对照</div>
        <div className="dq-diff-head"><span>属性</span><span>{left?.title.split("·")[0]?.trim() || "左侧"}</span><span>{right?.title.split("·")[0]?.trim() || "右侧"}</span><span>结果</span></div>
        {diffRows.map((row) => <div key={row.k} className={`dq-diff-row ${row.differ ? "differ" : row.missL || row.missR ? "gap" : "same"}`}>
          <em>{row.k}</em>
          <b className={row.missL ? "dim" : ""}>{row.a}</b>
          <b className={row.missR ? "dim" : ""}>{row.b}</b>
          <i>{row.differ ? "不同" : row.missL || row.missR ? "单侧" : "相同"}</i>
        </div>)}
      </section>}

      <section className="dq-detail">
        <div className="dq-sec-title">证据明细</div>
        <div className={`dq-detail-grid ${both ? "two" : "one"}`}>
          {left && renderEvidence(left, "db")}
          {right && renderEvidence(right, "code")}
          {extra.map((s) => <Fragment key={s.key}>{renderEvidence(s, "db")}</Fragment>)}
        </div>
      </section>
    </div>;
  };

  const openTrace = async (id: number, meta?: { title: string; subtitle: string; cells?: string[]; review_status?: string }) => {
    if (id <= 0) return;
    setFactTraceKey(null);
    setTraceOpenId(id);
    setTraceMeta(meta ?? { title: currentTable, subtitle: `候选 #${id}` });
    setTraceBusy(true);
    setPage("trace");
    try {
      setTraceData(await fetchDeriveTrace(id));
    } catch {
      setTraceData(null);
    } finally {
      setTraceBusy(false);
    }
  };

  const openFactTrace = async (key: string, meta?: { title: string; subtitle: string }) => {
    setTraceOpenId(null);
    setFactTraceKey(key);
    setTraceMeta(meta ?? { title: currentTable, subtitle: key });
    setTraceBusy(true);
    setPage("trace");
    try {
      const t = await fetchTraceByKey(key);
      setTraceData({
        id: -1,
        table_code: "",
        object_key: t.object_key,
        cells: [],
        confidence: 0,
        review_status: "pending",
        compare_hint: t.compare_hint,
        diff_type: t.diff_type,
        sides: t.sides,
        key: t.object_key,
      });
    } catch {
      setTraceData(null);
    } finally {
      setTraceBusy(false);
    }
  };

  const loadDeriveSummary = async () => {
    try {
      setDeriveSummary(await fetchDeriveSummary());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (page === "table" && currentTable && genOf(currentTable).kind === "推导") {
      loadDerive(currentTable);
    }
    if (page === "workbench" || (page === "table" && ["03 对象总览", "04 字段主表", "15 字段引用明细", "11 系统模块清单", "12 接口入口清单"].includes(currentTable))) {
      loadWorkbenchFacts();
    }
    if (page === "process") {
      loadDeriveSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, currentTable]);

  const openTableData = (table: string) => {
    setCurrentTable(table);
    setFocusTable(table);
    setPage("table");
  };
  const now = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const runAction = (table: string, msg: string) => setGenDone((prev) => ({ ...prev, [table]: `${msg} · ${now()}` }));
  const triggerUpload = (table: string) => { uploadTarget.current = table; fileRef.current?.click(); };
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = uploadTarget.current;
    setIngestBusy(true);
    try {
      const result = ingestKind === "dmp"
        ? await ingestDmp(file, ingestReplace)
        : ingestKind === "code"
          ? await ingestCode(file, ingestSystem.trim() || "未命名系统", ingestReplace)
          : await ingestAuto(file, ingestSystem.trim() || undefined, ingestReplace);
      const countText = Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(" · ");
      const warn = result.warnings?.length ? ` · ${result.warnings.length} 条告警` : "";
      const msg = `已导入 ${result.kind.toUpperCase()}「${result.filename}」：${countText}${warn}`;
      setIngestMsg(msg);
      if (t && t !== "__batch__") runAction(t, msg);
      await loadWorkbenchFacts();
    } catch (err) {
      setIngestMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIngestBusy(false);
      e.target.value = "";
    }
  };

  const openResultFrom = (table: string) => {
    const t = tableInfo[table];
    if (!t) return;
    setFocusTable(table);
    setMode(t.mode);
    setPage("workbench");
  };
  const openProcessFor = (table: string) => {
    if (tableInfo[table]) { openTableData(table); return; }
    setFocusTable(table);
    setPage("process");
  };
  const deriveTables = Object.entries(tableGen).filter(([, g]) => g.kind === "推导").map(([n]) => n);
  const deriveStats = deriveTables.map((t) => deriveSummary?.tables.find((x) => x.table_name === t));
  const ranDerive = deriveStats.filter((s) => s && s.total > 0).length;
  const pendingConfirm = deriveStats.reduce((n, s) => n + (s?.pending ?? 0), 0);
  const readyApply = deriveStats.reduce((n, s) => n + (s?.ok ?? 0), 0);
  const appliedAll = deriveStats.reduce((n, s) => n + (s?.applied ?? 0), 0);
  const totalCand = deriveSummary?.total_candidates ?? 0;
  const overallPct = deriveTables.length
    ? Math.round(deriveTables.reduce((n, t) => n + progressPct(deriveSummary?.tables.find((x) => x.table_name === t)), 0) / deriveTables.length)
    : 0;
  const nextAction = totalCand === 0
    ? { label: "下一步：运行全部推导", go: null as string | null }
    : pendingConfirm > 0
      ? { label: `下一步：确认剩余 ${pendingConfirm} 条候选`, go: deriveTables.find((t) => (deriveSummary?.tables.find((x) => x.table_name === t)?.pending ?? 0) > 0) ?? null }
      : readyApply > 0
        ? { label: `下一步：应用 ${readyApply} 条已确认结果`, go: deriveTables.find((t) => (deriveSummary?.tables.find((x) => x.table_name === t)?.ok ?? 0) > 0) ?? null }
        : { label: "本轮推导已闭环，可进入数据视图查看结论", go: null };

  const phaseLiveStatus = (p: Phase): Phase["status"] => {
    const outs = p.outputs;
    const deriveOuts = outs.filter((o) => genOf(o).kind === "推导");
    if (deriveOuts.length === 0) return p.status;
    const stats = deriveOuts.map((o) => progressOfDerive(deriveSummary?.tables.find((x) => x.table_name === o)));
    if (stats.every((s) => s === "已完成")) return "已完成";
    if (stats.some((s) => s !== "未开始")) return "进行中";
    return p.status === "已完成" ? "进行中" : p.status;
  };
  const liveDoneCount = phases.filter((p) => phaseLiveStatus(p) === "已完成").length;
  const backing = phases.flatMap((p) =>
    p.outputs
      .filter((o) => tableInfo[o]?.mode === mode)
      .map((o) => ({ table: o, no: p.no, label: tableInfo[o].label })),
  );
  const [selectedField, setSelectedField] = useState("PROJECT_CODE");
  const [selectedApi, setSelectedApi] = useState(apis[0].id);
  const [selectedSystem, setSelectedSystem] = useState(apis[0].system);
  const [selectedSchema, setSelectedSchema] = useState(PRIMARY_SCHEMA);
  const [selectedTable, setSelectedTable] = useState(PRIMARY_TABLE);

  // 统一血缘事实：优先后端表15，否则演示 facts
  const lineage: LineageFact[] = (() => {
    if (factLive?.refs?.length) {
      return factLive.refs.map((r) => {
        const parts = r.entry_name.split(" ");
        const method = (parts[0] === "POST" || parts[0] === "GET" || parts[0] === "PUT" || parts[0] === "DELETE" ? parts[0] : "GET") as Fact["method"];
        return {
          system: r.system_name,
          module: r.module_name,
          api: r.entry_name,
          method,
          op: (r.op_type === "INSERT" ? "INSERT" : "SELECT") as Fact["op"],
          schema: r.schema_name,
          table: r.table_name.includes(".") ? r.table_name : `${r.schema_name}.${r.table_name}`,
          field: r.field_name,
        };
      });
    }
    return facts;
  })();

  const entryMeta: Record<string, { label?: string; className?: string; filePath?: string; system?: string; module?: string }> = {};
  (factLive?.entries || []).forEach((e) => {
    entryMeta[e.entry_name] = {
      label: e.method_name || e.entry_name,
      className: e.entry_class || undefined,
      filePath: e.file_path || undefined,
      system: e.system_name,
      module: e.module_name,
    };
  });

  const liveSystems = uniq([
    ...lineage.map((f) => f.system),
    ...(factLive?.modules || []).map((m) => m.system_name),
    ...(factLive?.entries || []).map((e) => e.system_name),
  ]);
  const systemsList = liveSystems.length ? liveSystems : uniq(facts.map((f) => f.system));

  const liveApis = (() => {
    const fromLineage = uniq(lineage.map((f) => f.api)).map((api) => {
      const rows = lineage.filter((f) => f.api === api);
      const first = rows[0];
      const [method, ...rest] = api.split(" ");
      return {
        id: api, api, method: first.method || method, path: rest.join(" ") || api,
        label: entryMeta[api]?.label ?? apiLabels[api] ?? api,
        system: first.system, module: first.module, op: first.op,
        tables: uniq(rows.map((r) => r.table)).length,
        fields: rows.length,
        dbs: uniq(rows.map((r) => r.schema)).length,
      };
    });
    if (fromLineage.length) return fromLineage;
    // 仅有入口清单
    return (factLive?.entries || []).map((e) => {
      const [method, ...rest] = e.entry_name.split(" ");
      return {
        id: e.entry_name, api: e.entry_name, method, path: rest.join(" "),
        label: e.method_name || e.entry_name,
        system: e.system_name, module: e.module_name, op: "SELECT" as const,
        tables: 0, fields: 0, dbs: 0,
      };
    });
  })();
  const workbenchApis = liveApis.length ? liveApis : apis;

  const api = workbenchApis.find((a) => a.id === selectedApi) ?? workbenchApis[0] ?? apis[0];
  const pickApi = (id: string) => {
    setSelectedApi(id);
    const hit = workbenchApis.find((a) => a.id === id);
    if (hit) setSelectedSystem(hit.system);
  };
  const pickSystem = (sys: string) => {
    setSelectedSystem(sys);
    const first = workbenchApis.find((a) => a.system === sys);
    if (first) setSelectedApi(first.id);
    else {
      const ent = (factLive?.entries || []).find((e) => e.system_name === sys);
      if (ent) setSelectedApi(ent.entry_name);
    }
  };

  // —— 数据视图：库 / 表 / 字段 ——
  const schemaOptions = (() => {
    if (factLive?.fields?.length || factLive?.objects?.length) {
      const names = uniq([
        ...(factLive?.objects || []).map((o) => o.schema_name),
        ...(factLive?.fields || []).map((f) => f.schema_name),
      ]);
      return names.map((name) => {
        const tables = uniq((factLive?.fields || []).filter((f) => f.schema_name === name).map((f) => f.table_name));
        const fieldCount = (factLive?.fields || []).filter((f) => f.schema_name === name).length;
        return { name, tableCount: tables.length || (factLive?.objects || []).filter((o) => o.schema_name === name).length, fieldCount };
      });
    }
    const names = uniq(facts.map((f) => f.schema));
    return names.map((name) => ({
      name,
      tableCount: uniq(facts.filter((f) => f.schema === name).map((f) => f.table)).length,
      fieldCount: facts.filter((f) => f.schema === name).length,
    }));
  })();

  const effectiveSchema = schemaOptions.some((s) => s.name === selectedSchema)
    ? selectedSchema
    : (schemaOptions[0]?.name || PRIMARY_SCHEMA);

  const tableOptions = (() => {
    if (factLive?.fields?.length) {
      const names = uniq(factLive.fields.filter((f) => f.schema_name === effectiveSchema).map((f) => f.table_name));
      return names.map((name) => {
        const flds = factLive.fields.filter((f) => f.schema_name === effectiveSchema && f.table_name === name);
        const obj = factLive.objects.find((o) => o.schema_name === effectiveSchema && o.object_name === name);
        const fq = name.includes(".") ? name : `${effectiveSchema}.${name}`;
        const refs = lineage.filter((r) => r.schema === effectiveSchema && (r.table === name || r.table === fq)).length;
        return {
          name: fq,
          comment: obj?.object_comment || obj?.preliminary_class || undefined,
          fields: flds.length,
          refs,
          core: flds.filter((f) => f.is_core).length,
        };
      });
    }
    const names = uniq(facts.filter((f) => f.schema === effectiveSchema).map((f) => f.table));
    return names.map((name) => ({
      name,
      comment: undefined as string | undefined,
      fields: uniq(facts.filter((f) => f.table === name).map((f) => f.field)).length,
      refs: facts.filter((f) => f.table === name).length,
      core: 0,
    }));
  })();

  const effectiveTable = tableOptions.some((t) => t.name === selectedTable)
    ? selectedTable
    : (tableOptions[0]?.name || PRIMARY_TABLE);

  const pickSchema = (s: string) => {
    setSelectedSchema(s);
    const first = (() => {
      if (factLive?.fields?.length) {
        const t = factLive.fields.find((f) => f.schema_name === s)?.table_name;
        return t ? (t.includes(".") ? t : `${s}.${t}`) : PRIMARY_TABLE;
      }
      return facts.find((f) => f.schema === s)?.table || PRIMARY_TABLE;
    })();
    setSelectedTable(first);
  };

  const tableFields = (() => {
    const short = effectiveTable.includes(".") ? effectiveTable.split(".").pop()! : effectiveTable;
    if (factLive?.fields?.length) {
      return factLive.fields
        .filter((f) => f.schema_name === effectiveSchema && (f.table_name === short || f.table_name === effectiveTable))
        .map((f) => {
          const fq = effectiveTable.includes(".") ? effectiveTable : `${effectiveSchema}.${f.table_name}`;
          const refs = uniq(lineage.filter((r) => r.field === f.field_name && (r.table === fq || r.table === f.table_name || r.table.endsWith(`.${short}`))).map((r) => r.api)).length;
          const meta = fieldMeta[f.field_name];
          const risk = refs >= 3 ? "高" as const : refs >= 1 ? "中" as const : "低" as const;
          return {
            code: f.field_name,
            label: f.field_comment || meta?.label || "—",
            type: f.data_type || meta?.type || "",
            count: refs,
            risk: meta?.risk || risk,
            is_pk: f.is_pk,
            is_fk: f.is_fk,
          };
        });
    }
    return uniq(facts.filter((f) => f.table === effectiveTable || f.table.endsWith(`.${short}`)).map((f) => f.field)).map((code) => {
      const refs = uniq(facts.filter((f) => (f.table === effectiveTable || f.table.endsWith(`.${short}`)) && f.field === code).map((f) => f.api)).length;
      const meta = fieldMeta[code] ?? { label: "—", type: "", risk: "低" as const };
      return { code, label: meta.label, type: meta.type, count: refs, risk: meta.risk, is_pk: false, is_fk: false };
    });
  })();

  const fields = tableFields;
  const field = (selectedField && fields.find((f) => f.code === selectedField)) || fields[0] || { code: "—", label: "—", type: "", count: 0, risk: "低" as const, is_pk: false, is_fk: false };
  const fieldTree = (() => {
    const short = effectiveTable.includes(".") ? effectiveTable.split(".").pop()! : effectiveTable;
    const rows = lineage.filter((f) => f.field === field.code && (f.table === effectiveTable || f.table.endsWith(`.${short}`) || f.table === short));
    return uniq(rows.map((r) => r.system)).map((system) => {
      const sysRows = rows.filter((r) => r.system === system);
      const modules = uniq(sysRows.map((r) => r.module));
      return {
        name: system, type: "系统" as const, meta: `${modules.length} 个模块 · ${uniq(sysRows.map((r) => r.api)).length} 个接口`,
        children: modules.map((module) => ({
          name: module, type: "模块" as const,
          children: uniq(sysRows.filter((r) => r.module === module).map((r) => r.api)).map((apiName) => {
            const op = sysRows.find((r) => r.api === apiName)!.op;
            return { name: apiName, type: "接口" as const, meta: `API · ${op}` };
          }),
        })),
      };
    });
  })();
  const fieldSystems = uniq(lineage.filter((f) => f.field === field.code).map((f) => f.system)).length;

  const jumpToField = (schema: string, table: string, fieldName: string) => {
    setMode("data");
    setSelectedSchema(schema);
    setSelectedTable(table.includes(".") ? table : `${schema}.${table}`);
    setSelectedField(fieldName);
  };

  return <main className="app-shell">
    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFilePicked} />
    <aside className="rail">
      <div className="brand-mark"><span>Δ</span></div>
      <div className="rail-nav">
        <button className={`rail-button ${page === "process" || page === "table" || page === "trace" ? "active" : ""}`} title="分析过程" onClick={() => setPage("process")}><Mark kind="flow" /></button>
        <button className={`rail-button ${page === "workbench" ? "active" : ""}`} title="数据视图" onClick={() => setPage("workbench")}><Mark kind="field" /></button>
        <button className={`rail-button ${page === "lineage" ? "active" : ""}`} title="基础库候选" onClick={() => setPage("lineage")}><Mark kind="graph" /></button>
        <button className={`rail-button ${page === "config" ? "active" : ""}`} title="系统配置" onClick={() => setPage("config")}><Mark kind="shield" /></button>
      </div>
      <div className="rail-bottom"><div className="avatar">WL</div></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div className="crumb">{page === "trace"
          ? <><button className="crumb-link" onClick={() => setPage("process")}>分析过程</button><i>/</i><button className="crumb-link" onClick={backFromTrace}>{currentTable}</button><i>/</i><strong>对照详情</strong></>
          : page === "table"
          ? <><button className="crumb-link" onClick={() => setPage("process")}>分析过程</button><i>/</i><strong>{currentTable}</strong></>
          : page === "tpledit"
          ? <><button className="crumb-link" onClick={() => setPage("config")}>系统配置</button><i>/</i><strong>编辑表模版</strong></>
          : <><span>数据资产</span><i>/</i><strong>{page === "process" ? "分析过程" : page === "lineage" ? "基础库候选分析" : page === "config" ? "系统配置" : "结构与引用分析"}</strong></>}</div>
        <div className="top-actions"><span className="sync"><b />DMP 与源码扫描同步于 09:42</span><button className="help">?</button></div>
      </header>

      {page === "trace" ? <div className="content trace-content">
        <div className="table-head">
          <button className="back-button" onClick={backFromTrace}>← 返回明细表</button>
          <div className="table-title">
            <div>
              <span>{traceMeta?.title || currentTable} · 对照详情</span>
              <h1>{traceMeta?.subtitle || "差异对质"}</h1>
            </div>
          </div>
        </div>
        {traceOpenId && traceOpenId > 0 && <div className="trace-actions-bar">
          <span>核对完两侧证据后，确认或存疑</span>
          <div className="rev-actions">
            <button className={`rev-btn ok ${(traceData?.review_status === "ok" || traceData?.review_status === "applied" || traceMeta?.review_status === "ok") ? "on" : ""}`} title="确认" onClick={async () => {
              await reviewDerive([traceOpenId], "ok");
              setTraceMeta((m) => m ? { ...m, review_status: "ok" } : m);
              if (traceData) setTraceData({ ...traceData, review_status: "ok" });
              await loadDerive(currentTable);
              await loadDeriveSummary();
            }}>✓ 确认</button>
            <button className={`rev-btn no ${(traceData?.review_status === "no" || traceMeta?.review_status === "no") ? "on" : ""}`} title="存疑" onClick={async () => {
              await reviewDerive([traceOpenId], "no");
              setTraceMeta((m) => m ? { ...m, review_status: "no" } : m);
              if (traceData) setTraceData({ ...traceData, review_status: "no" });
              await loadDerive(currentTable);
              await loadDeriveSummary();
            }}>? 存疑</button>
          </div>
        </div>}
        {traceBusy ? <div className="panel"><p className="trace-loading">正在加载对照…</p></div>
          : traceData ? renderTracePanel({ ...traceData, confidence: traceData.confidence })
          : <div className="panel"><p className="trace-loading">无法加载对照详情</p></div>}
      </div> : page === "table" ? (() => {
        const info = tableInfo[currentTable];
        const ph = phaseOf(currentTable);
        const ev = evidenceOf(currentTable);
        let cfgCols: string[] = [];
        let pIdx = -1;
        let oIdx = -1;
        phaseCfg.forEach((p, pi) => p.outputs.forEach((o, oi) => { if (o.name === currentTable) { cfgCols = o.columns; pIdx = pi; oIdx = oi; } }));
        const tplKey = `${pIdx}-${oIdx}`;
        return <div className="content">
          <div className="table-head">
            <button className="back-button" onClick={() => setPage("process")}>← 返回分析过程</button>
            <div className="table-title">
              <div><span>{ph ? `${ph.no} · ${ph.name}` : "过程产出表"}</span><h1>{currentTable}</h1></div>
              {info && <button className="source-button" onClick={() => openResultFrom(currentTable)}>在{info.mode === "data" ? "数据视图" : "接口视图"}查看结论 <Mark kind="arrow" /></button>}
            </div>
          </div>
          {genOf(currentTable).kind === "推导" && (() => {
            const st = deriveSummary?.tables.find((x) => x.table_name === currentTable) || (deriveLive?.table_name === currentTable ? {
              total: deriveLive.stats.total,
              pending: deriveLive.stats.pending,
              ok: deriveLive.stats.ok,
              no: deriveLive.stats.no,
              applied: deriveLive.stats.applied,
            } : undefined);
            const prog = progressOfDerive(st as DeriveTableStat | undefined);
            const pct = progressPct(st as DeriveTableStat | undefined);
            const downs = consumersOf(currentTable);
            return <div className="table-progress">
              <div className="table-progress-main">
                <span className={`dmap-st s-${prog}`}>{prog}</span>
                <b>本表进度 {pct}%</b>
                <span>{st ? `${st.applied} 已落库 · ${st.ok} 待应用 · ${st.pending} 待确认 · 共 ${st.total}` : "尚未运行推导"}</span>
              </div>
              <div className="table-progress-meter"><i style={{ width: `${pct}%` }} /></div>
              {downs.length > 0 && <div className="table-progress-next">确认并应用后，将供给后续：{downs.map((d) => <button key={d} type="button" onClick={() => openTableData(d)}>{tableNo(d)}</button>)}</div>}
            </div>;
          })()}

          <div className="table-meta">
            <div className="meta-cell"><span>证据来源</span><b>{ev.source}</b></div>
            <div className="meta-cell"><span>结论等级</span><b className={ev.level === "已验证" ? "ready" : ""}>{ev.level}</b></div>
            <div className="meta-cell"><span>适用范围</span><b>{ev.scope}</b></div>
            {info && <div className="meta-cell wide"><span>贡献链路</span><div className="chain-mini">{CHAIN.map((seg) => <i key={seg} className={info.chain.includes(seg) ? "on" : ""}>{seg}</i>)}</div></div>}
          </div>

          {(() => {
            const g = genOf(currentTable);
            const done = genDone[currentTable];
            let cols: string[] = [];
            for (const p of phaseCfg) { const o = p.outputs.find((x) => x.name === currentTable); if (o) cols = o.columns; }
            const offline = derivationFor(currentTable, g, cols);
            const live = deriveLive && deriveLive.table_name === currentTable ? deriveLive : null;
            const dv = live
              ? {
                  rule: live.rule,
                  logic: live.logic,
                  columns: live.columns.length ? live.columns : offline.columns,
                  rows: live.rows.map((r) => ({
                    id: r.id,
                    cells: r.cells,
                    evidence: r.evidence,
                    note: r.note || undefined,
                    confidence: r.confidence ?? 50,
                    review_status: r.review_status,
                  })),
                }
              : { ...offline, rows: offline.rows.map((r, i) => ({ ...r, id: -(i + 1), confidence: 50, review_status: rowMark[`${currentTable}-${i}`] === "ok" ? "ok" as const : rowMark[`${currentTable}-${i}`] === "no" ? "no" as const : "pending" as const })) };
            const isDerive = g.kind === "推导" && (g.deps?.length ?? 0) > 0;
            const okCount = dv.rows.filter((r) => r.review_status === "ok" || r.review_status === "applied").length;
            const noCount = dv.rows.filter((r) => r.review_status === "no").length;
            const pendingIds = dv.rows.filter((r) => r.review_status === "pending" && r.id > 0).map((r) => r.id);
            const okIds = dv.rows.filter((r) => r.review_status === "ok" && r.id > 0).map((r) => r.id);

            const doRunDerive = async () => {
              setDeriveBusy(true);
              try {
                await runDerive(currentTable);
                await loadDerive(currentTable);
                await loadDeriveSummary();
                runAction(currentTable, "已运行推导，生成候选待确认");
              } catch (e) {
                runAction(currentTable, `推导失败：${e instanceof Error ? e.message : e}`);
              } finally {
                setDeriveBusy(false);
              }
            };
            const markRow = async (id: number, status: "ok" | "no", offlineIdx?: number) => {
              if (id > 0) {
                await reviewDerive([id], status);
                await loadDerive(currentTable);
                await loadDeriveSummary();
              } else if (offlineIdx !== undefined) {
                setRowMark((m) => ({ ...m, [`${currentTable}-${offlineIdx}`]: status }));
              }
            };
            const confirmAll = async () => {
              if (pendingIds.length) {
                await reviewDerive(pendingIds, "ok");
                await loadDerive(currentTable);
                await loadDeriveSummary();
              } else {
                setRowMark((m) => {
                  const n = { ...m };
                  dv.rows.forEach((_, ri) => { n[`${currentTable}-${ri}`] = "ok"; });
                  return n;
                });
              }
            };
            const doApply = async () => {
              setDeriveBusy(true);
              try {
                if (okIds.length === 0 && !live) {
                  runAction(currentTable, `已写入 ${okCount} 条确认结果（本地演示）`);
                  return;
                }
                const res = await applyDerive(currentTable);
                await loadDerive(currentTable);
                await loadDeriveSummary();
                runAction(currentTable, `已应用 ${res.applied} 条 · 写入正式表 ${res.written} 条`);
              } catch (e) {
                runAction(currentTable, `应用失败：${e instanceof Error ? e.message : e}`);
              } finally {
                setDeriveBusy(false);
              }
            };

            return <section className="panel source-panel">
              <div className="source-head">
                <div className="source-lead"><span className={`kind-tag k-${g.kind}`}>{g.kind}</span><div><b>来源与生成</b><span>{g.via}{live?.updated_at ? ` · 最近推导 ${live.updated_at}` : ""}</span></div></div>
                <div className="source-actions">
                  {g.kind === "解析" && <button className="ingest-btn primary" onClick={() => runAction(currentTable, "已重新解析 DMP + 源码")}><Mark kind="flow" />重新解析</button>}
                  {isDerive && <button className="ingest-btn primary" disabled={deriveBusy} onClick={doRunDerive}><Mark kind="flow" />{deriveBusy ? "推导中…" : "运行推导"}</button>}
                  <button className="ingest-btn" onClick={() => triggerUpload(currentTable)}><Mark kind="table" />{g.kind === "上传" ? "上传 / 替换 Excel" : "上传 Excel 覆盖"}</button>
                </div>
              </div>
              {isDerive ? <div className="derive-panel">
                {(() => {
                  const ups = (live?.deps?.length ? live.deps : g.deps) ?? [];
                  const downs = consumersOf(currentTable);
                  const rowCount = (t: string) => {
                    const st = deriveSummary?.tables.find((x) => x.table_name === t);
                    if (st) return `${st.total} 候选`;
                    if (tableInfo[t]) return `${tableInfo[t].total} 行`;
                    return `${genOf(t).kind}`;
                  };
                  return <div className="derive-chain">
                    <div className="derive-chain-col">
                      <div className="derive-chain-label">前序输入 <em>{ups.length}</em></div>
                      <div className="derive-chain-nodes">{ups.length ? ups.map((d) => <button key={d} className="pipe-node input" onClick={() => openTableData(d)}><span>{genOf(d).kind}</span><code>{d}</code><small>{rowCount(d)}</small></button>) : <span className="chain-empty">无显式前序</span>}</div>
                    </div>
                    <div className="derive-chain-arm"><i className="pipe-line" /><div className="pipe-engine"><Mark kind="flow" /><b>本表</b><code>{tableNo(currentTable)}</code></div><i className="pipe-line" /></div>
                    <div className="derive-chain-col current">
                      <div className="derive-chain-label">当前产出</div>
                      <div className="pipe-node output"><span>候选确认后落库</span><code>{currentTable}</code><small>{dv.rows.length} 条候选</small></div>
                    </div>
                    <div className="derive-chain-arm"><i className="pipe-line" /><span className="chain-arrow">→</span><i className="pipe-line" /></div>
                    <div className="derive-chain-col">
                      <div className="derive-chain-label">后续消费 <em>{downs.length}</em></div>
                      <div className="derive-chain-nodes">{downs.length ? downs.map((d) => <button key={d} className="pipe-node down" onClick={() => openTableData(d)}><span>{genOf(d).kind}</span><code>{d}</code><small>{rowCount(d)}</small></button>) : <span className="chain-empty">末端表 · 无下游推导</span>}</div>
                    </div>
                  </div>;
                })()}

                <div className="derive-logic">
                  <div className="derive-logic-head"><Mark kind="search" /><b>推导规则</b><span>{dv.rule}</span></div>
                  <ol>{dv.logic.map((s, i) => <li key={i}><em>{i + 1}</em>{s}</li>)}</ol>
                </div>

                {dv.rows.length ? <div className="derive-review">
                  <div className="review-head"><div><b>候选明细</b><span>共 {dv.rows.length} 条 · 点击行进入可视化对照 · 已确认 {okCount} · 存疑 {noCount}{live?.stats?.avg_confidence != null ? ` · 均置信 ${live.stats.avg_confidence}%` : ""}{live ? ` · 批次 ${live.batch_id || "—"}` : " · 尚未落库（先点运行推导）"}</span></div><button className="ingest-btn" onClick={confirmAll}><Mark kind="check" />全部确认</button></div>
                  <div className="data-scroll full"><table className="data-grid derive-grid"><thead><tr><th className="rownum">#</th>{dv.columns.map((c) => <th key={c}>{c}</th>)}<th>置信度</th><th>推导依据</th><th className="rev-col">确认</th><th></th></tr></thead><tbody>{dv.rows.map((r, ri) => {
                    const mk = r.review_status;
                    const conf = "confidence" in r ? (r as { confidence?: number }).confidence ?? 50 : 50;
                    return <tr key={r.id || ri} className={`${mk === "ok" || mk === "applied" ? "row-ok" : mk === "no" ? "row-no" : ""} ${r.id > 0 ? "row-click" : ""}`} onClick={() => r.id > 0 && openTrace(r.id, { title: currentTable, subtitle: r.cells[0] || `候选 #${r.id}`, cells: r.cells, review_status: r.review_status })}>
                      <td className="rownum">{ri + 1}</td>
                      {r.cells.map((cell, ci) => <td key={ci}>{cell}</td>)}
                      <td className="conf-cell"><span className={`conf-pill c-${conf >= 80 ? "hi" : conf >= 60 ? "mid" : "lo"}`}>{conf}%</span></td>
                      <td className="ev-cell"><div className="ev-chips">{r.evidence.map((e, ei) => <button key={ei} className="ev-chip" onClick={(ev) => { ev.stopPropagation(); openTableData(e.t); }} title={`来自 ${e.t}`}><code>{e.t.split(" ")[0]}</code>{e.ref}</button>)}{r.note && <span className="ev-note">{r.note}</span>}</div></td>
                      <td className="rev-col" onClick={(ev) => ev.stopPropagation()}><div className="rev-actions"><button className={`rev-btn ok ${mk === "ok" || mk === "applied" ? "on" : ""}`} onClick={() => markRow(r.id, "ok", ri)} title="确认">✓</button><button className={`rev-btn no ${mk === "no" ? "on" : ""}`} onClick={() => markRow(r.id, "no", ri)} title="存疑">?</button></div></td>
                      <td className="go-col"><span className="out-open">对照 <Mark kind="arrow" /></span></td>
                    </tr>;
                  })}</tbody></table></div>
                  <div className="review-foot"><span>{okCount === dv.rows.length && dv.rows.length > 0 ? "全部候选已确认，可写入正式表" : `还有 ${dv.rows.length - okCount} 条待确认`}</span><button className="ingest-btn primary" disabled={okCount === 0 || deriveBusy} onClick={doApply}><Mark kind="check" />应用已确认（{okCount}）</button></div>
                </div> : <div className="derive-empty"><p>点击运行推导，按上述规则从前序表（库内事实）生成候选结果，逐条确认后写入正式表。</p><button className="ingest-btn primary" disabled={deriveBusy} onClick={doRunDerive}><Mark kind="flow" />{deriveBusy ? "推导中…" : "运行推导"}</button></div>}
              </div> : g.kind !== "上传" ? <p className="source-hint">本表由 {g.via} 自动生成，无前序依赖；也可上传 Excel 覆盖。</p> : null}
              {done && <p className="ingest-note"><Mark kind="check" />{done}</p>}
            </section>;
          })()}

          {["03 对象总览", "04 字段主表", "15 字段引用明细"].includes(currentTable) && factLive ? <section className="panel table-panel">
            <div className="table-bar"><div><b>数据明细</b><span>点击行进入可视化对照 · {
              currentTable === "04 字段主表" ? `${factLive.fields.length} 字段`
                : currentTable === "15 字段引用明细" ? `${factLive.refs.length} 引用`
                : `${factLive.objects.length} 对象`
            }</span></div><div className="table-tools"><span className="tool-note">真数据</span></div></div>
            <div className="data-scroll full"><table className="data-grid derive-grid"><thead><tr><th className="rownum">#</th>
              {currentTable === "04 字段主表" && <><th>字段</th><th>注释</th><th>类型</th><th>引用数</th><th>状态</th><th></th></>}
              {currentTable === "15 字段引用明细" && <><th>系统</th><th>入口</th><th>操作</th><th>字段</th><th>角色</th><th></th></>}
              {currentTable === "03 对象总览" && <><th>对象</th><th>类型</th><th>分类</th><th>源码引用</th><th>入口数</th><th></th></>}
            </tr></thead><tbody>
              {currentTable === "04 字段主表" && factLive.fields.map((f, ri) => {
                const key = f.full_name;
                return <tr key={f.id} className="row-click" onClick={() => openFactTrace(key, { title: "04 字段主表", subtitle: key })}>
                  <td className="rownum">{ri + 1}</td>
                  <td><code>{key}</code></td><td>{f.field_comment || "—"}</td><td>{f.data_type || "—"}</td><td>{f.source_ref_count}</td><td>{f.field_ref_status || "—"}</td>
                  <td className="go-col"><span className="out-open">对照 <Mark kind="arrow" /></span></td>
                </tr>;
              })}
              {currentTable === "15 字段引用明细" && factLive.refs.map((r, ri) => {
                const key = r.full_field;
                return <tr key={r.id} className="row-click" onClick={() => openFactTrace(key, { title: "15 字段引用明细", subtitle: `${r.entry_name} → ${key}` })}>
                  <td className="rownum">{ri + 1}</td>
                  <td>{r.system_name}</td><td><code>{r.entry_name}</code></td><td>{r.op_type}</td><td><code>{key}</code></td><td>{r.field_role || "—"}</td>
                  <td className="go-col"><span className="out-open">对照 <Mark kind="arrow" /></span></td>
                </tr>;
              })}
              {currentTable === "03 对象总览" && factLive.objects.map((o, ri) => {
                const key = `${o.schema_name}.${o.object_name}`;
                return <tr key={o.id} className="row-click" onClick={() => openFactTrace(key, { title: "03 对象总览", subtitle: key })}>
                  <td className="rownum">{ri + 1}</td>
                  <td><code>{key}</code></td><td>{o.object_type}</td><td>{o.preliminary_class || "—"}</td><td>{o.referenced_by_code ? "是" : "否"}</td><td>{o.ref_entry_count}</td>
                  <td className="go-col"><span className="out-open">对照 <Mark kind="arrow" /></span></td>
                </tr>;
              })}
            </tbody></table></div>
            <div className="table-foot">明细表仅列清单 · 点击行进入库/码可视化对照</div>
          </section> : info ? <section className="panel table-panel">
            <div className="table-bar"><div><b>数据明细</b><span>共 {info.total} 行 · 当前显示 {info.rows.length} 行（示例）</span></div><div className="table-tools"><button className="icon-button"><Mark kind="search" /></button><span className="tool-note">DMP + 源码扫描回填</span></div></div>
            <div className="data-scroll full"><table className="data-grid"><thead><tr><th className="rownum">#</th>{info.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{info.rows.map((r, ri) => <tr key={ri}><td className="rownum">{ri + 1}</td>{r.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>)}</tbody></table></div>
            <div className="table-foot">显示 1–{info.rows.length} / {info.total} 行 · 完整数据由 DMP 导入与源码扫描持续回填</div>
          </section> : pIdx >= 0 ? <section className="panel table-panel">
            <div className="table-bar"><div><b>列模版</b><span>可在此直接编辑，修改即同步到系统配置，无需跳转</span></div><div className="table-tools"><button className="cfg-mode-toggle" onClick={() => setBulkEdit((b) => ({ ...b, [tplKey]: !b[tplKey] }))}>{bulkEdit[tplKey] ? "标签编辑" : "批量编辑"}</button><span className="tool-note">共 {cfgCols.length} 列</span></div></div>
            <div className="tpl-editor">{bulkEdit[tplKey]
              ? <div className="cfg-bulk"><textarea value={cfgCols.join("\n")} onChange={(e) => updateOutput(pIdx, oIdx, { columns: parseCols(e.target.value) })} rows={Math.min(Math.max(cfgCols.length + 1, 4), 16)} placeholder="每行一个列名，可直接从 Excel 复制一列/一行表头粘贴" /><small>每行一个列名 · 支持从 Excel 直接粘贴（换行 / 制表符 / 逗号自动分列）</small></div>
              : <div className="cfg-col-chips">{cfgCols.map((c, ci) => <span key={ci} className="cfg-col-chip"><em>{ci + 1}</em><input value={c} onChange={(e) => updateColumn(pIdx, oIdx, ci, e.target.value)} style={{ width: `${Math.max(c.length, 3) + 1}ch` }} /><button onClick={() => removeColumn(pIdx, oIdx, ci)}>✕</button></span>)}<button className="cfg-col-add" onClick={() => addColumn(pIdx, oIdx)}>+ 列</button></div>}</div>
            {cfgCols.length ? <div className="data-scroll full"><table className="data-grid"><thead><tr><th className="rownum">#</th>{cfgCols.map((c, ci) => <th key={ci}>{c || "未命名"}</th>)}</tr></thead><tbody><tr><td className="rownum">1</td>{cfgCols.map((_, ci) => <td key={ci} className="cell-empty">—</td>)}</tr></tbody></table></div> : <p className="tpl-empty">尚未定义列，点击「+ 列」或切换批量编辑粘贴表头</p>}
            <div className="table-foot">数据由 DMP 导入 / 源码扫描 / Excel 上传回填 · 列模版已保存于系统配置</div>
          </section> : <div className="preview-pending big">该表样例数据待 DMP 导入 / 源码扫描回填</div>}
        </div>;
      })() : page === "process" ? <div className="content">
        <div className="workhead">
          <div><h1>分析过程</h1><p>工作按「跑通推导 → 逐条确认 → 应用落库」推进；下方链路与阶段状态随真实进度变化。</p></div>
          <div className="collection-summary">
            <div><span>推导表</span><b>{ranDerive} / {deriveTables.length} 已跑通</b></div>
            <div><span>待确认</span><b className={pendingConfirm ? "warn" : "ready"}>{pendingConfirm} 条</b></div>
            <div><span>待应用</span><b className={readyApply ? "warn" : "ready"}>{readyApply} 条</b></div>
            <div><span>整体进度</span><b className="ready"><i />{overallPct}%</b></div>
          </div>
        </div>

        <section className="panel work-progress">
          <div className="work-progress-bar"><i style={{ width: `${overallPct}%` }} /></div>
          <ol className="work-steps">
            {([
              { n: 1 as const, t: "跑通推导", d: totalCand ? `已生成 ${totalCand} 条候选` : "尚未生成候选",
                st: totalCand > 0 ? "done" as const : "active" as const },
              { n: 2 as const, t: "逐表确认", d: pendingConfirm ? `还剩 ${pendingConfirm} 条` : totalCand ? "候选已审完" : "等待生成",
                st: totalCand === 0 ? "wait" as const : pendingConfirm === 0 ? "done" as const : "active" as const },
              { n: 3 as const, t: "应用落库", d: readyApply ? `${readyApply} 条可写入` : appliedAll ? `已落库 ${appliedAll} 条` : "确认后写入",
                st: totalCand === 0 || pendingConfirm > 0 ? "wait" as const : readyApply > 0 ? "active" as const : appliedAll > 0 ? "done" as const : "wait" as const },
            ]).map((s) => <li key={s.n} className={s.st}>
              <em>{s.st === "done" ? <Mark kind="check" /> : s.n}</em>
              <div><b>{s.t}</b><span>{s.d}</span></div>
            </li>)}
          </ol>
          <div className="work-next">
            <span>{nextAction.label}</span>
            {nextAction.go
              ? <button className="ingest-btn primary" onClick={() => openTableData(nextAction.go!)}>打开 {tableNo(nextAction.go)} <Mark kind="arrow" /></button>
              : totalCand === 0
                ? <button className="ingest-btn primary" disabled={deriveBusy} onClick={async () => {
                    setDeriveBusy(true);
                    try {
                      const res = await runAnalyzeAuto();
                      await loadDeriveSummary();
                      setIngestMsg(`已完成自动推导：${res.ran} 张表 · ${res.total_candidates} 条候选 · ${now()}`);
                    } catch (e) {
                      setIngestMsg(`自动推导失败：${e instanceof Error ? e.message : e}`);
                    } finally {
                      setDeriveBusy(false);
                    }
                  }}>{deriveBusy ? "推导中…" : "运行全部推导"}</button>
                : <button className="ingest-btn" onClick={() => setPage("workbench")}>打开数据视图</button>}
          </div>
        </section>

        <div className="ingest-bar">
          <div className="ingest-lead"><b>数据导入</b><span>DMP 多 sheet 结构 Excel → 表03/04/09；代码接口 Excel → 表11/12（需系统名）</span></div>
          <div className="ingest-actions ingest-import">
            <select className="ingest-select" value={ingestKind} onChange={(e) => setIngestKind(e.target.value as "auto" | "dmp" | "code")} disabled={ingestBusy}>
              <option value="auto">自动识别</option>
              <option value="dmp">DMP结构</option>
              <option value="code">代码接口</option>
            </select>
            {(ingestKind === "code" || ingestKind === "auto") && (
              <input className="ingest-sys" value={ingestSystem} onChange={(e) => setIngestSystem(e.target.value)} placeholder="系统名" disabled={ingestBusy} />
            )}
            <label className="ingest-check"><input type="checkbox" checked={ingestReplace} onChange={(e) => setIngestReplace(e.target.checked)} disabled={ingestBusy} /> 替换同范围</label>
            <button className="ingest-btn" disabled={ingestBusy} onClick={() => triggerUpload("__batch__")}><Mark kind="table" />{ingestBusy ? "导入中…" : "上传 Excel"}</button>
          </div>
        </div>
        <div className="ingest-bar">
          <div className="ingest-lead"><b>自动推导</b><span>基于已落库的表03/04/15 事实，按依赖顺序跑通 9 张推导表</span></div>
          <div className="ingest-actions">
            <button className="ingest-btn primary" disabled={deriveBusy} onClick={async () => {
              setDeriveBusy(true);
              try {
                const res = await runAnalyzeAuto();
                await loadDeriveSummary();
                const top = (res.results as { table_name: string; candidate_count: number }[])
                  .filter((r) => r.candidate_count > 0)
                  .slice(0, 4)
                  .map((r) => `${r.table_name.split(" ")[0]}×${r.candidate_count}`)
                  .join(" · ");
                setIngestMsg(`已完成自动推导：${res.ran} 张表 · ${res.total_candidates} 条候选${top ? `（${top}…）` : ""} · ${now()}`);
                runAction("__scan__", `推导 ${res.total_candidates} 条`);
              } catch (e) {
                setIngestMsg(`自动推导失败：${e instanceof Error ? e.message : e}`);
              } finally {
                setDeriveBusy(false);
              }
            }}><Mark kind="flow" />{deriveBusy ? "推导中…" : "运行全部推导"}</button>
          </div>
          {(ingestMsg || genDone["__scan__"]) && <p className="ingest-note"><Mark kind="check" />{ingestMsg || genDone["__scan__"]}</p>}
        </div>

        <section className="panel derive-map">
          <div className="derive-map-head">
            <div><b>推导链路进度</b><span>节点颜色随状态变化：未开始 → 已生成 → 确认中 → 待应用 → 已完成</span></div>
            <small>{overallPct}% · 阶段 {liveDoneCount}/{phases.length}</small>
          </div>
          <div className="derive-map-layers">{DERIVE_LAYERS.map((layer, li) => {
            const layerTables = layer.tables.filter((t) => genOf(t).kind === "推导");
            const layerPct = layerTables.length
              ? Math.round(layerTables.reduce((n, t) => n + progressPct(deriveSummary?.tables.find((x) => x.table_name === t)), 0) / layerTables.length)
              : (li === 0 ? 100 : 0);
            return <div key={layer.label} className="derive-map-layer">
            {li > 0 && <div className="derive-map-join" aria-hidden>↓</div>}
            <div className="derive-map-label"><em>{li + 1}</em><div><b>{layer.label}</b><span>{layer.hint}</span><div className="layer-meter"><i style={{ width: `${layerPct}%` }} /><b>{layerPct}%</b></div></div></div>
            <div className="derive-map-nodes">{layer.tables.map((t) => {
              const g = genOf(t);
              const liveSt = deriveSummary?.tables.find((x) => x.table_name === t);
              const prog = g.kind === "推导" ? progressOfDerive(liveSt) : "已完成";
              const ups = (g.deps ?? []).map(tableNo).join(" · ");
              const downs = consumersOf(t).map(tableNo);
              const related = focusTable === t
                || (g.deps ?? []).includes(focusTable)
                || consumersOf(focusTable).includes(t);
              return <button key={t} type="button" className={`dmap-node k-${g.kind} st-${prog} ${focusTable === t ? "on" : ""} ${related && focusTable !== t ? "rel" : ""}`} onClick={() => openTableData(t)}>
                <code>{tableNo(t)}</code>
                <span className="dmap-name">{t.replace(/^\d+\s/, "")}</span>
                <span className={`dmap-st s-${prog}`}>{prog}</span>
                {g.kind === "推导" && ups ? <small className="dmap-up">← {ups}</small> : <small className="dmap-up">事实基线</small>}
                {downs.length > 0 && <small className="dmap-down">→ {downs.join(" · ")}</small>}
                {liveSt && liveSt.total > 0 && <i className="dmap-count">{liveSt.applied}/{liveSt.total}</i>}
              </button>;
            })}</div>
          </div>;
          })}</div>
        </section>

        <div className="process-legend">
          <span><i className="dot done" />已完成</span>
          <span><i className="dot doing" />进行中</span>
          <span><i className="dot wait" />待开始</span>
          <span className="lg-kind"><i className="kb k-解析" />解析</span>
          <span className="lg-kind"><i className="kb k-上传" />上传</span>
          <span className="lg-kind"><i className="kb k-推导" />推导</span>
          <span className="lg-prog"><i className="ps s-未开始" />未开始</span>
          <span className="lg-prog"><i className="ps s-已生成" />已生成</span>
          <span className="lg-prog"><i className="ps s-确认中" />确认中</span>
          <span className="lg-prog"><i className="ps s-待应用" />待应用</span>
          <span className="lg-prog"><i className="ps s-已完成" />已落库</span>
        </div>

        <ol className="phase-list">{phases.map((p) => {
          const liveSt = phaseLiveStatus(p);
          const deriveOuts = p.outputs.filter((o) => genOf(o).kind === "推导");
          const phasePct = deriveOuts.length
            ? Math.round(deriveOuts.reduce((n, o) => n + progressPct(deriveSummary?.tables.find((x) => x.table_name === o)), 0) / deriveOuts.length)
            : (liveSt === "已完成" ? 100 : liveSt === "进行中" ? 45 : 0);
          return <li key={p.no} className={`phase-item status-${liveSt}`}>
          <div className="phase-rail"><span className="phase-no">{liveSt === "已完成" ? <Mark kind="check" /> : p.no}</span></div>
          <div className="phase-card panel">
            <div className="phase-head">
              <div><b>{p.name}</b><p>{p.desc}</p></div>
              <div className="phase-tail"><i className={`phase-badge b-${liveSt}`}>{liveSt}</i><small>{phasePct}% · 产出 {p.tables} 张表</small></div>
            </div>
            <div className="phase-meter"><i style={{ width: `${phasePct}%` }} /></div>
            <div className="phase-body">
              <div className="phase-steps"><span>关键步骤</span><ul>{p.steps.map((s, i) => <li key={s}><em>{i + 1}</em>{s}</li>)}</ul></div>
              <div className="phase-outputs"><span>产出数据表 <b>· {p.outputs.filter((o) => tableInfo[o]).length} 张汇入结果</b></span>
                <div className="out-tables">{p.outputs.map((o) => {
                  const info = tableInfo[o];
                  const g = genOf(o);
                  const live = deriveSummary?.tables.find((t) => t.table_name === o);
                  const prog = g.kind === "推导" ? progressOfDerive(live) : (info ? "已完成" : "未开始");
                  const countLabel = live
                    ? `${live.applied}/${live.total} 已落库${live.pending ? ` · ${live.pending}待确认` : live.ok ? ` · ${live.ok}待应用` : ""}`
                    : info
                      ? `${info.total} 行`
                      : "待回填";
                  return <button key={o} className={`out-table-row ${info || live ? "linked" : "mid"} ${g.kind === "推导" ? "is-derive" : ""} st-${prog} ${focusTable === o ? "focus" : ""}`} onClick={() => openTableData(o)}>
                    <code>{o}</code>
                    <span className={`kind-tag k-${g.kind}`}>{g.kind}</span>
                    {g.kind === "推导" ? <>
                      <span className={`dmap-st s-${prog}`}>{prog}</span>
                      <span className="dep-mini" title="前序 → 后续">
                        <em>←{(g.deps ?? []).map(tableNo).join("·") || "—"}</em>
                        <i>/</i>
                        <em>→{consumersOf(o).map(tableNo).join("·") || "端"}</em>
                      </span>
                    </> : info
                      ? <span className="chain-mini">{CHAIN.map((seg) => <i key={seg} className={info.chain.includes(seg) ? "on" : ""}>{seg}</i>)}</span>
                      : <em className="mid-tag">中间过程表</em>}
                    <span className="out-open">{countLabel} <Mark kind="arrow" /></span>
                  </button>;
                })}</div>
              </div>
            </div>
          </div>
        </li>;
        })}</ol>
      </div> : page === "lineage" ? (
        <BaseLibraryView />
      ) : page === "config" ? <div className="content">
        <div className="workhead">
          <div><h1>系统配置</h1><p>管理员可配置分析阶段、每阶段的步骤，以及每个步骤产出表的模版；默认即当前 P0–P6 / 29 表框架。</p></div>
          <div className="config-top"><span>共 {phaseCfg.length} 个阶段 · {phaseCfg.reduce((s, p) => s + p.outputs.length, 0)} 张表模版</span><button className="ingest-btn" onClick={resetCfg}>恢复默认</button><button className="ingest-btn primary" onClick={addPhase}>+ 新增阶段</button></div>
        </div>

        <div className="cfg-list">{phaseCfg.map((p, pi) => <section key={pi} className="panel cfg-phase">
          <div className="cfg-phase-head">
            <input className="cfg-no" value={p.no} onChange={(e) => updatePhase(pi, { no: e.target.value })} />
            <input className="cfg-name" value={p.name} onChange={(e) => updatePhase(pi, { name: e.target.value })} placeholder="阶段名称" />
            <select className="cfg-status" value={p.status} onChange={(e) => updatePhase(pi, { status: e.target.value as Phase["status"] })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button className="cfg-del" onClick={() => removePhase(pi)} title="删除阶段">✕</button>
          </div>
          <input className="cfg-desc" value={p.desc} onChange={(e) => updatePhase(pi, { desc: e.target.value })} placeholder="阶段说明" />

          <div className="cfg-cols">
            <div className="cfg-block">
              <div className="cfg-block-head"><span>关键步骤</span><button onClick={() => addStep(pi)}>+ 步骤</button></div>
              <div className="cfg-steps">{p.steps.map((s, si) => <div key={si} className="cfg-step"><em>{si + 1}</em><input value={s} onChange={(e) => updateStep(pi, si, e.target.value)} /><button onClick={() => removeStep(pi, si)}>✕</button></div>)}{!p.steps.length && <p className="cfg-empty">暂无步骤</p>}</div>
            </div>

            <div className="cfg-block">
              <div className="cfg-block-head"><span>产出表模版</span><button onClick={() => addOutput(pi)}>+ 产出表</button></div>
              <div className="cfg-outputs">{p.outputs.map((o, oi) => <div key={oi} className="cfg-output-row">
                <button className="cfg-output-open" onClick={() => openTplEditor(pi, oi)}>
                  <code>{o.name}</code>
                  <span className={`kind-tag k-${o.kind}`}>{o.kind}</span>
                  <small>{o.columns.length} 列</small>
                  <em className="cfg-open-hint">编辑模版 <Mark kind="arrow" /></em>
                </button>
                <button className="cfg-out-del" onClick={() => removeOutput(pi, oi)} title="删除产出表">✕</button>
              </div>)}{!p.outputs.length && <p className="cfg-empty">暂无产出表</p>}</div>
            </div>
          </div>
        </section>)}</div>
      </div> : page === "tpledit" ? (() => {
        const et = editTarget;
        const o = et && phaseCfg[et.pi] ? phaseCfg[et.pi].outputs[et.oi] : undefined;
        if (!et || !o) return <div className="content"><button className="back-button" onClick={() => setPage("config")}>← 返回系统配置</button><div className="preview-pending big">未选择表模版</div></div>;
        const ph = phaseCfg[et.pi];
        const ek = `e-${et.pi}-${et.oi}`;
        return <div className="content">
          <div className="table-head">
            <button className="back-button" onClick={() => setPage("config")}>← 返回系统配置</button>
            <div className="table-title"><div><span>{ph.no} · {ph.name}</span><h1>编辑表模版</h1></div><span className={`kind-tag k-${o.kind}`}>{o.kind}</span></div>
          </div>

          <div className="tpl-page">
            <section className="panel tpl-form">
              <div className="tpl-field"><label>表名称</label><input className="tpl-name" value={o.name} onChange={(e) => updateOutput(et.pi, et.oi, { name: e.target.value })} placeholder="表名称" /></div>
              <div className="tpl-field"><label>生成方式</label><div className="cfg-kind-seg big">{GEN_KINDS.map((k) => <button key={k} className={`kind-seg k-${k} ${o.kind === k ? "on" : ""}`} onClick={() => updateOutput(et.pi, et.oi, { kind: k })}>{k}</button>)}</div><p className="tpl-hint">{fallbackGen(o.name).via}</p></div>
              <div className="tpl-field">
                <div className="cfg-col-label"><label>列模版 · {o.columns.length} 列</label><button className="cfg-mode-toggle" onClick={() => setBulkEdit((b) => ({ ...b, [ek]: !b[ek] }))}>{bulkEdit[ek] ? "标签编辑" : "批量编辑"}</button></div>
                {bulkEdit[ek]
                  ? <div className="cfg-bulk"><textarea value={o.columns.join("\n")} onChange={(e) => updateOutput(et.pi, et.oi, { columns: parseCols(e.target.value) })} rows={Math.min(Math.max(o.columns.length + 2, 6), 24)} placeholder="每行一个列名，可直接从 Excel 复制一列/一行表头粘贴" /><small>每行一个列名 · 支持从 Excel 直接粘贴（换行 / 制表符 / 逗号自动分列）</small></div>
                  : <div className="cfg-col-chips">{o.columns.map((c, ci) => <span key={ci} className="cfg-col-chip"><em>{ci + 1}</em><input value={c} onChange={(e) => updateColumn(et.pi, et.oi, ci, e.target.value)} style={{ width: `${Math.max(c.length, 3) + 1}ch` }} /><button onClick={() => removeColumn(et.pi, et.oi, ci)}>✕</button></span>)}<button className="cfg-col-add" onClick={() => addColumn(et.pi, et.oi)}>+ 列</button></div>}
              </div>
            </section>

            <section className="panel tpl-preview-panel">
              <div className="table-bar"><div><b>模版预览</b><span>列头即最终数据表结构</span></div><span className="tool-note">共 {o.columns.length} 列</span></div>
              {o.columns.length ? <div className="data-scroll full"><table className="data-grid"><thead><tr><th className="rownum">#</th>{o.columns.map((c, ci) => <th key={ci}>{c || "未命名"}</th>)}</tr></thead><tbody>{[1, 2, 3].map((n) => <tr key={n}><td className="rownum">{n}</td>{o.columns.map((_, ci) => <td key={ci} className="cell-empty">—</td>)}</tr>)}</tbody></table></div> : <p className="tpl-empty">尚未定义列，点击「+ 列」或切换批量编辑粘贴表头</p>}
              <div className="table-foot">保存于系统配置 · 数据由 DMP 导入 / 源码扫描 / Excel 上传回填</div>
            </section>
          </div>
        </div>;
      })() : (() => {
        const demoFields: DemoField[] = factLive?.fields?.length
          ? factLive.fields.map((f) => ({
              schema: f.schema_name,
              table: f.table_name,
              field: f.field_name,
              comment: f.field_comment,
              data_type: f.data_type,
              is_pk: f.is_pk,
              is_fk: f.is_fk,
            }))
          : facts.map((f) => ({
              schema: f.schema,
              table: f.table,
              field: f.field,
              comment: fieldMeta[f.field]?.label,
              data_type: fieldMeta[f.field]?.type,
            }));
        const demoRefs: DemoRef[] = lineage.map((r) => ({
          system: r.system,
          module: r.module,
          api: r.api,
          op: r.op,
          schema: r.schema,
          table: r.table,
          field: r.field,
        }));
        const demoEntries: DemoEntry[] = (factLive?.entries || []).map((e) => ({
          system: e.system_name,
          module: e.module_name,
          entry_name: e.entry_name,
          entry_class: e.entry_class,
          method_name: e.method_name,
          request_params: e.request_params,
          return_type: e.return_type,
          file_path: e.file_path,
        }));
        // 无入库入口时，用演示 facts 合成入口
        if (!demoEntries.length) {
          uniq(facts.map((f) => f.api)).forEach((apiName) => {
            const row = facts.find((f) => f.api === apiName)!;
            demoEntries.push({
              system: row.system,
              module: row.module,
              entry_name: apiName,
              method_name: apiLabels[apiName],
            });
          });
        }
        return <div className="content demo-shell">
          <div className="demo-top">
            <h1>结构与引用分析</h1>
            <div className="demo-tabs">
              <button type="button" className={mode === "data" ? "on" : ""} onClick={() => setMode("data")}>库血缘</button>
              <button type="button" className={mode === "interface" ? "on" : ""} onClick={() => setMode("interface")}>系统接口</button>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ font: "10px DM Mono", color: "#7d8c9a" }}>{factLive ? "已接入库事实" : "演示数据"}</span>
              {backing.slice(0, 3).map((b) => (
                <button key={b.table} type="button" className="ingest-btn" style={{ padding: "4px 8px", fontSize: 10 }} onClick={() => openProcessFor(b.table)}>{b.table.split(" ")[0]}</button>
              ))}
            </div>
          </div>
          {mode === "data" ? (
            <DbBloodlineView
              fields={demoFields}
              refs={demoRefs}
              onJumpSystem={(apiName) => { pickApi(apiName); setMode("interface"); }}
            />
          ) : (
            <SysBloodlineView
              entries={demoEntries}
              refs={demoRefs}
              onJumpTable={(schema, table) => {
                setMode("data");
                setSelectedSchema(schema);
                setSelectedTable(table.includes(".") ? table : `${schema}.${table}`);
              }}
            />
          )}
        </div>;
      })()}
    </section>
  </main>;
}
