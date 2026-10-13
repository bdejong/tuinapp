const SIZE = 2.2;
export const ADVANCE = 2.65;
const mmToPt = (mm: number) => mm * 72 / 25.4;
const f = (n: number) => Number(n.toFixed(5)).toString();

type Point = [number, number];
function svgPoint(x: number, baseline: number, px: number, py: number): Point {
  return [mmToPt(x + px * SIZE / 24), mmToPt(baseline + 1.6 - py * SIZE / 24)];
}
function pathPoint([x,y]: Point): string { return `${f(x)} ${f(y)}`; }

export function draw(ops: string[], bit: number, x: number, baseline: number): void {
  ops.push('q', '0 G', '1 g', '0.38 w', '1 J', '1 j');
  if (bit !== 4) {
    const [cx,cy,r,inner,outer] = bit === 1 ? [12,12,4.3,6.7,10.5] : [9,8,3.6,5.6,7.4];
    const center = svgPoint(x, baseline, cx, cy);
    const radius = mmToPt(r * SIZE / 24);
    const k = radius * 0.551915024494;
    const [px,py] = center;
    ops.push(`${f(px+radius)} ${f(py)} m`, `${f(px+radius)} ${f(py+k)} ${f(px+k)} ${f(py+radius)} ${f(px)} ${f(py+radius)} c`, `${f(px-k)} ${f(py+radius)} ${f(px-radius)} ${f(py+k)} ${f(px-radius)} ${f(py)} c`, `${f(px-radius)} ${f(py-k)} ${f(px-k)} ${f(py-radius)} ${f(px)} ${f(py-radius)} c`, `${f(px+k)} ${f(py-radius)} ${f(px+radius)} ${f(py-k)} ${f(px+radius)} ${f(py)} c`, 'h', 's');
    for (let ray=0;ray<8;ray++) {
      const angle=ray*Math.PI/4;
      const a=svgPoint(x,baseline,cx+inner*Math.cos(angle),cy+inner*Math.sin(angle));
      const b=svgPoint(x,baseline,cx+outer*Math.cos(angle),cy+outer*Math.sin(angle));
      ops.push(`${pathPoint(a)} m`, `${pathPoint(b)} l`, 'S');
    }
  }
  if (bit !== 1) {
    const [scale,dx,dy] = bit === 2 ? [0.9,1.5,3.5] : [1,0,0];
    const coords: Point[] = [[6,19],[1,19],[.5,12],[5,10.5],[5,4.5],[14,3],[17.5,9],[24,8],[26,19],[19,19]].map(([px,py])=>svgPoint(x,baseline,dx+px*scale,dy+py*scale));
    ops.push(`${pathPoint(coords[0])} m`);
    for(let i=1;i<coords.length;i+=3) {
      const [c1,c2,end]=coords.slice(i,i+3);
      ops.push(`${pathPoint(c1)} ${pathPoint(c2)} ${pathPoint(end)} c`);
    }
    ops.push('h', 'B');
  }
  ops.push('Q');
}

export function legend(ops: string[], text: (value:string,size:number,x:number,y:number,bold?:boolean)=>void): void {
  for (const [bit,label,x] of [[1,'Full sun',75],[2,'Half sun',100],[4,'Shade',125]] as const) {
    draw(ops,bit,x,290);
    text(label,5.5,x+3,290);
  }
  text('[1] = plant note',5.5,150,290);
}
