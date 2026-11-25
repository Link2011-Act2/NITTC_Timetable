import { createHash } from 'node:crypto';

export const schoolCalendarPage = 'https://www.tsuruoka-nct.ac.jp/gakusei/行事予定表/';
const schoolOrigin = new URL(schoolCalendarPage).origin;

export function calendarPdfLinks(html, academicYear) {
  const year = new RegExp(`(?:${academicYear}|令和\\s*${academicYear - 2018})\\s*年度`);
  const found = { S: new Set(), F: new Set() };
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = match[2].replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').normalize('NFKC');
    if (!year.test(label) || !label.includes('行事予定表')) continue;
    const term = label.includes('前期') ? 'S' : label.includes('後期') ? 'F' : null;
    if (!term) continue;
    const url = new URL(match[1].replace(/&amp;/gi,'&'), schoolCalendarPage);
    if (url.origin === schoolOrigin && !url.username && !url.password && /\.pdf$/i.test(url.pathname)) found[term].add(url.href);
  }
  for (const links of Object.values(found)) if (links.size > 1) throw Error('同じ学期のPDFが複数あります。ファイルを指定してください');
  return Object.fromEntries(Object.entries(found).flatMap(([term,links])=>[...links].map(url=>[term,url])));
}

const names={夏季休業:'summer',冬季休業:'winter',学年末休業:'year_end',春季休業:'spring'};

export async function vacationCandidates(bytes, {academicYear, name, url = null}) {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({data:new Uint8Array(bytes)}).promise;
  const digest = createHash('sha256').update(bytes).digest('hex');
  const candidates = [], lessonStarts = [], periodEvidence = [];
  try {
    for(let page=1;page<=document.numPages;page++){
      const pdfPage = await document.getPage(page);
      const [data, operators] = await Promise.all([pdfPage.getTextContent(), pdfPage.getOperatorList()]);
      const items=data.items.filter(i=>i.str?.trim()).map(i=>({text:i.str.normalize('NFKC').trim(), x:i.transform[4], y:i.transform[5]}));
      const headers=items.flatMap(i=>{
        const month=i.text.match(/^(1[0-2]|[1-9])\s*月\s*\([A-Z]{3}\)/);
        return month ? [{...i,month:Number(month[1])}] : [];
      }).sort((a,b)=>a.x-b.x);
      const dayRows=items.filter(i=>i.x<(headers[0]?.x??0)-5 && i.y<(headers[0]?.y??0) && /^(?:[1-9]|[12][0-9]|3[01])$/.test(i.text));
      const arrows = operators.fnArray.flatMap((operator, index) => {
        if (operator !== OPS.constructPath) return [];
        const [paint, paths, bounds] = operators.argsArray[index];
        if (paint !== OPS.fill || paths?.[0]?.length !== 26 || !bounds) return [];
        const [left, bottom, right, top] = bounds;
        return right - left >= 3 && right - left <= 8 && top - bottom >= 18
          ? [{ x: (left + right) / 2, top, bottom }]
          : [];
      });
      const source={name,url,sha256:digest,page};
      for(const item of items){
        const mark=item.text.match(/^(夏季休業|冬季休業|学年末休業|春季休業)(?=$|[\s、,(])/);
        const lesson=/^(?:前期|後期)?授業開始(?=$|[\s、,(])/.test(item.text);
        if(!mark&&!lesson)continue;
        const header=headers.findLast(h=>h.x<=item.x+5);
        const row=dayRows.reduce((best,r)=>!best||Math.abs(r.y-item.y)<Math.abs(best.y-item.y)?r:best,null);
        let date=null;
        if(header&&row&&Math.abs(row.y-item.y)<9){
          const year=academicYear+Number(header.month<=3);
          const value=new Date(Date.UTC(year,header.month-1,Number(row.text)));
          if(value.getUTCMonth()===header.month-1)date=value.toISOString().slice(0,10);
        }
        if(lesson){lessonStarts.push({date,raw:item.text,source});continue;}
        const type=names[mark[1]], owner=type==='spring'&&date?.slice(5,7)==='04'?Number(date.slice(0,4)):academicYear;
        const id = `${owner}-${type}`;
        candidates.push({id,type,name:mark[1],start:date,end:null,confirmedThrough:null,
          estimatedEndMonth:null,sources:[source],reviewed:false,raw:item.text});
        if (date) {
          const arrow = vacationArrowEvidence({ header, headers, dayRows, arrows, academicYear, startDay: Number(row.text) });
          if (arrow) periodEvidence.push({ id, source, ...arrow });
        }
      }
    }
  } finally { await document.destroy(); }
  return {candidates,lessonStarts,periodEvidence};
}

export function vacationArrowEvidence({ header, headers, dayRows, arrows, academicYear, startDay }) {
  const column = headers.indexOf(header);
  const startRow = dayRows.find(row => Number(row.text) === startDay);
  if (!startRow) return null;
  const lastColumnWidth = headers.at(-1).x - headers.at(-2)?.x;
  const distanceFromNextHeader = (arrow, index) => {
    const left = headers[index].x;
    const right = headers[index + 1]?.x ?? left + lastColumnWidth;
    return right - arrow.x;
  };
  const isNearColumnEdge = (arrow, index) => {
    const distance = distanceFromNextHeader(arrow, index);
    return distance >= 15 && distance <= 28;
  };
  // Text starts near the bottom of each day row. An arrow starts near its top.
  const startsAt = (arrow, row) => Math.abs(arrow.top - row.y - 15) <= 5;
  const initial = arrows.filter(arrow => isNearColumnEdge(arrow, column) && startsAt(arrow, startRow));
  if (initial.length !== 1) return null;
  let segment = initial[0], index = column;
  const firstRow = dayRows.find(row => row.text === '1');
  if (!firstRow) return null;
  while (index < headers.length) {
    const { month } = headers[index];
    const year = academicYear + Number(month <= 3);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const distanceFromEnd = row => Math.abs(row.y - 5 - segment.bottom);
    const endRow = dayRows.filter(row => Number(row.text) <= lastDay).reduce((best, row) =>
      !best || distanceFromEnd(row) < distanceFromEnd(best) ? row : best, null);
    if (!endRow || distanceFromEnd(endRow) > 9) return null;
    const through = new Date(Date.UTC(year, month - 1, Number(endRow.text))).toISOString().slice(0, 10);
    if (Number(endRow.text) < lastDay) return { arrowThroughCandidate: through, arrowEndCandidate: through };
    const next = headers[index + 1];
    if (!next) return { arrowThroughCandidate: through, arrowEndCandidate: null };
    const continuations = arrows.filter(arrow => isNearColumnEdge(arrow, index + 1) &&
      Math.abs(distanceFromNextHeader(arrow, index + 1) - distanceFromNextHeader(segment, index)) <= 3 &&
      startsAt(arrow, firstRow));
    if (continuations.length !== 1) return { arrowThroughCandidate: through, arrowEndCandidate: null };
    segment = continuations[0];
    index++;
  }
  return null;
}
