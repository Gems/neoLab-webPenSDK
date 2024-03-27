import {PageInfo, PaperSize} from "../Util/type";
import {initializeApp} from "firebase/app";
import * as NLog from "../Util/NLog";

import {getDownloadURL, getStorage, ref} from "firebase/storage";
import JSZip, {JSZipObject} from "jszip";
import PUIController from "./PUIController";
import { buildBookId, fromMap } from "../Util/utils";

const firebaseConfig = {
  apiKey: "AIzaSyAY7MrI37TvkDerHsShcvOsueDpi4TGihw",
  authDomain: "neonotes2-d0880.firebaseapp.com",
  databaseURL: "https://neonotes2-d0880.firebaseio.com",
  projectId: "neonotes2-d0880",
  storageBucket: "neonotes2-d0880.appspot.com",
  messagingSenderId: "693506452621",
  appId: "1:693506452621:web:8b6600b884b8822d",
  measurementId: "G-44CKW86QHE",
};

const fbApp = initializeApp(firebaseConfig);
const storage = getStorage(fbApp);

// Ncode Formula
const DPI = window.devicePixelRatio * 96;
const NCODE_SIZE_IN_INCH = (8 * 7) / 600;
const POINT_DPI_SIZE_IN_INCH = 1 / DPI;
const POINT_DPI_RATIO = NCODE_SIZE_IN_INCH / POINT_DPI_SIZE_IN_INCH;

const pointToNcode = (point: number) => point / POINT_DPI_RATIO;

const getNprojUrl = async (pageInfo: PageInfo): Promise<string> => {
  try {
    const pageUrl = `nproj/${pageInfo.section}_${pageInfo.owner}_${pageInfo.book}.nproj`;
    console.debug("Downloading URL for: " + pageUrl);
    const nprojUrl = await getDownloadURL(ref(storage, pageUrl));
    console.debug("NProj URL: " + nprojUrl);

    return nprojUrl;
  } catch (err) {
    NLog.log(err);
    throw err;
  }
}

/**
 * Set Note Page PUI in PUIController
 */
const setNprojInPuiController = async (url: string | null, pageInfo: PageInfo) => {
  const nprojUrl = url ?? await getNprojUrl(pageInfo);

  NLog.debug("[NoteServer] In the PUIController, set nporj at the following url => " + nprojUrl);

  await PUIController.getInstance().fetchOnlyPageSymbols(nprojUrl, pageInfo);
};

const NprojCache = new Map<string, Map<number, PaperSize>>();

const fetchNproj = async (nprojUrl: string): Promise<Map<number, PaperSize>> => {
  NLog.debug("[NoteServer] Get NProj via the following url: " + nprojUrl);

  try {
    const nprojXml = await fetch(nprojUrl).then(res => res.text());
    const parser = new DOMParser();
    const doc = parser.parseFromString(nprojXml, "text/xml");

    const getDocTagElements = (tagName: string): HTMLCollectionOf<Element> =>
        doc.children[0].getElementsByTagName(tagName);
    const getDocTagValue = (tagName: string): string => getDocTagElements(tagName)[0]?.innerHTML;

    // const section = getDocTagValue("section");
    // const owner = getDocTagValue("owner");
    // const book = getDocTagValue("code");

    const startPage = parseInt(
        getDocTagElements("segment_info")[0]?.getAttribute("ncode_start_page") ?? getDocTagValue("start_page"));

    const pageSizes = new Map<number, PaperSize>();
    const pageItems = getDocTagElements("page_item");
    const totalPages = pageItems.length;

    for (let i = startPage; i < totalPages; i++) {
      const pageItem = pageItems[i];
      const x1 = parseInt(pageItem.getAttribute("x1"));
      const x2 = parseInt(pageItem.getAttribute("x2"));
      const y1 = parseInt(pageItem.getAttribute("y1"));
      const y2 = parseInt(pageItem.getAttribute("y2"));

      const margins = pageItem.getAttribute("crop_margin")?.split(",");

      const marginLeft = parseFloat(margins[0]);
      const marginTop = parseFloat(margins[1]);
      const marginRight = parseFloat(margins[2]);
      const marginBottom = parseFloat(margins[3]);

      const Xmin = pointToNcode(x1) + pointToNcode(marginLeft);
      const Ymin = pointToNcode(y1) + pointToNcode(marginTop);
      const Xmax = pointToNcode(x2) - pointToNcode(marginRight);
      const Ymax = pointToNcode(y2) - pointToNcode(marginBottom);

      pageSizes.set(startPage - i, {Xmin, Xmax, Ymin, Ymax} as PaperSize);
    }

    return pageSizes;
  } catch (err) {
    NLog.error(err);
    throw err;
  }
};

/**
 * Calculate page margin info
 * -> define X(min/max), Y(min,max)
 */
const extractMarginInfo = async (pageInfo: PageInfo): Promise<PaperSize> => {
  const bookId = buildBookId(pageInfo);
  const page = pageInfo.page;
  const pagesSizes = await fromMap(
      NprojCache, bookId, () => getNprojUrl(pageInfo).then(fetchNproj));

  return pagesSizes.get(page);
};

const BookPages = new Map<string, Map<number, string>>();

const pageFileNamePattern = /(\d+)_(\d+)_(\d+)_(\d+)\.jpg/;

type NotePages = Map<number, string>;

const downloadNotePages = async (bookId: String): Promise<NotePages> => {
  const zipUrl = `png/${bookId}.zip`;
  const jszip: JSZip = new JSZip();

  NLog.debug("Downloading URL for: " + zipUrl);

  const downloadUrl = await getDownloadURL(ref(storage, zipUrl));

  NLog.debug("Zip download URL: " + downloadUrl);
  const res = await fetch(downloadUrl);
  const zipBlob = await res.blob();
  const zipData: JSZip = await jszip.loadAsync(zipBlob);

  return await Object
      .values(zipData.files)
      .reduce(async (pagesPromise: Promise<NotePages>, file: JSZipObject): Promise<any> => {
        const matches = file.name.match(pageFileNamePattern);
        const page: number | undefined = matches && parseInt(matches[4]) || undefined;
        const pages = await pagesPromise;

        if (page !== undefined)
          pages.set(page, await file.async("blob").then(URL.createObjectURL));

        return pages;
      }, Promise.resolve(new Map<number, string>()));
};

/**
 * GET note image function
 */
const getNoteImage = async (pageInfo: PageInfo): Promise<string> => {
  const { section, owner, book, page } = pageInfo;
  const pages =  await fromMap(
      BookPages, `${section}_${owner}_${book}` as String, downloadNotePages);

  return pages.get(page) ?? pages.get(0);
};

const api = {
  extractMarginInfo,
  getNoteImage,
  setNprojInPuiController,
};

export default api;
