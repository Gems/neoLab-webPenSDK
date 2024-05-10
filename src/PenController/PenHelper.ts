import PenController from "./PenController";
import * as NLog from "../Util/NLog";
import {SDKversion} from "../Util/SDKVersion";
import ByteUtil from "../Util/ByteUtil";
import WatchAdvertisementController from "../Util/WatchAdvertisementController";
import {buildDeviceHash, DeviceDescription, getStoredPens, storePen} from "../Util/PenStorage";

interface BluetoothService {
  uuid: number | string;
  writeCharacteristicUuid: number | string;
  notificationCharacteristicUuid: number | string;
}

const service16: BluetoothService = {
  uuid: parseInt("0x19F1"),
  writeCharacteristicUuid: parseInt("0x2BA0"),
  notificationCharacteristicUuid: parseInt("0x2BA1"),
};

const service128: BluetoothService = {
  uuid: "4f99f138-9d53-5bfa-9e50-b147491afe68",
  writeCharacteristicUuid: "8bc8cc7d-88ca-56b0-af9a-9bf514d0d61a",
  notificationCharacteristicUuid: "64cd86b1-2256-5aeb-9f04-2caf6c60ae57",
};

class PenHelper {
  private readonly pens: Set<PenController> = new Set();
  private watchDevicesAbortController: AbortController | null = null;

  controller: PenController;
  device: BluetoothDevice;

  onPenConnected: (pen: PenController) => void;
  onSearchingChanged: (isSearching: boolean) => void;
  
  isSearching(): boolean {
    return !!this.watchDevicesAbortController;
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected;
  }

  debugMode = (bool: boolean) => {
    NLog.setDebug(bool);
  };

  async isSupportedBLE() {
    const isEnabledBle= navigator.bluetooth && await navigator.bluetooth.getAvailability();

    if (!isEnabledBle) {
      const message = "Bluetooth is not supported.";
      NLog.error(message);
    }

    return isEnabledBle;
  };

  private async getPairedPens(): Promise<BluetoothDevice[]> {
    if (!navigator.bluetooth?.getDevices || !await this.isSupportedBLE())
      return [];

    const stored = new Set(getStoredPens().map(buildDeviceHash));
    const pairedDevices = await navigator.bluetooth.getDevices();

    return pairedDevices
        .filter(device => stored.has(buildDeviceHash(device)));
  }

  async startScan(): Promise<DeviceDescription[]> {
    if (this.isConnected() || this.isSearching())
      return [];

    this.initAbortController();

    const pairedDevices = await this.getPairedPens();

    pairedDevices.forEach(device => this.watchAdvertisements(device));

    return pairedDevices.map(device => ({ id: device.id, name: device.name}));
  }

  private initAbortController() {
    this.watchDevicesAbortController = new AbortController();

    this.watchDevicesAbortController.signal.addEventListener("abort", () => {
      this.watchDevicesAbortController = null;
      this.updateSearching()
    });

    this.updateSearching();
  }

  /**
   * Logic for scanning Bluetooth devices for pen connection
   *
   * @returns {boolean}
   */
  async pairPen(): Promise<void> {
    if (!await this.isSupportedBLE())
      return;

    const options: RequestDeviceOptions = {
      filters:  [ { services: [ service16.uuid ] }, { services: [ service128.uuid ] } ],
    };

    try {
      const device = await navigator.bluetooth.requestDevice(options);

      NLog.debug("> Name:             " + device.name);
      NLog.debug("> Id:               " + device.id);
      NLog.debug("> Connected:        " + device.gatt?.connected);
      NLog.debug("> SDKVersion:       " + SDKversion);

      await this.connectDevice(device);
    } catch (err) {
      NLog.error("err", err);
      throw err;
    }
  }

  private registerWatchingDevice(device: BluetoothDevice): WatchAdvertisementController {
    if (!this.watchDevicesAbortController)
      throw new Error("Can't watch advertisements: AbortController is not initialized.");

    return new WatchAdvertisementController(device, this.watchDevicesAbortController);
  }

  private stopWatchingAllDevices() {
    NLog.debug("Stopping watching all devices...");
    this.watchDevicesAbortController?.abort();
  }

  private updateSearching() {
    this.onSearchingChanged?.(this.isSearching());
  }

  private connectingPromise: Promise<void>;

