import $ from "jquery";
import {PageInfo, Paper} from "../Util/type";
// import GenericPuiNproj from "./nproj/note_3_1013_1.json";
// import GridaPuiNproj from "./nproj/3_1013_1116_Grida.json";
// import PaperTubePuiNproj from "./nproj/papertube_controller_171117.json";
// import SmartClassKitPuiProj from "./nproj/SmartClassKit_Controller.json";
import GenericPuiNproj from "./nproj/note_3_1013_1.nproj";
import GridaPuiNproj from "./nproj/3_1013_1116_Grida.nproj";
import PaperTubePuiNproj from "./nproj/papertube_controller_171117.nproj";
import SmartClassKitPuiProj from "./nproj/SmartClassKit_Controller.nproj";
import {buildPageId} from "../Util/utils";

const PU_TO_NU = 0.148809523809524;

const predefinedPuiGroup = [GenericPuiNproj, GridaPuiNproj, PaperTubePuiNproj, SmartClassKitPuiProj];

let _puiInstance: PUIController = null;

export type PuiSymbolType = {
  pageInfo: PageInfo;
  command: string;

  type: "Rectangle" | "Ellipse" | "Polygon" | "Custom"; // string,
  rect_nu?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  ellipse_nu?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  custom_nu?: {
    left: number;
    top: number;
    width: number;
    height: number;
    lock: boolean;
  };
  polygon?: { x: number; y: number }[];
  extra?: string;
};

type NprojPageJson = {
  pageInfo: PageInfo;
  crop_margin: { left: number; top: number; right: number; bottom: number };
  size_pu: { width: number; height: number };
  nu: { Xmin: number; Ymin: number; Xmax: number; Ymax: number };
  whole: { x1: number; y1: number; x2: number; y2: number };
};

type NprojJson = {
  book: {
    title: string;
    author: string;
    section: number;
    owner: number;
    book: number;
    start_page: number;
    extra_info: {
      [key: string]: string;
    };
  };

  pdf: {
    filename: string;
    numPages: number;
  };

  pages: NprojPageJson[];

  symbols: PuiSymbolType[];

  resources: { [id: string]: string };
};

export function isPUI(pageInfo: PageInfo): boolean {
  const { owner, book, page } = pageInfo;

  return (owner === 27 && book === 161 && page === 1)
      // page === 4, Smart plate
      // page === 1, Plate paper
      || (owner === 1013 && (book === 1 || book === 1116));
}

export function isPUIOnPage(paper: Paper, x: number, y: number): boolean {
  const pageInfo = { section: paper.section, owner: paper.owner, book: paper.note, page: paper.page };
  const pageId = buildPageId(pageInfo);
  const pc = PUIController.getInstance();
  const isInclude = Object.keys(pc._onlyPageSymbols).includes(pageId);

  if (isInclude) {
    const point_nu = {x, y};
    return pc.checkPuiCommand(paper, point_nu);
  }
  return false;
}

function insidePolygon(point: { x: number; y: number }, vs: { x: number; y: number }[]) {
  // ray-casting algorithm based on
  // https://wrf.ecse.rpi.edu/Research/Short_Notes/pnpoly.html/pnpoly.html

  const { x, y } = point;

  let inside = false;

  for (let i = 0, j = vs.length - 1, l = vs.length; i < l; j = i++) {
    const { x: xi, y: yi } = vs[i];
    const { x: xj, y: yj } = vs[j];

    const intersect = yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect)
      inside = !inside;
  }

  return inside;
}

function insideRectangle(
    point: { x: number; y: number },
    rc: { left: number; top: number; width: number; height: number }) {

  return point.x >= rc.left && point.x <= rc.left + rc.width && point.y >= rc.top && point.y <= rc.top + rc.height;
}

function insideEllipse(
    point: { x: number; y: number }, el: { x: number; y: number; width: number; height: number }) {

  const p = Math.pow(point.x - el.x, 2) / Math.pow(el.width, 2) + Math.pow(point.y - el.y, 2) / Math.pow(el.height, 2);
  return p <= 1;
}

function parseKeyValue(text: string | null): { [key: string]: string } {
  if (!text)
    return undefined;

  const answer: { [key: string]: string } = {};
  const keyValue = text.split("=");
  answer[keyValue[0]] = keyValue[1];

  return answer;
}

const regexUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const regexBrackets = /^\{.*}$/;

