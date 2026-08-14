(() => {
  "use strict";

  const EXTENSION_ID = "todo-grouper-toolbar";
  const STORAGE_KEY = "todoGrouperMode";
  const VALID_MODES = new Set(["none", "project", "person", "type"]);

  const MODE_CONFIG = {
    project: {
      symbol: "$",
      label: "Project",
      unassigned: "No Project"
    },
    person: {
      symbol: "@",
      label: "Person",
      unassigned: "No Person"
    },
    type: {
      symbol: "!",
      label: "Task Type",
      unassigned: "No Task Type"
    }
  };

  let groupMode = "none";
  let observer = null;
  let scheduled = false;
  const collapsedGroups = new Set();

  function normalizeWhitespace(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  /*
    Tag format:
      Task description $Project Name @Person Name !Task Type

    Tags should be placed at the END of the task title.
    A tag's value continues until the next $, @, or ! tag, or the end.

    Example:
      Send ROM estimate $Montreal West @Brent !Email
  */
  function parseTags(title) {
    const result = {
      project: [],
      person: [],
      type: []
    };

    // A designator must begin at the start of the title or after whitespace.
    // The value runs until the next whitespace + designator, or end of title.
    const tagRegex = /(?:^|\s)([$@!])\s*([^$@!]+?)(?=\s+[$@!]\s*|$)/g;

    let match;
    while ((match = tagRegex.exec(title)) !== null) {
      const symbol = match[1];
      const value = normalizeWhitespace(match[2]);
      if (!value) continue;

      if (symbol === "$") result.project.push(value);
      if (symbol === "@") result.person.push(value);
      if (symbol === "!") result.type.push(value);
    }

    return result;
  }

  function getTaskTitle(taskItem) {
    const titleEl = taskItem.querySelector(".taskItem-title");
    return titleEl ? normalizeWhitespace(titleEl.textContent) : "";
  }

  function getTaskWrapper(taskItem) {
    // In the current To Do DOM, .taskItem is wrapped by a plain DIV
    // that is a direct child of .slice.componentList.
    const parent = taskItem.parentElement;
    if (parent && parent.parentElement?.matches(".slice.componentList")) {
      return parent;
    }

    // Fallback in case Microsoft changes the wrapper structure.
    return taskItem;
  }

  function groupForTask(taskItem, mode) {
    const title = getTaskTitle(taskItem);
    const tags = parseTags(title);
    const values = tags[mode] || [];

    if (!values.length) {
      return MODE_CONFIG[mode].unassigned;
    }

    // If a task has more than one tag of the same kind, keep it in a
    // combined group rather than duplicating the native To Do row.
    return values.join(", ");
  }

  function sortGroupNames(groupNames, unassignedName) {
    return [...groupNames].sort((a, b) => {
      if (a === unassignedName && b !== unassignedName) return 1;
      if (b === unassignedName && a !== unassignedName) return -1;
      return a.localeCompare(b, undefined, {
        sensitivity: "base",
        numeric: true
      });
    });
  }

  function restoreNativeLayout() {
    document.querySelectorAll(".todo-grouper-header").forEach((el) => el.remove());

    document.querySelectorAll(".todo-grouper-active").forEach((slice) => {
      slice.classList.remove("todo-grouper-active");
    });

    document.querySelectorAll(".todo-grouper-native-header-hidden").forEach((el) => {
      el.classList.remove("todo-grouper-native-header-hidden");
    });

    document.querySelectorAll("[data-todo-grouper-task='true']").forEach((wrapper) => {
      wrapper.style.removeProperty("order");
      wrapper.style.removeProperty("display");
      wrapper.removeAttribute("data-todo-grouper-task");
      wrapper.removeAttribute("data-todo-grouper-group");
    });
  }

  function makeGroupHeader(mode, groupName, count, order) {
    const config = MODE_CONFIG[mode];
    const key = `${mode}::${groupName}`;
    const collapsed = collapsedGroups.has(key);

    const header = document.createElement("div");
    header.className = "todo-grouper-header";
    header.style.order = String(order);
    header.dataset.todoGrouperGroup = groupName;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "todo-grouper-header-button";
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    button.title = collapsed ? `Expand ${groupName}` : `Collapse ${groupName}`;

    const chevron = document.createElement("span");
    chevron.className = "todo-grouper-chevron";
    chevron.textContent = collapsed ? "›" : "⌄";

    const symbol = document.createElement("span");
    symbol.className = `todo-grouper-symbol todo-grouper-symbol-${mode}`;
    symbol.textContent = config.symbol;

    const label = document.createElement("span");
    label.className = "todo-grouper-group-name";
    label.textContent = groupName;

    const badge = document.createElement("span");
    badge.className = "todo-grouper-count";
    badge.textContent = String(count);

    button.append(chevron, symbol, label, badge);

    button.addEventListener("click", () => {
      if (collapsedGroups.has(key)) {
        collapsedGroups.delete(key);
      } else {
        collapsedGroups.add(key);
      }
      scheduleApply();
    });

    header.appendChild(button);
    return header;
  }

  function groupSlice(slice, mode) {
    const config = MODE_CONFIG[mode];

    // Hide Microsoft's native card headings (for example "Flagged email"
    // and "Tasks") only while our grouping view is active.
    for (const child of [...slice.children]) {
      if (child.matches(".taskCard")) {
        child.classList.add("todo-grouper-native-header-hidden");
      }
    }

    const taskRecords = [];

    for (const taskItem of slice.querySelectorAll(".taskItem")) {
      const wrapper = getTaskWrapper(taskItem);

      // Only operate on rows that belong to this slice.
      if (wrapper.parentElement !== slice) continue;

      const title = getTaskTitle(taskItem);
      if (!title) continue;

      const groupName = groupForTask(taskItem, mode);

      taskRecords.push({
        taskItem,
        wrapper,
        title,
        groupName
      });
    }

    if (!taskRecords.length) return;

    slice.classList.add("todo-grouper-active");

    const grouped = new Map();

    for (const record of taskRecords) {
      if (!grouped.has(record.groupName)) {
        grouped.set(record.groupName, []);
      }
      grouped.get(record.groupName).push(record);
    }

    const groupNames = sortGroupNames(grouped.keys(), config.unassigned);

    groupNames.forEach((groupName, groupIndex) => {
      const records = grouped.get(groupName);
      const baseOrder = groupIndex * 10000;

      const header = makeGroupHeader(
        mode,
        groupName,
        records.length,
        baseOrder
      );

      slice.appendChild(header);

      const key = `${mode}::${groupName}`;
      const collapsed = collapsedGroups.has(key);

      records.forEach((record, taskIndex) => {
        record.wrapper.dataset.todoGrouperTask = "true";
        record.wrapper.dataset.todoGrouperGroup = groupName;
        record.wrapper.style.order = String(baseOrder + taskIndex + 1);
        record.wrapper.style.display = collapsed ? "none" : "";
      });
    });
  }

  function applyGrouping() {
    scheduled = false;

    if (!document.querySelector(".tasks")) return;

    // Prevent our own DOM changes from immediately triggering another pass.
    observer?.disconnect();

    try {
      restoreNativeLayout();

      if (groupMode !== "none") {
        const slices = document.querySelectorAll(
          ".tasks .slice.componentList"
        );

        slices.forEach((slice) => groupSlice(slice, groupMode));
      }

      updateToolbarState();
    } finally {
      startObserving();
    }
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      window.setTimeout(applyGrouping, 40);
    });
  }

  function updateToolbarState() {
    const select = document.querySelector("#todo-grouper-select");
    if (select && select.value !== groupMode) {
      select.value = groupMode;
    }

    const status = document.querySelector("#todo-grouper-status");
    if (status) {
      if (groupMode === "none") {
        status.textContent = "Microsoft default";
      } else {
        const config = MODE_CONFIG[groupMode];
        status.textContent = `Grouped by ${config.symbol}${config.label}`;
      }
    }
  }

  function createToolbar() {
    if (document.getElementById(EXTENSION_ID)) return;

    const toolbar = document.createElement("aside");
    toolbar.id = EXTENSION_ID;
    toolbar.setAttribute("aria-label", "Microsoft To Do Grouper");

    const top = document.createElement("div");
    top.className = "todo-grouper-toolbar-top";

    const title = document.createElement("strong");
    title.className = "todo-grouper-toolbar-title";
    title.textContent = "Group tasks";

    const select = document.createElement("select");
    select.id = "todo-grouper-select";
    select.setAttribute("aria-label", "Group Microsoft To Do tasks");

    [
      ["none", "Microsoft default"],
      ["project", "$ Project"],
      ["person", "@ Person"],
      ["type", "! Task Type"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });

    select.value = groupMode;

    select.addEventListener("change", () => {
      const nextMode = VALID_MODES.has(select.value) ? select.value : "none";
      groupMode = nextMode;

      chrome.storage.local.set({
        [STORAGE_KEY]: groupMode
      });

      scheduleApply();
    });

    const status = document.createElement("span");
    status.id = "todo-grouper-status";

    const help = document.createElement("div");
    help.className = "todo-grouper-help";
    help.textContent = "Put tags at the end:  $Project  @Person  !Type";

    top.append(title, select);
    toolbar.append(top, status, help);

    document.body.appendChild(toolbar);
  }

  function startObserving() {
    if (!observer) {
      observer = new MutationObserver((mutations) => {
        // Ignore mutations that occur entirely inside our toolbar.
        const onlyToolbar = mutations.every((mutation) => {
          const target =
            mutation.target.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target.parentElement;

          return target?.closest?.(`#${EXTENSION_ID}`);
        });

        if (!onlyToolbar) {
          scheduleApply();
        }
      });
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    chrome.storage.local.get(
      {
        [STORAGE_KEY]: "none"
      },
      (stored) => {
        const saved = stored[STORAGE_KEY];
        groupMode = VALID_MODES.has(saved) ? saved : "none";

        createToolbar();
        startObserving();
        scheduleApply();
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
