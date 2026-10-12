/**
 * 血缘探索 — 只回答两个问题：
 * 1) 一个表的字段，都被哪些系统 / 模块 / 接口引用？
 * 2) 一个系统的模块 / 接口，用了哪些库 / 表 / 字段？
 */

const drill = {
  mode: "field", // field = 字段被谁用；system = 接口用了什么
  // 字段视角
  schema: null,
  table: null,
  fieldName: null,
  refSystem: null,
  refModule: null,
  // 接口视角
  system: null,
  module: null,
  entry: null,
};

function drillResetField() {
  drill.schema = null;
  drill.table = null;
  drill.fieldName = null;
  drill.refSystem = null;
  drill.refModule = null;
}

function drillResetSystem() {
  drill.system = null;
  drill.module = null;
  drill.entry = null;
  drill.schema = null;
  drill.table = null;
  drill.fieldName = null;
}

function drillSyncAppState() {
  state.perspective = drill.mode === "system" ? "system" : "field";
  state.systemTarget = {
    system: drill.system,
    module: drill.module,
    entry: drill.entry,
  };
  if (drill.schema && drill.table && drill.fieldName) {
    state.target = {
      schema: drill.schema,
      table: drill.table,
      field: drill.fieldName,
    };
  }
}

function drillHash() {
  if (drill.mode === "system") {
    const parts = ["chain", "s"];
    [drill.system, drill.module, drill.entry]
      .filter(Boolean)
      .forEach((x) => parts.push(encodeURIComponent(x)));
    return parts.join("/");
  }
  const parts = ["chain", "f"];
  [drill.schema, drill.table, drill.fieldName]
    .filter(Boolean)
    .forEach((x) => parts.push(encodeURIComponent(x)));
  return parts.join("/");
}

function drillApplyHash(raw) {
  if (raw.startsWith("chain/s")) {
    drill.mode = "system";
    drillResetSystem();
    const segs = raw.split("/").slice(2).map(decodeURIComponent);
    drill.system = segs[0] || null;
    drill.module = segs[1] || null;
    drill.entry = segs[2] || null;
    return true;
  }
  if (raw.startsWith("chain/f") || raw.startsWith("chain/field/")) {
    drill.mode = "field";
    drillResetField();
    const segs = raw.startsWith("chain/field/")
      ? raw.slice("chain/field/".length).split(".")
      : raw.split("/").slice(2).map(decodeURIComponent);
    if (raw.startsWith("chain/field/")) {
      drill.schema = segs[0] || null;
      drill.table = segs[1] || null;
      drill.fieldName = segs.slice(2).join(".") || null;
    } else {
      drill.schema = segs[0] || null;
      drill.table = segs[1] || null;
      drill.fieldName = segs[2] || null;
    }
    return true;
  }
  if (raw.startsWith("chain/system/")) {
    drill.mode = "system";
    drillResetSystem();
    const segs = raw.slice("chain/system/".length).split("/").map(decodeURIComponent);
    drill.system = segs[0] || null;
    drill.module = segs[1] || null;
    drill.entry = segs[2] || null;
    return true;
  }
  return false;
}

function drillGoto(patch) {
  Object.assign(drill, patch);
  drillSyncAppState();
  location.hash = drillHash();
  return renderChain();
}

function shortLabel(s, n = 36) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function openChain(schema, table, field) {
  drill.mode = "field";
  drill.schema = schema;
  drill.table = table;
  drill.fieldName = field || null;
  drill.refSystem = null;
  drill.refModule = null;
  drillSyncAppState();
  location.hash = drillHash();
  setView("chain");
  await renderChain();
}

async function openSystem(system, module = null, entry = null) {
  drill.mode = "system";
  drill.system = system;
  drill.module = module;
  drill.entry = entry;
  drillSyncAppState();
  location.hash = drillHash();
  setView("chain");
  await renderChain();
}

async function openSystemFromDefault() {
  drill.mode = "system";
  drillResetSystem();
  drillSyncAppState();
  location.hash = "chain/s";
  setView("chain");
  await renderChain();
}

async function openFieldFromDefault() {
  drill.mode = "field";
  drillResetField();
  drillSyncAppState();
  location.hash = "chain/f";
  setView("chain");
  await renderChain();
}

