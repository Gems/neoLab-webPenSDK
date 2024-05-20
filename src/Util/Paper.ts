import { PageInfo, PaperSize } from "./type";
import {buildPageId, isInvalidPage, ncodeToScreen, point72ToNcode, safeOp} from "./utils";
import * as NLog from "./NLog";

export type PaperDetails = {
  imageBlobUrl: string;
  paperSize: PaperSize;
};

const PUI = new Map<string, any>()

export function registerPUI(pageInfo: PageInfo, data: any) {
  PUI.set(buildPageId(pageInfo, "."), data);
}

export function isPUI(pageInfo: PageInfo): boolean {
  const { section, owner, book, page } = pageInfo;
  const pageIdParts = [ section, owner, book, page ].filter(Boolean);

  while (pageIdParts.length > 0) {
    const pageId = pageIdParts.join(".");

    if (PUI.has(pageId))
      return true;

    pageIdParts.pop();
  }

  return false;
}

export function parseNproj(nprojXml: string) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(nprojXml, "text/xml");

    const getDocTagElements = (tagName: string): HTMLCollectionOf<Element> =>
        doc.children[0].getElementsByTagName(tagName);
    const getDocTagValue = (tagName: string): string => getDocTagElements(tagName)[0]?.innerHTML;

    // const section = getDocTagValue("section");
    // const owner = getDocTagValue("owner");
    // const book = getDocTagValue("code");

    const startPage = parseInt(
        getDocTagElements("segment_info")[0]?.getAttribute("ncode_start_page")
                ?? getDocTagValue("start_page"));

    const pageSizes = new Map<number, PaperSize>();
    const pageItems = getDocTagElements("page_item");
    const totalPages = pageItems.length;

    for (let i = startPage; i < totalPages; i++) {
      const pageItem = pageItems[i];
      const xLeft = point72ToNcode(parseInt(pageItem.getAttribute("x1")));
      const xRight = point72ToNcode(parseInt(pageItem.getAttribute("x2")));
      const yTop = point72ToNcode(parseInt(pageItem.getAttribute("y1")));
      const yBottom = point72ToNcode(parseInt(pageItem.getAttribute("y2")));

      const margin = pageItem
          .getAttribute("crop_margin")
          ?.split(",")
          ?.map(_ => point72ToNcode(parseFloat(_)));

      const [ marginLeft, marginTop, marginRight, marginBottom ] = margin;

      const Xmin = xLeft + marginLeft;
      const Ymin = yTop + marginTop;
      const Xmax = xRight - marginRight;
      const Ymax = yBottom - marginBottom;

      pageSizes.set(i - startPage, { Xmin, Xmax, Ymin, Ymax, width: xRight, height: yBottom, margin } as PaperSize);
    }

    return pageSizes;
  } catch (err) {
    NLog.error(err);
    throw err;
  }
}