import { useEffect, useMemo, useRef, useState } from "react";

export type DemoField = {
  schema: string;
  table: string; // short or FQ
  field: string;
  comment?: string | null;
  data_type?: string | null;
  is_pk?: boolean;
  is_fk?: boolean;
};

export type DemoRef = {
  system: string;
  module: string;
  api: string;
  op: string;
  schema: string;
  table: string;
  field: string;
};

export type DemoEntry = {
  system: string;
  module: string;
  entry_name: string;
  entry_class?: string | null;
  method_name?: string | null;
  request_params?: string | null;
  return_type?: string | null;
  file_path?: string | null;
};

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

function shortTable(t: string) {
  return t.includes(".") ? t.split(".").pop()! : t;
}

function tableSet(fields: DemoField[], schema: string): Set<string> {
  return new Set(
    fields.filter((f) => f.schema === schema).map((f) => shortTable(f.table)),
  );
}

function analyzePair(fields: DemoField[], a: string, b: string) {
  const sa = tableSet(fields, a);
  const sb = tableSet(fields, b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return {
    inter,
    onlyA: sa.size - inter,
    onlyB: sb.size - inter,
    coverBtoA: sa.size ? inter / sa.size : 0,
    coverAtoB: sb.size ? inter / sb.size : 0,
    jaccard: sa.size + sb.size - inter ? inter / (sa.size + sb.size - inter) : 0,
  };
}

function candidatesFor(fields: DemoField[], db: string) {
  const schemas = uniq(fields.map((f) => f.schema));
  const out: { other: string; inter: number; onlyA: number; onlyB: number; coverBtoA: number }[] = [];
  for (const other of schemas) {
    if (other === db) continue;
    const r = analyzePair(fields, db, other);
    if (r.coverBtoA >= 0.5 && tableSet(fields, other).size >= tableSet(fields, db).size - 2) {
      out.push({ other, inter: r.inter, onlyA: r.onlyA, onlyB: r.onlyB, coverBtoA: r.coverBtoA });
    }
  }
  return out.sort((x, y) => y.coverBtoA - x.coverBtoA);
}

function globalRecommend(fields: DemoField[]) {
  const schemas = uniq(fields.map((f) => f.schema));
  const score: Record<string, { coverSum: number; refCount: number; tableCount: number }> = {};
  schemas.forEach((d) => {
    score[d] = { coverSum: 0, refCount: 0, tableCount: tableSet(fields, d).size };
  });
  schemas.forEach((a) => {
    schemas.forEach((b) => {
      if (a === b) return;
      const r = analyzePair(fields, a, b);
      if (r.coverBtoA >= 0.5) {
        score[b].coverSum += r.coverBtoA;
        score[b].refCount += 1;
      }
    });
  });
  return Object.entries(score).sort(
    (a, b) => b[1].refCount - a[1].refCount || b[1].coverSum - a[1].coverSum,
  );
}

type Layer =
  | { kind: "l1" }
  | { kind: "l2"; a: string; b: string }
  | { kind: "l3"; a: string; b: string; table: string }
  | { kind: "table"; schema: string; table: string };

/** 数据视图：库关系全景 + 抽屉 + 两库对比 + 字段 Diff */
export function DbBloodlineView({
  fields,
  refs,
  onJumpSystem,
}: {
  fields: DemoField[];
  refs: DemoRef[];
  onJumpSystem?: (api: string) => void;
}) {
  const schemas = useMemo(() => uniq(fields.map((f) => f.schema)), [fields]);
  const [layer, setLayer] = useState<Layer>({ kind: "l1" });
  const [selected, setSelected] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 900, h: el.clientHeight || 560 });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth || 900, h: el.clientHeight || 560 });
    return () => ro.disconnect();
  }, [layer.kind]);

  const rec = useMemo(() => globalRecommend(fields), [fields]);
  const base = rec[0]?.[0] || schemas[0] || "";

  const totalTables = useMemo(() => {
    const s = new Set(fields.map((f) => `${f.schema}.${shortTable(f.table)}`));
    return s.size;
  }, [fields]);

  const openCompare = (a: string, b: string) => {
    setSelected(null);
    setLayer({ kind: "l2", a, b });
  };

  if (!schemas.length) {
    return <div className="demo-view"><div className="viz-empty">暂无库表结构，请先导入 DMP 结构 Excel</div></div>;
  }

  const crumb = (() => {
    if (layer.kind === "l1") return [{ label: "库血缘全景", active: true }];
    if (layer.kind === "l2") {
      return [
        { label: "库血缘全景", onClick: () => setLayer({ kind: "l1" }) },
        { label: `${layer.a} vs ${layer.b}`, active: true },
      ];
    }
    if (layer.kind === "l3") {
      return [
        { label: "库血缘全景", onClick: () => setLayer({ kind: "l1" }) },
        { label: `${layer.a} vs ${layer.b}`, onClick: () => setLayer({ kind: "l2", a: layer.a, b: layer.b }) },
        { label: layer.table, active: true },
      ];
    }
    return [
      { label: "库血缘全景", onClick: () => setLayer({ kind: "l1" }) },
      { label: `${layer.schema}.${layer.table}`, active: true },
    ];
  })();

  return (
    <div className="demo-bloodline" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="demo-stats">
        <div><span className="num">{schemas.length}</span><span className="lbl">数据库</span></div>
        <div><span className="num">{totalTables}</span><span className="lbl">业务表</span></div>
        <div><span className="num">{fields.length}</span><span className="lbl">字段</span></div>
        {base && (
          <div className="recommend">
            候选基础库：<b>{base}</b>
            {rec[0] ? `（被 ${rec[0][1].refCount} 个库高重叠，表 ${rec[0][1].tableCount} 张）` : ""}
          </div>
        )}
      </div>
      <div className="demo-crumb" style={{ padding: "8px 18px", background: "#fff", borderBottom: "1px solid #e5e6eb" }}>
        {crumb.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span className="sep">›</span>}
            {c.active ? <span className="cur">{c.label}</span> : <button type="button" onClick={c.onClick}>{c.label}</button>}
          </span>
        ))}
      </div>
      <div className="demo-view" ref={stageRef}>
        {layer.kind === "l1" && (
          <L1Graph
            fields={fields}
            schemas={schemas}
            base={base}
            size={size}
            selected={selected}
            onSelect={(s) => setSelected(s)}
            onCompare={openCompare}
            onOpenTable={(schema, table) => setLayer({ kind: "table", schema, table })}
          />
        )}
        {layer.kind === "l2" && (
          <L2Compare
            fields={fields}
            a={layer.a}
            b={layer.b}
            onOpenTable={(t) => setLayer({ kind: "l3", a: layer.a, b: layer.b, table: t })}
          />
        )}
        {layer.kind === "l3" && (
          <L3Diff
            fields={fields}
            refs={refs}
            a={layer.a}
            b={layer.b}
            table={layer.table}
            onJumpApi={onJumpSystem}
          />
        )}
        {layer.kind === "table" && (
          <TableDetail
            fields={fields}
            refs={refs}
            schema={layer.schema}
            table={layer.table}
            onJumpSchema={(s) => setLayer({ kind: "table", schema: s, table: layer.table })}
            onJumpApi={onJumpSystem}
          />
        )}
      </div>
    </div>
  );
}