function pickList(title, items, { searchable = false } = {}) {
  const box = el("div", "pick-panel");
  const head = el("div", "pick-head");
  head.innerHTML = `<strong>${title}</strong><span class="muted">${items.length}</span>`;
  box.appendChild(head);
  let filtered = items;
  if (searchable && items.length > 8) {
    const inp = el("input");
    inp.placeholder = "筛选…";
    inp.className = "pick-filter";
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase();
      const rows = box.querySelectorAll(".pick-item");
      rows.forEach((r) => {
        r.style.display = !q || r.dataset.q.includes(q) ? "" : "none";
      });
    };
    box.appendChild(inp);
  }
  const list = el("div", "pick-list");
  if (!filtered.length) list.appendChild(el("div", "pick-empty muted", "暂无"));
  filtered.forEach((it) => {
    const b = el("button", `pick-item ${it.active ? "active" : ""}`);
    b.type = "button";
    b.dataset.q = (it.title + " " + (it.sub || "")).toLowerCase();
    b.innerHTML = `
      <div class="pick-title">${it.title}</div>
      ${it.sub ? `<div class="pick-sub muted">${it.sub}</div>` : ""}
      ${it.meta ? `<div class="pick-meta">${it.meta}</div>` : ""}`;
    b.onclick = it.onClick;
    list.appendChild(b);
  });
  box.appendChild(list);
  return box;
}

function splitCols(columns) {
  const wrap = el("div", "split-cols");
  columns.forEach((col) => {
    const waiting = !!col.waiting;
    const c = el("div", `split-col${waiting ? " waiting" : ""}`);
    const countLabel = waiting ? "—" : String(col.items.length);
    c.innerHTML = `<div class="split-col-head"><span>${col.title}</span><span class="muted">${countLabel}</span></div>`;
    const list = el("div", "split-list");
    if (!col.items.length) {
      list.appendChild(
        el("div", `split-empty muted${waiting ? " wait-hint" : ""}`, col.emptyHint || "无")
      );
    } else {
      col.items.forEach((it) => {
        const row = el("button", `split-row ${it.active ? "active" : ""} ${it.danger ? "danger" : ""}`);
        row.type = "button";
        row.innerHTML = `
          <div class="split-row-title">${it.title}</div>
          ${it.sub ? `<div class="split-row-sub muted">${it.sub}</div>` : ""}
          ${it.meta ? `<div class="split-row-meta">${it.meta}</div>` : ""}`;
        if (it.onClick) row.onclick = it.onClick;
        list.appendChild(row);
      });
    }
    c.appendChild(list);
    wrap.appendChild(c);
  });
  return wrap;
}

function renderUsageTree(systems) {
  const wrap = el("div", "usage-tree");
  if (!systems.length) {
    wrap.appendChild(el("div", "empty-hint", "当前范围无引用（零命中）。"));
    return wrap;
  }

  systems.forEach((s) => {
    const sysNode = el("div", "ut-node ut-system");
    const sysHead = el("button", "ut-row");
    sysHead.type = "button";
    sysHead.innerHTML = `
      <span class="ut-toggle" aria-hidden="true">▾</span>
      <span class="ut-kind">系统</span>
      <span class="ut-name">${escapeHtml(s.system)}</span>
      <span class="ut-meta">${badge(s.modules.length + " 模块")} ${badge(s.ref_count + " 引用", "warn")}</span>`;
    const sysBody = el("div", "ut-children");
    sysHead.onclick = () => {
      sysNode.classList.toggle("collapsed");
      sysHead.querySelector(".ut-toggle").textContent = sysNode.classList.contains("collapsed")
        ? "▸"
        : "▾";
    };

    (s.modules || []).forEach((m) => {
      const modNode = el("div", "ut-node ut-module");
      const modHead = el("button", "ut-row");
      modHead.type = "button";
      const entryCount = (m.entries || []).length;
      modHead.innerHTML = `
        <span class="ut-toggle" aria-hidden="true">▾</span>
        <span class="ut-kind">模块</span>
        <span class="ut-name">${escapeHtml(m.module)}</span>
        <span class="ut-meta">${badge(entryCount + " 接口")}</span>`;
      const modBody = el("div", "ut-children");
      modHead.onclick = () => {
        modNode.classList.toggle("collapsed");
        modHead.querySelector(".ut-toggle").textContent = modNode.classList.contains("collapsed")
          ? "▸"
          : "▾";
      };

      (m.entries || []).forEach((e) => {
        const entryRow = el(
          "button",
          `ut-row ut-entry${(e.ops || []).includes("UPDATE") ? " danger" : ""}`
        );
        entryRow.type = "button";
        entryRow.innerHTML = `
          <span class="ut-toggle ut-leaf" aria-hidden="true">·</span>
          <span class="ut-kind">接口</span>
          <span class="ut-name">${escapeHtml(shortLabel(e.entry_name, 64))}</span>
          <span class="ut-meta">${badge(e.entry_type || "入口", "core")} ${(e.ops || [])
            .map((o) => badge(o, o === "UPDATE" ? "danger" : ""))
            .join(" ")}</span>`;
        entryRow.onclick = () => openSystem(s.system, m.module, e.entry_name);
        modBody.appendChild(entryRow);
      });

      if (!entryCount) {
        modBody.appendChild(el("div", "ut-empty muted", "无接口"));
      }

      modNode.append(modHead, modBody);
      sysBody.appendChild(modNode);
    });

    if (!(s.modules || []).length) {
      sysBody.appendChild(el("div", "ut-empty muted", "无模块"));
    }

    sysNode.append(sysHead, sysBody);
    wrap.appendChild(sysNode);
  });

  return wrap;
}