function isValidResourceIdFormat(id: string) {
  // '{9e3b1b11-1b1e-42be-8684-40679918ebc9}' ==> true
  // '9e3b1b11-1b1e-42be-8684-40679918ebc9' ==> true
  // '{any string}' ==> true

  return regexBrackets.test(id) || regexUUID.test(id);
}

const qvCommandFormat = /^qv/i;

function isNotQuickViewCommand(command: string) {
  return !qvCommandFormat.test(command);
}

export default class PUIController {
  private _pageSymbols: { [pageId: string]: PuiSymbolType[] } = {};

  public _onlyPageSymbols: { [pageId: string]: PuiSymbolType[] } = {};
  private _onlyPageResources: { [id: string]: string } = {};
  private _onlyPageSymbolFlag: boolean = false;

  private readonly _ready: Promise<void>;

  constructor() {
    // this._ready = this.readPredefinedSymbolsByJSON();
    this._ready = this.readPredefinedSymbolsByXML();
  }

  static getInstance() {
    if (!_puiInstance) {
      _puiInstance = new PUIController();
    }

    return _puiInstance;
  }

  /**
   * Parsing and saving function for nproj related to products with a fixed SOBP (Same Old Base Plate)
   * like a plate that is always fixed.
   */
  private readPredefinedSymbolsByXML = async () => {
    for (const url of predefinedPuiGroup) {
      // Retrieve symbols from an nproj file
      const { symbols } = await this.getPuiXML(url);

      // Insert symbols into the corresponding page
      for (const s of symbols) {
        const idStr = buildPageId(s.pageInfo);
        const symbols = (this._pageSymbols[idStr] ?? (this._pageSymbols[idStr] = []));

        symbols.push(s);

        // if (!commands.includes(s.command)) commands.push(s.command);
      }
    }
  };

  // private readPredefinedSymbolsByJSON = async () => {
  //   for (const json of predefinedPuiGroup) {
  //     const symbols = await this.getPuiJSON(json);

  //     for (const s of symbols) {
  //       const idStr = buildPageId(s.pageInfo);
  //       if (!this._pageSymbols[idStr]) this._pageSymbols[idStr] = [];
  //       this._pageSymbols[idStr].push(s);
  //     }
  //   }
  // };

  /**
   * Parsing and saving function for nproj related to products that need to be stored and retrieved
   * from the server, such as numerous notes.
   * @param {string} url
   * @param {number} page - The specific page of the note
   */
  private readPageSymbols = async (url: string, page: number) => {
    const { symbols, resources } = await this.getPuiXML(url);

    this._onlyPageSymbols = {};

    for (let j = 0, l2 = symbols.length; j < l2; j++) {
      const s = symbols[j];

      if (s.pageInfo.page === page) {
        const idStr = buildPageId(s.pageInfo);
        if (!this._onlyPageSymbols[idStr]) this._onlyPageSymbols[idStr] = [];
        this._onlyPageSymbols[idStr].push(s);
      }
    }

    if (Object.keys(resources).length)
      this._onlyPageResources = resources;
  };

  public fetchOnlyPageSymbols = async (url: string, pageInfo: PageInfo) => {
    const key = Object.keys(this._onlyPageSymbols)[0];
    const pageId = buildPageId(pageInfo);

    if (key !== pageId)
      await this.readPageSymbols(url, pageInfo.page);
  };

  public checkPuiCommand = (paper: Paper, point_nu: { x: number; y: number }) => {
    const command = this.getPuiCommand_sync(paper, point_nu);
    // Commands starting with "qv" (QuickView) are not treated as PUI (Pen User Interface).
    const isPUI = command && isNotQuickViewCommand(command);
    this._onlyPageSymbolFlag = isPUI;

    return isPUI;
  };

  public getPuiCommand = async (pageInfo: Paper, x: number, y: number) => {
    await this._ready;
    const command = this.getPuiCommand_sync(pageInfo, { x: x, y: y });

    if (command) {
      this._onlyPageSymbolFlag = false;

      // If the PUI command involves using resources (such as audio), return the resourcePath
      return isValidResourceIdFormat(command)
          ? this._onlyPageResources[command]
          : command;
    }
  };

