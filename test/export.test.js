import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistribution, scopeApplies } from '../lib/export.js';
import { emptyLesson } from '../web/table-model.js';
import { validateSktjf } from '../lib/validator.js';
import { fixture } from './support/synthetic.js';
test('exports only reviewed complete data and preserves excluded slots and stable ids',async()=>{const {project,options}=fixture();const result=await buildDistribution(project,options);assert.deepEqual(validateSktjf(result),[]);assert.equal(result.lessons[0].id,'stable-id');assert.deepEqual(result.lessons[0].conditions.all,['DD']);assert.equal(result.slotCoverage.find(x=>x.dayOfWeek===2).state,'EXCLUDED');assert.equal(result.calendar.length,5);assert.equal('data' in result.sources[0],false);});
test('missing or unreviewed records, missing provenance and tampered PDF block export',async()=>{for(const mutate of [p=>p.lessons[0].reviewed=false,p=>p.lessons.pop(),p=>p.calendar.pop(),p=>p.calendar[0].sourcePage=2,p=>p.sources[0].sha256='a'.repeat(64)]){const {project,options}=fixture();mutate(project);await assert.rejects(buildDistribution(project,options));}});
test('wrong scope, ambiguous values and unresolved footnotes block export',async()=>{let f=fixture();await assert.rejects(buildDistribution(f.project,{...f.options,scope:'4ME'}));f=fixture();f.project.lessons[0].entries[0].subject='※3';await assert.rejects(buildDistribution(f.project,f.options));f=fixture();f.project.calendar[0].dayType='不明';await assert.rejects(buildDistribution(f.project,f.options));});
test('coverage confirmation and unresolved warnings are required',async()=>{const f=fixture();await assert.rejects(buildDistribution(f.project,{...f.options,coverageConfirmed:false}),/資料/);f.project.warnings.push({sourceId:'src',message:'ページを確認'});await assert.rejects(buildDistribution(f.project,f.options),/確認事項/);});
test('calendar grouping maps only intended classes',()=>{assert.equal(scopeApplies('１・２・３年生','3I'),true);assert.equal(scopeApplies('4ME','4I'),false);assert.equal(scopeApplies('4ME','4E'),true);assert.equal(scopeApplies('4・5年生','5B'),true);});
test('footnote 2 becomes an extension and footnote 3 remains explicitly excluded',async()=>{
  const f=fixture();f.project.lessons[0].entries[0].subject='※2';f.project.lessons[0].raw='※2';f.project.lessons[1].raw='※3';const result=await buildDistribution(f.project,f.options);assert.equal(result.lessons[0].subject,'延長枠');assert.equal(result.lessons[0].kind,'EXTENSION');assert.equal(result.slotCoverage[1].state,'EXCLUDED');
  f.project.lessons[1].state='EMPTY';await assert.rejects(buildDistribution(f.project,f.options),/配信対象外/);
  f.project.lessons[1].state='PRESENT';f.project.lessons[1].entries=[{...emptyLesson(),subject:'英語'}];f.project.lessons[1].containsExcluded=true;const mixed=await buildDistribution(f.project,f.options);assert.equal(mixed.slotCoverage[1].containsExcluded,true);
});
