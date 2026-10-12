const titles = {
  chain: ["血缘探索", "两个问题：字段被谁用 · 接口用了什么"],
  dashboard: ["总览与闸门", "P0→P7 进度与全局指标"],
  fields: ["字段主表 · 04", "点字段进入「字段被谁用」"],
  references: ["引用事实 · 15", "点字段进入「字段被谁用」"],
  dicts: ["字典值域 · 09", "定义与使用"],
  issues: ["问题清单 · 24", "从问题跳到字段"],
  catalog: ["对象与入口", "表03 / 表11 / 表12"],
  framework: ["29 表框架", "交付物形态"],
};

const state = {
  perspective: "field", // field | system
  target: null, // {schema, table, field}
  systemTarget: null, // {system, module?, entry?}
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function badge(text, kind = "") {
  return `<span class="badge ${kind}">${text ?? "—"}</span>`;
}

function metaTriple(row) {
  return `${badge(row.evidence_source)} ${badge(row.conclusion_level)} ${badge(row.applicability, row.applicability?.includes("生产") ? "warn" : "")}`;
}

function parseTarget(full) {
  const parts = String(full).split(".");
  if (parts.length >= 3) {
    return { schema: parts[0], table: parts[1], field: parts.slice(2).join(".") };
  }
  return null;
}

function setView(name) {
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  const [t, d] = titles[name];
  $("#view-title").textContent = t;
  $("#view-desc").textContent = d;
}

function openDrawer(title, bodyHtml) {
  $("#drawer-title").textContent = title;
  $("#drawer-body").innerHTML = bodyHtml;
  $("#drawer").classList.remove("hidden");
}
function closeDrawer() {
  $("#drawer").classList.add("hidden");
}

async function openChainFromName(name) {
  // PROJECT_STATUS / TASK_INFO.TASK_STATUS / EXEC_USER.PROJECT_INFO.EXT1
  const fields = await api("/api/fields");
  let hit =
    fields.find((f) => f.full_name === name) ||
    fields.find((f) => `${f.table_name}.${f.field_name}` === name) ||
    fields.find((f) => f.field_name === name);
  if (!hit && name.includes(".")) {
    const p = parseTarget(name.includes(".") && name.split(".").length === 2 ? `X.${name}` : name);
    if (p && p.schema !== "X") {
      await openChain(p.schema, p.table, p.field);
      return;
    }
    hit = fields.find((f) => `${f.table_name}.${f.field_name}` === name || f.field_name === name.split(".").pop());
  }
  if (hit) await openChain(hit.schema_name, hit.table_name, hit.field_name);
  else alert("未找到对应字段：" + name);
}


async function renderDashboard() {
  const data = await api("/api/dashboard");
  const hot = await api("/api/lineage/hotspots");
  const s = data.summary;
  const root = $("#view-dashboard");
  root.innerHTML = "";

  const stats = el("div", "grid stats");
  [
    ["字段主表", s.fields, "accent"],
    ["引用事实", s.references, "accent"],
    ["问题", s.issues, "warn"],
    ["零命中字段", s.zero_hit_fields, "danger"],
    ["多写字段", s.multi_write_fields, "danger"],
    ["入口", s.entries, "ok"],
  ].forEach(([label, val, cls]) => {
    const card = el("div", "card clickable-card");
    card.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value ${cls}">${val}</div>`;
    if (label.includes("零命中") || label.includes("多写")) {
      card.onclick = () => goto("chain");
      card.title = "进入血缘串联";
    }
    stats.appendChild(card);
  });
  root.appendChild(stats);

  const hotCard = el("div", "card");
  hotCard.style.marginTop = "14px";
  hotCard.innerHTML = `<h3>两种入口进入串联</h3>`;
  const row = el("div", "hot-row");
  const sysBtn = el("button", "btn primary", "正向：从系统出发");
  sysBtn.onclick = () => openSystemFromDefault();
  row.appendChild(sysBtn);
  const fieldBtn = el("button", "btn primary", "反向：从字段热点出发");
  fieldBtn.onclick = () => openFieldFromDefault();
  row.appendChild(fieldBtn);
  hot.hotspots.slice(0, 4).forEach((h) => {
    const b = el("button", "btn hot-chip");
    b.innerHTML = `<span class="mono">${h.field_name}</span> ${h.reasons[0] || ""}`;
    b.onclick = () => openChain(h.schema_name, h.table_name, h.field_name);
    row.appendChild(b);
  });
  hotCard.appendChild(row);
  root.appendChild(hotCard);

  const two = el("div", "grid two");
  two.style.marginTop = "14px";
  const phaseCard = el("div", "card", "<h3>P0→P7 阶段</h3>");
  const phases = el("div", "grid phases");
  data.phases.forEach((p) => {
    const statusKind = p.status === "进行中" ? "warn" : p.status === "未开始" ? "" : "ok";
    phases.appendChild(
      el(
        "div",
        "phase card",
        `<div class="code">${p.phase_code}</div>
         <div class="name">${p.phase_name}</div>
         <div class="meta">表 ${p.table_ids} · ${p.filled_tables}/${p.table_count}</div>
         ${badge(p.status, statusKind)}
         ${p.gate_code ? badge(p.gate_code + (p.gate_passed ? " 已过" : " 未过"), p.gate_passed ? "ok" : "warn") : ""}
         <div class="meta">${p.note || ""}</div>`
      )
    );
  });
  phaseCard.appendChild(phases);
  two.appendChild(phaseCard);

  const gateCard = el("div", "card", "<h3>验收闸门</h3>");
  const glist = el("div", "gate-list");
  data.gates.forEach((g) => {
    glist.appendChild(
      el(
        "div",
        "gate-item",
        `<div><strong>${g.code} · ${g.name}</strong><div class="muted" style="margin-top:4px;font-size:12px">${g.detail}</div></div>
         ${badge(g.passed ? "通过" : "未通过", g.passed ? "ok" : "danger")}`
      )
    );
  });
  gateCard.appendChild(glist);
  two.appendChild(gateCard);
  root.appendChild(two);
}

function fieldTable(rows) {
  const wrap = el("div", "table-wrap");
  const table = el("table");
  table.innerHTML = `<thead><tr>
    <th>字段</th><th>类型</th><th>分类</th><th>引用</th><th>系统/入口</th><th>操作</th><th>状态</th><th>动作</th>
  </tr></thead>`;
  const tb = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr", "clickable");
    tr.innerHTML = `
      <td class="mono"><div>${r.full_name}</div><div class="muted">${r.field_comment || ""}</div></td>
      <td class="mono nowrap">${r.data_type || "—"}</td>
      <td>${r.field_category || "—"} ${r.is_core ? badge("核心", "core") : ""}</td>
      <td>${r.source_ref_count}</td>
      <td>${r.ref_system_count} / ${r.ref_entry_count}</td>
      <td class="mono">${r.ref_ops || "—"}</td>
      <td>${badge(r.field_ref_status, r.source_ref_count === 0 ? "danger" : "ok")}</td>
      <td><button class="btn primary btn-sm">串联分析</button></td>`;
    tr.onclick = () => openChain(r.schema_name, r.table_name, r.field_name);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  wrap.appendChild(table);
  return wrap;
}

async function renderFields() {
  const root = $("#view-fields");
  root.innerHTML = "";
  const bar = el("div", "toolbar");
  const q = el("input");
  q.placeholder = "搜索后点行进入串联";
  const zero = el("select");
  zero.innerHTML = `<option value="">全部</option><option value="1">仅零命中</option><option value="core">仅核心</option>`;
  const btn = el("button", "btn primary", "查询");
  bar.append(q, zero, btn);
  root.appendChild(bar);
  const box = el("div");
  root.appendChild(box);
  async function load() {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set("q", q.value.trim());
    if (zero.value === "1") params.set("zero_hit", "true");
    if (zero.value === "core") params.set("core_only", "true");
    box.innerHTML = "";
    box.appendChild(fieldTable(await api(`/api/fields?${params}`)));
  }
  btn.onclick = load;
  q.onkeydown = (e) => e.key === "Enter" && load();
  await load();
}

async function renderReferences() {
  const root = $("#view-references");
  root.innerHTML = "";
  const bar = el("div", "toolbar");
  const q = el("input");
  q.placeholder = "搜索；点行进入该字段串联";
  const op = el("select");
  op.innerHTML = `<option value="">全部操作</option><option>SELECT</option><option>INSERT</option><option>UPDATE</option><option>DELETE</option><option>JOIN</option>`;
  const btn = el("button", "btn primary", "查询");
  bar.append(q, op, btn);
  root.appendChild(bar);
  const box = el("div");
  root.appendChild(box);
  async function load() {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set("q", q.value.trim());
    if (op.value) params.set("op_type", op.value);
    const rows = await api(`/api/references?${params}`);
    const wrap = el("div", "table-wrap");
    const table = el("table");
    table.innerHTML = `<thead><tr>
      <th>字段</th><th>操作</th><th>系统/模块</th><th>入口</th><th>角色</th><th>动作</th>
    </tr></thead>`;
    const tb = el("tbody");
    rows.forEach((r) => {
      const tr = el("tr", "clickable");
      tr.innerHTML = `
        <td class="mono">${r.full_field}</td>
        <td>${badge(r.op_type, r.op_type === "UPDATE" ? "warn" : "core")}</td>
        <td>${r.system_name}<div class="muted">${r.module_name}</div></td>
        <td class="mono">${r.entry_name}</td>
        <td>${r.field_role || "—"}</td>
        <td><button class="btn primary btn-sm">串联</button></td>`;
      tr.onclick = () => openChain(r.schema_name, r.table_name, r.field_name);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    box.innerHTML = "";
    box.appendChild(wrap);
  }
  btn.onclick = load;
  await load();
}

async function renderDicts() {
  const rows = await api("/api/dicts");
  const root = $("#view-dicts");
  root.innerHTML = "";
  const wrap = el("div", "table-wrap");
  const table = el("table");
  table.innerHTML = `<thead><tr><th>类型</th><th>字典</th><th>值</th><th>来源/使用</th><th>动作</th></tr></thead>`;
  const tb = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr");
    const loc =
      r.record_type === "定义"
        ? `${r.source_type || ""} ${r.source_schema || ""}.${r.source_table || ""}`
        : `${r.use_system || ""} / ${r.use_table}.${r.use_field}`;
    tr.innerHTML = `
      <td>${badge(r.record_type, r.record_type === "定义" ? "core" : "warn")}</td>
      <td class="mono">${r.dict_name}</td>
      <td>${r.value_code || "—"} <span class="muted">${r.value_label || ""}</span></td>
      <td>${loc}</td>
      <td></td>`;
    if (r.use_schema && r.use_table && r.use_field) {
      const b = el("button", "btn primary btn-sm", "串联字段");
      b.onclick = () => openChain(r.use_schema, r.use_table, r.use_field);
      tr.lastElementChild.appendChild(b);
    } else {
      const b = el("button", "btn ghost btn-sm", "按字典名找字段");
      b.onclick = async () => {
        const fields = await api("/api/fields");
        const hit = fields.find((f) => f.dict_type === r.dict_name);
        if (hit) openChain(hit.schema_name, hit.table_name, hit.field_name);
        else alert("未找到绑定该字典的字段");
      };
      tr.lastElementChild.appendChild(b);
    }
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  wrap.appendChild(table);
  root.appendChild(wrap);
}

async function renderIssues() {
  const rows = await api("/api/issues");
  const root = $("#view-issues");
  root.innerHTML = "";
  const wrap = el("div", "table-wrap");
  const table = el("table");
  table.innerHTML = `<thead><tr><th>编号</th><th>分类</th><th>对象</th><th>描述</th><th>风险</th><th>动作</th></tr></thead>`;
  const tb = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr");
    tr.innerHTML = `
      <td class="mono">${r.issue_no}</td>
      <td>${r.category}</td>
      <td class="mono">${r.object_name}</td>
      <td>${r.description}<div class="muted">建议：${r.suggestion || "—"}</div></td>
      <td>${badge(r.risk, r.risk === "高" ? "danger" : "warn")}</td>
      <td><button class="btn primary btn-sm">串联对象</button></td>`;
    tr.querySelector("button").onclick = () => openChainFromName(r.object_name);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  wrap.appendChild(table);
  root.appendChild(wrap);
}

async function renderCatalog() {
  const [objects, modules, entries, materials, links] = await Promise.all([
    api("/api/objects"),
    api("/api/modules"),
    api("/api/entries"),
    api("/api/materials"),
    api("/api/implicit-links"),
  ]);
  const root = $("#view-catalog");
  root.innerHTML = `
    <div class="grid two">
      <div class="card"><h3>表03 对象总览</h3>
        ${objects
          .map(
            (o) => `<div class="list-item"><strong class="mono">${o.schema_name}.${o.object_name}</strong>
        <div class="muted">${o.preliminary_class || ""} · 引用入口 ${o.ref_entry_count}</div>
        <button class="btn ghost btn-sm" data-obj="${o.schema_name}.${o.object_name}">看该表字段串联</button></div>`
          )
          .join("")}
      </div>
      <div class="card"><h3>表01 输入资料</h3>
        ${materials
          .map(
            (m) => `<div class="list-item"><strong>${m.material_no}</strong> ${m.material_type}
        <div class="muted">${m.system_name || ""} ${m.repo || m.dmp_file || ""}</div></div>`
          )
          .join("")}
      </div>
      <div class="card"><h3>表11 / 表12 系统模块与入口</h3>
        ${modules
          .map(
            (m) => `<div class="list-item"><strong>${m.system_name}</strong> · ${m.module_name}
        <div class="muted">${m.duty || ""}</div></div>`
          )
          .join("")}
        <hr style="border-color:var(--line);margin:12px 0">
        ${entries
          .map(
            (e) => `<div class="list-item mono">${e.entry_type} · ${e.entry_name}
        <div class="muted">${e.system_name} / ${e.module_name}</div></div>`
          )
          .join("")}
      </div>
      <div class="card"><h3>表17 隐式关联</h3>
        ${
          links
            .map(
              (l) => `<div class="list-item"><div class="mono">${l.child_field} → ${l.parent_field}</div>
        <div class="muted">${l.find_system} · FK=${l.has_fk ? "有" : "无"}</div>
        <button class="btn ghost btn-sm" data-link="${l.child_field}">串联子字段</button></div>`
            )
            .join("") || '<div class="muted">暂无</div>'
        }
      </div>
    </div>`;
  root.querySelectorAll("[data-obj]").forEach((b) => {
    b.onclick = async () => {
      const [schema, table] = b.dataset.obj.split(".");
      const fields = await api(`/api/fields?schema=${schema}&table=${table}`);
      const hit = fields.find((f) => f.is_core) || fields[0];
      if (hit) openChain(hit.schema_name, hit.table_name, hit.field_name);
    };
  });
  root.querySelectorAll("[data-link]").forEach((b) => {
    b.onclick = () => openChainFromName(b.dataset.link);
  });
}

async function renderFramework() {
  const data = await api("/api/dashboard");
  const root = $("#view-framework");
  const grid = el("div", "framework-grid");
  data.tables_framework.forEach((t) => {
    grid.appendChild(
      el(
        "div",
        `fw-card${t.core ? " core" : ""}`,
        `<div class="mono" style="color:var(--accent)">表${t.id} · ${t.phase}</div>
         <div style="margin-top:6px;font-weight:600">${t.name}</div>
         ${t.core ? badge("核心主线", "core") : ""}`
      )
    );
  });
  root.innerHTML = `<div class="card" style="margin-bottom:12px"><strong>说明：</strong>29 张表是交付物形态；真正工作方式是左侧「血缘串联」——一张字段把 04/09/15/17/24 与闸门串在同一屏。</div>`;
  root.appendChild(grid);
}

const renderers = {
  dashboard: renderDashboard,
  fields: renderFields,
  references: renderReferences,
  dicts: renderDicts,
  issues: renderIssues,
  catalog: renderCatalog,
  framework: renderFramework,
};

async function goto(name) {
  if (name === "chain") {
    if (typeof drillSyncAppState === "function") drillSyncAppState();
    if (typeof drillHash === "function") location.hash = drillHash();
    else location.hash = "chain";
  } else {
    location.hash = name;
  }
  setView(name);
  if (name === "chain") {
    if (typeof renderChain !== "function") {
      console.error("renderChain 未加载");
      return;
    }
    await renderChain();
    return;
  }
  await renderers[name]();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw || raw === "chain") {
    if (typeof drillResetField === "function") {
      drill.mode = "field";
      drillResetField();
    }
    return "chain";
  }
  if (typeof drillApplyHash === "function" && drillApplyHash(raw)) {
    drillSyncAppState();
    return "chain";
  }
  if (raw === "impact") return "chain";
  return titles[raw] ? raw : "chain";
}

async function boot() {
  document.querySelectorAll("#nav button").forEach((b) => {
    b.onclick = () => goto(b.dataset.view);
  });
  $("#drawer-close").onclick = closeDrawer;
  $("#drawer").onclick = (e) => {
    if (e.target.id === "drawer") closeDrawer();
  };
  $("#btn-refresh").onclick = async () => {
    await fetch("/api/admin/refresh-stats", { method: "POST" });
    await goto(parseHash());
  };

  try {
    const h = await api("/api/health");
    $("#health").textContent = "服务正常";
    $("#health").classList.add("ok");
  } catch {
    $("#health").textContent = "服务不可用";
  }

  await goto(parseHash());
}

// boot 由 index 在 drill.js 加载后调用
