/* Pure data operations, shared by the plugin and the automated tests. */
(function (root) {
  "use strict";
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const tagCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  function compareTags(a, b) { return tagCollator.compare(a, b) || String(a).localeCompare(String(b)); }
  function parseTags(text) {
    return [...new Set(String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
  }
  // Complete phrases and conservative English noun inflections, without
  // fuzzy matching, synonyms or semantic inference from the title.
  const irregularPlurals = new Map(Object.entries({ analyses: "analysis", syntheses: "synthesis",
    hypotheses: "hypothesis", theses: "thesis", crises: "crisis", indices: "index", matrices: "matrix",
    vertices: "vertex", oxen: "ox", children: "child", men: "man", women: "woman", mice: "mouse",
    teeth: "tooth", feet: "foot", people: "person", phenomena: "phenomenon", criteria: "criterion",
    gases: "gas", buses: "bus", statuses: "status", lenses: "lens" }));
  const invariantWords = new Set(["series", "species", "news", "physics", "mathematics", "electronics",
    "kinetics", "thermodynamics", "economics", "ethics", "gas", "lens"]);
  function matchWord(word) {
    if (!/^[a-z]{3,}$/.test(word) || invariantWords.has(word)) return word;
    if (irregularPlurals.has(word)) return irregularPlurals.get(word);
    if (/[^aeiou]ies$/.test(word)) return word.slice(0, -3) + "y";
    if (/(ches|shes|sses|xes|zzes)$/.test(word)) return word.slice(0, -2);
    if (/s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
    return word;
  }
  function titleTokens(value) {
    return (String(value || "").normalize("NFKC").toLowerCase()
      .match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+|[+#]/gu) || []).map(matchWord);
  }
  function compileTagMatcher(tags) {
    const phrases = [...new Set(tags)].map(tag => ({ tag, words: titleTokens(tag) })).filter(p => p.words.length);
    return title => {
      const words = titleTokens(title);
      return phrases.filter(p => words.some((word, start) => word === p.words[0] &&
        p.words.every((part, offset) => words[start + offset] === part))).map(p => p.tag);
    };
  }
  function filter(records, state, groupTags = []) {
    const tags = state.tags || [];
    const words = String(state.query || "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return records.filter(record => {
      const names = new Set(record.tags.map(t => t.tag));
      if (state.groupID && !groupTags.some(t => names.has(t))) return false;
      if (state.untagged && names.size) return false;
      if (tags.length && !(state.mode === "any"
        ? tags.some(t => names.has(t)) : tags.every(t => names.has(t)))) return false;
      if (words.length) {
        const text = [record.titleText ?? record.title, record.creator, record.year, ...names].join(" ").toLocaleLowerCase();
        if (!words.every(word => text.includes(word))) return false;
      }
      return true;
    });
  }
  function facets(records, manualOnly = false) {
    const counts = new Map();
    for (const record of records) {
      const names = new Set(record.tags.filter(t => !manualOnly || !t.type).map(t => t.tag));
      for (const tag of names) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => compareTags(a.tag, b.tag));
  }
  function sorted(records, order = "title") {
    return [...records].sort((a, b) => {
      let n = order === "year" ? collator.compare(b.year, a.year)
        : order === "added" ? b.id - a.id : collator.compare(a.titleText ?? a.title, b.titleText ?? b.title);
      return n || collator.compare(a.titleText ?? a.title, b.titleText ?? b.title) || a.id - b.id;
    });
  }
  function tagType(tags, name) {
    const value = tags.find(t => t.tag === name);
    return value ? Number(value.type || 0) : null;
  }
  function planChange(tags, names, action) {
    const result = tags.map(t => ({ ...t }));
    const changes = [];
    for (const name of names) {
      const before = tagType(result, name);
      if (action === "add" && before === null) {
        result.push({ tag: name, type: 0 });
        changes.push({ name, before: null, after: 0 });
      } else if (action === "remove" && before !== null) {
        result.splice(result.findIndex(t => t.tag === name), 1);
        changes.push({ name, before, after: null });
      }
    }
    return { tags: result, changes };
  }
  function planUndo(tags, changes) {
    const result = tags.map(t => ({ ...t }));
    for (const change of changes) {
      if (tagType(result, change.name) !== change.after) {
        throw new Error(`标签「${change.name}」已被其他操作修改，无法安全撤销。`);
      }
      const index = result.findIndex(t => t.tag === change.name);
      if (index >= 0) result.splice(index, 1);
      if (change.before !== null) result.push({ tag: change.name, type: change.before });
    }
    return result;
  }
  function normalizeState(value) {
    return {
      tags: [...new Set((Array.isArray(value?.tags) ? value.tags : []).filter(t => typeof t === "string"))],
      mode: value?.mode === "any" ? "any" : "all",
      query: typeof value?.query === "string" ? value.query : "",
      untagged: !!value?.untagged,
      groupID: typeof value?.groupID === "string" && value.groupID ? value.groupID : null
    };
  }
  function reconcileState(value, records) {
    const state = normalizeState(value);
    const available = new Set(records.flatMap(r => r.tags.map(t => t.tag)));
    const removed = state.tags.filter(tag => !available.has(tag));
    state.tags = state.tags.filter(tag => available.has(tag));
    return { state, removed };
  }
  function selectTag(value, tag, additive = false) {
    const state = normalizeState(value);
    state.untagged = false;
    if (!additive) { state.tags = [tag]; state.groupID = null; }
    else state.tags = state.tags.includes(tag) ? state.tags.filter(t => t !== tag) : [...state.tags, tag];
    return state;
  }
  // Stored nodes are flat for safe moves and stable IDs; rendering supplies the tree.
  function normalizeGroups(value) {
    const nodes = [];
    const seen = new Set();
    for (const raw of Array.isArray(value) ? value : []) {
      if (!raw || typeof raw.id !== "string" || !raw.id || seen.has(raw.id) ||
        typeof raw.name !== "string" || !raw.name.trim()) continue;
      seen.add(raw.id);
      nodes.push({ id: raw.id, name: raw.name.trim(), parentID: typeof raw.parentID === "string" ? raw.parentID : null,
        tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).filter(t => typeof t === "string" && t))],
        collapsed: !!raw.collapsed });
    }
    const byID = new Map(nodes.map(n => [n.id, n]));
    for (const node of nodes) {
      if (!byID.has(node.parentID)) node.parentID = null;
      const chain = new Set([node.id]);
      let current = byID.get(node.parentID);
      while (current) {
        if (chain.has(current.id)) { node.parentID = null; break; }
        chain.add(current.id); current = byID.get(current.parentID);
      }
    }
    return nodes;
  }
  function descendants(nodes, id) {
    const ids = new Set([id]);
    const pending = [id];
    while (pending.length) {
      const parent = pending.pop();
      for (const node of nodes) if (node.parentID === parent && !ids.has(node.id)) {
        ids.add(node.id); pending.push(node.id);
      }
    }
    return ids;
  }
  function groupTags(nodes, id) {
    const ids = descendants(nodes, id);
    return [...new Set(nodes.filter(n => ids.has(n.id)).flatMap(n => n.tags))];
  }
  function groupPath(nodes, id) {
    const byID = new Map(nodes.map(n => [n.id, n]));
    const parts = [], seen = new Set();
    let node = byID.get(id);
    while (node && !seen.has(node.id)) {
      parts.unshift(node.name); seen.add(node.id); node = byID.get(node.parentID);
    }
    return parts.join(" / ");
  }
  function upsertGroup(nodes, change) {
    nodes = normalizeGroups(nodes);
    if (typeof change.id !== "string" || !change.id) throw new Error("分组标识无效。");
    const name = String(change.name || "").trim();
    if (!name || name.length > 80) throw new Error("分组名称需为 1–80 个字符。");
    const parentID = change.parentID || null;
    if (parentID && !nodes.some(n => n.id === parentID)) throw new Error("父分组已不存在。");
    if (parentID && descendants(nodes, change.id).has(parentID)) throw new Error("不能将分组移入自身或其子分组。");
    if (nodes.some(n => n.id !== change.id && n.parentID === parentID && n.name === name)) throw new Error("同一层级已有同名分组。");
    const old = nodes.find(n => n.id === change.id);
    const updated = { id: change.id, name, parentID,
      tags: [...new Set((change.tags || []).filter(t => typeof t === "string" && t))], collapsed: old?.collapsed || false };
    if (old) nodes[nodes.indexOf(old)] = updated; else nodes.push(updated);
    return nodes;
  }
  function removeGroup(nodes, id) {
    const ids = descendants(nodes, id);
    return nodes.filter(n => !ids.has(n.id));
  }
  function reorderGroup(nodes, id, targetID, after = false) {
    nodes = normalizeGroups(nodes);
    const source = nodes.find(n => n.id === id), target = nodes.find(n => n.id === targetID);
    if (!source || !target) throw new Error("分组已变化，请重新拖动。");
    if (source.parentID !== target.parentID) throw new Error("请在同一层级内调整顺序；更换父组可使用分组编辑器。");
    if (id === targetID) return nodes;
    const siblings = nodes.filter(n => n.parentID === source.parentID && n.id !== id);
    siblings.splice(siblings.findIndex(n => n.id === targetID) + (after ? 1 : 0), 0, source);
    let index = 0;
    return nodes.map(n => n.parentID === source.parentID ? siblings[index++] : n);
  }
  root.TagWorkspaceCore = { parseTags, compileTagMatcher, filter, facets, sorted, tagType, planChange, planUndo, normalizeState,
    reconcileState, selectTag, normalizeGroups, descendants, groupTags, groupPath, upsertGroup, removeGroup, reorderGroup, compareTags };
  if (typeof module !== "undefined") module.exports = root.TagWorkspaceCore;
})(globalThis);
