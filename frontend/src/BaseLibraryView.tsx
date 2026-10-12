import { useState } from "react";

/** Figma Make《数据库重构辅助系统》· 基础库候选分析页（P5） */

const SYS_LIST = ["SYS_USER", "SYS_ROLE", "SYS_DICT", "SYS_LOG"];
const SYS_SET = new Set(SYS_LIST);
const isSysTable = (t: string) => SYS_SET.has(t);

const colLib: Record<string, string[]> = {
  PROJECT_INFO: ["PROJECT_CODE", "PROJECT_NAME", "PROJECT_STATUS", "CREATE_TIME", "GEO_POINT"],
  PROJECT_STAGE: ["STAGE_CODE", "STAGE_NAME", "PROJECT_CODE"],
  PROJECT_METRIC: ["METRIC_CODE", "METRIC_VALUE", "PROJECT_CODE"],
  PROJECT_LOG: ["LOG_ID", "OPERATOR", "PROJECT_CODE", "LOG_TIME"],
  CONTRACT: ["CONTRACT_ID", "PROJECT_CODE", "AMOUNT", "SIGN_DATE"],
  FUND_PLAN: ["PLAN_ID", "PROJECT_CODE", "PLAN_AMOUNT", "FISCAL_YEAR"],
  FUND_EXEC: ["EXEC_ID", "PLAN_ID", "EXEC_AMOUNT", "EXEC_DATE"],
  MILESTONE: ["MS_ID", "PROJECT_CODE", "MS_NAME", "DUE_DATE"],
  RISK_ITEM: ["RISK_ID", "PROJECT_CODE", "RISK_LEVEL", "RISK_DESC"],
  CITY_BRANCH: ["BRANCH_ID", "BRANCH_NAME", "CITY"],
  PROV_OFFICE: ["OFFICE_ID", "OFFICE_NAME", "PROVINCE"],
  ORG_UNIT: ["ORG_CODE", "ORG_NAME", "PARENT_CODE"],
  REGION: ["REGION_CODE", "REGION_NAME"],
  DASHBOARD: ["BOARD_ID", "TITLE", "CHART_TYPE"],
  METRIC_SNAPSHOT: ["SNAP_ID", "METRIC_CODE", "SNAP_VALUE", "SNAP_DATE"],
  NOTICE: ["NOTICE_ID", "TITLE", "CONTENT"],
  MEETING: ["MEETING_ID", "TITLE", "MEET_TIME"],
  DOC: ["DOC_ID", "TITLE", "AUTHOR"],
  SYS_USER: ["USER_ID", "LOGIN", "NAME"],
  SYS_ROLE: ["ROLE_ID", "NAME"],
  SYS_DICT: ["DICT_ID", "TYPE", "VALUE"],
  SYS_LOG: ["LOG_ID", "USER_ID", "LOG_TIME"],
};

const colOverride: Record<string, Record<string, string[]>> = {
  EXEC_CITY: { PROJECT_INFO: ["PROJECT_CODE", "PROJECT_NAME", "PROJECT_STATUS", "CREATE_TIME", "CITY"] },
  EXEC_V2: { PROJECT_INFO: ["PROJECT_CODE", "PROJECT_NAME", "PROJECT_STATUS", "CREATE_TIME", "GEO_POINT", "RISK_TAG"] },
};

