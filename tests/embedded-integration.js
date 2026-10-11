/* Test-only addon, installed exclusively in a disposable profile. */
var started = false, testRoot, output = { checks: [], passed: false };
function install() {} function uninstall() {} function shutdown() {}
function startup() { testRoot = Services.prefs.getStringPref('tagWorkspace.testRoot'); setTimeout(run, 2200); }
function onMainWindowLoad() { setTimeout(run, 1800); }
async function report() { await IOUtils.writeJSON(PathUtils.join(testRoot, 'integration-results.json'), output); }
function assert(ok, name) { if (!ok) throw new Error(name); output.checks.push(name); }
async function waitFor(fn, timeout = 30000) {
  const start = Date.now(); while (!(await fn())) { if (Date.now() - start > timeout) throw new Error('Timeout: ' + fn); await Zotero.Promise.delay(100); }
}
async function run() {
  if (started) return; started = true;
  try {
    await Zotero.initializationPromise;
    await waitFor(() => Zotero.getMainWindow()?.ZoteroPane?.itemsView);
    const win = Zotero.getMainWindow(), doc = win.document, pane = win.ZoteroPane;
    if (Zotero.DataDirectory.dir !== PathUtils.join(testRoot, 'data') || !testRoot.includes('\\test-runs\\run-')) throw new Error('Isolation failed');
    win.document.title='Better Tags — isolated layout test';
    await IOUtils.writeUTF8(PathUtils.join(testRoot,'ready'),'ready');
    await waitFor(()=>IOUtils.exists(PathUtils.join(testRoot,'start')),300000);
    const lib = Zotero.Libraries.userLibraryID;
    output.application = Zotero.version;
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    let addon = await AddonManager.getAddonByID('tag-workspace@local.tools');
    output.upgradedFrom = addon.version;
    const baseline = doc.getElementById('better-tags-panel')?.betterTagsController;
    if (baseline) await baseline.ready;
    const groups = JSON.stringify([{ id:'old-group', name:'Battery', parentID:null, tags:['Li battery'], collapsed:false }]);
    const presets = JSON.stringify([{id:'old-preset', name:'原有组合', libraryID:lib, state:{tags:['Li battery'], mode:'all', query:''}}]);
    Zotero.Prefs.set(`tagWorkspace.groups.v1.${lib}`, groups); Zotero.Prefs.set('tagWorkspace.presets.v1', presets);
    const folder = new Zotero.Collection(); folder.name = 'Test collection'; await folder.saveTx();
    async function article(title, tags, inFolder = false) {
      const item = new Zotero.Item('journalArticle'); item.libraryID = lib; item.setField('title', title);
      item.setField('date','2026'); item.setCreators([{firstName:'',lastName:'测试作者',creatorType:'author',fieldMode:1}]);
      item.setTags(tags.map(tag => ({ tag }))); if(inFolder) item.setCollections([folder.id]); await item.saveTx(); return item;
    }
    const a = await article('Alpha Li<sub>2</sub>O<sub>2</sub> battery', ['Li battery','Review'], true);
    const b = await article('Beta <i>in situ</i> battery', ['Li battery']);
    const c = await article('Gamma review of Zn', ['Review','Zn battery']);
    const d = await article('Untagged article', [], true);
    const note = new Zotero.Item('note'); note.parentItemID = a.id; note.setNote('<p>uniquenotephrase</p>'); await note.saveTx();
    const secondNote = new Zotero.Item('note'); secondNote.parentItemID = b.id; secondNote.setNote('<p>Second article note</p>'); await secondNote.saveTx();
    if (baseline && addon.version === '2.2.0') {
      await baseline.load(); baseline.ui.toggleTag('Li battery'); await baseline.idle;
      output.reproducedAutomaticExpansion = pane.itemsView.isContainerOpen(pane.itemsView.getRowIndexByID(a.id));
      assert(output.reproducedAutomaticExpansion, 'Version 2.2.0 reproduces unwanted automatic child expansion');
      baseline.ui.state = baseline.core.normalizeState(); await baseline.queueApply();
    }
    if(baseline && addon.version==='2.1.0') {
      await baseline.load(); baseline.ui.toggleTag('Li battery'); await baseline.idle;
      c.setField('title','Gamma review of Zn updated'); await c.saveTx();
      await pane.itemsView.rowProvider.notify('modify','item',[c.id],{[c.id]:{}});
      output.reproducedIncrementalLeak=pane.getSortedItems(true).includes(c.id);
      baseline.ui.state=baseline.core.normalizeState(); await baseline.queueApply();
    }
    if (baseline && addon.version === '2.0.0') {
      await baseline.load(); baseline.ui.filterGroup('old-group'); await baseline.idle;
      baseline.ui.toggleTag('Review'); await baseline.idle;
      output.reproducedGroupRetention = baseline.ui.state.groupID === 'old-group';
      baseline.ui.state = baseline.core.normalizeState(); await baseline.queueApply();
      await pane.itemsView.setFilter('tags',new Set(['Li battery']));
      baseline.ui.toggleTag('Review'); await baseline.idle;
      output.reproducedHiddenNativeFilter = !pane.getSortedItems(true).includes(c.id);
      baseline.ui.state = baseline.core.normalizeState();
      pane.tagSelector?.clearTagSelection(); await pane.itemsView.setFilter('tags',new Set());
      await baseline.queueApply();
    }
    await pane.collectionsView.selectCollection(folder.id);
    const nativeView = pane.itemsView, nativePane = doc.getElementById('zotero-items-pane');
    const nativeSearch = doc.getElementById('zotero-tb-search');
    nativeSearch.searchTextbox.value = 'Alpha'; await pane.search();
    const originalChange = baseline?.originalChange || nativeView.changeCollectionTreeRows;
    const originalToggle = baseline?.originalToggle || pane.toggleTagSelector;
    const originalExpandMatches = baseline?.originalExpandMatches || nativeView.rowProvider._expandMatchParents;
    const version = Services.prefs.getStringPref('tagWorkspace.testVersion');
    const installer = await AddonManager.getInstallForFile(Zotero.File.pathToFile(PathUtils.join(PathUtils.parent(PathUtils.parent(testRoot)), 'dist', `better-tags-${version}.xpi`)));
    await installer.install(); addon = await AddonManager.getAddonByID('tag-workspace@local.tools');
    await waitFor(() => doc.getElementById('better-tags-panel')?.betterTagsController);
    let ctl = doc.getElementById('better-tags-panel').betterTagsController; await ctl.ready;
    let ui = ctl.ui; const service = ui.service, core = service.core;
    assert(addon.version === version && addon.isActive, 'Install-from-file upgrades the existing plugin to ' + version);
    assert(Zotero.Prefs.get(`tagWorkspace.groups.v1.${lib}`) === groups && Zotero.Prefs.get('tagWorkspace.presets.v1') === presets, 'Upgrade preserves nested groups and saved combinations');
    assert(doc.getElementById('zotero-tag-selector-container').contains(ctl.$('panel')) && ctl.$('panel').getBoundingClientRect().height > 100, 'Panel mounts visibly in the native tag area');
    assert(nativePane === doc.getElementById('zotero-items-pane') && nativeView === pane.itemsView && nativeSearch === doc.getElementById('zotero-tb-search'), 'Original item pane, item view and quick search are retained');
    assert(!doc.getElementById('better-tags-frame') && !ctl.$('query') && !ctl.$('results'), 'No floating window or duplicate document search/results');
    assert(ctl.$('conditions').parentElement === nativePane.parentElement && ctl.$('conditions').compareDocumentPosition(nativePane) & win.Node.DOCUMENT_POSITION_FOLLOWING, 'Compact filter bar precedes the native item list');
    assert(ctl.scopeMode === 'library', 'Initial filter scope is whole library even when a collection is selected');
    // Exercise real chrome-window layout at different sizes, with a user-set 90% split.
    const settle = () => Zotero.Promise.delay(350);
    const geometry = () => ({available:ctl.sizingHeight(),panel:ctl.container.getBoundingClientRect().height,folders:ctl.folderTree.getBoundingClientRect().height,ratio:ctl.heightRatio});
    const dragHeight = async fraction => {
      ctl.splitterDown({button:0});
      ctl.container.setAttribute('height',Math.round(ctl.sizingHeight()*fraction));
      ctl.container.style.height=Math.round(ctl.sizingHeight()*fraction)+'px';
      ctl.splitterUp(); await settle();
    };
    const checkRatio = name => {
      const g=geometry(); (output.geometry ||= []).push({name,...g});
      assert(Math.abs(g.panel/g.available-ctl.heightRatio)<.015 && g.folders>=28,name+' '+JSON.stringify(g));
    };
    win.maximize(); await settle(); await dragHeight(.9);
    const preferred=Zotero.Prefs.get('tagWorkspace.embeddedHeightRatio.v1');
    output.resizeInitial={preferred,...geometry(), nodes:[ctl.sidebar,...ctl.sidebar.children].map(n=>({id:n.id,attrs:[...n.attributes].map(a=>[a.name,a.value]),height:n.getBoundingClientRect().height,cssHeight:win.getComputedStyle(n).height,flex:win.getComputedStyle(n).flex}))};
    assert(Math.abs(Number(preferred)-.9)<.01,'Dragging the divider records the chosen proportion');
    checkRatio('Maximized panel occupies the chosen 90% with folders still visible');
    win.restore(); win.resizeTo(1050,700); await settle();
    checkRatio('Restored smaller window keeps the chosen proportion');
    win.resizeTo(1000,590); await settle(); checkRatio('Further window shrinking keeps the chosen proportion');
    win.maximize(); await settle(); checkRatio('Maximizing again restores the proportion without drift');
    assert(Zotero.Prefs.get('tagWorkspace.embeddedHeightRatio.v1')===preferred,'Window resizing never overwrites the preferred proportion');
    ctl.setVisible(false); win.restore(); win.resizeTo(1050,700); await settle(); ctl.setVisible(true); await settle();
    checkRatio('Hiding during a resize and reopening also preserves the proportion');
    await dragHeight(.6); checkRatio('A later divider drag updates the proportion');
    const savedHeightRatio=Zotero.Prefs.get('tagWorkspace.embeddedHeightRatio.v1');
    const ids = () => pane.getSortedItems(true).filter(id => [a.id,b.id,c.id,d.id].includes(id)).sort((x,y)=>x-y);
    const expect = (wanted, message) => assert(JSON.stringify(ids()) === JSON.stringify(wanted.map(i=>i.id).sort((x,y)=>x-y)), message + ' [' + ids() + ']');
    const clickTag = (tag, altKey = false, ctrlKey = false) => {
      const btn = [...ctl.$('tag-list').querySelectorAll('.tag-option')].find(n=>n.dataset.tag===tag);
      if (!btn) throw new Error('Missing tag ' + tag);
      btn.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,button:0,altKey,ctrlKey}));
    };
    clickTag('Li battery'); await ctl.idle;
    assert(ctl.rows()[0].isLibrary(true) && nativeSearch.searchTextbox.value === 'Alpha', 'Whole-library navigation preserves native search text');
    expect([a], 'Tag and native text search intersect');
    nativeSearch.searchTextbox.value = ''; await pane.search();
    expect([a,b], 'Clearing native search retains the tag filter');
    clickTag('Review'); await ctl.idle; clickTag('Li battery'); await ctl.idle;
    const isOpen = item => nativeView.isContainerOpen(nativeView.getRowIndexByID(item.id));
    assert(!isOpen(a) && !isOpen(b), 'New tag selection keeps all article attachments and notes folded');
    nativeView.rowProvider.toggleOpenState(nativeView.getRowIndexByID(a.id)); await settle();
    assert(isOpen(a) && pane.getSortedItems(true).includes(note.id), 'User can manually expand a tagged article and reveal its notes');
    await ctl.queueApply(false);
    assert(isOpen(a) && !isOpen(b), 'Refreshing the same filter preserves manual expansion without opening other articles');
    nativeView.rowProvider.toggleOpenState(nativeView.getRowIndexByID(a.id)); await settle();
    c.setField('title','Gamma review of Zn updated again'); await c.saveTx();
    await pane.itemsView.rowProvider.notify('modify','item',[c.id],{[c.id]:{}});
    expect([a,b], 'Background updates to an unrelated item cannot append it to tagged results');
    assert(!isOpen(a) && !isOpen(b), 'Background updates do not reopen folded search results');
    assert(ctl.rows().every(row=>row.isSearchMode()),'Native list recognizes active Better Tags conditions as a filtered search');
    b.removeTag('Li battery'); await b.saveTx(); expect([a],'Removing a matching tag immediately removes that item from the results');
    b.addTag('Li battery'); await b.saveTx(); expect([a,b],'Adding a matching tag immediately restores only the matching item');
    // Open a real local PDF in Zotero's reader, modify an unrelated item while
    // that tab is active, then return repeatedly to the native library tab.
    const stream='BT /F1 18 Tf 40 100 Td (Better Tags reader fixture) Tj ET';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf='%PDF-1.4\n', offsets=[0];
    for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=pdf.length;
    pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const pdfPath=PathUtils.join(testRoot,'reader-fixture.pdf'); await IOUtils.writeUTF8(pdfPath,pdf);
    const attachment=await Zotero.Attachments.importFromFile({file:pdfPath,parentItemID:a.id});
    // Import selects its newly created attachment. Match the user's normal
    // workflow instead: open a PDF from a selected, folded parent article.
    await pane.selectItems([a.id]); nativeView.collapseAllRows(true); await settle();
    const reader=await Zotero.Reader.open(attachment.id); await settle();
    assert(win.Zotero_Tabs.selectedID!=='zotero-pane','A matching article opens in Zotero actual PDF reader');
    c.setField('title','Gamma changed while reading'); await c.saveTx();
    await pane.itemsView.rowProvider.notify('modify','item',[c.id],{[c.id]:{}});
    win.Zotero_Tabs.select('zotero-pane'); await settle(); expect([a,b],'Returning from a PDF reader excludes unrelated background updates');
    for(let i=0;i<2;i++) { win.Zotero_Tabs.select(reader.tabID); await settle(); win.Zotero_Tabs.select('zotero-pane'); await settle(); }
    expect([a,b],'Repeated reader and library switches retain the exact tagged result set');
    assert(!isOpen(a) && !isOpen(b), 'Returning from a PDF reader leaves the result articles folded');
    win.Zotero_Tabs.close(reader.tabID);
    clickTag('Review'); await ctl.idle; expect([a,c], 'Normal tag click replaces the previous tag');
    clickTag('Li battery', true); await ctl.idle; expect([a], 'Alt-click adds a persistent AND condition');
    clickTag('Li battery', false, true); await ctl.idle; expect([a,c], 'Ctrl-click removes an already selected tag');
    ctl.$('panel').dispatchEvent(new win.KeyboardEvent('keyup',{key:'Control',bubbles:true}));
    clickTag('Li battery', false, true); await ctl.idle; expect([a], 'Ctrl-click adds tags after the modifier was released');
    assert(ui.state.tags.length===2 && new Set(ui.state.tags).size===2,'Alt and Ctrl share a single deduplicated selection');
    ctl.$('mode-any').click(); await ctl.idle; expect([a,b,c], 'ANY produces the native-list union');
    assert(!isOpen(a) && !isOpen(b), 'ANY tag matching also starts with folded articles');
    ctl.$('mode-all').click(); await ctl.idle;
    nativeSearch.searchTextbox.value = 'Gamma'; await pane.search(); expect([], 'Native search respects all active tag conditions');
    ctl.$('clear').click(); await ctl.idle; expect([c], 'Clear tags keeps the native query and its results');
    assert(nativeSearch.searchTextbox.value === 'Gamma', 'Clear tags never clears native search text');
    nativeSearch.searchTextbox.value=''; await pane.search();
    clickTag('Li battery'); await ctl.idle;
    ctl.setVisible(false); expect([a,b], 'Hiding navigation retains active results');
    assert(doc.getElementById('zotero-tag-selector-container').getAttribute('collapsed')==='true' && ctl.$('conditions').getBoundingClientRect().height>0, 'Hidden navigation leaves filter conditions visible');
    doc.getElementById('tag-workspace-menu').doCommand(); await waitFor(()=>ctl.visible);
    assert(doc.querySelectorAll('#better-tags-panel').length===1, 'Tools menu restores exactly one embedded panel');
    await pane.toggleTagSelector(); assert(!ctl.visible, 'Native View menu hides Better Tags consistently');
    await pane.toggleTagSelector(); assert(ctl.visible && doc.activeElement===ctl.$('tag-search'), 'Native View menu restores Better Tags and focuses tag search');
    await pane.collectionsView.selectCollection(folder.id); await ctl.idle;
    expect([a], 'Native collection navigation combines with active tag filters');
    assert(ctl.scopeMode==='current', 'Native collection choice visibly switches scope to current classification');
    ctl.scopeMode='library'; await ctl.queueApply(); expect([a,b], 'Entire library restores cross-collection results');
    // Exercise native advanced-search objects without replacing or mutating them.
    const row = ctl.rows()[0], advanced = new Zotero.Search(); advanced.libraryID=lib; advanced.addCondition('title','contains','Beta');
    row.setAdvancedSearch(advanced); await ctl.queueApply(false); expect([b], 'Native advanced search and tag filter compose');
    row.setAdvancedSearch(null); await ctl.queueApply(false); expect([a,b], 'Removing advanced search retains tag results');
    // Native child-note hits must be retained so Zotero can reveal their parent.
    const oldMode = Zotero.Prefs.get('search.quicksearch-mode'); Zotero.Prefs.set('search.quicksearch-mode','everything');
    nativeSearch.searchTextbox.value='uniquenotephrase'; await pane.search(); expect([a], 'Native note/full-text search retains matching tagged parents');
    assert(isOpen(a) && pane.getSortedItems(true).includes(note.id), 'Native full-text search can still expand the matching child note');
    nativeSearch.searchTextbox.value=''; Zotero.Prefs.set('search.quicksearch-mode',oldMode); await pane.search();
    ctl.$('clear').click(); await ctl.idle;
    ctl.$('untagged').checked=true; ctl.$('untagged').dispatchEvent(new win.Event('change')); await ctl.idle;
    assert(ids().includes(d.id)&&!ids().includes(a.id), 'Untagged filter applies to the native list');
    ctl.$('clear').click(); await ctl.idle;
    ui.openGroupEditor(); assert(ctl.$('group-dialog').open, 'Group editor opens as a native-window modal');
    ctl.$('group-name').value='Read'; ui.groupMemberSelection.add('Review'); ui.saveGroupEditor(); await ctl.idle;
    const read = service.readGroups(lib).find(g=>g.name==='Read'); assert(read?.tags.includes('Review'), 'Embedded group editor saves existing tag membership');
    service.saveGroup(lib,{name:'Chemistry',parentID:'old-group',tags:['Zn battery']}); await ctl.load();
    ui.filterGroup('old-group'); await ctl.idle; expect([a,b,c], 'Parent group filters include descendant-group tags');
    assert(!isOpen(a) && !isOpen(b), 'Selecting a tag group also defaults to folded articles');
    clickTag('Review'); await ctl.idle; expect([a,c], 'Plain click clears a previous group condition and keeps only the clicked tag');
    assert(ui.state.groupID===null && !ctl.$('selected-tags').querySelector('.group-chip'),'No old group chip remains after plain tag selection');
    await pane.itemsView.setFilter('tags',new Set(['Li battery']));
    clickTag('Review'); await ctl.idle; expect([a,c], 'Plain click also clears a hidden native tag restriction');
    assert(ctl.rows().every(row=>row.tags.size===0),'Native and plugin tag conditions cannot accumulate independently');
    service.saveGroup(lib,{name:'Shared tags',tags:['Li battery','Review']}); await ctl.load();
    clickTag('Li battery');
    const automaticColor=service.tagColor(lib,'Li battery'), nativeColor=JSON.stringify(Zotero.Tags.getColor(lib,'Li battery'));
    const beforeColor=JSON.stringify(ui.state);
    ctl.$('tag-list').querySelector('[data-tag="Li battery"]').dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,screenX:250,screenY:350}));
    ctl.$('tag-menu').hidePopup(); ctl.$('tag-color').doCommand();
    await waitFor(()=>ctl.$('color-dialog').open);
    assert(ctl.$('color-options').children.length===12 && !ctl.$('color-dialog').querySelector('input'),'Tag context menu offers only twelve preset background colors');
    assert([...ctl.$('color-options').children].every(n=>n.textContent==='' && n.getAttribute('aria-label') && n.getBoundingClientRect().height>=30),'Palette displays unlabeled swatches with adequate size and accessible names');
    ctl.$('color-options').querySelector('[data-color="blue"]').click(); ctl.$('color-cancel').click();
    assert(service.tagColor(lib,'Li battery')===automaticColor,'Canceling color selection leaves the original color intact');
    ctl.openColor('Li battery'); ctl.$('color-options').querySelector('[data-color="blue"]').click(); ctl.$('color-save').click();
    const copies=[...ctl.$('tag-list').querySelectorAll('[data-tag="Li battery"]'),...ctl.$('selected-tags').querySelectorAll('[data-tag="Li battery"]')];
    assert(copies.length===3 && copies.every(n=>win.getComputedStyle(n).backgroundColor==='rgb(202, 216, 240)'),'Chosen color updates both groups and the active-condition chip');
    assert(JSON.stringify(ui.state)===beforeColor && JSON.stringify(Zotero.Tags.getColor(lib,'Li battery'))===nativeColor,'Appearance edits preserve selections and Zotero native colored-tag shortcuts');
    ctl.openColor('Li battery');
    assert(ctl.$('color-options').querySelector('[aria-checked="true"]').dataset.color==='blue','Reopening the palette indicates the saved color');
    assert(ctl.$('color-dialog').scrollWidth<=ctl.$('color-dialog').clientWidth,'Color palette fits its dialog without horizontal overflow');
    ctl.$('color-auto').click(); ctl.$('color-save').click();
    assert(service.tagColor(lib,'Li battery')===automaticColor,'Automatic color restores the same original pastel');
    service.setTagColor(lib,'Li battery','blue');
    let repeated=[...ctl.$('tag-list').querySelectorAll('[data-tag="Li battery"]')];
    assert(repeated.length===2 && repeated.every(n=>n.getAttribute('aria-pressed')==='true'),'The same tag in two groups shares one selection');
    repeated[1].dispatchEvent(new win.MouseEvent('click',{bubbles:true,button:0,ctrlKey:true})); await ctl.idle;
    assert(ui.state.tags.length===0 && !ctl.$('tag-list').querySelector('[data-tag="Li battery"][aria-pressed="true"]'),'Ctrl-click in a second group removes the one shared condition');
    clickTag('Li battery'); clickTag('Review'); await ctl.idle;
    assert(ui.state.tags.join()==='Review' && !ctl.$('selected-tags').textContent.includes('Li battery'),'Single click replaces all copies of the previously selected tag');
    const title = ctl.$('tag-list').querySelector('.group-title'); const stateBefore=JSON.stringify(ui.state); title.click();
    assert(JSON.stringify(ui.state)===stateBefore, 'Group title only expands/collapses and does not filter');
    title.click(); ui.moveGroup(read.id,'old-group',false);
    assert(service.readGroups(lib)[0].id===read.id, 'Custom group order persists in the embedded navigation');
    const empty=service.saveGroup(lib,{name:'Empty test group',tags:[]}); await ctl.load();
    const emptyID=service.readGroups(lib).find(g=>g.name==='Empty test group').id;
    ui.state.tags=[]; ui.filterGroup(emptyID); await ctl.idle; expect([], 'Empty group does not expose unrelated native items');
    ui.openGroupEditor(emptyID); ctl.$('delete-group').click(); ctl.$('confirm-delete-group').click(); await ctl.idle;
    assert(ui.state.groupID===null && !ctl.$('selected-tags').textContent.includes('Empty test group'),'Deleting an active group clears its obsolete filter condition');
    ctl.$('clear').click(); await ctl.idle;
    await pane.selectItems([a.id,b.id]); ctl.openBatch();
    assert(ctl.batchRequest.ids.length===2, 'Batch tagging reads the native item selection directly');
    ctl.$('tag-input').value='Batch marker'; await ctl.edit('add');
    assert(a.hasTag('Batch marker')&&b.hasTag('Batch marker')&&!c.hasTag('Batch marker'), 'Batch tag operation changes only the captured selection');
    await ctl.edit('undo'); assert(!a.hasTag('Batch marker')&&!b.hasTag('Batch marker'), 'Batch undo restores selected item tags');
    ctl.$('batch-dialog').close();
    clickTag('Zn battery'); await ctl.idle; c.deleted=true; await c.saveTx();
    await waitFor(()=>!ui.state.tags.includes('Zn battery')); await ctl.idle;
    assert(!ctl.$('selected-tags').textContent.includes('Zn battery'), 'Deleting the final item automatically removes the stale selected tag');
    c.deleted=false; await c.saveTx(); await ctl.load();
    clickTag('Li battery'); clickTag('Review'); clickTag('Li battery',true); await ctl.idle; expect([a], 'Rapid tag changes settle on the latest combination');
    ctl.$('save-preset').click(); ctl.$('preset-name').value='Battery reviews'; ctl.$('confirm-preset').click();
    assert(service.readPresets().some(p=>p.name==='Battery reviews'), 'Save combination uses embedded controls');
    // Rename via the actual UI and Zotero database, including child and trash tags.
    const renameItem=await article('Rename fixture',['Rename source']);
    const trashed=await article('Trash rename fixture',['Rename source']); trashed.deleted=true; await trashed.saveTx();
    note.addTag('Rename source'); await note.saveTx();
    const renameGroup=service.saveGroup(lib,{name:'Rename group',tags:['Rename source','Review']});
    const nestedRename=service.saveGroup(lib,{name:'Nested rename',parentID:renameGroup,tags:['Rename source']});
    service.savePreset('Rename preset',lib,{tags:['Rename source','Review'],mode:'any'});
    service.setTagColor(lib,'Rename source','peach');
    const renameColor=service.tagColor(lib,'Rename source');
    await Zotero.Tags.setColor(lib,'Rename source','#66a188',0);
    await ctl.load(); clickTag('Rename source'); await ctl.idle;
    const beforeContext=JSON.stringify(ui.state);
    let renameButton=ctl.$('tag-list').querySelector('[data-tag="Rename source"]');
    renameButton.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,screenX:250,screenY:350}));
    assert(ctl.contextTag==='Rename source' && JSON.stringify(ui.state)===beforeContext,'Tag context menu opens without modifying filter selection');
    ctl.$('tag-menu').hidePopup(); ctl.$('tag-rename').doCommand();
    await waitFor(()=>ctl.$('rename-dialog').open);
    assert(ctl.$('rename-dialog').open && ctl.$('rename-name').value==='Rename source','Rename menu opens a prefilled editor');
    output.renameLayout=[ctl.$('rename-dialog'),...ctl.$('rename-dialog').querySelectorAll('*')].map(n=>({id:n.id||n.tagName,w:n.getBoundingClientRect().width,x:n.getBoundingClientRect().x,scroll:n.scrollWidth,client:n.clientWidth,margin:win.getComputedStyle(n).margin,padding:win.getComputedStyle(n).padding,min:win.getComputedStyle(n).minWidth,display:win.getComputedStyle(n).display,box:win.getComputedStyle(n).boxSizing}));
    assert(ctl.$('rename-dialog').scrollWidth<=ctl.$('rename-dialog').clientWidth,'Rename dialog fits its contents without a horizontal scrollbar');
    ctl.$('rename-name').value='  '; await ctl.saveRename();
    assert(ctl.$('rename-dialog').open && renameItem.hasTag('Rename source'),'Blank name is rejected without changing items');
    ctl.$('rename-name').value='Renamed tag'; await ctl.saveRename();
    assert(!ctl.$('rename-dialog').open && renameItem.hasTag('Renamed tag') && !renameItem.hasTag('Rename source'),'Rename editor changes the native tag');
    assert(note.hasTag('Renamed tag') && trashed.hasTag('Renamed tag'),'Library-wide rename covers child notes and trash');
    assert(service.readGroups(lib).filter(g=>[renameGroup,nestedRename].includes(g.id)).every(g=>g.tags.includes('Renamed tag')&&!g.tags.includes('Rename source')),'Rename preserves nested and repeated group membership');
    assert(service.readPresets().find(p=>p.name==='Rename preset').state.tags.includes('Renamed tag'),'Rename updates saved tag conditions');
    assert(ui.state.tags.join()==='Renamed tag' && pane.getSortedItems(true).includes(renameItem.id),'Selected renamed tag remains active with matching native results');
    assert(service.tagColor(lib,'Renamed tag')===renameColor && Zotero.Tags.getColor(lib,'Renamed tag')?.color==='#66a188','Rename preserves pastel and native colored-tag settings');
    renameButton=ctl.$('tag-list').querySelector('[data-tag="Renamed tag"]');
    renameButton.dispatchEvent(new win.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'F2'}));
    assert(ctl.$('rename-dialog').open,'F2 provides a keyboard-accessible rename shortcut');
    ctl.$('rename-name').value='Review'; await ctl.saveRename();
    assert(!ctl.$('rename-merge-row').hidden && renameItem.hasTag('Renamed tag') && !renameItem.hasTag('Review'),'Existing target requires explicit merge choice before any write');
    ctl.$('rename-merge').checked=true; await ctl.saveRename();
    assert(renameItem.hasTag('Review')&&!renameItem.hasTag('Renamed tag') && !ctl.$('rename-dialog').open,'Confirmed same-name merge completes using native tags');
    assert(service.readPresets().find(p=>p.name==='Rename preset').state.tags.join()==='Review' && service.readGroups(lib).find(g=>g.id===renameGroup).tags.join()==='Review','Merging deduplicates saved combinations and group memberships');
    assert(ui.state.tags.join()==='Review' && pane.getSortedItems(true).includes(renameItem.id),'Merged active filter has a single tag and matching results');
    assert(service.tagColorChoice(lib,'Review')===null && service.tagColorChoice(lib,'Renamed tag')===null,'Merging keeps the target appearance and clears the obsolete color override');
    // Match only title text against the current library's existing vocabulary.
    const vocabulary=await article('Vocabulary fixture',['battery','Flow battery','AbstractOnly']);
    const autoOne=await article('A BATTERY for storage',['Keep']);
    const autoPhrase=await article('XXX <i>FLOW</i> BATTERIES &amp; their applications',[]);
    const autoNo=await article('A solar cell',[]); autoNo.setField('abstractNote','Flow batteries AbstractOnly'); await autoNo.saveTx();
    const autoGap=await article('Flow-assisted rechargeable batteries',[]);
    const autoSkip=await article('Flow batteries untouched',[]);
    const autoExisting=await article('Flow battery',[]); autoExisting.setTags([{tag:'battery',type:1}]); await autoExisting.saveTx();
    const vocabularyBefore=(await Zotero.Tags.getAll(lib)).map(t=>t.tag).sort().join('|');
    ctl.$('clear').click(); await ctl.idle;
    const autoIDs=[autoOne.id,autoPhrase.id,autoNo.id,autoGap.id,autoExisting.id];
    await pane.selectItems(autoIDs);
    const autoMenu=doc.getElementById('better-tags-auto-title');
    assert(autoMenu?.getAttribute('label')==='按标题自动添加已有标签','Native item context menu offers title-based automatic tagging');
    autoMenu.doCommand(); await waitFor(()=>autoOne.hasTag('battery')&&!service.pending);
    assert(autoOne.hasTag('battery')&&!autoOne.hasTag('Flow battery')&&autoOne.hasTag('Keep'),'Battery title adds only the short tag and preserves unrelated tags');
    assert(autoPhrase.hasTag('battery')&&autoPhrase.hasTag('Flow battery'),'Flow batteries title with formatting adds both matching existing tags');
    assert(autoNo.getTags().length===0,'Words in abstract do not produce title-based tags');
    assert(autoGap.hasTag('battery')&&!autoGap.hasTag('Flow battery'),'Nonadjacent flow and batteries do not match the complete phrase');
    assert(autoExisting.hasTag('Flow battery')&&autoExisting.getTags().find(t=>t.tag==='battery').type===1,'Existing automatic tag types are preserved without duplicates');
    assert(autoSkip.getTags().length===0,'Unselected items are untouched by the context-menu action');
    assert((await Zotero.Tags.getAll(lib)).map(t=>t.tag).sort().join('|')===vocabularyBefore,'Automatic tagging creates no new tag names');
    const noChanges=await service.autoTagByTitle(lib,autoIDs,doc);
    assert(noChanges.changed===0&&noChanges.added===0,'Repeated automatic tagging is idempotent');
    await service.undo();
    assert(autoOne.getTags().map(t=>t.tag).join()==='Keep'&&autoPhrase.getTags().length===0&&autoExisting.getTags().length===1&&autoExisting.getTags()[0].type===1,'Undo removes only tags added by the automatic operation');
    clickTag('Li battery'); clickTag('Review',true); await ctl.idle;
    const color = service.tagColor(lib,'Li battery');
    const button=doc.getElementById('tag-workspace-button'), toolbar=doc.getElementById('zotero-items-toolbar');
    const extra=doc.createXULElement('toolbarbutton'); extra.className='zotero-tb-button'; toolbar.insertBefore(extra,button.nextSibling);
    await Zotero.Promise.delay(200);
    assert(button.getBoundingClientRect().right<=extra.getBoundingClientRect().left && win.getComputedStyle(button).position==='static','Toolbar icon shares normal layout with neighboring plugins'); extra.remove();
    assert(button.getAttribute('image').endsWith('icons/better-tags.png') && addon.iconURL.includes('better-tags.png'),'Supplied logo remains the addon and toolbar icon');
    nativeSearch.searchTextbox.value='Beta'; await pane.search(); expect([], 'Disable fixture is actively restricted before unload');
    await addon.disable(); await Zotero.Promise.delay(500);
    assert(!doc.getElementById('better-tags-panel')&&!doc.getElementById('better-tags-conditions')&&nativeView.changeCollectionTreeRows===originalChange&&pane.toggleTagSelector===originalToggle,'Disabling removes embedded UI and restores native view and menu hooks');
    assert(doc.getElementById('zotero-tag-selector').style.display!== 'none' && nativeSearch.searchTextbox.value==='Beta','Disabling restores native tags while retaining native search');
    assert(nativeView.rowProvider._expandMatchParents===originalExpandMatches,'Disabling restores native automatic child expansion behavior');
    expect([b], 'Disabling releases the tag restriction on the native results');
    await addon.enable(); await waitFor(()=>doc.getElementById('better-tags-panel')?.betterTagsController);
    ctl=doc.getElementById('better-tags-panel').betterTagsController; await ctl.ready; ui=ctl.ui;
    assert(doc.querySelectorAll('#better-tags-panel').length===1 && ui.service.tagColor(lib,'Li battery')===color && ui.service.readPresets().some(p=>p.name==='Battery reviews'), 'Re-enabling creates one panel and preserves colors, groups and combinations');
    assert(Zotero.Prefs.get('tagWorkspace.embeddedHeightRatio.v1')===savedHeightRatio && Math.abs(ctl.heightRatio-Number(savedHeightRatio))<.000001,'Re-enabling preserves the user-chosen panel proportion');
    await settle(); checkRatio('Re-enabled panel uses the saved proportion in the current window');
    nativeSearch.searchTextbox.value=''; await pane.search(); ctl.scopeMode='library'; await ctl.queueApply();
    // Keep a useful preview for manual visual review.
    clickTag('Li battery'); await ctl.idle; await pane.selectItem(a.id);
    win.document.title=`Better Tags ${version} — isolated preview`;
    output.passed=true; output.fixtureIDs={a:a.id,b:b.id,c:c.id,d:d.id};
  } catch(error) { output.error=String(error); output.stack=error.stack; Zotero.logError(error); }
  await report();
  const timer=setInterval(async()=> { if(await IOUtils.exists(PathUtils.join(testRoot,'finish'))) { clearInterval(timer); Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); } },1000);
  const liveTimer=setInterval(async()=>{
    const w=Zotero.getMainWindow(), c=w?.document.getElementById('better-tags-panel')?.betterTagsController;
    if(c && !c.disposed) await IOUtils.writeJSON(PathUtils.join(testRoot,'live-layout.json'),{
      available:c.sizingHeight(),height:c.container.getBoundingClientRect().height,folders:c.folderTree.getBoundingClientRect().height,
      ratio:c.heightRatio,dragging:c.sizingDrag,styles:c.container.getAttribute('style'),pref:Zotero.Prefs.get('tagWorkspace.embeddedHeightRatio.v1')});
  },1000);
}
