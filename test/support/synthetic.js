import { createHash } from 'node:crypto';
import { emptyDay, emptyLesson, emptyProject } from '../../web/table-model.js';

function syntheticPdf(){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'];
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
export function fixture(){
  const pdf=syntheticPdf(),project=emptyProject(null,'',2026,'S'),source={id:'src',name:'synthetic.pdf',data:pdf.toString('base64'),sha256:createHash('sha256').update(pdf).digest('hex')};project.sources.push(source);
  for(let day=1;day<=5;day++)project.lessons.push({term:'S',classId:'1-1',day,period:1,entries:day===1?[{...emptyLesson(),id:'stable-id',subject:'数学',cycle:'A',attributes:'DD'}]:[],state:day===1?'PRESENT':day===2?'EXCLUDED':'EMPTY',reviewed:true,raw:'',sourceId:'src',sourcePage:1});
  for(let day=6;day<=10;day++)project.calendar.push({...emptyDay(`2026-04-${String(day).padStart(2,'0')}`),scope:'1・2・3年生',dayType:'A',reviewed:true,sourceId:'src',sourcePage:1});
  return {project,options:{term:'S',classId:'1-1',scope:'1・2・3年生',start:'2026-04-06',end:'2026-04-10',revision:'2026.S.0',coverageConfirmed:true,periods:[{number:1,start:'08:40',end:'10:10'}]}};
}