async function renderChain() {
  const root = $("#view-chain");
  root.innerHTML = "";

  const shell = el("div", "explore-shell");

  // 两个问题入口，不用「正/反向」
  const tabs = el("div", "q-tabs");
  tabs.innerHTML = `
    <button type="button" class="q-tab ${drill.mode === "field" ? "active" : ""}" data-m="field">
      <span class="q-tab-kicker">问题一</span>
      <span class="q-tab-title">字段被谁用</span>
      <span class="q-tab-desc">选表 → 看每个字段被哪些系统 / 模块 / 接口引用</span>
    </button>
    <button type="button" class="q-tab ${drill.mode === "system" ? "active" : ""}" data-m="system">
      <span class="q-tab-kicker">问题二</span>
      <span class="q-tab-title">接口用了什么</span>
      <span class="q-tab-desc">选系统 / 模块 / 接口 → 一眼看库 · 表 · 字段</span>
    </button>`;
  tabs.querySelectorAll(".q-tab").forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.m === drill.mode) return;
      if (b.dataset.m === "field") {
        drill.mode = "field";
        drillResetField();
        location.hash = "chain/f";
      } else {
        drill.mode = "system";
        drillResetSystem();
        location.hash = "chain/s";
      }
      drillSyncAppState();
      await renderChain();
    };
  });
  shell.appendChild(tabs);

  const body = el("div", "explore-body");
  shell.appendChild(body);
  root.appendChild(shell);

  if (drill.mode === "field") await renderFieldUsage(body);
  else await renderInterfaceUsage(body);
}

