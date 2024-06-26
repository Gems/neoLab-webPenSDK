import PageDot from "../API/PageDot";
import {Dot, DotTypes} from "./type";

interface FilterProtocol {
  (dot: Dot): void;
}

const MAX_OWNER = 1024;
const MAX_NOTE_ID = 16384;
const MAX_PAGE_ID = 262143;
const MAX_X = 15070;
const MAX_Y = 8480;

export default class DotFilter {
  useFilter = true;

  delta: number = 10;

  dot1 = new PageDot() as Dot;
  dot2 = new PageDot() as Dot;
  makeDownDot = new PageDot() as Dot;
  makeMoveDot = new PageDot() as Dot;
  secondCheck = true;
  thirdCheck = true;

  listener: FilterProtocol;

  constructor(listener: FilterProtocol) {
    this.listener = listener;
  }

  put = (dot: Dot) => {
    if (!this.validateCode(dot))
      return;

    if (dot.dotType == DotTypes.PEN_ERROR || dot.dotType == DotTypes.PEN_INFO)
      return this.sendDot(dot);

    if (dot.dotType == DotTypes.PEN_DOWN) {
      // Start Dot is put in the first dot.
      this.dot1 = dot;
      this.sendDot(dot);
    } else if (dot.dotType == DotTypes.PEN_MOVE) {
      // Just put it in the middle of the first
      if (this.secondCheck) {
        this.dot2 = dot;
        this.secondCheck = false;
      }
      // Middle next Dot checks Middle validation check when first verification succeeds, and next Dot when failure
      else if (this.thirdCheck) {
        if (this.validateStartDot(this.dot1, this.dot2, dot)) {
          this.sendDot(this.dot1);

          if (this.validateMiddleDot(this.dot1, this.dot2, dot)) {
            this.sendDot(this.dot2);
            this.dot1 = this.dot2;
            this.dot2 = dot;
          } else {
            this.dot2 = dot;
          }
        } else {
          this.dot1 = this.dot2;
          this.dot2 = dot;
        }

        this.thirdCheck = false;
      } else {
        if (this.validateMiddleDot(this.dot1, this.dot2, dot)) {
          this.sendDot(this.dot2);
          this.dot1 = this.dot2;
          this.dot2 = dot;
        } else {
          this.dot2 = dot;
        }
      }
    } else if (dot.dotType == DotTypes.PEN_UP) {
      var validateStartDotFlag = true;
      var validateMiddleDotFlag = true;
      //If only one dot is entered and only one Down 1, Move 1, End is entered
      // (Even though only one dot is entered through A_DotData in CommProcessor, Move 1, End 1 data is passed to actual processDot through A_DotUpDownData.)
      if (this.secondCheck) {
        this.dot2 = this.dot1;
      }
      if (this.thirdCheck && this.dot1.dotType == DotTypes.PEN_DOWN) {
        if (this.validateStartDot(this.dot1, this.dot2, dot)) {
          this.sendDot(this.dot1);
        } else {
          validateStartDotFlag = false;
        }
      }

      // Middle Dot Verification
      if (this.validateMiddleDot(this.dot1, this.dot2, dot)) {
        if (!validateStartDotFlag) {
          this.makeDownDot = dot;
          this.makeDownDot.dotType = DotTypes.PEN_DOWN;
          this.sendDot(this.makeDownDot);
        }

        this.sendDot(this.dot2);
      } else {
        validateMiddleDotFlag = false;
      }

      // Last Dot Verification
      if (this.validateEndDot(this.dot1, this.dot2, dot)) {
        if (!validateStartDotFlag && !validateMiddleDotFlag) {
          this.makeDownDot = dot;
          this.makeDownDot.dotType = DotTypes.PEN_DOWN;
          this.sendDot(this.makeDownDot);
        }

        if (this.thirdCheck && !validateMiddleDotFlag) {
          this.makeMoveDot = dot;
          this.makeMoveDot.dotType = DotTypes.PEN_MOVE;
          this.sendDot(this.makeMoveDot);
        }
        this.sendDot(dot);
      } else {
        this.dot2.dotType = DotTypes.PEN_UP;
        this.sendDot(this.dot2);
      }

      // Dot and variable initialization
      this.dot1 = new PageDot();
      this.dot2 = new PageDot();
      this.secondCheck = true;
      this.thirdCheck = true;
    }
  };

  validateCode = (d: Dot) => {
    return d.pageInfo.book < MAX_NOTE_ID && d.pageInfo.page < MAX_PAGE_ID;
  };

  // ==============================================
  // Use 3 points
  // Directionality and Delta X, Delta Y
  // ==============================================

  validateStartDot = (vd1: Dot, vd2: Dot, vd3: Dot) => {
    let d1 = vd1;
    let d2 = vd2;
    let d3 = vd3;
    if (d1.x > MAX_X || d1.x < 1) {
      return false;
    }

    if (d1.y > MAX_Y || d1.y < 1) {
      return false;
    }
    let d123x = d3.x > d1.x == d2.x > d1.x;
    let d13x = Math.abs(d3.x - d1.x);
    let d12x = Math.abs(d1.x - d2.x);
    if (d123x && d13x > this.delta && d12x > this.delta) {
      return false;
    }
    let d123y = d3.y > d1.y == d2.y > d1.y;
    let d13y = Math.abs(d3.y - d1.y);
    let d12y = Math.abs(d1.y - d2.y);
    if (d123y && d13y > this.delta && d12y > this.delta) {
      return false;
    }
    return true;
  };

  validateMiddleDot = (vd1: Dot, vd2: Dot, vd3: Dot) => {
    let d1 = vd1;
    let d2 = vd2;
    let d3 = vd3;
    if (d2.x > MAX_X || d2.x < 1) {
      return false;
    }

    if (d2.y > MAX_Y || d2.y < 1) {
      return false;
    }

    let d123x = d3.x > d2.x == d1.x > d2.x;
    let d23x = Math.abs(d3.x - d2.x);
    let d12x = Math.abs(d1.x - d2.x);
    if (d123x && d23x > this.delta && d12x > this.delta) {
      return false;
    }

    let d123y = d1.y > d2.y == d3.y > d2.y;
    let d13y = Math.abs(d3.y - d2.y);
    let d12y = Math.abs(d1.y - d2.y);
    if (d123y && d13y > this.delta && d12y > this.delta) {
      return false;
    }
    return true;
  };

  validateEndDot = (vd1: Dot, vd2: Dot, vd3: Dot) => {
    let d1 = vd1;
    let d2 = vd2;
    let d3 = vd3;
    if (d3.x > MAX_X || d3.x < 1) {
      return false;
    }

    if (d3.y > MAX_Y || d3.y < 1) {
      return false;
    }

    if (d3.x > d1.x == d3.x > d2.x && Math.abs(d3.x - d1.x) > this.delta && Math.abs(d3.x - d2.x) > this.delta) {
      return false;
    } else if (d3.y > d1.y == d3.y > d2.y && Math.abs(d3.y - d1.y) > this.delta && Math.abs(d3.y - d2.y) > this.delta) {
      return false;
    }
    return true;
  };

  sendDot = (dot: Dot) => {
    this.listener!(dot);
  };
}
