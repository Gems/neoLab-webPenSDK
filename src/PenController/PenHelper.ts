import PenController from "./PenController";
import {Dot, PageInfo, PenCallbacks} from "../Util/type";
import * as NLog from "../Util/NLog";
import {SDKversion} from "../Util/SDKVersion";
import {buildPageId, isPlatePaper, isSamePage} from "../Util/utils";
import ByteUtil from "../Util/ByteUtil";

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
  pens: PenController[];
  controller: PenController;
  connectingQueue: string[];
  page: PageInfo;
  dotStorage: { [key: string]: Dot[] };
  isPlate: boolean;
  plateMode: string;
  writeCharacteristic: boolean;

  onPenConnected: (pen: PenController) => void;

  constructor() {
    this.pens = []; // PenController Array
    this.connectingQueue = []; // device.id array
    this.dotStorage = {};
    this.isPlate = false;
    this.plateMode = "";
    this.page = { section: 0, owner: 0, book: 0, page: 0 }; // PageInfo
    this.writeCharacteristic = false;
  }

  /**
   * Bluetooth의 Characteristics 상태 정보를 binding 하기 위한 로직
   */
  private async characteristicBinding(
      read: BluetoothRemoteGATTCharacteristic,
      write: BluetoothRemoteGATTCharacteristic,
      controller: PenController) {

    // Read Set
    await read.startNotifications();

    read.addEventListener("characteristicvaluechanged", (event: any) => {
      const value = event.target.value;
      const buffer: ByteUtil = new ByteUtil();

      for (let i = 0; i < value.byteLength; i++)
        buffer.PutByte(value.getUint8(i));

      controller.putData(buffer.ToU8Array());
    });

    // Write Set
    controller.addWrite((data: Uint8Array) => write
        .writeValue(data)
        .then(() => NLog.log("write success CMD: ", "0x" + data[1].toString(16), data[1]))
        .catch((err: any) => {
          NLog.log("write Error", err);

          if (err instanceof DOMException)
            setTimeout(() => write.writeValue(data), 500);
        }));
  };


  /**
   * @returns {boolean}
   */
  isConnected() {
    return this.writeCharacteristic;
  }

  private isConnectedOrConnecting = (device: BluetoothDevice) => {
    return this.pens.some((pen) => pen.device.id === device.id) || this.connectingQueue.includes(device.id);
  };

  private addDeviceToConnectingQueue = (device: BluetoothDevice) => {
    this.connectingQueue.push(device.id);
  };

  private removeDeviceFromConnectingQueue = (device: BluetoothDevice) => {
    this.connectingQueue = this.connectingQueue.filter(id => id !== device.id);
  };

  debugMode = (bool: boolean) => {
    NLog.setDebug(bool);
  };

  // TODO: Move to PenController and implement there.
  // /**
  //  * MARK: Dot Event Callback - callback function for processing dots that arrive through the pen.
  //  *
  //  * @param {OnDot} onDot
  //  * @param {Dot} dot
  //  */
  // private handleDot(onDot: OnDot | null, dot: Dot): void {
  //   const pageId = buildPageId(dot.pageInfo);
  //   const dotStorage = (this.dotStorage[pageId] ?? (this.dotStorage[pageId] = []));
  //
  //   dotStorage.push(dot);
  //
  //   // Check if it's a platePage and then set the isPlate value
  //   this.isPlate = isPlatePaper(dot.pageInfo);
  //
  //   // REVIEW: Previously there was a check here, that handled 'page change' only in case of `dot.type === DotTypes.PAGE_DOWN`.
  //   //         Double-check if it's a correct approach to handle any dot type here.
  //   if (!isSamePage(dot.pageInfo, this.page)) {
  //     this.page = dot.pageInfo;
  //     this.callbacks?.onPage?.(this.page);
  //     return;
  //   }
  //
  //   onDot!(dot);
  // };

  /**
   * Logic for scanning Bluetooth devices for pen connection
   *
   * @returns {boolean}
   */
  async scanPen() {
    if (!await this.isSupportedBLE())
      return;

    const options: RequestDeviceOptions = {
      filters:  [ { services: [ service16.uuid ] }, { services: [ service128.uuid ] } ],
    };

    try {
      const device = await navigator.bluetooth.requestDevice(options);

      NLog.log("> Name:             " + device.name);
      NLog.log("> Id:               " + device.id);
      NLog.log("> Connected:        " + device.gatt?.connected);
      NLog.log("> SDKVersion:       " + SDKversion);

      await this.connectDevice(device);

    } catch (err) {
      NLog.log("err", err);
    }
  }

  async isSupportedBLE() {
    const isEnabledBle= navigator.bluetooth && await navigator.bluetooth.getAvailability();

    if (!isEnabledBle) {
      const message = "Bluetooth is not supported.";
      alert(message);
      NLog.log(message);
    }

    return isEnabledBle;
  };

  /**
   * Logic to set up the connection of a Bluetooth device.
   */
  async connectDevice(device: BluetoothDevice) {
    if (!device)
      return;

    if (this.isConnectedOrConnecting(device))
      return NLog.log("Bluetooth Device is already connecting or connected.");

    NLog.log("Connect start", device);
    try {
      this.addDeviceToConnectingQueue(device);

      const gattServer = (await device.gatt?.connect()) as BluetoothRemoteGATTServer;
      NLog.log("GATT Server", gattServer);

      const controller = new PenController(device);
      device.ongattserverdisconnected = this.onDisconnected.bind(this, controller);

      //await this.bindService(service16, gattServer, controller);
      await this.bindService(service128, gattServer, controller);

      controller.OnConnected();

      this.pens.push(controller);
      this.controller = controller;
      this.onPenConnected?.(controller);

    } catch (err) {
      NLog.error("Bluetooth Device connection error:", err);
    } finally {
      this.removeDeviceFromConnectingQueue(device);
    }
  };

  async bindService(service: BluetoothService, server: BluetoothRemoteGATTServer, controller: PenController) {
    try {
      const gattService = await server.getPrimaryService(service.uuid);
      NLog.log("Service binding", gattService);

      const notificationCharacteristic = await gattService.getCharacteristic(service.notificationCharacteristicUuid);
      const writingCharacteristic = await gattService.getCharacteristic(service.writeCharacteristicUuid);

      await this.characteristicBinding(notificationCharacteristic, writingCharacteristic, controller);

      NLog.log("Service ", service.uuid, " has been successfully bound.");
    } catch (err) {
      NLog.error("Service ", service.uuid, " is not supported.", err);
    }
  };

  /**
   * Disconnected Callback function
   *
   * @param {PenController} controller
   * @param {any} event
   */
  private onDisconnected (controller: PenController, event: any) {
    NLog.log("device disconnect", controller, event);
    this.pens = this.pens.filter(pen => pen !== controller);

    controller.OnDisconnected();
  };

  /**
   * Disconnect Action
   *
   * @param {PenController} penController
   */
  disconnect(penController: PenController) {
    penController.device?.gatt?.disconnect();
  };
}

const shared = new PenHelper();

export default shared;
