const {test}=require('node:test'),assert=require('node:assert/strict'),P=require('../position-core');
const paragraphs=['The first paragraph introduces a useful project.','Students tested the device in several different rooms. Their results improved the design.'];
const make=(extra={})=>P.capture({articleKey:'personal/project',paragraphs,paragraph:1,offset:35,scrollY:640,viewportOffset:82,updatedAt:100,...extra});
test('semantic positions retain stable article identity, content version and text context',()=>{
 const a=make();assert.ok(P.valid(a));assert.equal(a.articleKey,'personal/project');assert.equal(a.contentVersion,P.fingerprint(paragraphs));assert.equal(a.after,paragraphs[1].slice(35,83));assert.deepEqual(P.resolve(a,a.articleKey,paragraphs),{paragraph:1,offset:35,viewportOffset:82});
});
test('body edits and inserted paragraphs relocate the same text instead of trusting numeric paragraph order',()=>{
 const a=make(),changed=['A new introduction.',paragraphs[0],'An additional observation. '+paragraphs[1]];
 assert.deepEqual(P.resolve(a,a.articleKey,changed),{paragraph:2,offset:35+'An additional observation. '.length,viewportOffset:82});
});
test('an edit on one side of the anchor can still locate its surviving context',()=>{
 const a=make(),changed=[paragraphs[0],paragraphs[1].slice(0,35)+'A changed sentence. '+paragraphs[1].slice(35)];
 assert.equal(P.resolve(a,a.articleKey,changed).offset,35+'A changed sentence. '.length);
});
test('unrelated body revisions, ambiguous repeated text and another article fall back safely',()=>{
 const a=make();assert.equal(P.resolve(a,a.articleKey,['A completely revised report.']),null);assert.equal(P.resolve(a,'another/project',paragraphs),null);assert.equal(P.resolve(a,a.articleKey,[...paragraphs,paragraphs[1]]),null);
});
test('empty, malformed and future anchors do not prevent compatible pixel restoration',()=>{
 for(const invalid of [null,{}, {...make(),version:2},{...make(),offset:-1},{...make(),viewportOffset:Infinity},{...make(),after:'x'.repeat(49)}])assert.equal(P.resolve(invalid,'personal/project',paragraphs),null);
 const a=make({offset:9999});assert.equal(a.offset,paragraphs[1].length);assert.ok(P.valid(a));
});