  private getPuiCommand_sync = (paper: Paper, point_nu: { x: number; y: number }) => {
    const pageInfo = { section: paper.section, owner: paper.owner, book: paper.note, page: paper.page };
    const pageId = buildPageId(pageInfo);
    const symbols: { [pageId: string]: PuiSymbolType[] } = this._onlyPageSymbolFlag ? this._onlyPageSymbols : this._pageSymbols;

    const pageSymbols = symbols[pageId];

    if (!pageSymbols)
      return undefined;

    for (const s of pageSymbols) {
      switch (s.type) {
        case "Rectangle": {
          if (insideRectangle(point_nu, s.rect_nu)) return s.command;
          break;
        }

        case "Ellipse": {
          if (insideEllipse(point_nu, s.ellipse_nu)) return s.command;
          break;
        }

        case "Polygon": {
          if (insidePolygon(point_nu, s.polygon)) {
            return s.command;
          }

          break;
        }
      }
    }

    return undefined;
  };

  get ready() {
    return this._ready;
  }

  private getPuiXML = async (url: string) => {
    const res = await fetch(url);
    const nprojXml = await res.text();
    // console.log(nprojXml);

    // Book information
    const $bookXml = $(nprojXml).find("book");
    const title = $bookXml.find("title").text();
    const author = $bookXml.find("author").text();

    const segment_info = $bookXml.find("segment_info");
    const ncode_start_page_str = segment_info.attr("ncode_start_page");

    const section = parseInt($bookXml.find("section").text(), 10);
    const owner = parseInt($bookXml.find("owner").text(), 10);
    const book = parseInt($bookXml.find("code").text(), 10);
    const startPage = ncode_start_page_str
        ? parseInt(ncode_start_page_str, 10)
        : parseInt($bookXml.find("start_page").text(), 10);

    const extra = $bookXml.find("extra_info")?.text();
    const extra_info = parseKeyValue(extra);

    const $pdfXml = $(nprojXml).find("pdf");
    const filename = $pdfXml.find("path").text();

    // Page information
    const $pages = $(nprojXml).find("pages");
    const numPages = parseInt($pages.attr("count") || "", 10);

    const ret: NprojJson = {
      book: {
        title,
        author,
        section,
        owner,
        book,
        start_page: startPage,
        extra_info,
      },
      pdf: {
        filename,
        numPages,
      },
      pages: new Array(numPages),
      symbols: [],
      resources: {},
    };

    // Handling of page items
    const $page_items = $pages.find("page_item");

    $page_items.each((index: number, page) => {
      const p = $(page);
      const pageDelta = parseInt(p.attr("number") || "index", 10);
      const pageInfo = { section, owner, book, page: startPage + pageDelta };

      const surface_pu = {
        left: parseFloat(p.attr("x1") || "0"),
        top: parseFloat(p.attr("y1") || "0"),
        right: parseFloat(p.attr("x2") || "0"),
        bottom: parseFloat(p.attr("y2") || "0"),
      };

      const $crop_margin = p.attr("crop_margin") || "0,0,0,0";
      const margins = $crop_margin.split(",");
      const crop_margin_pu = {
        left: parseFloat(margins[0]),
        top: parseFloat(margins[1]),
        right: parseFloat(margins[2]),
        bottom: parseFloat(margins[3]),
      };

      const size_pu = {
        width: Math.round(surface_pu.right - crop_margin_pu.right) - (surface_pu.left + crop_margin_pu.left),
        height: Math.round(surface_pu.bottom - crop_margin_pu.bottom) - (surface_pu.top + crop_margin_pu.top),
      };

      const nu = {
        Xmin: (surface_pu.left + crop_margin_pu.left) * PU_TO_NU,
        Ymin: (surface_pu.top + crop_margin_pu.top) * PU_TO_NU,
        Xmax: (surface_pu.left + size_pu.width) * PU_TO_NU,
        Ymax: (surface_pu.top + size_pu.height) * PU_TO_NU,
      };
      // const Xmax_physical = (surface_pu.right - padding_pu.right) * PU_TO_NU;
      // const Ymax_physical = (surface_pu.bottom - padding_pu.bottom) * PU_TO_NU;

      // Push the result
      ret.pages[pageDelta] = {
        pageInfo,
        size_pu,
        nu,
        whole: { x1: surface_pu.left, x2: surface_pu.right, y1: surface_pu.top, y2: surface_pu.bottom },
        crop_margin: crop_margin_pu,
      } as NprojPageJson;
    });

    // Symbol information
    const $symbols = $(nprojXml).find("symbols");
    const symbolXml = $symbols.find("symbol");

    $(symbolXml).each(function (index, sym) {
      // console.log(sym.outerHTML);

      const pageDelta = parseInt($(sym).attr("page") || "0", 10);
      const page = pageDelta + startPage;
      const pageInfo = { section, owner, book, page };

      const type: string = $(sym).attr("type") || ""; // Only Rectangles are considered here.
      const x = parseFloat($(sym).attr("x") || "");
      const y = parseFloat($(sym).attr("y") || "");
      const width = parseFloat($(sym).attr("width") || "");
      const height = parseFloat($(sym).attr("height") || "");

      const lock = parseInt($(sym).attr("lock") || "");

      const command: string = $(sym).find("command").attr("param");

      const extra = $(sym).find("extra").attr("param") || "";

      switch (type) {
        case "Rectangle": {
          const puiSymbol: PuiSymbolType = {
            type,
            command,
            pageInfo,
            rect_nu: {
              left: x * PU_TO_NU,
              top: y * PU_TO_NU,
              width: width * PU_TO_NU,
              height: height * PU_TO_NU,
            },
            extra,
          };
          ret.symbols.push(puiSymbol);
          break;
        }

        case "Ellipse": {
          const puiSymbol: PuiSymbolType = {
            type,
            command,
            pageInfo,
            ellipse_nu: {
              x: x * PU_TO_NU,
              y: y * PU_TO_NU,
              width: width * PU_TO_NU,
              height: height * PU_TO_NU,
            },
            extra,
          };
          ret.symbols.push(puiSymbol);
          break;
        }

        case "Custom": {
          const puiSymbol: PuiSymbolType = {
            type,
            command,
            pageInfo,
            custom_nu: {
              left: x * PU_TO_NU,
              top: y * PU_TO_NU,
              width: width * PU_TO_NU,
              height: height * PU_TO_NU,
              lock: lock === 1,
            },
            extra,
          };
          ret.symbols.push(puiSymbol);
          break;
        }

        default: {
          throw new Error(`symbol type(${type} is not "Rectangle" nor "Ellipse"`);
        }
      }
    });

    const $resources = $(nprojXml).find("resources");
    const resourceXml = $resources.find("resource");

    $(resourceXml).each((index, res) => {
      const id = $(res).find("id").text();
      const path = $(res).find("path").text();
      if (id && path) {
        ret.resources[id] = path;
      }
    });

    return ret;
  };