const schemaTables: Record<string, { label: string; biz: string[] }> = {
  EXEC_V2: { label: "执行新版库", biz: ["PROJECT_INFO", "PROJECT_STAGE", "PROJECT_METRIC", "PROJECT_LOG", "CONTRACT", "FUND_PLAN", "FUND_EXEC", "MILESTONE", "RISK_ITEM"] },
  KINGBASE_PROD: { label: "主生产库", biz: ["PROJECT_INFO", "PROJECT_STAGE", "PROJECT_METRIC", "PROJECT_LOG", "CONTRACT", "FUND_PLAN", "FUND_EXEC", "MILESTONE"] },
  EXEC_ARCHIVE: { label: "执行归档库", biz: ["PROJECT_INFO", "PROJECT_STAGE", "PROJECT_METRIC", "PROJECT_LOG", "CONTRACT", "MILESTONE"] },
  EXEC_CITY: { label: "市级执行库", biz: ["PROJECT_INFO", "PROJECT_STAGE", "PROJECT_LOG", "CONTRACT", "CITY_BRANCH"] },
  EXEC_PROV: { label: "省级执行库", biz: ["PROJECT_INFO", "PROJECT_STAGE", "PROJECT_LOG", "PROV_OFFICE"] },
  PUBLIC_SERVICE: { label: "公共服务库", biz: ["ORG_UNIT", "REGION", "PROJECT_INFO"] },
  HOLO_BI: { label: "全息分析库", biz: ["PROJECT_INFO", "DASHBOARD", "METRIC_SNAPSHOT"] },
  OA: { label: "协同办公库", biz: ["NOTICE", "MEETING", "DOC"] },
};

const SCHEMAS = Object.keys(schemaTables);
const schemaTableList = (s: string) => [...schemaTables[s].biz, ...SYS_LIST];
const colsOf = (s: string, t: string) => colOverride[s]?.[t] ?? colLib[t] ?? [];
const bizCount = (s: string) => schemaTables[s].biz.length;

type Pair = { inter: number; coverBtoA: number; coverAtoB: number; jaccard: number };

function tableSet(s: string, excl: boolean): Set<string> {
  return new Set(schemaTableList(s).filter((t) => !excl || !isSysTable(t)));
}

function analyzePair(a: string, b: string, excl: boolean): Pair {
  const sa = tableSet(a, excl), sb = tableSet(b, excl);
  let inter = 0;
  sa.forEach((t) => { if (sb.has(t)) inter++; });
  return {
    inter,
    coverBtoA: sa.size ? inter / sa.size : 0,
    coverAtoB: sb.size ? inter / sb.size : 0,
    jaccard: sa.size + sb.size - inter ? inter / (sa.size + sb.size - inter) : 0,
  };
}

function candidatesFor(s: string, excl: boolean): { other: string; r: Pair }[] {
  const out: { other: string; r: Pair }[] = [];
  for (const o of SCHEMAS) {
    if (o === s) continue;
    const r = analyzePair(s, o, excl);
    if (r.coverBtoA >= 0.5 && tableSet(o, excl).size >= tableSet(s, excl).size - 2) out.push({ other: o, r });
  }
  return out.sort((x, y) => y.r.coverBtoA - x.r.coverBtoA);
}

