import { encodeWinAnsi, width } from './pdf-text';
import * as symbols from './pdf-symbols';

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'] as const;
export interface Plant { name: string; plant_type?: string | null; sun_requirements: number; notes?: string | null; }
export interface Activity { name: string; description?: string | null; }
export interface MonthData { sow_early: Plant[]; sow_late: Plant[]; plant_early: Plant[]; plant_late: Plant[]; activities: Activity[]; }
export interface PrintPlant { name: string; sun_requirements?: number; note?: number | null; }
export interface CategoryData { vegetables: PrintPlant[]; flowers: PrintPlant[]; herbs: PrintPlant[]; other: PrintPlant[]; }
export interface PrintData { monthName: string; sowEarly: CategoryData; sowLate: CategoryData; plantEarly: CategoryData; plantLate: CategoryData; activities: string[]; notes?: string[]; }

const mmToPt=(mm:number)=>mm*72/25.4;
const n=(value:number)=>Number(value.toFixed(5)).toString();
const emptyCategory=():CategoryData=>({vegetables:[],flowers:[],herbs:[],other:[]});

function categorize(plants:Plant[], notes:string[]):CategoryData {
  const data=emptyCategory();
  for(const type of ['vegetable_fruit','flower','herb',null] as const) {
    for(const p of plants.filter(p=>(p.plant_type??null)===type)) {
      const normalized=(p.notes??'').trim().split(/\s+/u).filter(Boolean).join(' ');
      let note:number|undefined;
      if(normalized) { let index=notes.indexOf(normalized);if(index<0){notes.push(normalized);index=notes.length-1;}note=index+1; }
      const row={name:p.name,sun_requirements:p.sun_requirements,note};
      (type==='vegetable_fruit'?data.vegetables:type==='flower'?data.flowers:type==='herb'?data.herbs:data.other).push(row);
    }
  }
  return data;
}

export function printDataFromMonth(monthName:string, monthData:MonthData):PrintData {
  const notes:string[]=[];
  return {monthName,sowEarly:categorize(monthData.sow_early,notes),sowLate:categorize(monthData.sow_late,notes),plantEarly:categorize(monthData.plant_early,notes),plantLate:categorize(monthData.plant_late,notes),activities:monthData.activities.map(a=>a.description?`${a.name} - ${a.description}`:a.name),notes};
}

type Page={ops:string[]};
class Layout {
  pages:Page[]=[{ops:[]}];
  page=this.pages[0];
  y=290;
  text(value:string,size:number,x:number,y:number,bold=false):void {
    const bytes=encodeWinAnsi(value);
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    this.page.ops.push(`BT /${bold?'F2':'F1'} ${n(size)} Tf 1 0 0 1 ${n(mmToPt(x))} ${n(mmToPt(y))} Tm <${hex}> Tj ET`);
  }
  newPage():void { this.page={ops:[]};this.pages.push(this.page);this.y=290;symbols.legend(this.page.ops,this.text.bind(this)); }
  checkPage():void { if(this.y<12)this.newPage(); }
}

function drawPlant(layout:Layout,plant:PrintPlant,x:number,y:number):void {
  const name=`• ${plant.name}`;
  layout.text(name,5.5,x,y);
  let cursor=x+width(name,5.5)+.6;
  for(const bit of [1,2,4]) if(((plant.sun_requirements??0)&bit)!==0){symbols.draw(layout.page.ops,bit,cursor,y);cursor+=symbols.ADVANCE;}
  if(plant.note!=null)layout.text(`[${plant.note}]`,5.5,cursor,y);
}

function wrapNote(note:string,maxWidth:number):string[] {
  const lines:string[]=[];let line='';
  for(const word of note.split(/\s+/u).filter(Boolean)) {
    if(line&&width(`${line} ${word}`,5.5)>maxWidth){lines.push(line);line='';}
    if(line)line+=' ';
    for(const c of word) { if(line&&width(line+c,5.5)>maxWidth){lines.push(line);line='';}line+=c; }
  }
  if(line)lines.push(line);
  return lines;
}

function truncate(s:string,max:number):string { const chars=Array.from(s);return chars.length>max?`${chars.slice(0,max-3).join('')}...`:s; }

