import { describe, expect, it } from 'vitest';
import { generateMonthPdf, generatePdf, printDataFromMonth, type CategoryData, type MonthData, type PrintData, type PrintPlant } from '../../cloudflare/pdf';

const empty=():CategoryData=>({vegetables:[],flowers:[],herbs:[],other:[]});
function fixture():PrintData {
  return {monthName:'October',sowEarly:{vegetables:[{name:'Carrot',sun_requirements:1,note:1},{name:'Pea',sun_requirements:2}],flowers:[{name:'Dahlia',sun_requirements:1}],herbs:[{name:'Basil',sun_requirements:1}],other:[]},sowLate:empty(),plantEarly:empty(),plantLate:empty(),activities:['Prune - After frost'],notes:['Sow after the last frost.']};
}
type Text={page:number;value:string;font:string;size:number;x:number;y:number};
function readPdf(bytes:Uint8Array):{pages:string[];texts:Text[];source:string} {
  const source=new TextDecoder('latin1').decode(bytes);
  const streams=[...source.matchAll(/<<(?:.|\n)*?\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)].map(m=>m[2]);
  const pages=streams.filter(s=>/\bBT\b/.test(s));
  const texts:Text[]=[];
  pages.forEach((content,page)=>{
    for(const match of content.matchAll(/BT \/(F[12]) ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm <([\da-f]*)> Tj ET/g)) {
      const hex=match[5];let value='';for(let i=0;i<hex.length;i+=2)value+=String.fromCharCode(parseInt(hex.slice(i,i+2),16));
      texts.push({page:page+1,value,font:match[1]==='F1'?'Helvetica':'Helvetica-Bold',size:+match[2],x:+match[3],y:+match[4]});
    }
  });
  return {pages,texts,source};
}
const pt=(mm:number)=>mm*72/25.4;
function near(actual:number,expected:number){expect(Math.abs(actual-expected)).toBeLessThan(.01);}
function entry(name:string):PrintPlant{return {name,sun_requirements:0};}

