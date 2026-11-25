import { dateAdd, emptyDay, emptyLesson, isoDate } from './table-model.js';
import { normalizeSubjectName } from './subject-names.js';
import { parseWeekRange } from './week-ranges.js';

/** Split an explicit annotation only when a single PDF text item contains one subject. */
export function draftLessonEntry(raw, textItemCount) {
  const subject=normalizeSubjectName(raw);
  const parsed=textItemCount===1&&!/[\/／]/u.test(raw)?parseWeekRange(subject):null;
  if(!parsed?.subject||/\s/u.test(parsed.subject))return {...emptyLesson(),subject};
  return {...emptyLesson(),subject:parsed.subject,weekStart:String(parsed.activeWeekRange.start??''),
    weekEnd:String(parsed.activeWeekRange.end??''),weekSourceNotation:parsed.notation};
}

const fullDayEvents = new Map([
  ['始業行事', 'EVENT'],
  ['校内体育大会', 'EVENT'],
  ['高専祭', 'EVENT'],
  ['工場見学', 'EXCURSION'],
  ['卒研発表会', 'EVENT'],
]);
const eventsOmittedWhenWithCycle = new Set([...fullDayEvents.keys(), '清掃', '終業行事']);

export function parseCalendarText(raw) {
  const cell={dayType:'',lessonDay:'',lessonType:'',label:''};
  const match=raw.match(/^\s*(?:[（(]([月火水木金])[）)]\s*)?([AB])(?:\s*((?:TOEIC|[^\x00-\x7f]).*))?\s*$/u);
  if(match){cell.dayType=match[2];if(match[1]){cell.lessonDay=String('月火水木金'.indexOf(match[1])+1);cell.lessonType=match[2];}const label=match[3]?.trim()||'';if(!eventsOmittedWhenWithCycle.has(label))cell.label=label;}
  else if(/^(祝日|振替休日|代休|臨時休業)$/.test(raw)){cell.dayType='HOLIDAY';cell.label=raw;}
  else if(fullDayEvents.has(raw.trim())){
    cell.dayType='HOLIDAY';
    cell.label=raw.trim();
    cell.eventKind=fullDayEvents.get(cell.label);
  }
  else cell.label=raw;
  return cell;
}

