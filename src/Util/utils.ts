// noinspection JSUnusedGlobalSymbols

import { BookInfo, PageInfo } from "./type";

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

export function buildPageId(pageInfo: PageInfo | undefined, separator: string = "."): string {
  if (isInvalidBook(pageInfo))
    return undefined;

  const { section, owner, book, page } = pageInfo;
  return [ section, owner, book, page ].join(separator);
}

export function buildBookId(bookInfo: BookInfo, separator: string = "."): string {
  if (isInvalidBook(bookInfo))
    return undefined;

  const { section, owner, book } = bookInfo;
  return [ section, owner, book ].join(separator);
}

/**
 * Using the props received pageInfo, check if it is the same page or not.
 *
 * @param {PageInfo} page1
 * @param {PageInfo} page2
 * @returns {boolean}
 */
export const isSamePage = (page1: PageInfo | undefined, page2: PageInfo | undefined): boolean => {
  return page1 === page2
      || (isSameBook(page1, page2) && page1.page === page2.page);
};

export const isSameBook = (bookOne?: BookInfo, bookTwo?: BookInfo): boolean => {
  return bookOne === bookTwo
      || (bookOne && bookTwo
             && bookOne.section === bookTwo.section
             && bookOne.owner === bookTwo.owner
             && bookOne.book === bookTwo.book);
};

export const InvalidBookInfo = {
  section: -1,
  owner: -1,
  book: -1,
};

export const InvalidPageInfo = {
  ... InvalidBookInfo,
  page: -1,
};

export const isInvalidBook = (bookInfo?: BookInfo | null | undefined): boolean =>
    // pageInfo.section === 0 -> abnormal pageInfo
    //|| pageInfo.section === 0 // REVIEW: Despite that it's written that section === 0 is an abnormal pageInfo, there are some nproj files with section 0.
    !bookInfo || isSameBook(bookInfo, InvalidBookInfo) || bookInfo.section === 0;

/**
 * Logic to confirm whether the corresponding page info is a plate paper or not.
 *
 * @param {PageInfo} pageInfo
 * @returns {boolean}
 */
export const isPlatePaper = (pageInfo: PageInfo): boolean => {
  return pageInfo.owner === 1013 && pageInfo.book === 2;
};

let scaleFactor = 1;

export const screenScaleFactor = (factor: number) => {
  scaleFactor = factor;
};

const DPI = window.devicePixelRatio * 96;
// Ncode Formula
const NCODE_SIZE_IN_INCH = (8 * 7) / 600;
const POINT_72DPI_SIZE_IN_INCH = 1 / 72;

export const point72ToNcode = (point: number) => {
  const ratio = NCODE_SIZE_IN_INCH / POINT_72DPI_SIZE_IN_INCH;
  return point / ratio;
};

export const ncodeToScreen = (ncode: number): number => ncode * NCODE_SIZE_IN_INCH * DPI * scaleFactor;
