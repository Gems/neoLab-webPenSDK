import {Dot, ScreenDot, ScreenMode, PageInfo, PaperSize, View } from "./type";

export async function fromMap<K,V>(map: Map<K,V>, key: K, supplier: (key: K) => Promise<V>): Promise<V> {
  if (!map.has(key))
    map.set(key, await supplier(key));

  return map.get(key);
}

export async function safeOp<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Create a PageInfo object with the given parameters.
 *
 * @param {number} section
 * @param {number} owner
 * @param {number} book
 * @param {number} page
 * @returns {PageInfo}
 */
export const pageInfo = (section: number, owner: number, book: number, page: number): PageInfo =>
    ({ section, owner, book, page });

export function buildPageId(pageInfo: PageInfo, separator: string = "."): string {
  if (isInvalidPage(pageInfo))
    return undefined;

  const { section, owner, book, page } = pageInfo;
  return [ section, owner, book, page ].join(separator);
}

export function buildBookId(pageInfo: PageInfo, separator: string = "."): string {
  if (isInvalidPage(pageInfo))
    return undefined;

  const { section, owner, book } = pageInfo;
  return [ section, owner, book ].join(separator);
}

/**
 * Using the props received pageInfo, check if it is the same page or not.
 *
 * @param {PageInfo} page1
 * @param {PageInfo} page2
 * @returns {boolean}
 */
export const isSamePage = (page1: PageInfo, page2: PageInfo): boolean => {
  return page1 === page2
      || (!page1 && !page2 && page1.section === page2.section
                           && page1.owner === page2.owner
                           && page1.book === page2.book
                           && page1.page === page2.page);
};

export const InvalidPageInfo = {
  section: -1,
  owner: -1,
  book: -1,
  page: -1,
};

export const isInvalidPage = (pageInfo?: PageInfo | null): boolean =>
                                                          // pageInfo.section === 0 -> abnormal pageInfo
    !pageInfo || isSamePage(pageInfo, InvalidPageInfo) || pageInfo.section === 0;

/**
 * Logic to confirm whether the corresponding page info is a plate paper or not.
 *
 * @param {PageInfo} pageInfo
 * @returns {boolean}
 */
export const isPlatePaper = (pageInfo: PageInfo): boolean => {
  return pageInfo.owner === 1013 && pageInfo.book === 2;
};

/**
 * Translate the coordinate value to a value that matches the view size of the Canvas using the Ncode dot coordinates.
 * @param {Dot} dot
 * @param {View} view
 * @param {PaperSize} paperSize
 * @returns {ScreenDot}
 */
export const ncodeToScreen = (dot: Dot, view: View, paperSize: PaperSize): ScreenDot => {
  let paperBase, paperWidth, paperHeight;
  paperBase = { Xmin: paperSize.Xmin, Ymin: paperSize.Ymin }; // The margin value of Ncode paper,
  paperWidth = paperSize.Xmax - paperSize.Xmin; // The width of Ncode paper in pixels.
  paperHeight = paperSize.Ymax - paperSize.Ymin; // The height of Ncode paper in pixels.

  /**
   * ncode_size : ncode_dot_position = view_size : view_dot_position
   * view_dot_position = (ncode_dot_position * view_size) / ncode_size
   * Therefore, multiply each value of ncode_dot_position by its corresponding width and height ratio to get the final size.
   *
   * widthRatio = view.width / paperWidth
   * heightRatio = view.height / paperHeight
   */

  const widthRatio = view.width / paperWidth;
  const heightRatio = view.height / paperHeight;
  // By subtracting the basic margin values of dot (Xmin and Ymin) from the final size.
  const x = (dot.x - paperBase.Xmin) * widthRatio;
  const y = (dot.y - paperBase.Ymin) * heightRatio;

  return { x, y };
};

/**
 * Translate the coordinates of Ncode dot in SmartPlate to a value that matches the view size of Canvas and angle (degree).
 * @param {Dot} dot
 * @param {View} view
 * @param {number} angle - [0', 180']: landscape, [90', 270']: portrait
 * @param {PaperSize} paperSize
 * @returns {ScreenDot}
 */
export const ncodeToSmartPlateScreen = (dot: Dot, view: View, angle: number, paperSize: PaperSize): ScreenDot => {
  const plateMode = angle === 90 || angle === 270 ? ScreenMode.PORTRAIT : ScreenMode.LANDSCAPE;
  const xDiff = paperSize.Xmax - paperSize.Xmin;
  const yDiff = paperSize.Ymax - paperSize.Ymin;

  // When plateMode is portrait, swap the width and height values of Ncode
  const paperWidth = plateMode === ScreenMode.LANDSCAPE ? xDiff : yDiff;
  const paperHeight = plateMode === ScreenMode.LANDSCAPE ? yDiff : xDiff;
  const paperBase = { Xmin: paperSize.Xmin, Ymin: paperSize.Ymin };

  let nx = Math.cos((Math.PI / 180) * angle) * dot.x - Math.sin((Math.PI / 180) * angle) * dot.y;
  let ny = Math.sin((Math.PI / 180) * angle) * dot.x + Math.cos((Math.PI / 180) * angle) * dot.y;

  if (angle === 0) {
    paperBase.Xmin = 0;
    paperBase.Ymin = 0;
  } else if (angle === 90) {
    paperBase.Ymin = 0;
    nx += paperSize.Ymax;
  } else if (angle === 180) {
    nx += paperSize.Xmax;
    ny += paperSize.Ymax;
  } else if (angle === 270) {
    paperBase.Xmin = 0;
    ny += paperSize.Xmax;
  }

  const widthRatio = view.width / paperWidth;
  const heightRatio = view.height / paperHeight;
  const x = (nx - paperBase.Xmin) * widthRatio;
  const y = (ny - paperBase.Ymin) * heightRatio;

  return { x, y };
};