// School-specific heuristic: extract all pages, retain uncertain text for human review.
export function extractPage(items, width, height, year, term, pageNumber) {
  const texts=items.filter(i=>i.str?.trim() && i.transform).map(i=>({text:i.str.trim(),x:i.transform[4],y:i.transform[5]}));
  const out={lessons:[],calendar:[],warnings:[]};
  const dateRows=texts.filter(t=>t.x<width*.20 && /^\d{1,2}月\d{1,2}日$/.test(t.text));
  const weekdayHeaders=texts.filter(t=>['月','火','水','木','金'].includes(t.text) && t.y>height*.75).sort((a,b)=>a.x-b.x);
  if(dateRows.length && weekdayHeaders.length>=5) {
    const headers=weekdayHeaders.slice(0,5), scope=texts.filter(t=>t.y>headers[0].y&&t.x>width*.35).map(t=>t.text).join('') || `ページ${pageNumber}`;
    const boundaries=headers.slice(0,-1).map((h,i)=>(h.x+headers[i+1].x)/2);
    for(const row of dateRows){
      const end=texts.find(t=>t.x>width*.2&&t.x<width*.39&&Math.abs(t.y-row.y)<3&&/^\d{1,2}月\d{1,2}日$/.test(t.text));
      if(!end)continue;
      const [sm,sd]=row.text.match(/\d+/g).map(Number),[em,ed]=end.text.match(/\d+/g).map(Number);
      const start=isoDate(sm<4?year+1:year,sm,sd),finish=isoDate(em<4?year+1:year,em,ed); if(!start||!finish)continue;
      let date=start;
      for(let n=0;date<=finish&&n<7;n++,date=dateAdd(date,1)){
        const dow=new Date(`${date}T00:00:00Z`).getUTCDay(); if(dow<1||dow>5)continue;
        const idx=dow-1,left=idx===0?(headers[0].x-(boundaries[0]-headers[0].x)):boundaries[idx-1],right=idx===4?width:boundaries[idx];
        const raw=texts.filter(t=>t.x>=left&&t.x<right&&Math.abs(t.y-row.y)<7).sort((a,b)=>a.x-b.x).map(t=>t.text).join('');
        const cell={...emptyDay(date),scope,raw};
        Object.assign(cell,parseCalendarText(raw));
        out.calendar.push(cell);
      }
    }
    return out;
  }
  // First-year rows are identified by their labels. Other layouts remain editable manually.
  const anchors=texts.filter(t=>/^[1-4]$/.test(t.text)&&t.x<width*.13&&texts.some(u=>u.text==='組'&&Math.abs(u.y-t.y)<2&&u.x>t.x&&u.x-t.x<12)).sort((a,b)=>b.y-a.y);
  const periodHeaders=texts.filter(t=>/校時/.test(t.text) && t.y>height*.9).sort((a,b)=>a.x-b.x);
  if(anchors.length>=4&&periodHeaders.length>=20){
    const headers=periodHeaders.slice(0,20);const xs=headers.map(h=>h.x),boundaries=xs.slice(0,-1).map((x,i)=>(x+xs[i+1])/2);
    for(const anchor of anchors.slice(0,4))for(let idx=0;idx<20;idx++){
      const left=idx===0?xs[0]-(boundaries[0]-xs[0]):boundaries[idx-1],right=idx===19?width:boundaries[idx];
      const next=anchors.find(a=>a.y<anchor.y),bottom=next?next.y+5:anchor.y-(anchors[0].y-anchors[1].y)+5;
      const fragments=texts.filter(t=>t.x>=left&&t.x<right&&t.y<=anchor.y+5&&t.y>bottom).sort((a,b)=>b.y-a.y||a.x-b.x);
      const raw=fragments.map(t=>t.text).join(' ');
      if(raw){
        const excluded=/^※\s*[3３]$/.test(raw),simple=excluded||raw==='補講'||/^※\s*[2２]$/.test(raw);
        out.lessons.push({term,classId:`1-${anchor.text}`,day:Math.floor(idx/4)+1,period:idx%4+1,
          entries:excluded?[]:[draftLessonEntry(raw,fragments.length)],...(excluded?{state:'EXCLUDED'}:{}),rawUnparsed:!simple,reviewed:false,raw});
      }
    }
    // Only the supplied four-department layout is recognized. Shared cells can
    // span rows; keep their text unconfirmed instead of assigning it by guess.
    const names=['機械','電気・電子','情報','化学・生物'],departments=['M','E','I','B'];
    const upper=texts.filter(t=>t.x>width*.085&&t.x<width*.12&&names.includes(t.text)&&t.y<anchors[3].y-height*.015).sort((a,b)=>b.y-a.y);
    const layout=upper.length===16&&upper.every((a,i)=>a.text===names[i%4]&&(i===0||(upper[i-1].y-a.y>height*.02&&upper[i-1].y-a.y<height*.05)));
    if(layout){
      for(let i=0;i<upper.length;i++)for(let idx=0;idx<20;idx++){
        const anchor=upper[i],left=idx===0?xs[0]-(boundaries[0]-xs[0]):boundaries[idx-1],right=idx===19?width:boundaries[idx];
        const bottom=i<upper.length-1?upper[i+1].y+5:anchor.y-(upper[i-1].y-anchor.y)+5;
        const fragments=texts.filter(t=>t.x>=left&&t.x<right&&t.y<=anchor.y+5&&t.y>bottom).sort((a,b)=>b.y-a.y||a.x-b.x);
        const raw=fragments.map(t=>t.text).join(' ');
        if(!raw)continue;
        const excluded=/^※\s*[3３]$/.test(raw),simple=excluded||raw==='補講'||/^※\s*[2２]$/.test(raw);
        out.lessons.push({term,classId:`${Math.floor(i/4)+2}${departments[i%4]}`,day:Math.floor(idx/4)+1,period:idx%4+1,
          entries:excluded?[]:[draftLessonEntry(raw,fragments.length)],...(excluded?{state:'EXCLUDED'}:{}),rawUnparsed:!simple,reviewed:false,raw});
      }
      out.warnings.push(`ページ${pageNumber}: 2年生以上の抽出結果を確認してください`);
    } else out.warnings.push(`ページ${pageNumber}: 2年生以上の時間割は手入力してください`);
  } else out.warnings.push(`ページ${pageNumber}: 表の構造を判定できませんでした`);
  return out;
}
