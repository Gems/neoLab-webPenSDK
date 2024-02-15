var debug = true;

function log(...arg: any) {
  if (debug) console.log(...arg);
}

function error(...arg: any) {
  console.error(...arg);
}

function setDebug(bool: boolean) {
  debug = bool;
}

export { log, error, debug, setDebug };