function drawPdf(data:PrintData):Uint8Array {
  const layout=new Layout();
  const col1=10,col2=75,col3=140,lineHeight=2.8,bottom=12;
  const rowText=(value:string,size:number,x:number,y:number,bold=false)=>layout.text(value,size,x,y,bold);
  const drawPeriod=(period:CategoryData,label:string)=>{
    const third:({kind:'plant';plant:PrintPlant}|{kind:'heading'}|{kind:'gap'})[]=period.herbs.map(plant=>({kind:'plant',plant}));
    if(period.other.length){if(third.length)third.push({kind:'gap'});third.push({kind:'heading'});for(const plant of period.other)third.push({kind:'plant',plant});}
    const rows=Math.max(period.vegetables.length,period.flowers.length,third.length);
    for(let row=0;row<rows;row++) {
      if(layout.y<bottom){layout.newPage();rowText(`${label} ${data.monthName}`,8,col1,layout.y,true);layout.y-=3.5;rowText('Vegetables',6.5,col1,layout.y,true);rowText('Flowers',6.5,col2,layout.y,true);rowText('Herbs',6.5,col3,layout.y,true);layout.y-=3;}
      const veg=period.vegetables[row],flower=period.flowers[row];if(veg)drawPlant(layout,veg,col1,layout.y);if(flower)drawPlant(layout,flower,col2,layout.y);
      const t=third[row];if(t?.kind==='plant')drawPlant(layout,t.plant,col3,layout.y);else if(t?.kind==='heading')rowText('Other',6.5,col3,layout.y,true);
      layout.y-=lineHeight;
    }
  };
  const headings=(label:string)=>{rowText(label,8,col1,layout.y,true);layout.y-=3.5;rowText('Vegetables',6.5,col1,layout.y,true);rowText('Flowers',6.5,col2,layout.y,true);rowText('Herbs',6.5,col3,layout.y,true);layout.y-=3;};
  const periodGroup=(period:CategoryData,label:string)=>{headings(`${label} ${data.monthName}`);drawPeriod(period,label);};
  symbols.legend(layout.page.ops,layout.text.bind(layout));
  rowText('Sow This Month',11,col1,layout.y,true);layout.y-=5;
  periodGroup(data.sowEarly,'Early');layout.y-=3;layout.checkPage();
  if(layout.y-6.5<bottom)layout.newPage();
  periodGroup(data.sowLate,'Late');layout.y-=5;layout.checkPage();
  if(layout.y-11.5<bottom)layout.newPage();
  rowText('Plant This Month',11,col1,layout.y,true);layout.y-=5;
  periodGroup(data.plantEarly,'Early');layout.y-=3;layout.checkPage();
  if(layout.y-6.5<bottom)layout.newPage();
  periodGroup(data.plantLate,'Late');layout.y-=5;layout.checkPage();
  if(layout.y-4<bottom)layout.newPage();
  rowText('Activities',11,col1,layout.y,true);layout.y-=4;
  if(!data.activities.length)rowText('No activities this month',5.5,col1,layout.y);
  else for(const activity of data.activities){layout.checkPage();rowText(`• ${truncate(activity,100)}`,5.5,col1,layout.y);layout.y-=lineHeight;}
  const noteLines=(data.notes??[]).flatMap((note,index)=>wrapNote(note,57).map((body,line)=>({number:index+1,first:line===0,body})));
  let offset=0;
  while(offset<noteLines.length){layout.y-=1;if(layout.y-3.5<bottom)layout.newPage();rowText('Plant notes',8,col1,layout.y,true);layout.y-=3.5;
    const capacity=Math.floor((layout.y-bottom)/2.2)+1,count=Math.min(noteLines.length-offset,capacity*3),rows=Math.ceil(count/3);
    for(const [column,x] of [col1,col2,col3].entries())for(let row=0;row<rows;row++){
      const index=offset+column*rows+row;if(index>=offset+count)break;const line=noteLines[index],baseline=layout.y-row*2.2;
      if(line.first||row===0)rowText(`[${line.number}]`,5.5,x,baseline);rowText(line.body,5.5,x+5,baseline);
    }
    offset+=count;if(offset<noteLines.length)layout.newPage();
  }
  return encodeDocument(layout.pages,data.monthName);
}

function ascii(value:string):Uint8Array{return new TextEncoder().encode(value);}
function concat(chunks:Uint8Array[]):Uint8Array {const size=chunks.reduce((sum,b)=>sum+b.length,0),out=new Uint8Array(size);let offset=0;for(const b of chunks){out.set(b,offset);offset+=b.length;}return out;}
function encodeDocument(pages:Page[],monthName:string):Uint8Array {
  const objects:Uint8Array[]=[];
  const add=(body:string|Uint8Array)=>{objects.push(typeof body==='string'?ascii(body):body);return objects.length;};
  const catalog=add('');const pageTree=add('');
  const regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds:number[]=[];
  for(const page of pages){
    const content=ascii(page.ops.join('\n')+'\n');
    const contentId=add(concat([ascii(`<< /Length ${content.length} >>\nstream\n`),content,ascii('endstream')]));
    const pageId=add('');pageIds.push(pageId);
    objects[pageId-1]=ascii(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${n(mmToPt(210))} ${n(mmToPt(297))}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`);
  }
  objects[catalog-1]=ascii(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
  objects[pageTree-1]=ascii(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const title=monthName.replace(/[()\\]/g,'\\$&');
  const info=add(`<< /Title (Garden Planner - ${title}) /Producer (Tuinapp TypeScript PDF renderer) >>`);
  const chunks:Uint8Array[]=[ascii('%PDF-1.4\n%âãÏÓ\n')],offsets=[0];let pos=chunks[0].length;
  for(let i=0;i<objects.length;i++){offsets.push(pos);const object=concat([ascii(`${i+1} 0 obj\n`),objects[i],ascii('\nendobj\n')]);chunks.push(object);pos+=object.length;}
  const xref=pos;let table=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(const offset of offsets.slice(1))table+=`${offset.toString().padStart(10,'0')} 00000 n \n`;
  table+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;chunks.push(ascii(table));return concat(chunks);
}

export function generatePdf(data:PrintData):Uint8Array { return drawPdf(data); }
export function generateMonthPdf(month:number,monthData:MonthData):Uint8Array {
  if(!Number.isInteger(month)||month<1||month>12)throw new RangeError('Month must be between 1 and 12');
  return generatePdf(printDataFromMonth(MONTHS[month-1],monthData));
}
