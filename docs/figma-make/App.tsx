import { useRef, useState } from "react";

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

function Mark({ kind }: { kind: "table" | "field" | "shield" | "search" | "arrow" | "flow" | "check" }) {
  const paths = {
    table: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M9 9v11"/></>,
    field: <><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></>,
    shield: <path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    flow: <><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 8v8M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h9"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
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
  "16 库源码差异": { kind: "推导", via: "DMP 结构 vs 源码映射比对", deps: ["04 字段主表", "14 Entity映射"] },
  "17 隐式关联": { kind: "推导", via: "字段共现与命名分析", deps: ["15 字段引用明细"] },
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
  "28 生产结构差异": { kind: "推导", via: "生产结构 vs 当前基线比对", deps: ["03 对象总览"] },
  "29 业务确认记录": { kind: "上传", via: "业务确认闭环 / Excel 上传" },
};
function fallbackGen(table: string): Gen {
  return tableGen[table] ?? { kind: "解析", via: "自动解析生成" };
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
  const [page, setPage] = useState<"workbench" | "process" | "table" | "config" | "tpledit">("process");
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
  const uploadTarget = useRef<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const openTableData = (table: string) => {
    setCurrentTable(table);
    setFocusTable(table);
    setPage("table");
  };
  const now = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const runAction = (table: string, msg: string) => setGenDone((prev) => ({ ...prev, [table]: `${msg} · ${now()}` }));
  const triggerUpload = (table: string) => { uploadTarget.current = table; fileRef.current?.click(); };
  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.files?.[0]?.name;
    if (!name) return;
    const t = uploadTarget.current;
    if (t === "__batch__") setIngestMsg(`已接收 Excel 模版：${name}（演示，待校验入库）`);
    else runAction(t, `已上传 ${name}`);
    e.target.value = "";
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
  const doneCount = phases.filter((p) => p.status === "已完成").length;
  const backing = phases.flatMap((p) =>
    p.outputs
      .filter((o) => tableInfo[o]?.mode === mode)
      .map((o) => ({ table: o, no: p.no, label: tableInfo[o].label })),
  );
  const [selectedField, setSelectedField] = useState("PROJECT_CODE");
  const [selectedApi, setSelectedApi] = useState(apis[0].id);
  const api = apis.find((a) => a.id === selectedApi)!;
  const assetTree = assetTreeFor(api.api);

  // 数据视图：主表字段清单（表04）+ 每个字段的引用接口数（表15）
  const tableFields = uniq(facts.filter((f) => f.table === PRIMARY_TABLE).map((f) => f.field));
  const fields = tableFields.map((code) => {
    const refs = uniq(facts.filter((f) => f.table === PRIMARY_TABLE && f.field === code).map((f) => f.api)).length;
    const meta = fieldMeta[code] ?? { label: "—", type: "", risk: "低" as const };
    return { code, label: meta.label, type: meta.type, count: refs, risk: meta.risk };
  });
  const field = fields.find((f) => f.code === selectedField) ?? fields[0];
  const fieldTree = usageTreeFor(field.code);
  const fieldSystems = uniq(facts.filter((f) => f.table === PRIMARY_TABLE && f.field === field.code).map((f) => f.system)).length;

  return <main className="app-shell">
    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFilePicked} />
    <aside className="rail">
      <div className="brand-mark"><span>Δ</span></div>
      <div className="rail-nav">
        <button className={`rail-button ${page === "process" || page === "table" ? "active" : ""}`} title="分析过程" onClick={() => setPage("process")}><Mark kind="flow" /></button>
        <button className={`rail-button ${page === "workbench" ? "active" : ""}`} title="数据视图" onClick={() => setPage("workbench")}><Mark kind="field" /></button>
        <button className={`rail-button ${page === "config" ? "active" : ""}`} title="系统配置" onClick={() => setPage("config")}><Mark kind="shield" /></button>
      </div>
      <div className="rail-bottom"><div className="avatar">WL</div></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div className="crumb">{page === "table"
          ? <><button className="crumb-link" onClick={() => setPage("process")}>分析过程</button><i>/</i><strong>{currentTable}</strong></>
          : page === "tpledit"
          ? <><button className="crumb-link" onClick={() => setPage("config")}>系统配置</button><i>/</i><strong>编辑表模版</strong></>
          : <><span>数据资产</span><i>/</i><strong>{page === "process" ? "分析过程" : page === "config" ? "系统配置" : "结构与引用分析"}</strong></>}</div>
        <div className="top-actions"><span className="sync"><b />DMP 与源码扫描同步于 09:42</span><button className="help">?</button></div>
      </header>

      {page === "table" ? (() => {
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
            const dv = derivationFor(currentTable, g, cols);
            const isDerive = g.kind === "推导" && (g.deps?.length ?? 0) > 0;
            const okCount = dv.rows.filter((_, ri) => rowMark[`${currentTable}-${ri}`] === "ok").length;
            const noCount = dv.rows.filter((_, ri) => rowMark[`${currentTable}-${ri}`] === "no").length;
            const confirmAll = () => setRowMark((m) => { const n = { ...m }; dv.rows.forEach((_, ri) => { n[`${currentTable}-${ri}`] = "ok"; }); return n; });
            return <section className="panel source-panel">
              <div className="source-head">
                <div className="source-lead"><span className={`kind-tag k-${g.kind}`}>{g.kind}</span><div><b>来源与生成</b><span>{g.via}</span></div></div>
                <div className="source-actions">
                  {g.kind === "解析" && <button className="ingest-btn primary" onClick={() => runAction(currentTable, "已重新解析 DMP + 源码")}><Mark kind="flow" />重新解析</button>}
                  <button className="ingest-btn" onClick={() => triggerUpload(currentTable)}><Mark kind="table" />{g.kind === "上传" ? "上传 / 替换 Excel" : "上传 Excel 覆盖"}</button>
                </div>
              </div>
              {isDerive ? <div className="derive-panel">
                <div className="derive-pipeline">
                  <div className="pipe-inputs">{(g.deps ?? []).map((d) => <button key={d} className="pipe-node input" onClick={() => openTableData(d)}><span>输入表</span><code>{d}</code><small>{tableInfo[d]?.total ?? "—"} 行 · {genOf(d).kind}</small></button>)}</div>
                  <div className="pipe-arm"><i className="pipe-line" /><div className="pipe-engine"><Mark kind="flow" /><b>推导引擎</b></div><i className="pipe-line" /></div>
                  <div className="pipe-node output"><span>产出表</span><code>{currentTable}</code><small>{dv.rows.length} 条候选</small></div>
                </div>

                <div className="derive-logic">
                  <div className="derive-logic-head"><Mark kind="search" /><b>推导规则</b><span>{dv.rule}</span></div>
                  <ol>{dv.logic.map((s, i) => <li key={i}><em>{i + 1}</em>{s}</li>)}</ol>
                </div>

                {dv.rows.length ? <div className="derive-review">
                  <div className="review-head"><div><b>逐条候选确认</b><span>共 {dv.rows.length} 条 · 已确认 {okCount} · 存疑 {noCount}</span></div><button className="ingest-btn" onClick={confirmAll}><Mark kind="check" />全部确认</button></div>
                  <div className="data-scroll full"><table className="data-grid derive-grid"><thead><tr><th className="rownum">#</th>{dv.columns.map((c) => <th key={c}>{c}</th>)}<th>推导依据</th><th className="rev-col">确认</th></tr></thead><tbody>{dv.rows.map((r, ri) => {
                    const mk = rowMark[`${currentTable}-${ri}`];
                    return <tr key={ri} className={mk === "ok" ? "row-ok" : mk === "no" ? "row-no" : ""}>
                      <td className="rownum">{ri + 1}</td>
                      {r.cells.map((cell, ci) => <td key={ci}>{cell}</td>)}
                      <td className="ev-cell"><div className="ev-chips">{r.evidence.map((e, ei) => <button key={ei} className="ev-chip" onClick={() => openTableData(e.t)} title={`来自 ${e.t}`}><code>{e.t.split(" ")[0]}</code>{e.ref}</button>)}{r.note && <span className="ev-note">{r.note}</span>}</div></td>
                      <td className="rev-col"><div className="rev-actions"><button className={`rev-btn ok ${mk === "ok" ? "on" : ""}`} onClick={() => setRowMark((m) => ({ ...m, [`${currentTable}-${ri}`]: "ok" }))} title="确认">✓</button><button className={`rev-btn no ${mk === "no" ? "on" : ""}`} onClick={() => setRowMark((m) => ({ ...m, [`${currentTable}-${ri}`]: "no" }))} title="存疑">?</button></div></td>
                    </tr>;
                  })}</tbody></table></div>
                  <div className="review-foot"><span>{okCount === dv.rows.length ? "全部候选已确认，可写入本表" : `还有 ${dv.rows.length - okCount} 条待确认`}</span><button className="ingest-btn primary" disabled={okCount === 0} onClick={() => runAction(currentTable, `已写入 ${okCount} 条确认结果`)}><Mark kind="check" />应用已确认（{okCount}）</button></div>
                </div> : <div className="derive-empty"><p>点击运行推导，按上述规则从前序表生成候选结果，逐条确认后写入本表。</p><button className="ingest-btn primary" onClick={() => runAction(currentTable, "已运行推导，生成候选待确认")}><Mark kind="flow" />运行推导</button></div>}
              </div> : g.kind !== "上传" ? <p className="source-hint">本表由 {g.via} 自动生成，无前序依赖；也可上传 Excel 覆盖。</p> : null}
              {done && <p className="ingest-note"><Mark kind="check" />{done}</p>}
            </section>;
          })()}

          {info ? <section className="panel table-panel">
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
          <div><h1>分析过程</h1><p>本结果依据《数据现状分析工作方案》P0–P6 / {totalTables} 表框架逐阶段汇总而成。</p></div>
          <div className="collection-summary"><div><span>阶段</span><b>{phases.length} 个阶段</b></div><div><span>汇总表</span><b>{totalTables} 张表</b></div><div><span>整体进度</span><b className="ready"><i />{doneCount} / {phases.length} 已完成</b></div></div>
        </div>

        <div className="ingest-bar">
          <div className="ingest-lead"><b>数据接入</b><span>各步骤产出表可自动解析 DMP + 源码生成，也可上传 Excel 模版补录</span></div>
          <div className="ingest-actions">
            <button className="ingest-btn primary" onClick={() => runAction("__scan__", "已触发 DMP + 源码全量解析")}><Mark kind="flow" />自动解析 DMP + 源码</button>
            <button className="ingest-btn" onClick={() => triggerUpload("__batch__")}><Mark kind="table" />上传 Excel 模版</button>
          </div>
          {(ingestMsg || genDone["__scan__"]) && <p className="ingest-note"><Mark kind="check" />{ingestMsg || genDone["__scan__"]}</p>}
        </div>

        <div className="process-legend"><span><i className="dot done" />已完成</span><span><i className="dot doing" />进行中</span><span><i className="dot wait" />待开始</span><span className="lg-kind"><i className="kb k-解析" />解析</span><span className="lg-kind"><i className="kb k-上传" />上传</span><span className="lg-kind"><i className="kb k-推导" />推导</span></div>

        <ol className="phase-list">{phases.map((p) => <li key={p.no} className={`phase-item status-${p.status}`}>
          <div className="phase-rail"><span className="phase-no">{p.status === "已完成" ? <Mark kind="check" /> : p.no}</span></div>
          <div className="phase-card panel">
            <div className="phase-head">
              <div><b>{p.name}</b><p>{p.desc}</p></div>
              <div className="phase-tail"><i className={`phase-badge b-${p.status}`}>{p.status}</i><small>产出 {p.tables} 张表</small></div>
            </div>
            <div className="phase-body">
              <div className="phase-steps"><span>关键步骤</span><ul>{p.steps.map((s, i) => <li key={s}><em>{i + 1}</em>{s}</li>)}</ul></div>
              <div className="phase-outputs"><span>产出数据表 <b>· {p.outputs.filter((o) => tableInfo[o]).length} 张汇入结果</b></span>
                <div className="out-tables">{p.outputs.map((o) => {
                  const info = tableInfo[o];
                  const g = genOf(o);
                  return <button key={o} className={`out-table-row ${info ? "linked" : "mid"} ${focusTable === o ? "focus" : ""}`} onClick={() => openTableData(o)}>
                    <code>{o}</code>
                    <span className={`kind-tag k-${g.kind}`}>{g.kind}</span>
                    {info
                      ? <span className="chain-mini">{CHAIN.map((seg) => <i key={seg} className={info.chain.includes(seg) ? "on" : ""}>{seg}</i>)}</span>
                      : <em className="mid-tag">中间过程表</em>}
                    <span className="out-open">{info ? `${info.total} 行` : "待回填"} <Mark kind="arrow" /></span>
                  </button>;
                })}</div>
              </div>
            </div>
          </div>
        </li>)}</ol>
      </div> : page === "config" ? <div className="content">
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
      })() : <div className="content">
        <div className="workhead">
          <div><h1>数据视图</h1><p>按数据库、表、字段逐级查看结构事实及下游引用。</p></div>
          <div className="collection-summary"><div><span>结构来源</span><b>1 个 DMP 文件</b></div><div><span>代码来源</span><b>6 个工程</b></div><div><span>解析状态</span><b className="ready"><i />已完成</b></div></div>
        </div>
        <nav className="view-tabs" aria-label="分析视图"><button className={mode === "data" ? "active" : ""} onClick={() => setMode("data")}>数据视图</button><button className={mode === "interface" ? "active" : ""} onClick={() => setMode("interface")}>接口视图</button></nav>

        <div className="provenance-bar">
          <span>分析依据</span>
          <div>{backing.map((b) => <button key={b.table} className={`prov-chip ${focusTable === b.table ? "focus" : ""}`} onClick={() => openProcessFor(b.table)} title={`来自阶段 ${b.no} · ${b.label}`}><em>阶段{b.no}</em><code>{b.table}</code></button>)}</div>
          <p>本视图结论由以上过程表汇总，点击可回溯所在阶段</p>
        </div>

        {mode === "data" ? <>
          <section className="selection-bar">
            <div className="selection-step"><span>01</span><div><small>数据库</small><b>{PRIMARY_SCHEMA} <i>⌄</i></b></div></div>
            <div className="step-line" />
            <div className="selection-step"><span>02</span><div><small>表</small><b>{PRIMARY_TABLE} <i>⌄</i></b></div></div>
            <div className="selection-status"><span className="pulse" />源码扫描已关联 <b>{facts.filter((f) => f.table === PRIMARY_TABLE).length}</b> 项引用事实</div>
          </section>

          <div className="flow-chain" aria-label="字段调用链路">
            <span>库</span><b>›</b><span>表</span><b>›</b><span className="active">字段</span><b>›</b><span>系统</span><b>›</b><span>模块</span><b>›</b><span>接口</span>
            <small>从左至右选择，查看当前字段的调用路径</small>
          </div>

          <section className="analysis-grid">
            <div className="field-panel panel">
              <div className="panel-heading"><div><p>字段清单</p><span>{PRIMARY_TABLE.split(".").pop()} · {fields.length} 个字段</span></div><button className="icon-button"><Mark kind="search" /></button></div>
              <div className="field-header"><span>字段 / 业务含义</span><span>引用</span><span>风险</span></div>
              <div className="field-list">{fields.map((f) => <button key={f.code} onClick={() => setSelectedField(f.code)} className={`field-row ${field.code === f.code ? "chosen" : ""}`}><div><b>{f.code}</b><span>{f.label}</span></div><strong>{f.count}</strong><i className={`risk risk-${f.risk}`}>{f.risk}</i></button>)}</div>
              <div className="panel-foot">显示 {fields.length} / {fields.length} <button>查看全部字段 <Mark kind="arrow" /></button></div>
            </div>

            <div className="detail-stack">
              <section className="impact-card">
                <div className="impact-caption"><span className="live-dot" />当前字段</div>
                <div className="field-title"><div><span>{field.type}</span><h2>{field.code}</h2><p>{field.label}</p></div><button className="source-button">查看事实证据 <Mark kind="arrow" /></button></div>
                <div className="stat-grid"><div><span>引用接口</span><b>{field.count}</b><small>跨 {fieldSystems} 个系统</small></div><div><span>变更风险</span><b className={field.risk === "高" ? "amber" : ""}>{field.risk}</b><small>{field.risk === "高" ? "建议建立兼容期" : "按常规评估"}</small></div><div><span>结论等级</span><b>已验证</b><small>源码 + DMP</small></div></div>
              </section>

              <section className="tree-panel panel">
                <div className="tree-head"><div><p>引用路径</p><span>按业务归属展开 · {field.count} 个直接调用</span></div><button className="collapse-button">全部收起</button></div>
                <div className="tree-guide"><span>系统</span><i>›</i><span>模块</span><i>›</i><span>接口</span><p>点击接口，查看它使用的所有数据</p></div>
                <div className="usage-tree">{fieldTree.length ? fieldTree.map((node) => <TreeNode key={node.name} node={node} onOpen={(apiName) => { if (apiName) setSelectedApi(apiName); setMode("interface"); }} />) : <div className="tree-empty">该字段暂无引用事实（零命中）</div>}</div>
              </section>
            </div>
          </section>
        </> : <>
          <section className="selection-bar">
            <div className="selection-step"><span>01</span><div><small>系统</small><b>{api.system} <i>⌄</i></b></div></div>
            <div className="step-line" />
            <div className="selection-step"><span>02</span><div><small>模块</small><b>{api.module} <i>⌄</i></b></div></div>
            <div className="selection-status"><span className="pulse" />源码扫描解析出 <b>{apis.length}</b> 个接口</div>
          </section>
          <div className="flow-chain"><span>系统</span><b>›</b><span>模块</span><b>›</b><span className="active">接口</span><b>›</b><span>库</span><b>›</b><span>表</span><b>›</b><span>字段</span><small>从左至右选择，查看当前接口的触达数据</small></div>

          <section className="analysis-grid">
            <div className="field-panel panel">
              <div className="panel-heading"><div><p>接口清单</p><span>{api.module} · {apis.length} 个接口</span></div><button className="icon-button"><Mark kind="search" /></button></div>
              <div className="field-header"><span>接口 / 业务含义</span><span>触达表</span><span>操作</span></div>
              <div className="field-list">{apis.map((a) => <button key={a.id} onClick={() => setSelectedApi(a.id)} className={`field-row api-row ${selectedApi === a.id ? "chosen" : ""}`}><div><b><i className={`api-verb verb-${a.method}`}>{a.method}</i>{a.path}</b><span>{a.label}</span></div><strong>{a.tables}</strong><i className={`risk op-${a.op}`}>{a.op}</i></button>)}</div>
              <div className="panel-foot">显示 {apis.length} / {apis.length} <button>查看全部接口 <Mark kind="arrow" /></button></div>
            </div>

            <div className="detail-stack">
              <section className="api-mode panel">
                <div className="api-head"><div><h2>{api.method} {api.path}</h2><span>API · {api.op} · {api.system} / {api.module}</span></div><button className="source-button">查看事实证据 <Mark kind="arrow" /></button></div>
                <div className="access-summary"><div><b>{api.dbs}</b><span>访问数据库</span></div><div><b>{api.tables}</b><span>访问表</span></div><div><b>{api.fields}</b><span>触达字段</span></div><p>按库、表、字段展开接口直接访问事实。</p></div>
              </section>

              <section className="tree-panel panel">
                <div className="tree-head"><div><p>触达路径</p><span>按数据归属展开 · {api.tables} 张表 · {api.fields} 个字段</span></div><button className="collapse-button">全部收起</button></div>
                <div className="tree-guide"><span>库</span><i>›</i><span>表</span><i>›</i><span>字段</span><p>展开表，查看该接口访问的字段</p></div>
                <div className="usage-tree">{assetTree.map((node) => <TreeNode key={node.name} node={node} onOpen={() => undefined} />)}</div>
              </section>
            </div>
          </section>
        </>}
      </div>}
    </section>
  </main>;
}