  /**
   * Logic to set up the connection of a Bluetooth device.
   */
  private async watchAdvertisements(device: BluetoothDevice): Promise<void> {
    if (!device || this.isConnected())
      return;

    const watchAdvertisement = this.registerWatchingDevice(device);

    if (watchAdvertisement.isWatching())
      return;

    const self = this;

    // noinspection SpellCheckingInspection
    device.onadvertisementreceived = async () => {
      NLog.debug("> Received advertisement from " + buildDeviceHash(device));

      await self.connectDevice(device);
    }

    try {
      NLog.debug('Watching advertisements from "' + buildDeviceHash(device) + '"...');
      await watchAdvertisement.startWatching();
    }
    catch(error) {
      NLog.error("Couldn't start watching advertisements for Bluetooth Device " + buildDeviceHash(device) + ":", error);
      watchAdvertisement.stopWatching();
    }
  };

  private async connectDevice(device: BluetoothDevice, reportOnError: boolean = true): Promise<boolean> {
    while (this.connectingPromise)
      await this.connectingPromise;

    if (this.isConnected())
      return true;

    let deferredResolve: () => void;
    this.connectingPromise = new Promise(resolve => deferredResolve = resolve);

    try {
      NLog.debug("Connecting to GATT Server..." + buildDeviceHash(device));
      const gattServer: BluetoothRemoteGATTServer = await device.gatt?.connect();
      NLog.debug('> Bluetooth device "' + buildDeviceHash(device) + ' connected.');

      this.device = device;
      device.ongattserverdisconnected = this.onDisconnected.bind(this);

      await this.initializeController(gattServer);

      // Stop watching advertisements to conserve battery life. Relevant for Mobile devices.
      this.stopWatchingAllDevices();
    }
    catch(error) {
      reportOnError
          ? NLog.error("Bluetooth Device connection error: ", error)
          : NLog.debug("Bluetooth Device couldn't connect: ", device)
    }
    finally {
      this.connectingPromise = null;
      deferredResolve();
    }

    return this.isConnected();
  }

  private async initializeController(gattServer: BluetoothRemoteGATTServer): Promise<void> {
    const controller = new PenController(this.device.id);
    const services = [ service128, service16 ];

    for (let i = 0; i < services.length; i++)
      if (await this.bindService(services[i], gattServer, controller))
        break;

    if (!this.isConnected())
      throw new Error("Couldn't bind any GATT service to the bluetooth device.");

    this.pens.add(controller);
    this.controller = controller;

    storePen(this.device);

    controller.RequestVersion();
    this.onPenConnected?.(controller);

    //this.debugMode(false);
  }

  private async bindService(service: BluetoothService, server: BluetoothRemoteGATTServer, controller: PenController): Promise<boolean> {
    try {
      const gattService = await server.getPrimaryService(service.uuid);
      NLog.debug("Service binding", gattService);

      const notificationCharacteristic = await gattService.getCharacteristic(service.notificationCharacteristicUuid);
      const writingCharacteristic = await gattService.getCharacteristic(service.writeCharacteristicUuid);
      const gattCharacteristic = await this.characteristicBinding(notificationCharacteristic, writingCharacteristic, controller);

      NLog.debug("Service ", service.uuid, " has been successfully bound.");

      return server.connected && !!gattCharacteristic;
    } catch (err) {
      NLog.error("Service ", service.uuid, " is not supported.", err);

      return false;
    }
  };

  /**
   * Logic for binding the state information of Bluetooth Characteristics
   */
  private async characteristicBinding(
      read: BluetoothRemoteGATTCharacteristic,
      write: BluetoothRemoteGATTCharacteristic,
      controller: PenController): Promise<BluetoothRemoteGATTCharacteristic> {

    // noinspection SpellCheckingInspection
    read.oncharacteristicvaluechanged = (event: any) => {
      const value = event.target.value;
      const buffer: ByteUtil = new ByteUtil();

      for (let i = 0; i < value.byteLength; i++)
        buffer.PutByte(value.getUint8(i));

      controller.handleData(buffer.ToU8Array());
    };

    // Write Set
    controller.setWriter((data: Uint8Array) => write
        .writeValue(data)
        .then(() => NLog.debug("Write success CMD: ", "0x" + data[1].toString(16), data[1]))
        .catch((err: any) => {
          NLog.error("Write Error", err);

          if (err instanceof DOMException)
            setTimeout(() => write.writeValue(data), 500);
        }));

    // Read Set
    return await read.startNotifications();
  };

  /**
   * Disconnected Callback function
   *
   * @param {any} event
   */
  private onDisconnected (event: any) {
    NLog.debug("Device disconnect", this.controller, event);

    const controller = this.controller;

    this.device = null;
    this.controller = null;
    this.pens.delete(controller);

    controller.handleDisconnect();
  };

  /**
   * Disconnect the currently connected controller
   */
  disconnect() {
    if (!this.device)
      return console.warn("No Bluetooth device is connected.");

    this.device.gatt?.disconnect();
  };
}

const shared = new PenHelper();

export default shared;