function globalRecommend(excl: boolean): [string, { refCount: number; coverSum: number }][] {
  const score: Record<string, { refCount: number; coverSum: number }> = {};
  SCHEMAS.forEach((d) => (score[d] = { refCount: 0, coverSum: 0 }));
  SCHEMAS.forEach((a) => SCHEMAS.forEach((b) => {
    if (a === b) return;
    const r = analyzePair(a, b, excl);
    if (r.coverBtoA >= 0.5) { score[b].coverSum += r.coverBtoA; score[b].refCount += 1; }
  }));
  return Object.entries(score).sort((a, b) => b[1].refCount - a[1].refCount || b[1].coverSum - a[1].coverSum);
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

/** 与 Figma Make 同源结构 / 类名 */
export function BaseLibraryView() {
  const [selSchema, setSelSchema] = useState<string | null>(null);
  const [cmpBase, setCmpBase] = useState<string | null>(null);
  const [cmpTable, setCmpTable] = useState<string | null>(null);
  const [exclSys, setExclSys] = useState(true);

  const excl = exclSys;
  const rec = globalRecommend(excl);
  const recName = rec[0][0];
  const totalBiz = SCHEMAS.reduce((s, d) => s + bizCount(d), 0);
  const totalCol = SCHEMAS.reduce((s, d) => s + schemaTableList(d).reduce((ss, t) => ss + colsOf(d, t).length, 0), 0);
  const ranked = [...SCHEMAS].sort((a, b) => (candidatesFor(b, excl)[0]?.r.coverBtoA ?? -1) - (candidatesFor(a, excl)[0]?.r.coverBtoA ?? -1));
  const sel = selSchema;
  const cands = sel ? candidatesFor(sel, excl) : [];

  return (
    <div className="content">
      <div className="workhead">
        <div>
          <h1>基础库候选分析</h1>
          <p>按表重叠度比对各业务库，推荐重构归并的基础库 —— 支撑 P5 问题与重构决策。</p>
        </div>
        <div className="collection-summary">
          <div><span>数据库</span><b>{SCHEMAS.length} 个</b></div>
          <div><span>业务表</span><b>{totalBiz}</b></div>
          <div><span>系统表</span><b>{SCHEMAS.length * SYS_LIST.length}{excl ? "（已排除）" : ""}</b></div>
          <div><span>字段总数</span><b>{totalCol}</b></div>
        </div>
      </div>

      <div className="lineage-bar">
        <div className="recommend-box">
          <CheckMark />
          <div>
            <span>推荐全局基础库</span>
            <b><code>{recName}</code> · {schemaTables[recName].label}</b>
          </div>
          <em>被 {rec[0][1].refCount} 个库高重叠覆盖 · 业务表 {bizCount(recName)} 张</em>
        </div>
        <label className="excl-toggle">
          <input type="checkbox" checked={excl} onChange={(e) => { setExclSys(e.target.checked); setCmpTable(null); }} />
          {" "}排除系统表再算重复
        </label>
      </div>

      <section className="lineage-grid">
        <div className="field-panel panel">
          <div className="panel-heading">
            <div>
              <p>业务库清单</p>
              <span>按可归并程度排序 · {SCHEMAS.length} 个库</span>
            </div>
          </div>
          <div className="schema-list">
            {ranked.map((d) => {
              const top = candidatesFor(d, excl)[0];
              const isBase = d === recName;
              return (
                <button
                  key={d}
                  type="button"
                  className={`schema-row ${sel === d ? "chosen" : ""} ${isBase ? "base" : ""}`}
                  onClick={() => { setSelSchema(d); setCmpBase(null); setCmpTable(null); }}
                >
                  <div className="schema-id"><b>{d}</b><span>{schemaTables[d].label}</span></div>
                  <div className="schema-meta">
                    <i className="st-count">{bizCount(d)} 表</i>
                    {isBase ? <i className="st-base">推荐基础库</i> : top ? <i className="st-cand">可并入 {Math.round(top.r.coverBtoA * 100)}%</i> : <i className="st-ind">独立库</i>}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="panel-foot">显示 {SCHEMAS.length} / {SCHEMAS.length} <span className="tool-note">DMP 多库结构比对</span></div>
        </div>

        <div className="detail-stack">
          {!sel ? (
            <div className="lineage-hint panel">选择左侧业务库，查看它的候选基础库与表级重叠明细</div>
          ) : (
            <>
              <section className="impact-card">
                <div className="impact-caption"><span className="live-dot" />当前业务库</div>
                <div className="field-title">
                  <div>
                    <span>{schemaTables[sel].label}</span>
                    <h2>{sel}</h2>
                    <p>业务表 {bizCount(sel)} · 系统表 {SYS_LIST.length}{excl ? "（计算时已排除）" : ""}</p>
                  </div>
                </div>
              </section>

              <section className="tree-panel panel">
                <div className="tree-head">
                  <div>
                    <p>候选基础库</p>
                    <span>覆盖本库 ≥50% 且表数不少于本库 · {cands.length} 个候选</span>
                  </div>
                </div>
                {cands.length ? (
                  <div className="cand-list">
                    {cands.map(({ other, r }, i) => (
                      <button
                        key={other}
                        type="button"
                        className={`cand-row ${i === 0 ? "top" : ""} ${cmpBase === other ? "on" : ""}`}
                        onClick={() => { setCmpBase(other); setCmpTable(null); }}
                      >
                        <div className="cand-head">
                          <span className="cand-name"><b>{other}</b> {schemaTables[other].label}</span>
                          <span className="cand-pct">{Math.round(r.coverBtoA * 100)}%</span>
                        </div>
                        <div className="cand-bar"><i style={{ width: `${Math.round(r.coverBtoA * 100)}%` }} /></div>
                        <div className="cand-note">
                          覆盖本库 {r.inter} / {tableSet(sel, excl).size} 张表 · Jaccard {r.jaccard.toFixed(2)} · 对方 {tableSet(other, excl).size} 张表
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="tree-empty">未发现可归并的基础库，{sel} 可能是独立库或本身即基础库。</div>
                )}
                {sel === recName && (
                  <div className="decision-box">
                    <b>重构建议：</b>本库被多个库高重叠覆盖，建议作为归并后的基础库，其它库以差异表增量扩展。
                  </div>
                )}
              </section>

              {cmpBase && (() => {
                const a = sel, b = cmpBase;
                const sa = tableSet(a, excl), sb = tableSet(b, excl);
                const shared = [...sa].filter((t) => sb.has(t)).sort();
                const onlyA = [...sa].filter((t) => !sb.has(t)).sort();
                const onlyB = [...sb].filter((t) => !sa.has(t)).sort();
                return (
                  <section className="panel compare-panel">
                    <div className="compare-head">
                      <span className="db-pill">{a}</span>
                      <i>对比</i>
                      <span className="db-pill b">{b}</span>
                      <button type="button" className="collapse-button" onClick={() => { setCmpBase(null); setCmpTable(null); }}>关闭对比</button>
                    </div>
                    <div className="compare-cols">
                      <div className="cmp-col shared">
                        <div className="cmp-col-head">共有表 <em>{shared.length}</em></div>
                        <div className="cmp-col-body">
                          {shared.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`cmp-row btn ${cmpTable === t ? "on" : ""}`}
                              onClick={() => setCmpTable(cmpTable === t ? null : t)}
                            >
                              {t}{isSysTable(t) && <i className="sys-flag">系统</i>}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="cmp-col a-only">
                        <div className="cmp-col-head">仅 {a} 有 <em>{onlyA.length}</em></div>
                        <div className="cmp-col-body">
                          {onlyA.length ? onlyA.map((t) => <span key={t} className="cmp-row">{t}</span>) : <p className="cmp-empty">无</p>}
                        </div>
                      </div>
                      <div className="cmp-col b-only">
                        <div className="cmp-col-head">仅 {b} 有 <em>{onlyB.length}</em></div>
                        <div className="cmp-col-body">
                          {onlyB.length ? onlyB.map((t) => <span key={t} className="cmp-row">{t}</span>) : <p className="cmp-empty">无</p>}
                        </div>
                      </div>
                    </div>
                    {cmpTable && (() => {
                      const ca = colsOf(a, cmpTable), cb = colsOf(b, cmpTable);
                      const scb = new Set(cb), sca = new Set(ca);
                      const comm = ca.filter((c) => scb.has(c));
                      const fa = ca.filter((c) => !scb.has(c));
                      const fb = cb.filter((c) => !sca.has(c));
                      return (
                        <div className="field-diff">
                          <div className="field-diff-head">
                            <code>{cmpTable}</code> 同名表字段差异{fa.length || fb.length ? "" : " · 结构一致"}
                          </div>
                          <div className="fd-grid">
                            <div className="fd-col">
                              <span>共有字段 · {comm.length}</span>
                              <div>{comm.map((c) => <code key={c}>{c}</code>)}</div>
                            </div>
                            <div className="fd-col a">
                              <span>仅 {a} · {fa.length}</span>
                              <div>{fa.length ? fa.map((c) => <code key={c}>{c}</code>) : <em>无</em>}</div>
                            </div>
                            <div className="fd-col b">
                              <span>仅 {b} · {fb.length}</span>
                              <div>{fb.length ? fb.map((c) => <code key={c}>{c}</code>) : <em>无</em>}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </section>
                );
              })()}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
