import {Dot, DotTypes} from "./type";

type StrokeDelegate = (stroke: Dot[]) => void;

const MAX_OWNER = 1024;
const MAX_NOTE_ID = 16384;
const MAX_PAGE_ID = 262143;
const MAX_X = 15070;
const MAX_Y = 8480;

const MAX_DELTA: number = 10;

export default class StrokeHandler {
  dots: Dot[] = [];
  strokes: Dot[][] = [];

  delegate: StrokeDelegate;

  constructor(delegate: StrokeDelegate) {
    this.delegate = delegate;
  }

  handleDot(dot: Dot) {
    if (!this.validateCode(dot))
      return;

    this.dots.push(dot);

    const isStrokeOver = dot.dotType === DotTypes.PEN_UP;
    // const missing = Math.max(0, 3 - this.dots.length);
    //
    // if (missing > 0) {
    //   if (!isStrokeOver)
    //     return;
    //
    //   this.dots.push(...new Array(missing).fill(dot));
    // }

    this.processDots();

    if (!isStrokeOver)
      return;

    const stroke = this.dots.splice(0, this.dots.length);

    this.strokes.push(stroke);
    this.delegate(stroke);
  }

  private processDots(): void {
    const length = this.dots.length;

    if (length < 3)
      return;

    const [ d1, d2, d3 ] = this.dots.slice(-3);

    if (!this.validateStartDot(d1, d2, d3)) {
      const removed = this.dots.shift();

      if (removed !== d1)
        console.warn("Illegal state: only PEN_DOWN dot could be considered as invalid start"
                              + ", and it should be the first in the sequence of dots.");

      return;
    }

    if (!this.validateMiddleDot(d1, d2, d3)) {
      this.dots.splice(-2, 1);
      return this.processDots();
    }

    if (!this.validateEndDot(d1, d2, d3)) {
      this.dots.splice(-1, 1);
      return this.processDots();
    }
  }
  
  private validateCode = (dot: Dot) => {
    return  dot.pageInfo.book < MAX_NOTE_ID
            && dot.pageInfo.page < MAX_PAGE_ID
            && (dot.dotType === DotTypes.PEN_DOWN
               || dot.dotType === DotTypes.PEN_UP
               || dot.dotType === DotTypes.PEN_MOVE);
  };

  validateStartDot(d1: Dot, d2: Dot, d3: Dot) {
    return d1.dotType !== DotTypes.PEN_DOWN
        || (this.validateDot(d1)
            && this.checkDeltaDirection(d1.x, d2.x, d3.x)
            && this.checkDeltaDirection(d1.y, d2.y, d3.y));
  };

  private validateMiddleDot(d1: Dot, d2: Dot, d3: Dot){
    return this.validateDot(d2)
        && this.checkDeltaDirection(d2.x, d1.x, d3.x)
        && this.checkDeltaDirection(d2.y, d1.y, d3.y);
  };

  private validateEndDot(d1: Dot, d2: Dot, d3: Dot) {
    return this.validateDot(d3)
        && this.checkDeltaDirection(d3.x, d1.x, d2.x)
        && this.checkDeltaDirection(d3.y, d1.y, d2.y);
  };

  private checkDeltaDirection(t: number, o1: number, o2: number) {
    const delta1 = t - o1;
    const delta2 = t - o2;

    // !(p3 > p1 and p3 > p2) or (p3 < p1 and p3 < p2) => (p3 > p1 !== p3 > p2)
    return delta1 * delta2 < 0
        // some of the deltas is less than the constant delta
        || Math.min(Math.abs(delta1), Math.abs(delta2)) < MAX_DELTA;
  }

  private validateDot(dot: Dot) {
    return !(dot.x < 0 || dot.x > MAX_X || dot.y < 0 || dot.y > MAX_Y);
  }
}
