let isDebugEnabled = true;

function log(...data: any[]) {
  console.log(...data);
}

function debug(...data: any[]) {
  isDebugEnabled && console.debug(...data);
}

function error(...data: any[]) {
  console.error(...data);
}

function setDebug(isEnabled: boolean) {
  isDebugEnabled = isEnabled;
}

export { log, error, debug, setDebug };