  private getPuiJSON = async (json: PuiJSON) => {
    const symbols: PuiSymbolType[] = [];
    const nprojJson = json.nproj;

    // book information
    const bookJson = nprojJson.book;
    const section = parseInt(bookJson[0].section.toString());
    const owner = parseInt(bookJson[0].owner.toString());
    const book = parseInt(bookJson[0].code.toString());
    const startPage = parseInt(bookJson[0].start_page[0]._);

    // page information
    const pageJson = nprojJson.pages;
    const numPages = parseInt(pageJson[0].$.count);

    // symbol information
    const symbolsJson = nprojJson.symbols;
    const symbolJson = symbolsJson[0].symbol;

    symbolJson.forEach(function (sym) {
      // console.log(sym.outerHTML);

      const pageDelta = parseInt(sym.$.page);
      const type: string = sym.$.type; // Only Rectangles are considered here.
      const x = parseFloat(sym.$.x);
      const y = parseFloat(sym.$.y);
      const width = parseFloat(sym.$.width);
      const height = parseFloat(sym.$.height);

      const command: string = sym.command[0].$.param;

      const page = pageDelta + startPage;
      const pageInfo = { section, owner, book, page };

      switch (type) {
        case "Rectangle": {
          const puiSymbol: PuiSymbolType = {
            type,
            command,
            pageInfo,
            rect_nu: {
              left: x * PU_TO_NU,
              top: y * PU_TO_NU,
              width: width * PU_TO_NU,
              height: height * PU_TO_NU,
            },
          };
          symbols.push(puiSymbol);
          break;
        }

        case "Ellipse": {
          const puiSymbol: PuiSymbolType = {
            type,
            command,
            pageInfo,
            ellipse_nu: {
              x: x * PU_TO_NU,
              y: y * PU_TO_NU,
              width: width * PU_TO_NU,
              height: height * PU_TO_NU,
            },
          };
          symbols.push(puiSymbol);
          break;
        }

        default: {
          throw new Error(`symbol type(${type} is not "Rectangle" nor "Ellipse"`);
        }
      }
    });

    return symbols;
  };
}
