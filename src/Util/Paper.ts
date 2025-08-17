import { BookInfo, PageInfo, PaperSize } from "./type";
import {buildPageId, point72ToNcode} from "./utils";

export type PaperDetails = {
  imageBlobUrl?: string;
  paperSize: PaperSize;
};

export type NprojDetails = BookInfo & {
  pages: Map<number, PaperSize>;
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

/*
    <book>
        <title>네오스마트펜체크시트</title>
        <author></author>
        <section>3</section>
        <owner>27</owner>
        <code>145</code>
        <revision>22</revision>
        <scale>0.001</scale>
        <start_page>1</start_page>
        <key_dot>1</key_dot>
        <dot_is_line_segment>true</dot_is_line_segment>
        <line_segment_length>3</line_segment_length>
        <target_dpi>600</target_dpi>
        <dotsize>1</dotsize>
        <ncp_format>0</ncp_format>
        <kind>0</kind>
        <extra_info>pdf_page_count=1</extra_info>
    </book>

 */

const zeroMargin = [ 0, 0, 0, 0 ];
const parseNumber = (str: string) => parseInt(str, 10);

export function parseNproj(nprojXml: string): NprojDetails {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(nprojXml.trim(), "text/xml");

    const getDocTagElements = (tagName: string): HTMLCollectionOf<Element> =>
        doc.children[0].getElementsByTagName(tagName);
    const getDocTagValue = (tagName: string): string => getDocTagElements(tagName)[0]?.innerHTML;

    const error = getDocTagElements("parsererror")[0]?.textContent;

    if (error)
      throw new Error(`Error while parsing XML: ${error}`);

    const section = parseNumber(getDocTagValue("section"));
    const owner = parseNumber(getDocTagValue("owner"));
    const book = parseNumber(getDocTagValue("code"));

    // const details = {
    //   scale: getDocTagValue("scale"),
    //   key_dot: getDocTagValue("key_dot"),
    //   dot_is_line_segment: getDocTagValue("dot_is_line_segment"),
    //   line_segment_length: getDocTagValue("line_segment_length"),
    //   target_dpi: getDocTagValue("target_dpi"),
    //   dotsize: getDocTagValue("dotsize"),
    //   ncp_format: getDocTagValue("ncp_format"),
    //   kind: getDocTagValue("kind"),
    // };

    const startPage = parseNumber(
        getDocTagElements("segment_info")[0]?.getAttribute("ncode_start_page")
                ?? getDocTagValue("start_page"));

    const pageSizes = new Map<number, PaperSize>();
    const pageItems = getDocTagElements("page_item");
    const totalPages = pageItems.length;

    for (let i = startPage; i < totalPages; i++) {
      const pageItem = pageItems[i];
      const xLeft = point72ToNcode(parseNumber(pageItem.getAttribute("x1")));
      const xRight = point72ToNcode(parseNumber(pageItem.getAttribute("x2")));
      const yTop = point72ToNcode(parseNumber(pageItem.getAttribute("y1")));
      const yBottom = point72ToNcode(parseNumber(pageItem.getAttribute("y2")));

      const margin = pageItem
          .getAttribute("crop_margin")
          ?.split(",")
          ?.map(_ => point72ToNcode(parseFloat(_)));

      if (!margin)
        console.warn(`No margin found for book: ${section}.${owner}.${book}:  using zero margin.`);

      const [ marginLeft, marginTop, marginRight, marginBottom ] = margin ?? zeroMargin;

      const Xmin = xLeft + marginLeft;
      const Ymin = yTop + marginTop;
      const Xmax = xRight - marginRight;
      const Ymax = yBottom - marginBottom;

      pageSizes.set(i - startPage, { Xmin, Xmax, Ymin, Ymax, width: xRight, height: yBottom, margin } as PaperSize);
    }

    return {
      book,
      owner,
      section,
      pages: pageSizes,
    };
  } catch (err) {
    throw err;
  }
}
