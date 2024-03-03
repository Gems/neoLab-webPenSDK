import {PageInfo} from "../Util/type";
import {initializeApp} from "firebase/app";
import * as NLog from "../Util/NLog";

import {getDownloadURL, getStorage, ref} from "firebase/storage";
import JSZip from "jszip";
import PUIController from "./PUIController";

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
const NCODE_SIZE_IN_INCH = (8 * 7) / 600;
const POINT_72DPI_SIZE_IN_INCH = 1 / 72;

const point72ToNcode = (p: number) => {
  const ratio = NCODE_SIZE_IN_INCH / POINT_72DPI_SIZE_IN_INCH;
  return p / ratio;
};

const getNprojUrl = async (pageInfo: PageInfo) => {
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

/**
 * Calculate page margin info
 * -> define X(min/max), Y(min,max)
 */
const extractMarginInfo = async (url: string | null, pageInfo: PageInfo) => {
  const page = pageInfo.page;
  const nprojUrl = url ?? await getNprojUrl(pageInfo);

  NLog.debug("[NoteServer] Get the page margin from the following url => " + nprojUrl);

  try {
    const res = await fetch(nprojUrl);
    const nprojXml = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(nprojXml, "text/xml");

    const section = doc.children[0].getElementsByTagName("section")[0]?.innerHTML;
    const owner = doc.children[0].getElementsByTagName("owner")[0]?.innerHTML;
    const book = doc.children[0].getElementsByTagName("code")[0]?.innerHTML;

    let startPage = doc.children[0].getElementsByTagName("start_page")[0]?.innerHTML;
    const segment_info = doc.children[0].getElementsByTagName("segment_info")

    if (segment_info)
      startPage = segment_info[0].getAttribute("ncode_start_page");

    const page_item = doc.children[0].getElementsByTagName("page_item")[page - parseInt(startPage)];

    if (page_item === undefined)
      throw new Error("Page item is undefined");

    NLog.debug(`Target SOBP: ${section}(section) ${owner}(owner) ${book}(book) ${page}(page)`);

    let x1, x2, y1, y2, crop_margin, l, t, r, b;

    x1 = parseInt(page_item.getAttribute("x1"));
    x2 = parseInt(page_item.getAttribute("x2"));
    y1 = parseInt(page_item.getAttribute("y1"));
    y2 = parseInt(page_item.getAttribute("y2"));

    crop_margin = page_item.getAttribute("crop_margin");
    const margins = crop_margin.split(",");
    l = parseFloat(margins[0]);
    t = parseFloat(margins[1]);
    r = parseFloat(margins[2]);
    b = parseFloat(margins[3]);

    const Xmin = point72ToNcode(x1) + point72ToNcode(l);
    const Ymin = point72ToNcode(y1) + point72ToNcode(t);
    const Xmax = point72ToNcode(x2) - point72ToNcode(r);
    const Ymax = point72ToNcode(y2) - point72ToNcode(b);

    return { Xmin, Xmax, Ymin, Ymax };
  } catch (err) {
    NLog.error(err);
    throw err;
  }
};


/**
 * GET note image function
 */
const getNoteImage = async (pageInfo: PageInfo): Promise<string> => {
  const zipUrl = `png/${pageInfo.section}_${pageInfo.owner}_${pageInfo.book}.zip`;
  const page = pageInfo.page;

  const jszip = new JSZip();

  console.debug("Downloading URL for: " + zipUrl);

  return await getDownloadURL(ref(storage, zipUrl))
      .then(async (url) => {
        console.debug("Zip URL: " + url);
        const zipBlob = await fetch(url).then((res) => res.blob());

        return await jszip
            .loadAsync(zipBlob)
            .then(async function (zip) {
              const pages = Object.values(zip.files)
                  .reduce((o: any, file) => {
                    const found = file.name.match(/(\d+)_(\d+)_(\d+)_(\d+)\.jpg/);
                    const pageNum = found[4];

                    o[pageNum] = file;

                    return o;
                  }, {});

              const pageFile = pages[page] ?? Object.values(pages)[0];

              !pages[page] && console.warn(`Page '${page}' not found, using first page instead`);

              return await pageFile.async("blob").then(URL.createObjectURL);
            });
      });
};

const api = {
  extractMarginInfo,
  getNoteImage,
  setNprojInPuiController,
};

export default api;
