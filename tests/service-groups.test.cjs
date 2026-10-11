const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/core.js');
const Service = vm.runInNewContext(fs.readFileSync(require.resolve('../src/service.js'), 'utf8') + '\nTagWorkspaceService;');
function setup() {
  const prefs = new Map(); let serial = 0;
  const z = {
    Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) },
    Libraries: { get: id => [1, 2].includes(id) ? { libraryID: id } : null },
    Utilities: { randomString: () => `g${++serial}` }, logError() {}
  };
  return { service: new Service(z, core), z, prefs };
}

test('failed native rename leaves group and preset references untouched and releases the write lock', async () => {
  const { service, z, prefs } = setup();
  z.Libraries.get = id => ({libraryID:id,editable:true});
  service.saveGroup(1,{name:'Group',tags:['Old']});
  service.savePreset('Preset',1,{tags:['Old']});
  const before=JSON.stringify([...prefs]); let calls=0;
  z.Tags={getID:name=>name==='Old'?1:false,getTagItems:async()=>[5],rename:async()=>{calls++;throw new Error('Native failure');}};
  await assert.rejects(service.renameTag(1,'Old','New'),/Native failure/);
  assert.equal(calls,1); assert.equal(JSON.stringify([...prefs]),before); assert.equal(service.pending,null);
});
test('readonly libraries and unconfirmed merges cannot rename native tags', async () => {
  const { service,z } = setup(); let calls=0;
  z.Tags={getID:()=>1,getTagItems:async()=>[1],rename:async()=>{calls++;}};
  z.Libraries.get = id => ({libraryID:id,editable:false});
  await assert.rejects(service.renameTag(1,'Old','New'),/只读/);
  z.Libraries.get = id => ({libraryID:id,editable:true});
  await assert.rejects(service.renameTag(1,'Old','New'),error=>error.code==='TAG_MERGE_REQUIRED');
  assert.equal(calls,0); assert.equal(service.pending,null);
});

test('reordered groups persist without changing their identities or descendants', () => {
  const { service, z } = setup();
  const a = service.saveGroup(1, { name: 'A', tags: ['T'] });
  const child = service.saveGroup(1, { name: 'Child', parentID: a, tags: ['C'] });
  const b = service.saveGroup(1, { name: 'B', tags: ['B'] });
  service.reorderGroup(1, b, a);
  const saved = new Service(z, core).readGroups(1);
  assert.deepEqual(saved.filter(n => !n.parentID).map(n => n.id), [b, a]);
  assert.equal(saved.find(n => n.id === child).parentID, a);
});
test('random pastel tag colors persist per library and handle unusual tag names', () => {
  const { service, z, prefs } = setup();
  for (const tag of ['Alpha', '__proto__', '<sub>']) {
    const color = service.tagColor(1, tag);
    assert.match(color, /^hsl\(\d+, 65%, 91%\)$/);
    assert.equal(new Service(z, core).tagColor(1, tag), color);
  }
  service.tagColor(2, 'Alpha');
  assert.ok(prefs.has('tagWorkspace.tagColors.v1.1'));
  assert.ok(prefs.has('tagWorkspace.tagColors.v1.2'));
});
test('preset colors persist per library, allow readonly appearance changes and restore the original automatic color', () => {
  const { service, z } = setup();
  for (const tag of ['Battery', '__proto__']) {
    const automatic = service.tagColor(1, tag);
    service.setTagColor(1, tag, 'blue');
    const reopened = new Service(z, core);
    assert.equal(reopened.tagColor(1, tag), '#CAD8F0');
    assert.equal(reopened.tagColorChoice(1, tag), 'blue');
    assert.equal(reopened.tagColorChoice(2, tag), null);
    reopened.setTagColor(1, tag, null);
    assert.equal(new Service(z, core).tagColor(1, tag), automatic);
  }
});
test('only supplied color choices can be saved and black labels stay readable on every preset', () => {
  const { service, prefs } = setup();
  service.setTagColor(1, 'Battery', 'mint');
  const before = JSON.stringify([...prefs]);
  for (const choice of ['#000000', 'red', 'url(example)', '', undefined]) {
    assert.throws(() => service.setTagColor(1, 'Battery', choice));
    assert.equal(JSON.stringify([...prefs]), before);
  }
  for (const {color} of service.colorPalette) {
    const rgb = color.slice(1).match(/../g).map(c => parseInt(c,16)/255)
      .map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
    const luminance = rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
    assert.ok((luminance+.05)/.05 >= 7, color + ' has strong black-text contrast');
  }
});
test('group storage isolates library namespaces and survives a new service instance', () => {
  const { service, z } = setup();
  service.saveGroup(1, { name: '电池', tags: ['同名标签'] });
  service.saveGroup(2, { name: '计算', tags: ['同名标签'] });
  const reopened = new Service(z, core);
  assert.deepEqual(reopened.readGroups(1).map(g => g.name), ['电池']);
  assert.deepEqual(reopened.readGroups(2).map(g => g.name), ['计算']);
});
test('group-only edits never need native item writes and do not touch legacy presets', () => {
  const { service, prefs } = setup();
  prefs.set('tagWorkspace.presets.v1', '[{"name":"old"}]');
  const id = service.saveGroup(1, { name: 'A', tags: ['标签'] });
  service.toggleGroup(1, id);
  assert.equal(service.readGroups(1)[0].collapsed, true);
  service.deleteGroup(1, id);
  assert.deepEqual(service.readGroups(1), []);
  assert.equal(prefs.get('tagWorkspace.presets.v1'), '[{"name":"old"}]');
});
test('failed validation leaves the last saved group tree intact', () => {
  const { service, prefs } = setup();
  const root = service.saveGroup(1, { name: '父' });
  const child = service.saveGroup(1, { name: '子', parentID: root });
  const previous = prefs.get(service.groupPreference(1));
  assert.throws(() => service.saveGroup(1, { id: root, name: '父', parentID: child }), /子分组/);
  assert.equal(prefs.get(service.groupPreference(1)), previous);
  assert.throws(() => service.saveGroup(1, { id: 'missing', name: '丢失' }), /不存在/);
});
test('invalid persisted JSON is reported and preserved instead of overwritten', () => {
  const { service, prefs } = setup();
  prefs.set(service.groupPreference(1), '{broken');
  assert.throws(() => service.saveGroup(1, { name: 'A' }), /原数据已保留/);
  assert.equal(prefs.get(service.groupPreference(1)), '{broken');
});
test('old saved filter shapes remain readable, with optional group scope added', () => {
  const { service, prefs } = setup();
  prefs.set(service.preference, JSON.stringify([{ id: 'p1', name: 'old', libraryID: 1, state: { tags: ['A'], mode: 'any' } }]));
  const old = service.readPresets()[0];
  assert.equal(old.state.groupID, null); assert.deepEqual(old.state.tags, ['A']);
  const group = service.saveGroup(1, { name: 'A' });
  service.savePreset('group', 1, { groupID: group });
  assert.equal(service.readPresets().find(p => p.name === 'group').state.groupID, group);
});
