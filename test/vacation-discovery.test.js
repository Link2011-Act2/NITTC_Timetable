import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarPdfLinks, vacationArrowEvidence } from '../lib/vacation-discovery.js';

test('finds calendar PDFs by year and term rather than file name',()=>{
  const html='<a href="/a-renamed.pdf">令和８年度行事予定表（前期）</a>'+
    '<a href="/another.pdf">2026年度行事予定表（後期）</a>'+
    '<a href="/old.pdf">令和７年度行事予定表（後期）</a>'+
    '<a href="https://example.com/ignored.pdf">2026年度行事予定表（後期）</a>';
  assert.deepEqual(calendarPdfLinks(html,2026),{
    S:'https://www.tsuruoka-nct.ac.jp/a-renamed.pdf',
    F:'https://www.tsuruoka-nct.ac.jp/another.pdf'
  });
  assert.deepEqual(calendarPdfLinks(html,2027),{});
  assert.throws(()=>calendarPdfLinks(html+'<a href="/duplicate.pdf">2026年度行事予定表（後期）</a>',2026),/複数/);
});

const rows = Array.from({length:31}, (_, index) => ({ text:String(index + 1), y:718 - index * 20 }));
const december = {month:12,x:240}, january = {month:1,x:326}, february = {month:2,x:412}, march = {month:3,x:498};

test('links an arrow across adjacent months and leaves the date awaiting review', () => {
  assert.deepEqual(vacationArrowEvidence({
    header:december, headers:[december,january,february,march], dayRows:rows, academicYear:2026, startDay:26,
    arrows:[{x:303,top:233,bottom:113},{x:389,top:733,bottom:513}]
  }), {arrowThroughCandidate:'2027-01-11',arrowEndCandidate:'2027-01-11'});
});

test('a school-year boundary establishes confirmed-through evidence only', () => {
  assert.deepEqual(vacationArrowEvidence({
    header:february, headers:[december,january,february,march], dayRows:rows, academicYear:2026, startDay:20,
    arrows:[{x:475,top:353,bottom:173},{x:561,top:733,bottom:113}]
  }), {arrowThroughCandidate:'2027-03-31',arrowEndCandidate:null});
});
