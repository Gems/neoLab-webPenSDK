import {Paper, Dot, DotTypes, PenTipTypes, Angle, PageInfo} from "../Util/type";
import {pageInfo} from "../Util/utils";

class PageDot implements Dot {
  pageInfo: PageInfo;
  x: number;
  y: number;
  f: number;
  dotType: DotTypes;
  timeDiff: number;
  timeStamp: number;
  penTipType: PenTipTypes;
  color: number;
  angle: Angle;

  constructor() {
    this.pageInfo = pageInfo(0, 0, 0, 0);
    this.x = 0;
    this.y = 0;
    this.angle = {
      tx: 0,
      ty: 0,
      twist: 0,
    };
    this.f = 0;
    this.color = 0x000000ff;
    this.timeDiff = 0;
    this.timeStamp = 0;
    this.dotType = DotTypes.PEN_DOWN;
    this.penTipType = PenTipTypes.NORMAL; // 0: Normal, 1: Eraser
  }

  static MakeDot(
      paper: Paper,
      x: number,
      y: number,
      force: number,
      type: DotTypes,
      penTipType: PenTipTypes,
      color: number,
      angle = { tx: 0, ty: 0, twist: 0 }): PageDot {

    const builder = new DotBuilder();

    const xx = parseFloat(x.toFixed(2));
    const yy = parseFloat(y.toFixed(2));

    builder
      .owner(paper.owner)
      .section(paper.section)
      .note(paper.book)
      .page(paper.page)
      .timeDiff(paper.timeDiff)
      .timeStamp(paper.time)
      .coord(xx, yy)
      .force(force)
      .dotType(type)
      .penTipType(penTipType)
      .color(color)
      .angle(angle);

    return builder.Build();
  }

  Clone(dotType?: DotTypes) {
    const newDot = new PageDot();

    newDot.pageInfo = this.pageInfo;
    newDot.x = this.x;
    newDot.y = this.y;
    newDot.f = this.f;
    newDot.timeDiff = this.timeDiff;
    newDot.timeStamp = this.timeStamp;
    newDot.dotType = dotType ?? this.dotType;
    newDot.penTipType = this.penTipType;
    newDot.color = this.color;
    newDot.angle = this.angle;

    return newDot;
  }
}

class DotBuilder {
  dot: PageDot;

  constructor() {
    this.dot = new PageDot();
  }

  section(section: number) {
    this.dot.pageInfo.section = section;
    return this;
  }

  owner(owner: number) {
    this.dot.pageInfo.owner = owner;
    return this;
  }

  note(note: number) {
    this.dot.pageInfo.book = note;
    return this;
  }

  page(page: number) {
    this.dot.pageInfo.page = page;
    return this;
  }

  timeDiff(timeDiff: number) {
    this.dot.timeDiff = timeDiff;
    return this;
  }

  timeStamp(timeStamp: number) {
    this.dot.timeStamp = timeStamp;
    return this;
  }

  coord(x: number, y: number) {
    this.dot.x = x;
    this.dot.y = y;
    return this;
  }

  angle(angle: Angle) {
    this.dot.angle.tx = angle.tx;
    this.dot.angle.ty = angle.ty;
    this.dot.angle.twist = angle.twist;
    return this;
  }

  tilt(tx: number, ty: number) {
    this.dot.angle.tx = tx;
    this.dot.angle.ty = ty;
    return this;
  }

  twist(twist: number) {
    this.dot.angle.twist = twist;
    return this;
  }

  force(force: number) {
    this.dot.f = force;
    return this;
  }

  dotType(dotType: DotTypes) {
    this.dot.dotType = dotType;
    return this;
  }

  penTipType(penTipType: PenTipTypes) {
    this.dot.penTipType = penTipType;
    return this;
  }

  color(color: number) {
    this.dot.color = color;
    return this;
  }

  Build() {
    return this.dot;
  }
}

export default PageDot;

export { DotBuilder };