/** 问题一：表 → 字段清单（含引用摘要）→ 点字段看 系统|模块|接口 */
async function renderFieldUsage(body) {
  const left = el("div", "explore-left");
  const right = el("div", "explore-right");
  body.append(left, right);

  // 左：库 + 表
  const objects = await api("/api/objects");
  const allFields = await api("/api/fields");
  const schemas = [...new Set([...objects.map((o) => o.schema_name), ...allFields.map((f) => f.schema_name)])].sort();

  left.appendChild(
    pickList(
      "数据库",
      schemas.map((s) => ({
        title: s,
        sub: `${objects.filter((o) => o.schema_name === s).length} 表`,
        active: drill.schema === s,
        onClick: () =>
          drillGoto({
            schema: s,
            table: null,
            fieldName: null,
            refSystem: null,
            refModule: null,
          }),
      }))
    )
  );

  if (!drill.schema) {
    right.appendChild(el("div", "explore-placeholder", "先选左侧数据库，再选表。选中表后，右侧列出该表全部字段及引用情况。"));
    return;
  }

  const tables = [
    ...new Set([
      ...objects.filter((o) => o.schema_name === drill.schema).map((o) => o.object_name),
      ...allFields.filter((f) => f.schema_name === drill.schema).map((f) => f.table_name),
    ]),
  ].sort();

  left.appendChild(
    pickList(
      "表",
      tables.map((t) => {
        const fc = allFields.filter((f) => f.schema_name === drill.schema && f.table_name === t).length;
        return {
          title: t,
          sub: `${fc} 字段`,
          active: drill.table === t,
          onClick: () =>
            drillGoto({
              table: t,
              fieldName: null,
              refSystem: null,
              refModule: null,
            }),
        };
      }),
      { searchable: true }
    )
  );

  if (!drill.table) {
    right.appendChild(el("div", "explore-placeholder", "选择一张表，查看表内字段被谁引用。"));
    return;
  }

  const fields = allFields.filter(
    (f) => f.schema_name === drill.schema && f.table_name === drill.table
  );

  const head = el("div", "explore-right-head");
  head.innerHTML = `<h2 class="mono">${drill.schema}.${drill.table}</h2>
    <p class="muted">共 ${fields.length} 个字段 · 点字段查看引用树（系统 → 模块 → 接口）</p>`;
  right.appendChild(head);

  const tableWrap = el("div", "usage-table-wrap");
  const table = el("table", "usage-table");
  table.innerHTML = `<thead><tr>
    <th>字段</th><th>说明</th><th>引用</th><th>系统</th><th>入口</th><th>操作</th>
  </tr></thead>`;
  const tb = el("tbody");
  fields.forEach((f) => {
    const tr = el("tr", `usage-row ${drill.fieldName === f.field_name ? "active" : ""}`);
    tr.innerHTML = `
      <td class="mono">${f.field_name}</td>
      <td class="muted">${f.field_comment || f.field_category || "—"}</td>
      <td>${f.source_ref_count}</td>
      <td>${f.ref_system_count}</td>
      <td>${f.ref_entry_count}</td>
      <td class="mono">${f.ref_ops || "—"}</td>`;
    tr.onclick = () =>
      drillGoto({
        fieldName: f.field_name,
        refSystem: null,
        refModule: null,
      });
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  tableWrap.appendChild(table);
  right.appendChild(tableWrap);

  if (!drill.fieldName) return;

  // 下方分栏：该字段的调用方
  const chain = await api(
    `/api/lineage/chain?${new URLSearchParams({
      schema: drill.schema,
      table: drill.table,
      field: drill.fieldName,
    })}`
  );

  const detail = el("div", "usage-detail");
  const systems = chain.tree || [];
  detail.innerHTML = `<div class="usage-detail-head">
    <strong class="mono">${chain.target}</strong>
    <span class="muted">${chain.narrative || "该字段的引用关系（系统嵌套模块，模块嵌套接口）"}</span>
  </div>`;
  detail.appendChild(renderUsageTree(systems));
  right.appendChild(detail);
}

/** 问题二：系统 → 模块 → 接口 → 库|表|字段 */
async function renderInterfaceUsage(body) {
  const left = el("div", "explore-left");
  const right = el("div", "explore-right");
  body.append(left, right);

  const sysData = await api("/api/lineage/systems");
  left.appendChild(
    pickList(
      "系统",
      sysData.systems.map((s) => ({
        title: s.system_name,
        sub: s.duty_summary || "—",
        meta: `${badge(s.entry_count + " 接口")} ${badge(s.field_count + " 字段", "warn")}`,
        active: drill.system === s.system_name,
        onClick: () =>
          drillGoto({
            system: s.system_name,
            module: null,
            entry: null,
          }),
      }))
    )
  );

  if (!drill.system) {
    right.appendChild(el("div", "explore-placeholder", "先选系统，再选模块和接口。选中接口后，右侧分栏展示库 · 表 · 字段。"));
    return;
  }

  const params = new URLSearchParams({ system: drill.system });
  if (drill.module) params.set("module", drill.module);
  if (drill.entry) params.set("entry", drill.entry);
  const data = await api(`/api/lineage/from-system?${params}`);

  left.appendChild(
    pickList(
      "模块",
      data.tree.map((m) => ({
        title: m.module,
        sub: `${m.entries.length} 接口`,
        active: drill.module === m.module,
        onClick: () =>
          drillGoto({
            module: m.module,
            entry: null,
          }),
      }))
    )
  );

  if (!drill.module) {
    // 系统级汇总：一眼看该系统碰到的全部字段
    right.appendChild(
      el(
        "div",
        "explore-right-head",
        `<h2>${drill.system}</h2><p class="muted">未选模块时，显示本系统全部触达字段；选模块 / 接口可缩小范围</p>`
      )
    );
    right.appendChild(renderFieldSurface(data.field_surface || [], data.summary));
    return;
  }

  const mod = data.tree.find((m) => m.module === drill.module);
  left.appendChild(
    pickList(
      "接口",
      (mod?.entries || []).map((e) => ({
        title: e.entry_name,
        sub: e.entry_type,
        meta: badge(e.field_count + " 字段", "warn"),
        active: drill.entry === e.entry_name,
        onClick: () => drillGoto({ entry: e.entry_name }),
      })),
      { searchable: true }
    )
  );

  if (!drill.entry) {
    right.appendChild(
      el(
        "div",
        "explore-right-head",
        `<h2>${drill.system} / ${drill.module}</h2><p class="muted">模块汇总触达；点左侧接口可看单接口明细</p>`
      )
    );
    right.appendChild(renderFieldSurface(data.field_surface || [], data.summary));
    return;
  }

  // 接口明细：三栏 库|表|字段
  const entr = (mod?.entries || []).find((e) => e.entry_name === drill.entry);
  const databases = entr?.databases || [];
  const allTables = [];
  databases.forEach((d) => {
    d.tables.forEach((t) => {
      allTables.push({
        schema_name: d.schema_name,
        table_name: t.table_name,
        full_table: t.full_table,
        fields: t.fields,
      });
    });
  });

  const tablesShown = drill.schema
    ? allTables.filter((t) => t.schema_name === drill.schema)
    : allTables;

  let fieldsShown = [];
  (drill.table
    ? tablesShown.filter((t) => t.table_name === drill.table)
    : tablesShown
  ).forEach((t) => {
    t.fields.forEach((f) => {
      fieldsShown.push({ ...f, schema_name: t.schema_name, table_name: t.table_name });
    });
  });

  right.appendChild(
    el(
      "div",
      "explore-right-head",
      `<h2 class="mono">${escapeHtml(shortLabel(drill.entry, 60))}</h2>
       <p class="muted">${drill.system} / ${drill.module}</p>`
    )
  );

  right.appendChild(
    splitCols([
      {
        title: "数据库",
        items: databases.map((d) => ({
          title: d.schema_name,
          sub: `${d.tables.length} 表`,
          meta: badge(d.tables.reduce((n, t) => n + t.fields.length, 0) + " 字段", "warn"),
          active: drill.schema === d.schema_name,
          onClick: () =>
            drillGoto({
              schema: drill.schema === d.schema_name ? null : d.schema_name,
              table: null,
              fieldName: null,
            }),
        })),
      },
      {
        title: "表",
        items: tablesShown.map((t) => ({
          title: t.table_name,
          sub: t.full_table,
          meta: badge(t.fields.length + " 字段", "warn"),
          active: drill.table === t.table_name,
          onClick: () => {
            const same = drill.table === t.table_name && drill.schema === t.schema_name;
            drillGoto({
              schema: t.schema_name,
              table: same ? null : t.table_name,
              fieldName: null,
            });
          },
        })),
      },
      {
        title: "字段",
        items: fieldsShown.map((f) => ({
          title: f.field_name,
          sub: `${f.schema_name}.${f.table_name}`,
          meta: (f.ops || []).map((o) => badge(o, o === "UPDATE" ? "danger" : "core")).join(" "),
          danger: (f.ops || []).includes("UPDATE"),
          onClick: () => openChain(f.schema_name, f.table_name, f.field_name),
        })),
      },
    ])
  );

  if (!databases.length) {
    right.appendChild(el("div", "empty-hint", "该接口无字段级库访问记录。"));
  }
}

function renderFieldSurface(surface, summary) {
  const wrap = el("div", "surface-wrap");
  if (summary) {
    wrap.appendChild(
      el(
        "div",
        "surface-summary",
        `${badge((summary.schema_count || 0) + " 库")} ${badge((summary.table_count || 0) + " 表")} ${badge(
          (summary.field_count || 0) + " 字段",
          "warn"
        )} ${badge((summary.ref_count || 0) + " 引用")}`
      )
    );
  }
  const table = el("table", "usage-table");
  table.innerHTML = `<thead><tr><th>字段</th><th>操作</th><th>模块数</th><th>入口数</th><th></th></tr></thead>`;
  const tb = el("tbody");
  (surface || []).forEach((f) => {
    const tr = el("tr", "usage-row");
    tr.innerHTML = `
      <td class="mono">${f.full_name}</td>
      <td>${(f.ops || []).map((o) => badge(o, o === "UPDATE" ? "danger" : "core")).join(" ")}</td>
      <td>${f.module_count}</td>
      <td>${f.entry_count}</td>
      <td><button type="button" class="btn ghost btn-sm">看谁在用</button></td>`;
    tr.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      openChain(f.schema_name, f.table_name, f.field_name);
    };
    tr.onclick = () => openChain(f.schema_name, f.table_name, f.field_name);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  const tw = el("div", "usage-table-wrap");
  tw.appendChild(table);
  wrap.appendChild(tw);
  if (!(surface || []).length) wrap.appendChild(el("div", "empty-hint", "无触达字段"));
  return wrap;
}

// 兼容旧调用名
function drillSyncAppStateSafe() {
  if (typeof drillSyncAppState === "function") drillSyncAppState();
}
function drillHashSafe() {
  return typeof drillHash === "function" ? drillHash() : "chain";
}
