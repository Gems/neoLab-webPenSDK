let isDebugEnabled = true;

function log(...arg: any) {
  console.log(...arg);
}

function debug(...arg: any) {
  if (isDebugEnabled) console.log(...arg);
}

function error(...arg: any) {
  console.error(...arg);
}

function setDebug(bool: boolean) {
  isDebugEnabled = bool;
}

export { log, error, debug, setDebug };
