import { PageInfo, PaperSize } from "./type";
import {buildPageId, isInvalidPage, ncodeToScreen, safeOp} from "./utils";
import NoteServer from "../API/NoteServer";

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

export async function fetchPaperDetails(pageInfo: PageInfo, shouldIncludeImageBlobUrl: boolean = true): Promise<PaperDetails | null> {
  // Ed: PUI is a special piece of paper that holds symbols to control input state (color, thickness, etc.)
  if (isInvalidPage(pageInfo) || isPUI(pageInfo))
    return null;

  const imageBlobUrl = shouldIncludeImageBlobUrl ? await safeOp(() => NoteServer.getNoteImage(pageInfo)) ?? "" : "";
  const paperSize = await safeOp(() => NoteServer.extractMarginInfo(pageInfo));

  const width = ncodeToScreen(paperSize.width);
  const height = ncodeToScreen(paperSize.height);
  const Xmin = ncodeToScreen(paperSize.Xmin);
  const Xmax = ncodeToScreen(paperSize.Xmax);
  const Ymin = ncodeToScreen(paperSize.Ymin);
  const Ymax = ncodeToScreen(paperSize.Ymax);
  const margin = paperSize.margin.map(ncodeToScreen);

  return paperSize ? { imageBlobUrl, paperSize: { width, height, margin, Xmin, Xmax, Ymin, Ymax} } : null;
}