function L1Graph({
  fields, schemas, base, size, selected, onSelect, onCompare, onOpenTable,
}: {
  fields: DemoField[];
  schemas: string[];
  base: string;
  size: { w: number; h: number };
  selected: string | null;
  onSelect: (s: string | null) => void;
  onCompare: (a: string, b: string) => void;
  onOpenTable: (schema: string, table: string) => void;
}) {
  const W = size.w;
  const H = size.h;
  const NODE_W = Math.min(160, W * 0.15);
  const NODE_H = 56;
  const centerX = W / 2;
  const centerY = H / 2;

  const overlapScore: Record<string, number> = {};
  schemas.forEach((d) => {
    let sum = 0, cnt = 0;
    schemas.forEach((o) => {
      if (o === d) return;
      sum += analyzePair(fields, d, o).jaccard;
      cnt++;
    });
    overlapScore[d] = cnt ? sum / cnt : 0;
  });

  const positions: Record<string, { x: number; y: number }> = {};
  if (base) positions[base] = { x: centerX - NODE_W / 2, y: centerY - NODE_H / 2 };
  const sorted = schemas.filter((d) => d !== base).sort((a, b) => overlapScore[b] - overlapScore[a]);
  const innerCount = Math.min(5, Math.floor(sorted.length / 2) || sorted.length);
  const inner = sorted.slice(0, innerCount);
  const outer = sorted.slice(innerCount);
  const r1 = Math.min(W, H) * 0.22;
  const r2 = Math.min(W, H) * 0.36;
  inner.forEach((d, i) => {
    const angle = (i / Math.max(inner.length, 1)) * 2 * Math.PI - Math.PI / 2;
    positions[d] = { x: centerX + r1 * Math.cos(angle) - NODE_W / 2, y: centerY + r1 * Math.sin(angle) - NODE_H / 2 };
  });
  outer.forEach((d, i) => {
    const angle = (i / Math.max(outer.length, 1)) * 2 * Math.PI - Math.PI / 2;
    positions[d] = { x: centerX + r2 * Math.cos(angle) - NODE_W / 2, y: centerY + r2 * Math.sin(angle) - NODE_H / 2 };
  });
  // single schema fallback
  schemas.forEach((d, i) => {
    if (!positions[d]) {
      positions[d] = { x: 40 + (i % 3) * (NODE_W + 40), y: 40 + Math.floor(i / 3) * (NODE_H + 30) };
    }
  });

  const edges: { a: string; b: string; inter: number; jaccard: number }[] = [];
  for (let i = 0; i < schemas.length; i++) {
    for (let j = i + 1; j < schemas.length; j++) {
      const a = schemas[i], b = schemas[j];
      const r = analyzePair(fields, a, b);
      if (r.inter < 1 || r.jaccard < 0.08) continue;
      edges.push({ a, b, inter: r.inter, jaccard: r.jaccard });
    }
  }

  const drawer = selected ? (() => {
    const bizN = tableSet(fields, selected).size;
    const cCount = fields.filter((f) => f.schema === selected).length;
    const cands = candidatesFor(fields, selected);
    const tables = [...tableSet(fields, selected)].sort();
    return (
      <div className={`demo-drawer show`}>
        <button type="button" className="close" onClick={() => onSelect(null)}>×</button>
        <h2>{selected}</h2>
        <div className="desc">共 <b>{bizN}</b> 张业务表，<b>{cCount}</b> 个字段。</div>
        <div className="demo-mini">
          <div className="box"><div className="n">{bizN}</div><div className="l">业务表</div></div>
          <div className="box"><div className="n">{cCount}</div><div className="l">字段</div></div>
        </div>
        {cands.length > 0 ? (
          <>
            <h3>候选基础库（按覆盖率）</h3>
            {cands.map((c, idx) => (
              <div key={c.other} className={`demo-cand ${idx === 0 ? "top" : ""}`} onClick={() => onCompare(selected, c.other)}>
                <div className="head"><span className="name">{c.other}</span><span className="pct">覆盖 {Math.round(c.coverBtoA * 100)}%</span></div>
                <div className="bar"><i style={{ width: `${Math.round(c.coverBtoA * 100)}%` }} /></div>
                <div className="note">共同 {c.inter} · 你独有 {c.onlyA} · 对方独有 {c.onlyB}</div>
              </div>
            ))}
            <div className="demo-decision">建议：以 <b>{cands[0].other}</b> 为基础扩展，覆盖 {Math.round(cands[0].coverBtoA * 100)}%，仅需补充 {cands[0].onlyA} 张本地表。点击上方行可对比。</div>
          </>
        ) : (
          <div className="demo-decision">没有其他库覆盖此库 50% 以上表，相对独立，可作为独立基础库。点连线可与其它库对比。</div>
        )}
        <h3>业务表（{tables.length}）</h3>
        <div className="demo-tlist">
          {tables.map((t) => {
            const n = fields.filter((f) => f.schema === selected && shortTable(f.table) === t).length;
            return (
              <button key={t} type="button" onClick={() => onOpenTable(selected, t)}>
                {t}<span>{n} 字段 ›</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  })() : <div className="demo-drawer" />;

  return (
    <div className="demo-l1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {edges.map((e) => {
          const pa = positions[e.a], pb = positions[e.b];
          if (!pa || !pb) return null;
          const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H / 2;
          const x2 = pb.x + NODE_W / 2, y2 = pb.y + NODE_H / 2;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          return (
            <g key={`${e.a}-${e.b}`} onClick={() => onCompare(e.a, e.b)} style={{ cursor: "pointer" }}>
              <path className={`demo-edge ${e.jaccard >= 0.35 ? "strong" : ""}`} d={`M ${x1} ${y1} Q ${mx} ${Math.min(y1, y2) - 20} ${x2} ${y2}`} />
              <rect className="demo-edge-bg" x={mx - 28} y={my - 9} width={56} height={18} rx={9} />
              <text className="demo-edge-lab" x={mx} y={my + 4} textAnchor="middle">{e.inter}表</text>
            </g>
          );
        })}
        {schemas.map((d) => {
          const pos = positions[d];
          if (!pos) return null;
          const bizN = tableSet(fields, d).size;
          const cCount = fields.filter((f) => f.schema === d).length;
          const isBase = d === base;
          return (
            <g key={d} className={`demo-node ${isBase ? "base" : ""} ${selected === d ? "on" : ""}`} onClick={() => onSelect(d)}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} />
              <text className="n-name" x={pos.x + 10} y={pos.y + 22}>{d.length > 14 ? `${d.slice(0, 12)}…` : d}</text>
              <text className="n-meta" x={pos.x + 10} y={pos.y + 40}>{bizN}表 · {cCount}字段</text>
              {isBase && <text className="n-hint" x={pos.x + NODE_W - 8} y={pos.y + 22} textAnchor="end">★基础</text>}
            </g>
          );
        })}
      </svg>
      {drawer}
      {!selected && schemas.length > 1 && (
        <div style={{ position: "absolute", left: 16, bottom: 16, fontSize: 12, color: "#86909c", background: "rgba(255,255,255,.9)", padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e6eb" }}>
          点库看抽屉 · 点连线（N表）进入两库对比
        </div>
      )}
    </div>
  );
}

function L2Compare({
  fields, a, b, onOpenTable,
}: {
  fields: DemoField[];
  a: string;
  b: string;
  onOpenTable: (t: string) => void;
}) {
  const sa = tableSet(fields, a);
  const sb = tableSet(fields, b);
  const shared = [...sa].filter((t) => sb.has(t)).sort();
  const onlyA = [...sa].filter((t) => !sb.has(t)).sort();
  const onlyB = [...sb].filter((t) => !sa.has(t)).sort();
  const countFields = (schema: string, t: string) =>
    fields.filter((f) => f.schema === schema && shortTable(f.table) === t).length;

  return (
    <div className="demo-layer">
      <div className="demo-l2-head">
        <span className="demo-pill">{a}</span>
        <span className="vs">VS</span>
        <span className="demo-pill b">{b}</span>
        <span style={{ color: "#86909c", fontSize: 12.5 }}>
          共有 <b style={{ color: "#1d5fd0" }}>{shared.length}</b> · {a}独有 <b style={{ color: "#389e0d" }}>{onlyA.length}</b> · {b}独有 <b style={{ color: "#d46b08" }}>{onlyB.length}</b>
        </span>
      </div>
      <div className="demo-l2-cols">
        <div className="demo-col a-only">
          <div className="demo-col-head">{a} 独有 <span className="cnt">{onlyA.length}</span></div>
          <div className="demo-col-body">
            {onlyA.map((t) => (
              <div key={t} className="demo-trow" onClick={() => onOpenTable(t)}>
                <span>{t}</span><span className="fields">{countFields(a, t)}字段</span>
              </div>
            ))}
            {!onlyA.length && <div className="viz-empty">无</div>}
          </div>
        </div>
        <div className="demo-col shared">
          <div className="demo-col-head">共有表（点表看字段 Diff）<span className="cnt">{shared.length}</span></div>
          <div className="demo-col-body">
            {shared.map((t) => {
              const ca = countFields(a, t), cb = countFields(b, t);
              return (
                <div key={t} className="demo-trow" onClick={() => onOpenTable(t)}>
                  <span>{t}{ca !== cb ? " · 字段数不同" : ""}</span>
                  <span className="fields">{ca} ↔ {cb}</span>
                </div>
              );
            })}
            {!shared.length && <div className="viz-empty">无共有表</div>}
          </div>
        </div>
        <div className="demo-col b-only">
          <div className="demo-col-head">{b} 独有 <span className="cnt">{onlyB.length}</span></div>
          <div className="demo-col-body">
            {onlyB.map((t) => (
              <div key={t} className="demo-trow" onClick={() => onOpenTable(t)}>
                <span>{t}</span><span className="fields">{countFields(b, t)}字段</span>
              </div>
            ))}
            {!onlyB.length && <div className="viz-empty">无</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function L3Diff({
  fields, refs, a, b, table, onJumpApi,
}: {
  fields: DemoField[];
  refs: DemoRef[];
  a: string;
  b: string;
  table: string;
  onJumpApi?: (api: string) => void;
}) {
  const fa = fields.filter((f) => f.schema === a && shortTable(f.table) === table);
  const fb = fields.filter((f) => f.schema === b && shortTable(f.table) === table);
  const ca = fa.map((f) => f.field);
  const cb = fb.map((f) => f.field);
  const all = uniq([...ca, ...cb]).sort();
  const common = all.filter((c) => ca.includes(c) && cb.includes(c));
  const onlyA = all.filter((c) => ca.includes(c) && !cb.includes(c));
  const onlyB = all.filter((c) => !ca.includes(c) && cb.includes(c));
  const typeOf = (schema: string, field: string) =>
    fields.find((f) => f.schema === schema && shortTable(f.table) === table && f.field === field)?.data_type || "—";
  const commentOf = (schema: string, field: string) =>
    fields.find((f) => f.schema === schema && shortTable(f.table) === table && f.field === field)?.comment || "";

  const usedBy = (() => {
    const hits = refs.filter((r) => shortTable(r.table) === table);
    const keys = uniq(hits.map((h) => `${h.system}|${h.module}|${h.api}|${h.op}`));
    return keys.map((k) => {
      const [system, module, api, op] = k.split("|");
      return { system, module, api, op };
    });
  })();

  const typeDiff = common.filter((c) => typeOf(a, c) !== typeOf(b, c)).length;

  return (
    <div className="demo-layer">
      <div style={{ background: "#fff", padding: "14px 18px", borderRadius: 10, border: "1px solid #e5e6eb", marginBottom: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "DM Mono, monospace" }}>{table}</div>
        <div style={{ fontSize: 12, color: "#86909c", marginTop: 4 }}>
          {a} ↔ {b} · 共同 <b style={{ color: "#1d5fd0" }}>{common.length}</b> · 仅{a} <b style={{ color: "#389e0d" }}>{onlyA.length}</b> · 仅{b} <b style={{ color: "#d46b08" }}>{onlyB.length}</b> · 类型差异 <b style={{ color: "#cf1322" }}>{typeDiff}</b>
        </div>
      </div>
      <div className="demo-diff-grid">
        <div className="demo-diff-card common">
          <h3>共有字段（{common.length}）</h3>
          <table className="demo-diff-table">
            <thead><tr><th>字段</th><th>{a}</th><th>{b}</th><th>状态</th></tr></thead>
            <tbody>
              {common.map((c) => {
                const ta = typeOf(a, c), tb = typeOf(b, c);
                const same = ta === tb;
                return (
                  <tr key={c}>
                    <td className="f">{c}</td>
                    <td style={{ fontFamily: "DM Mono,monospace", fontSize: 11.5, color: "#86909c" }}>{ta}</td>
                    <td style={{ fontFamily: "DM Mono,monospace", fontSize: 11.5, color: "#86909c" }}>{tb}</td>
                    <td>{same ? <span className="demo-badge same">一致</span> : <span className="demo-badge type">类型不同</span>}</td>
                  </tr>
                );
              })}
              {!common.length && <tr><td colSpan={4} style={{ textAlign: "center", color: "#c9cdd4", padding: 16 }}>无</td></tr>}
            </tbody>
          </table>
        </div>
        <div>
          <div className="demo-diff-card a">
            <h3>仅 {a} 有（{onlyA.length}）</h3>
            <table className="demo-diff-table">
              <thead><tr><th>字段</th><th>类型</th><th>含义</th></tr></thead>
              <tbody>
                {onlyA.map((c) => (
                  <tr key={c}><td className="f">{c}</td><td style={{ fontFamily: "DM Mono,monospace", fontSize: 11.5, color: "#86909c" }}>{typeOf(a, c)}</td><td style={{ fontSize: 11.5 }}>{commentOf(a, c)}</td></tr>
                ))}
                {!onlyA.length && <tr><td colSpan={3} style={{ textAlign: "center", color: "#c9cdd4", padding: 16 }}>无</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="demo-diff-card b" style={{ marginTop: 12 }}>
            <h3>仅 {b} 有（{onlyB.length}）</h3>
            <table className="demo-diff-table">
              <thead><tr><th>字段</th><th>类型</th><th>含义</th></tr></thead>
              <tbody>
                {onlyB.map((c) => (
                  <tr key={c}><td className="f">{c}</td><td style={{ fontFamily: "DM Mono,monospace", fontSize: 11.5, color: "#86909c" }}>{typeOf(b, c)}</td><td style={{ fontSize: 11.5 }}>{commentOf(b, c)}</td></tr>
                ))}
                {!onlyB.length && <tr><td colSpan={3} style={{ textAlign: "center", color: "#c9cdd4", padding: 16 }}>无</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="demo-iface-block">
        <h3 style={{ fontSize: 13.5, margin: "0 0 10px", color: "#4e5969" }}>被哪些接口调用</h3>
        {usedBy.length ? usedBy.map((u) => (
          <div key={`${u.api}-${u.op}`} className="demo-iface-row">
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{u.system} / {u.module}</div>
              <div style={{ fontSize: 11, color: "#86909c", marginTop: 2, fontFamily: "DM Mono, monospace" }}>{u.api}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`demo-badge ${u.op === "SELECT" || u.op === "JOIN" ? "same" : "type"}`}>{u.op}</span>
              {onJumpApi && <button type="button" className="ingest-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => onJumpApi(u.api)}>详情 →</button>}
            </div>
          </div>
        )) : <div style={{ color: "#c9cdd4", fontSize: 12, padding: 10 }}>暂无接口调用记录（需表15字段引用）</div>}
      </div>
    </div>
  );
}

function TableDetail({
  fields, refs, schema, table, onJumpSchema, onJumpApi,
}: {
  fields: DemoField[];
  refs: DemoRef[];
  schema: string;
  table: string;
  onJumpSchema: (s: string) => void;
  onJumpApi?: (api: string) => void;
}) {
  const cols = fields.filter((f) => f.schema === schema && shortTable(f.table) === table);
  const existIn = uniq(fields.filter((f) => shortTable(f.table) === table).map((f) => f.schema));
  const usedBy = uniq(refs.filter((r) => shortTable(r.table) === table).map((r) => `${r.system}|${r.module}|${r.api}|${r.op}`))
    .map((k) => {
      const [system, module, api, op] = k.split("|");
      return { system, module, api, op };
    });

  return (
    <div className="demo-layer">
      <div style={{ background: "#fff", padding: "16px 20px", borderRadius: 10, border: "1px solid #e5e6eb", marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 6px", font: "700 18px DM Mono, monospace" }}>{table}</h2>
        <div style={{ fontSize: 12.5, color: "#86909c" }}>所属库：<b>{schema}</b> · 字段数：<b>{cols.length}</b></div>
      </div>
      <div className="demo-td-grid">
        <div className="demo-td-card">
          <h3>字段列表（{cols.length}）</h3>
          <div className="body">
            <table className="demo-diff-table">
              <thead><tr><th>字段名</th><th>类型</th><th>含义</th></tr></thead>
              <tbody>
                {cols.map((c) => (
                  <tr key={c.field}>
                    <td className="f" style={{ color: "#1d5fd0" }}>{c.field}{c.is_pk ? " ·PK" : ""}{c.is_fk ? " ·FK" : ""}</td>
                    <td style={{ fontSize: 11, color: "#86909c", fontFamily: "DM Mono,monospace" }}>{c.data_type || ""}</td>
                    <td style={{ fontSize: 11.5 }}>{c.comment || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="demo-td-card" style={{ marginBottom: 12 }}>
            <h3>存在于哪些库（{existIn.length}）</h3>
            <div className="body">
              {existIn.map((d) => (
                <button key={d} type="button" className={`demo-chip db ${d === schema ? "cur" : ""}`} onClick={() => onJumpSchema(d)}>
                  {d}{d === schema ? "（当前）" : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="demo-td-card">
            <h3>被哪些接口调用（{usedBy.length}）</h3>
            <div className="body">
              {usedBy.length ? usedBy.map((u) => (
                <button key={u.api + u.op} type="button" className="demo-chip iface" onClick={() => onJumpApi?.(u.api)} title={u.api}>
                  {u.op} · {u.api.replace(/^(GET|POST)\s+/, "")}
                </button>
              )) : <div className="viz-empty" style={{ padding: 12 }}>暂无引用</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fqTable(r: { schema: string; table: string }) {
  const t = shortTable(r.table);
  return `${r.schema}.${t}`;
}

function moduleTableSet(refs: DemoRef[], system: string, module: string): Set<string> {
  return new Set(refs.filter((r) => r.system === system && r.module === module).map(fqTable));
}

function apiTableSet(refs: DemoRef[], api: string): Set<string> {
  return new Set(refs.filter((r) => r.api === api).map(fqTable));
}

function apiFieldSet(refs: DemoRef[], api: string): Set<string> {
  return new Set(refs.filter((r) => r.api === api).map((r) => `${fqTable(r)}.${r.field}`));
}

function setOverlap(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return {
    inter,
    onlyA: a.size - inter,
    onlyB: b.size - inter,
    jaccard: a.size + b.size - inter ? inter / (a.size + b.size - inter) : 0,
  };
}

type SysLayer =
  | { kind: "mods" }
  | { kind: "modCompare"; a: string; b: string }
  | { kind: "apis"; module: string }
  | { kind: "apiCompare"; module: string; a: string; b: string }
  | { kind: "apiDetail"; api: string };

/**
 * 系统全局视图（对标库血缘）：
 * 模块环形图（共享库表为边）→ 模块对比 / 模块内接口关系图 → 接口对比 / 接口触达
 */
export function SysBloodlineView({
  entries,
  refs,
  onJumpTable,
}: {
  entries: DemoEntry[];
  refs: DemoRef[];
  onJumpTable?: (schema: string, table: string) => void;
}) {
  const systems = useMemo(() => {
    const fromE = entries.map((e) => e.system);
    const fromR = refs.map((r) => r.system);
    return uniq([...fromE, ...fromR]);
  }, [entries, refs]);

  const [system, setSystem] = useState(systems[0] || "");
  const [layer, setLayer] = useState<SysLayer>({ kind: "mods" });
  const [selectedMod, setSelectedMod] = useState<string | null>(null);
  const [selectedApi, setSelectedApi] = useState<string | null>(null);
  const [pane, setPane] = useState<"graph" | "list">("graph");
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 520 });

  useEffect(() => {
    if (systems.length && !systems.includes(system)) setSystem(systems[0]);
  }, [systems, system]);

  useEffect(() => {
    setLayer({ kind: "mods" });
    setSelectedMod(null);
    setSelectedApi(null);
  }, [system]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || pane !== "graph") return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 520 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 900, h: el.clientHeight || 520 });
    return () => ro.disconnect();
  }, [pane, layer.kind]);

  const modules = useMemo(() => {
    const fromE = uniq(entries.filter((e) => e.system === system).map((e) => e.module));
    if (fromE.length) return fromE;
    return uniq(refs.filter((r) => r.system === system).map((r) => r.module));
  }, [entries, refs, system]);

  const apisOf = (mod: string) => {
    const fromE = uniq(entries.filter((e) => e.system === system && e.module === mod).map((e) => e.entry_name));
    if (fromE.length) return fromE;
    return uniq(refs.filter((r) => r.system === system && r.module === mod).map((r) => r.api));
  };

  const allApis = useMemo(() => modules.flatMap((m) => apisOf(m)), [modules, entries, refs, system]);
  const totalTables = useMemo(() => new Set(refs.filter((r) => r.system === system).map(fqTable)).size, [refs, system]);

  if (!systems.length) {
    return <div className="demo-view"><div className="viz-empty">暂无系统/接口，请先导入代码分析 Excel</div></div>;
  }

  if (pane === "list") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="demo-stats">
          <div className="demo-sys-switch">
            {systems.map((s) => (
              <button key={s} type="button" className={s === system ? "on" : ""} onClick={() => setSystem(s)}>{s}</button>
            ))}
          </div>
          <button type="button" className="ingest-btn" style={{ marginLeft: "auto" }} onClick={() => setPane("graph")}>← 模块关系全景</button>
        </div>
        <div className="demo-view">
          <SysTriPaneView entries={entries} refs={refs} onJumpTable={onJumpTable} />
        </div>
      </div>
    );
  }

  const crumb = (() => {
    const home = { label: `${system} · 模块全景`, onClick: () => { setLayer({ kind: "mods" }); setSelectedMod(null); } };
    if (layer.kind === "mods") return [{ label: home.label, active: true }];
    if (layer.kind === "modCompare") {
      return [home, { label: `${layer.a} vs ${layer.b}`, active: true }];
    }
    if (layer.kind === "apis") {
      return [home, { label: `${layer.module} · 接口关系`, active: true }];
    }
    if (layer.kind === "apiCompare") {
      return [
        home,
        { label: `${layer.module} · 接口关系`, onClick: () => setLayer({ kind: "apis", module: layer.module }) },
        { label: "接口对比", active: true },
      ];
    }
    return [
      home,
      { label: selectedApi || layer.api, active: true },
    ];
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="demo-stats">
        <div className="demo-sys-switch">
          {systems.map((s) => (
            <button key={s} type="button" className={s === system ? "on" : ""} onClick={() => setSystem(s)}>{s}</button>
          ))}
        </div>
        <div><span className="num">{modules.length}</span><span className="lbl">模块</span></div>
        <div><span className="num">{allApis.length}</span><span className="lbl">接口</span></div>
        <div><span className="num">{totalTables}</span><span className="lbl">触达表</span></div>
        <button type="button" className="ingest-btn" style={{ marginLeft: "auto" }} onClick={() => setPane("list")}>清单三栏 →</button>
      </div>
      <div className="demo-crumb" style={{ padding: "8px 18px", background: "#fff", borderBottom: "1px solid #e5e6eb" }}>
        {crumb.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span className="sep">›</span>}
            {"active" in c && c.active ? <span className="cur">{c.label}</span> : <button type="button" onClick={"onClick" in c ? c.onClick : undefined}>{c.label}</button>}
          </span>
        ))}
      </div>
      <div className="demo-view" ref={stageRef}>
        {layer.kind === "mods" && (
          <ModuleGraph
            system={system}
            modules={modules}
            apisOf={apisOf}
            refs={refs}
            size={size}
            selected={selectedMod}
            onSelect={setSelectedMod}
            onCompare={(a, b) => { setSelectedMod(null); setLayer({ kind: "modCompare", a, b }); }}
            onOpenModule={(m) => { setSelectedMod(null); setLayer({ kind: "apis", module: m }); }}
          />
        )}
        {layer.kind === "modCompare" && (
          <CoupleCompare
            titleA={layer.a}
            titleB={layer.b}
            kindLabel="表"
            setA={moduleTableSet(refs, system, layer.a)}
            setB={moduleTableSet(refs, system, layer.b)}
            onOpenItem={(t) => onJumpTable?.(t.split(".")[0], t.split(".").slice(1).join(".") || t)}
            emptyHint="两模块暂无共享库表（需表15字段引用才能算模块耦合）"
          />
        )}
        {layer.kind === "apis" && (
          <ApiGraph
            system={system}
            module={layer.module}
            apis={apisOf(layer.module)}
            refs={refs}
            entries={entries}
            size={size}
            selected={selectedApi}
            onSelect={setSelectedApi}
            onCompare={(a, b) => { setSelectedApi(null); setLayer({ kind: "apiCompare", module: layer.module, a, b }); }}
            onOpenApi={(api) => { setSelectedApi(null); setLayer({ kind: "apiDetail", api }); }}
          />
        )}
        {layer.kind === "apiCompare" && (
          <ApiCoupleCompare
            a={layer.a}
            b={layer.b}
            refs={refs}
            onJumpTable={onJumpTable}
          />
        )}
        {layer.kind === "apiDetail" && (
          <ApiDetailPane
            api={layer.api}
            entries={entries}
            refs={refs}
            onJumpTable={onJumpTable}
          />
        )}
      </div>
    </div>
  );
}

function ModuleGraph({
  system, modules, apisOf, refs, size, selected, onSelect, onCompare, onOpenModule,
}: {
  system: string;
  modules: string[];
  apisOf: (m: string) => string[];
  refs: DemoRef[];
  size: { w: number; h: number };
  selected: string | null;
  onSelect: (m: string | null) => void;
  onCompare: (a: string, b: string) => void;
  onOpenModule: (m: string) => void;
}) {
  const W = size.w, H = size.h;
  const NODE_W = Math.min(150, W * 0.16);
  const NODE_H = 56;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) * (modules.length <= 1 ? 0 : 0.28);
  const positions: Record<string, { x: number; y: number }> = {};
  modules.forEach((m, i) => {
    if (modules.length === 1) {
      positions[m] = { x: cx - NODE_W / 2, y: cy - NODE_H / 2 };
      return;
    }
    const angle = (i / modules.length) * 2 * Math.PI - Math.PI / 2;
    positions[m] = { x: cx + r * Math.cos(angle) - NODE_W / 2, y: cy + r * Math.sin(angle) - NODE_H / 2 };
  });

  const edges: { a: string; b: string; inter: number; jaccard: number }[] = [];
  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i], b = modules[j];
      const ov = setOverlap(moduleTableSet(refs, system, a), moduleTableSet(refs, system, b));
      if (ov.inter < 1) continue;
      edges.push({ a, b, inter: ov.inter, jaccard: ov.jaccard });
    }
  }

  const drawer = selected ? (() => {
    const apis = apisOf(selected);
    const tables = moduleTableSet(refs, system, selected);
    const related = modules
      .filter((m) => m !== selected)
      .map((m) => ({ m, ...setOverlap(tables, moduleTableSet(refs, system, m)) }))
      .filter((x) => x.inter > 0)
      .sort((a, b) => b.inter - a.inter);
    return (
      <div className="demo-drawer show">
        <button type="button" className="close" onClick={() => onSelect(null)}>×</button>
        <h2>{selected}</h2>
        <div className="desc">模块 · <b>{system}</b></div>
        <div className="demo-mini">
          <div className="box"><div className="n">{apis.length}</div><div className="l">接口</div></div>
          <div className="box"><div className="n">{tables.size}</div><div className="l">触达表</div></div>
        </div>
        {related.length > 0 && (
          <>
            <h3>耦合模块（共享库表）</h3>
            {related.map((x, idx) => (
              <div key={x.m} className={`demo-cand ${idx === 0 ? "top" : ""}`} onClick={() => onCompare(selected, x.m)}>
                <div className="head"><span className="name">{x.m}</span><span className="pct">{x.inter} 表</span></div>
                <div className="note">Jaccard {(x.jaccard * 100).toFixed(0)}% · 点此对比</div>
              </div>
            ))}
          </>
        )}
        {!related.length && <div className="demo-decision">与其它模块暂无共享表耦合（或尚未导入表15引用）。仍可进入本模块看接口关系。</div>}
        <h3>接口（{apis.length}）</h3>
        <div className="demo-tlist">
          {apis.map((api) => (
            <button key={api} type="button" onClick={() => onOpenModule(selected)}>
              {api.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "")}
              <span>{apiTableSet(refs, api).size}表 ›</span>
            </button>
          ))}
        </div>
        <button type="button" className="ingest-btn primary" style={{ width: "100%", marginTop: 12 }} onClick={() => onOpenModule(selected)}>
          进入模块 · 看接口关系图
        </button>
      </div>
    );
  })() : <div className="demo-drawer" />;

  return (
    <div className="demo-l1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {edges.map((e) => {
          const pa = positions[e.a], pb = positions[e.b];
          if (!pa || !pb) return null;
          const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H / 2;
          const x2 = pb.x + NODE_W / 2, y2 = pb.y + NODE_H / 2;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          return (
            <g key={`${e.a}-${e.b}`} onClick={() => onCompare(e.a, e.b)} style={{ cursor: "pointer" }}>
              <path className={`demo-edge ${e.jaccard >= 0.3 ? "strong" : ""}`} d={`M ${x1} ${y1} Q ${mx} ${Math.min(y1, y2) - 18} ${x2} ${y2}`} />
              <rect className="demo-edge-bg" x={mx - 28} y={my - 9} width={56} height={18} rx={9} />
              <text className="demo-edge-lab" x={mx} y={my + 4} textAnchor="middle">{e.inter}表</text>
            </g>
          );
        })}
        {modules.map((m) => {
          const pos = positions[m];
          if (!pos) return null;
          const nApi = apisOf(m).length;
          const nTbl = moduleTableSet(refs, system, m).size;
          return (
            <g key={m} className={`demo-node ${selected === m ? "on" : ""}`} onClick={() => onSelect(m)}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} />
              <text className="n-name" x={pos.x + 10} y={pos.y + 22}>{m.length > 12 ? `${m.slice(0, 10)}…` : m}</text>
              <text className="n-meta" x={pos.x + 10} y={pos.y + 40}>{nApi}接口 · {nTbl}表</text>
            </g>
          );
        })}
      </svg>
      {drawer}
      <div style={{ position: "absolute", left: 16, bottom: 16, fontSize: 12, color: "#86909c", background: "rgba(255,255,255,.92)", padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e6eb", maxWidth: 360 }}>
        模块节点 · 连线=共享库表数 · 点模块开抽屉 · 点连线对比耦合 · 抽屉内进入接口关系图
      </div>
    </div>
  );
}

function ApiGraph({
  system, module, apis, refs, entries, size, selected, onSelect, onCompare, onOpenApi,
}: {
  system: string;
  module: string;
  apis: string[];
  refs: DemoRef[];
  entries: DemoEntry[];
  size: { w: number; h: number };
  selected: string | null;
  onSelect: (a: string | null) => void;
  onCompare: (a: string, b: string) => void;
  onOpenApi: (a: string) => void;
}) {
  const W = size.w, H = size.h;
  const NODE_W = Math.min(170, W * 0.18);
  const NODE_H = 52;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) * (apis.length <= 1 ? 0 : 0.3);
  const positions: Record<string, { x: number; y: number }> = {};
  apis.forEach((a, i) => {
    if (apis.length === 1) {
      positions[a] = { x: cx - NODE_W / 2, y: cy - NODE_H / 2 };
      return;
    }
    const angle = (i / apis.length) * 2 * Math.PI - Math.PI / 2;
    positions[a] = { x: cx + r * Math.cos(angle) - NODE_W / 2, y: cy + r * Math.sin(angle) - NODE_H / 2 };
  });

  const edges: { a: string; b: string; inter: number; jaccard: number }[] = [];
  for (let i = 0; i < apis.length; i++) {
    for (let j = i + 1; j < apis.length; j++) {
      const a = apis[i], b = apis[j];
      const ov = setOverlap(apiTableSet(refs, a), apiTableSet(refs, b));
      if (ov.inter < 1) continue;
      edges.push({ a, b, inter: ov.inter, jaccard: ov.jaccard });
    }
  }

  const drawer = selected ? (() => {
    const tables = apiTableSet(refs, selected);
    const fields = apiFieldSet(refs, selected);
    const ent = entries.find((e) => e.entry_name === selected);
    const related = apis
      .filter((a) => a !== selected)
      .map((a) => ({ a, ...setOverlap(tables, apiTableSet(refs, a)) }))
      .filter((x) => x.inter > 0)
      .sort((x, y) => y.inter - x.inter);
    return (
      <div className="demo-drawer show">
        <button type="button" className="close" onClick={() => onSelect(null)}>×</button>
        <h2 style={{ fontSize: 14 }}>{selected}</h2>
        <div className="desc">{system} / {module}{ent?.entry_class ? ` · ${ent.entry_class}` : ""}</div>
        <div className="demo-mini">
          <div className="box"><div className="n">{tables.size}</div><div className="l">触达表</div></div>
          <div className="box"><div className="n">{fields.size}</div><div className="l">字段引用</div></div>
        </div>
        {related.length > 0 && (
          <>
            <h3>耦合接口（共享库表）</h3>
            {related.map((x, idx) => (
              <div key={x.a} className={`demo-cand ${idx === 0 ? "top" : ""}`} onClick={() => onCompare(selected, x.a)}>
                <div className="head"><span className="name" style={{ fontSize: 11 }}>{x.a.replace(/^(GET|POST)\s+/i, "")}</span><span className="pct">{x.inter}表</span></div>
              </div>
            ))}
          </>
        )}
        {!related.length && <div className="demo-decision">与同模块其它接口暂无共享表（需表15）。仍可查看本接口触达详情。</div>}
        <button type="button" className="ingest-btn primary" style={{ width: "100%", marginTop: 12 }} onClick={() => onOpenApi(selected)}>
          查看接口触达详情
        </button>
      </div>
    );
  })() : <div className="demo-drawer" />;

  return (
    <div className="demo-l1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {edges.map((e) => {
          const pa = positions[e.a], pb = positions[e.b];
          if (!pa || !pb) return null;
          const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H / 2;
          const x2 = pb.x + NODE_W / 2, y2 = pb.y + NODE_H / 2;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          return (
            <g key={`${e.a}-${e.b}`} onClick={() => onCompare(e.a, e.b)} style={{ cursor: "pointer" }}>
              <path className={`demo-edge ${e.jaccard >= 0.3 ? "strong" : ""}`} d={`M ${x1} ${y1} Q ${mx} ${Math.min(y1, y2) - 16} ${x2} ${y2}`} />
              <rect className="demo-edge-bg" x={mx - 28} y={my - 9} width={56} height={18} rx={9} />
              <text className="demo-edge-lab" x={mx} y={my + 4} textAnchor="middle">{e.inter}表</text>
            </g>
          );
        })}
        {apis.map((a) => {
          const pos = positions[a];
          if (!pos) return null;
          const method = a.split(" ")[0] || "GET";
          const path = a.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "");
          const short = path.length > 16 ? `${path.slice(0, 14)}…` : path;
          return (
            <g key={a} className={`demo-node ${selected === a ? "on" : ""}`} onClick={() => onSelect(a)}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} />
              <text className="n-name" x={pos.x + 8} y={pos.y + 20} style={{ fontSize: 11 }}>{method} {short}</text>
              <text className="n-meta" x={pos.x + 8} y={pos.y + 38}>{apiTableSet(refs, a).size}表 · {apiFieldSet(refs, a).size}字段</text>
            </g>
          );
        })}
      </svg>
      {drawer}
      {!apis.length && <div className="viz-empty">该模块暂无接口</div>}
      <div style={{ position: "absolute", left: 16, bottom: 16, fontSize: 12, color: "#86909c", background: "rgba(255,255,255,.92)", padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e6eb" }}>
        模块「{module}」内接口关系 · 连线=共享库表 · 点边对比接口耦合
      </div>
    </div>
  );
}