describe('Cloudflare PDF renderer',()=>{
  it('preserves A4 geometry, typography, columns and vertical rhythm',()=>{
    const {pages,texts,source}=readPdf(generatePdf(fixture()));
    expect(pages).toHaveLength(1);
    expect(source).toContain(`/MediaBox [0 0 ${pt(210).toFixed(5)} ${pt(297).toFixed(5)}]`);
    for(const [value,font,size,x,y] of [
      ['Sow This Month','Helvetica-Bold',11,10,290],['Early October','Helvetica-Bold',8,10,285],['Vegetables','Helvetica-Bold',6.5,10,281.5],['Flowers','Helvetica-Bold',6.5,75,281.5],['Herbs','Helvetica-Bold',6.5,140,281.5],
      ['\x7f Carrot','Helvetica',5.5,10,278.5],['\x7f Dahlia','Helvetica',5.5,75,278.5],['\x7f Basil','Helvetica',5.5,140,278.5],['\x7f Pea','Helvetica',5.5,10,275.7],['Late October','Helvetica-Bold',8,10,269.9],
    ] as [string,string,number,number,number][]) {
      const t=texts.find(t=>t.value===value);expect(t,`Missing ${value}`).toBeTruthy();expect(t!.page).toBe(1);expect(t!.font).toBe(font);near(t!.size,size);near(t!.x,pt(x));near(t!.y,pt(y));
    }
  });

  it('paginates long columns without losing rows or printing below the page',()=>{
    const data=fixture();data.sowEarly.vegetables=Array.from({length:210},(_,i)=>entry(`Vegetable ${String(i).padStart(3,'0')}`));data.sowEarly.flowers=Array.from({length:105},(_,i)=>entry(`Flower ${String(i).padStart(3,'0')}`));data.sowEarly.herbs=Array.from({length:110},(_,i)=>entry(`Herb ${String(i).padStart(3,'0')}`));
    const {pages,texts}=readPdf(generatePdf(data));expect(pages).toHaveLength(3);
    for(const [prefix,count,x] of [['Vegetable',210,10],['Flower',105,75],['Herb',110,140]] as [string,number,number][])for(let i=0;i<count;i++){
      const value=`\x7f ${prefix} ${String(i).padStart(3,'0')}`,rows=texts.filter(t=>t.value===value);expect(rows,`Missing/repeated ${value}`).toHaveLength(1);near(rows[0].x,pt(x));near(rows[0].size,5.5);
    }
    for(const t of texts)expect(t.y).toBeGreaterThanOrEqual(pt(12)-.001);
    for(const page of [2,3]){expect(texts.some(t=>t.page===page&&t.value==='Early October')).toBe(true);expect(texts.some(t=>t.page===page&&t.value==='Vegetables')).toBe(true);}
  });

  it('places uncategorized plants in the herbs column under Other',()=>{
    const data=fixture();data.sowEarly.other.push(entry('Uncategorized plant'));const {texts}=readPdf(generatePdf(data));
    const heading=texts.find(t=>t.value==='Other')!,plant=texts.find(t=>t.value.includes('Uncategorized plant'))!;near(heading.x,pt(140));near(heading.size,6.5);near(plant.x,pt(140));near(plant.size,5.5);expect(plant.y).toBeLessThan(heading.y);
  });

  it('keeps the minimal empty-calendar output and truncates long activities',()=>{
    const data=fixture();data.sowEarly=empty();data.activities=[];const {pages,texts}=readPdf(generatePdf(data));expect(pages).toHaveLength(1);expect(texts.some(t=>t.value==='No activities this month'&&t.size===5.5)).toBe(true);
    const long=fixture();long.activities=['x'.repeat(120)];expect(readPdf(generatePdf(long)).texts.some(t=>t.value===`\x7f ${'x'.repeat(97)}...`&&t.size===5.5)).toBe(true);
  });

  it('deduplicates normalized notes and reuses their numbered references',()=>{
    const p={name:'Carrot',plant_type:'vegetable_fruit',sun_requirements:7,sow_periods:3,plant_periods:3,notes:'  First line\r\n\n  Second\t line.  '};
    const month:MonthData={sow_early:[p,{...p,name:'Pea',notes:'First line Second line.'}],sow_late:[p],plant_early:[p],plant_late:[p],activities:[]};
    const data=printDataFromMonth('January',month);expect(data.notes).toEqual(['First line Second line.']);expect(data.sowEarly.vegetables[0].note).toBe(1);expect(data.sowLate.vegetables[0].note).toBe(1);expect(data.plantLate.vegetables[0].note).toBe(1);
    const {texts}=readPdf(generatePdf(data));expect(texts.filter(t=>t.value==='First line Second line.')).toHaveLength(1);expect(texts.some(t=>t.value==='Plant notes')).toBe(true);expect(texts.some(t=>t.value.includes('(N)')||t.value.includes('***'))).toBe(false);
  });

  it('does not make note references for whitespace-only notes',()=>{
    const data=printDataFromMonth('January',{sow_early:[{name:'Basil',plant_type:'herb',sun_requirements:0,notes:' \r\n\t '}],sow_late:[],plant_early:[],plant_late:[],activities:[]});
    expect(data.notes).toEqual([]);expect(data.sowEarly.herbs[0].note).toBeUndefined();expect(readPdf(generatePdf(data)).texts.some(t=>t.value==='Plant notes')).toBe(false);
  });

  it('wraps long notes into three columns, breaks oversized words and retains WinAnsi accents',()=>{
    const data=fixture();data.notes=Array.from({length:120},(_,i)=>{const n=i+1;return `Note${String(n).padStart(3,'0')} ${'cultivation advice '.repeat(15)}Last${String(n).padStart(3,'0')}`;});data.notes.push(`${'X'.repeat(500)} café après l'été`);
    const {pages,texts,source}=readPdf(generatePdf(data));expect(pages.length).toBeGreaterThan(1);
    const extracted=texts.map(t=>t.value).join(' ');for(let i=1;i<=120;i++){const id=String(i).padStart(3,'0');expect(extracted.match(new RegExp(`Note${id}`,'g'))).toHaveLength(1);expect(extracted.match(new RegExp(`Last${id}`,'g'))).toHaveLength(1);}
    expect(extracted.replace(/[^X]/g,'')).toHaveLength(500);
    const encodedTexts=texts.map(t=>t.value).join(' ').toLowerCase();expect(encodedTexts).toContain('caf\xe9');expect(encodedTexts).toContain('apr\xe8s');expect(encodedTexts).toContain("l'\xe9t\xe9");
    for(const t of texts)expect(t.y).toBeGreaterThanOrEqual(pt(12)-.001);
    for(const x of [15,80,145])expect(texts.some(t=>t.value.includes('cultivation')&&Math.abs(t.x-pt(x))<.01)).toBe(true);
  });

  it('draws separate monochrome vector paths for sun, partial shade and shade bits',()=>{
    const counts:number[][]=[];
    for(let bit=0;bit<8;bit++){const data=fixture();data.sowEarly.vegetables[0].sun_requirements=bit;const {pages}=readPdf(generatePdf(data));const content=pages[0];expect(content).not.toMatch(/\b(?:rg|RG|k|K|Do)\b/);expect(content).not.toMatch(/(?:^|\n)(?:0\.5|0\.25) [gG](?:\n|$)/);
      counts.push([(content.match(/\bB\b/g)??[]).length,(content.match(/\bS\b/g)??[]).length]);}
    for(let bit=0;bit<8;bit++){const clouds=Number((bit&2)!==0)+Number((bit&4)!==0),suns=Number((bit&1)!==0)+Number((bit&2)!==0);expect(counts[bit][0]).toBe(counts[0][0]+clouds);expect(counts[bit][1]).toBe(counts[0][1]+8*suns);}
  });

  it('draws the cloud silhouette with the original cubic Bezier controls',()=>{
    const {pages}=readPdf(generatePdf(fixture()));const lines=pages[0].split('\n'),ends=lines.map((line,index)=>line==='B'?index:-1).filter(index=>index>=0);
    expect(ends).toHaveLength(3);
    const shadeEnd=ends[1],start=lines.slice(0,shadeEnd).map((line,index)=>line.endsWith(' m')?index:-1).filter(index=>index>=0).pop()!;
    const cloud=lines.slice(start,shadeEnd+1);expect(cloud.filter(line=>line.endsWith(' c'))).toHaveLength(3);expect(cloud.some(line=>line.endsWith(' l'))).toBe(false);
    const point=(px:number,py:number)=>`${pt(125+px*2.2/24).toFixed(5)} ${pt(290+1.6-py*2.2/24).toFixed(5)}`;
    expect(cloud[0]).toBe(`${point(6,19)} m`);
    expect(cloud[1]).toBe(`${point(1,19)} ${point(.5,12)} ${point(5,10.5)} c`);
  });

  it('exposes the 1-based month entry point and validates month bounds',()=>{
    const month:MonthData={sow_early:[],sow_late:[],plant_early:[],plant_late:[],activities:[]};const parsed=readPdf(generateMonthPdf(10,month));expect(parsed.texts.some(t=>t.value==='Early October')).toBe(true);expect(()=>generateMonthPdf(0,month)).toThrow(RangeError);expect(()=>generateMonthPdf(13,month)).toThrow(RangeError);
  });
});
