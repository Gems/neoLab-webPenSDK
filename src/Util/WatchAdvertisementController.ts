import * as NLog from "./NLog";

const checkIfWatching = (device: BluetoothDevice) => device.watchingAdvertisements;

const stopWatching = (device: BluetoothDevice) => {
  try {
    device.onadvertisementreceived = null;
    checkIfWatching(device) && device.unwatchAdvertisements();
  } catch (err) {
    console.warn("Could not stop watching advertisements for device: ", device, err);
  }
}

const abortSignal = (abortController: AbortController) => {
  try {
    abortController && !abortController.signal.aborted && abortController.abort();
  } catch (err) {
    console.warn("Could not abort signal for watching operation:", err);
  }
}

class WatchAdvertisementController {
  private intervalId: number | null = null;

  constructor(
      private readonly device: BluetoothDevice,
      private readonly abortController: AbortController = new AbortController(),
      private readonly connectHandler: ((device: BluetoothDevice) => boolean | Promise<boolean>) | null = null) {
  }

  async startWatching() {
    const self = this;

    if (self.device.watchingAdvertisements) {
      console.warn("Already watching advertisements for device:", self.device);
      return;
    }

    NLog.debug("Watching advertisements for device:", self.device);

    const { signal } = self.abortController;

    if (signal.aborted) {
      console.warn("Can't start watching advertisements for device because of already aborted signal:", self.device);
      return;
    }

    signal.addEventListener("abort", () => stopWatching(self.device));

    await self.device.watchAdvertisements({ signal });

    if (self.connectHandler) {
      const tryConnect = async () => {
        if (!await self.connectHandler(self.device))
          return;

        clearInterval(self.intervalId);
        abortSignal(self.abortController);
      }

      // @ts-ignore
      self.intervalId = setInterval(tryConnect, 4000);
    }
  }

  stopWatching() {
    stopWatching(this.device);
  }

  isWatching() {
    return checkIfWatching(this.device);
  }

  isForDevice(device: BluetoothDevice) {
    return this.device === device;
  }
}

export default WatchAdvertisementController;