function CoupleCompare({
  titleA, titleB, kindLabel, setA, setB, onOpenItem, emptyHint,
}: {
  titleA: string;
  titleB: string;
  kindLabel: string;
  setA: Set<string>;
  setB: Set<string>;
  onOpenItem?: (item: string) => void;
  emptyHint: string;
}) {
  const shared = [...setA].filter((x) => setB.has(x)).sort();
  const onlyA = [...setA].filter((x) => !setB.has(x)).sort();
  const onlyB = [...setB].filter((x) => !setA.has(x)).sort();
  if (!setA.size && !setB.size) {
    return <div className="demo-layer"><div className="viz-empty">{emptyHint}</div></div>;
  }
  return (
    <div className="demo-layer">
      <div className="demo-l2-head">
        <span className="demo-pill">{titleA}</span>
        <span className="vs">VS</span>
        <span className="demo-pill b">{titleB}</span>
        <span style={{ color: "#86909c", fontSize: 12.5 }}>
          共有 <b style={{ color: "#1d5fd0" }}>{shared.length}</b> {kindLabel} · 独有 {onlyA.length} / {onlyB.length}
        </span>
      </div>
      <div className="demo-l2-cols">
        <div className="demo-col a-only">
          <div className="demo-col-head">{titleA} 独有 <span className="cnt">{onlyA.length}</span></div>
          <div className="demo-col-body">
            {onlyA.map((t) => <div key={t} className="demo-trow" onClick={() => onOpenItem?.(t)}><span>{t}</span></div>)}
            {!onlyA.length && <div className="viz-empty">无</div>}
          </div>
        </div>
        <div className="demo-col shared">
          <div className="demo-col-head">共有{kindLabel}<span className="cnt">{shared.length}</span></div>
          <div className="demo-col-body">
            {shared.map((t) => <div key={t} className="demo-trow" onClick={() => onOpenItem?.(t)}><span>{t}</span></div>)}
            {!shared.length && <div className="viz-empty">无共有</div>}
          </div>
        </div>
        <div className="demo-col b-only">
          <div className="demo-col-head">{titleB} 独有 <span className="cnt">{onlyB.length}</span></div>
          <div className="demo-col-body">
            {onlyB.map((t) => <div key={t} className="demo-trow" onClick={() => onOpenItem?.(t)}><span>{t}</span></div>)}
            {!onlyB.length && <div className="viz-empty">无</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiCoupleCompare({
  a, b, refs, onJumpTable,
}: {
  a: string;
  b: string;
  refs: DemoRef[];
  onJumpTable?: (schema: string, table: string) => void;
}) {
  const ta = apiTableSet(refs, a);
  const tb = apiTableSet(refs, b);
  const fa = apiFieldSet(refs, a);
  const fb = apiFieldSet(refs, b);
  const sharedT = [...ta].filter((x) => tb.has(x)).sort();
  const sharedF = [...fa].filter((x) => fb.has(x)).sort();
  const onlyA = [...fa].filter((x) => !fb.has(x)).sort();
  const onlyB = [...fb].filter((x) => !fa.has(x)).sort();

  return (
    <div className="demo-layer">
      <div className="demo-l2-head">
        <span className="demo-pill" style={{ fontSize: 12 }}>{a}</span>
        <span className="vs">VS</span>
        <span className="demo-pill b" style={{ fontSize: 12 }}>{b}</span>
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12.5, color: "#4e5969" }}>
        <span>共有表 <b style={{ color: "#1d5fd0" }}>{sharedT.length}</b></span>
        <span>共有字段 <b style={{ color: "#1d5fd0" }}>{sharedF.length}</b></span>
        <span>仅左字段 {onlyA.length}</span>
        <span>仅右字段 {onlyB.length}</span>
      </div>
      {!ta.size && !tb.size ? (
        <div className="viz-empty">两接口均无库表引用事实，无法计算耦合（需表15）</div>
      ) : (
        <div className="demo-diff-grid">
          <div className="demo-diff-card common">
            <h3>共有表（{sharedT.length}）</h3>
            <div className="demo-col-body" style={{ padding: 8 }}>
              {sharedT.map((t) => (
                <div key={t} className="demo-trow" onClick={() => onJumpTable?.(t.split(".")[0], t.split(".").slice(1).join("."))}>
                  <span>{t}</span>
                </div>
              ))}
              {!sharedT.length && <div className="viz-empty">无</div>}
            </div>
          </div>
          <div className="demo-diff-card common">
            <h3>共有字段（{sharedF.length}）</h3>
            <div className="demo-col-body" style={{ padding: 8, maxHeight: 360, overflow: "auto" }}>
              {sharedF.map((f) => <div key={f} className="demo-trow"><span>{f}</span></div>)}
              {!sharedF.length && <div className="viz-empty">无</div>}
            </div>
          </div>
          <div className="demo-diff-card a">
            <h3>仅 {a.split(" ")[0]} 侧字段（{onlyA.length}）</h3>
            <div className="demo-col-body" style={{ padding: 8, maxHeight: 280, overflow: "auto" }}>
              {onlyA.map((f) => <div key={f} className="demo-trow"><span>{f}</span></div>)}
              {!onlyA.length && <div className="viz-empty">无</div>}
            </div>
          </div>
          <div className="demo-diff-card b">
            <h3>仅对侧字段（{onlyB.length}）</h3>
            <div className="demo-col-body" style={{ padding: 8, maxHeight: 280, overflow: "auto" }}>
              {onlyB.map((f) => <div key={f} className="demo-trow"><span>{f}</span></div>)}
              {!onlyB.length && <div className="viz-empty">无</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiDetailPane({
  api, entries, refs, onJumpTable,
}: {
  api: string;
  entries: DemoEntry[];
  refs: DemoRef[];
  onJumpTable?: (schema: string, table: string) => void;
}) {
  const entry = entries.find((e) => e.entry_name === api);
  const touch = refs.filter((r) => r.api === api);
  const tables = uniq(touch.map((t) => `${t.schema}::${shortTable(t.table)}::${t.op}`)).map((k) => {
    const [schema, table, op] = k.split("::");
    return { schema, table, op };
  });
  return (
    <div className="demo-layer">
      <div style={{ background: "#fff", padding: 18, borderRadius: 10, border: "1px solid #e5e6eb", marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 8px", font: "700 16px DM Mono, monospace" }}>{api}</h2>
        <div className="demo-kv">
          <div><span>系统</span><b>{entry?.system || touch[0]?.system || "—"}</b></div>
          <div><span>模块</span><b>{entry?.module || touch[0]?.module || "—"}</b></div>
          <div><span>Controller</span><b>{entry?.entry_class || "—"}</b></div>
          <div><span>方法</span><b>{entry?.method_name || "—"}</b></div>
          <div><span>入参</span><b>{entry?.request_params || "—"}</b></div>
          <div><span>返回</span><b>{entry?.return_type || "—"}</b></div>
          <div><span>路径</span><b>{entry?.file_path || "—"}</b></div>
        </div>
      </div>
      <h3 style={{ margin: "0 0 10px", fontSize: 13.5, color: "#4e5969" }}>触达库表（{tables.length}）</h3>
      {tables.length ? tables.map((t) => (
        <button key={`${t.schema}.${t.table}.${t.op}`} type="button" className="demo-tref" onClick={() => onJumpTable?.(t.schema, t.table)}>
          <div className="db">{t.schema}<span className={`dir ${t.op === "SELECT" || t.op === "JOIN" ? "read" : "write"}`}>{t.op}</span></div>
          <div className="t">{t.table}</div>
        </button>
      )) : <div className="viz-empty">尚无字段引用 · 导入表15后可分析接口耦合</div>}
    </div>
  );
}

/** 系统视角：左系统 / 中模块接口 / 右详情 */
export function SysTriPaneView({
  entries,
  refs,
  onJumpTable,
}: {
  entries: DemoEntry[];
  refs: DemoRef[];
  onJumpTable?: (schema: string, table: string) => void;
}) {
  const systems = useMemo(() => {
    const fromE = entries.map((e) => e.system);
    const fromR = refs.map((r) => r.system);
    return uniq([...fromE, ...fromR]);
  }, [entries, refs]);

  const [system, setSystem] = useState(systems[0] || "");
  const [api, setApi] = useState("");

  useEffect(() => {
    if (!systems.includes(system) && systems[0]) setSystem(systems[0]);
  }, [systems, system]);

  const sysEntries = useMemo(
    () => entries.filter((e) => e.system === system),
    [entries, system],
  );

  // 若无 entries，从 refs 推导接口列表
  const modules = useMemo(() => {
    if (sysEntries.length) return uniq(sysEntries.map((e) => e.module));
    return uniq(refs.filter((r) => r.system === system).map((r) => r.module));
  }, [sysEntries, refs, system]);

  const apisInModule = (mod: string) => {
    if (sysEntries.length) {
      return uniq(sysEntries.filter((e) => e.module === mod).map((e) => e.entry_name));
    }
    return uniq(refs.filter((r) => r.system === system && r.module === mod).map((r) => r.api));
  };

  const selectedApi = api || apisInModule(modules[0] || "")[0] || "";
  const entry = sysEntries.find((e) => e.entry_name === selectedApi);
  const touch = refs.filter((r) => r.api === selectedApi || (r.system === system && r.api === selectedApi));
  const touchTables = uniq(touch.map((t) => `${t.schema}::${shortTable(t.table)}::${t.op}`)).map((k) => {
    const [schema, table, op] = k.split("::");
    return { schema, table, op };
  });

  const countForSystem = (s: string) => {
    const n = uniq(entries.filter((e) => e.system === s).map((e) => e.entry_name)).length;
    if (n) return n;
    return uniq(refs.filter((r) => r.system === s).map((r) => r.api)).length;
  };

  if (!systems.length) {
    return <div className="demo-view"><div className="viz-empty">暂无系统/接口，请先导入代码分析 Excel</div></div>;
  }

  return (
    <div className="demo-sys">
      <div className="demo-sys-left">
        <h3>系统</h3>
        {systems.map((s) => (
          <button key={s} type="button" className={`demo-sys-item ${s === system ? "on" : ""}`} onClick={() => { setSystem(s); setApi(""); }}>
            {s}<em>{countForSystem(s)}</em>
          </button>
        ))}
      </div>
      <div className="demo-sys-center">
        <h3>{system}</h3>
        {modules.map((mod) => (
          <div key={mod} className="demo-mod-block">
            <div className="demo-mod-title">{mod}</div>
            {apisInModule(mod).map((name) => {
              const method = name.split(" ")[0] || "GET";
              const path = name.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "");
              const tables = uniq(refs.filter((r) => r.api === name).map((r) => shortTable(r.table))).length;
              return (
                <button
                  key={name}
                  type="button"
                  className={`demo-iface-row2 ${selectedApi === name ? "on" : ""}`}
                  onClick={() => setApi(name)}
                >
                  <span><span className="method">{method}</span>{path}</span>
                  <em style={{ fontStyle: "normal", fontSize: 10, color: "#86909c" }}>{tables ? `${tables}表` : "—"}</em>
                </button>
              );
            })}
          </div>
        ))}
        {!modules.length && <div className="viz-empty">该系统暂无模块</div>}
      </div>
      <div className="demo-sys-right">
        {selectedApi ? (
          <>
            <h3>接口详情</h3>
            <div className="demo-kv">
              <div><span>入口</span><b>{selectedApi}</b></div>
              <div><span>系统</span><b>{system}</b></div>
              <div><span>模块</span><b>{entry?.module || touch[0]?.module || "—"}</b></div>
              <div><span>Controller</span><b>{entry?.entry_class || "—"}</b></div>
              <div><span>方法</span><b>{entry?.method_name || "—"}</b></div>
              <div><span>入参</span><b>{entry?.request_params || "—"}</b></div>
              <div><span>返回</span><b>{entry?.return_type || "—"}</b></div>
              <div><span>路径</span><b>{entry?.file_path || "—"}</b></div>
            </div>
            <h3>访问的库表（{touchTables.length}）</h3>
            {touchTables.length ? touchTables.map((t) => (
              <button
                key={`${t.schema}.${t.table}.${t.op}`}
                type="button"
                className="demo-tref"
                onClick={() => onJumpTable?.(t.schema, t.table)}
              >
                <div className="db">{t.schema}<span className={`dir ${t.op === "SELECT" || t.op === "JOIN" ? "read" : "write"}`}>{t.op}</span></div>
                <div className="t">{t.table}</div>
              </button>
            )) : (
              <div className="viz-empty" style={{ padding: 12 }}>尚无字段引用事实。导入代码 Excel 登记了入口；表15补齐后此处显示触达表。</div>
            )}
          </>
        ) : (
          <div className="viz-empty">选择左侧系统与中间接口</div>
        )}
      </div>
    </div>
  );
}
