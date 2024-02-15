import PenController from "./PenController";
import {Dot, OnDot, OnPenAuthorized, Options, PageInfo, PenCallbacks} from "../Util/type";
import * as NLog from "../Util/NLog";
import {SDKversion} from "../Util/SDKVersion";
import {buildPageId, isPlatePaper, isSamePage} from "../Util/utils";
import ByteUtil from "../Util/ByteUtil";

const serviceUuid = parseInt("0x19F1");
const characteristicUuidNoti = parseInt("0x2BA1");
const characteristicUuidWrite = parseInt("0x2BA0");

const PEN_SERVICE_UUID_128 = "4f99f138-9d53-5bfa-9e50-b147491afe68";
const PEN_CHARACTERISTICS_NOTIFICATION_UUID_128 = "64cd86b1-2256-5aeb-9f04-2caf6c60ae57";
const PEN_CHARACTERISTICS_WRITE_UUID_128 = "8bc8cc7d-88ca-56b0-af9a-9bf514d0d61a";

class PenHelper {
  pens: PenController[];
  controller: PenController;
  connectingQueue: string[];
  page: PageInfo;
  dotStorage: { [key: string]: Dot[] };
  isPlate: boolean;
  plateMode: string;
  writeCharacteristic: boolean;

  private callbacks: PenCallbacks;

  constructor() {
    this.pens = []; // PenController Array
    this.connectingQueue = []; // device.id array
    this.dotStorage = {};
    this.isPlate = false;
    this.plateMode = "";
    this.page = { section: 0, owner: 0, book: 0, page: 0 }; // PageInfo
    this.writeCharacteristic = false;

    this.callbacks = {};
  }

  addCallbacks(callbacks: PenCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks, };
  }

  /**
   * Bluetooth의 Characteristics 상태 정보를 binding 하기 위한 로직
   *
   * @param {BluetoothRemoteGATTCharacteristic} read
   * @param {BluetoothRemoteGATTCharacteristic} write
   * @param {BluetoothDevice} device
   */
  private async characteristicBinding(
      read: BluetoothRemoteGATTCharacteristic,
      write: BluetoothRemoteGATTCharacteristic,
      device: BluetoothDevice) {

    const controller = new PenController(device);
    // Read Set
    await read.startNotifications();

    read.addEventListener("characteristicvaluechanged", (event: any) => {
      const value = event.target.value;
      const buffer: ByteUtil = new ByteUtil();

      for (let i = 0; i < value.byteLength; i++)
        buffer.PutByte(value.getUint8(i));

      controller.putData(buffer.ToU8Array());
    });

    device.addEventListener("gattserverdisconnected", this.onDisconnected.bind(this, controller));

    controller.OnConnected();

    // Write Set
    controller.addWrite((data: Uint8Array) => write
        .writeValue(data)
        .then(() => NLog.log("write success CMD: ", "0x" + data[1].toString(16), data[1]))
        .catch((err: any) => {
          NLog.log("write Error", err);

          if (err instanceof DOMException)
            setTimeout(() => write.writeValue(data), 500);
        }));

    // Call back Event Set
    controller.addCallbacks({
      ...this.callbacks,
      onDot: this.handleDot.bind(this, this.callbacks?.onDot),
      onPenAuthorized: this.onPenAuthorized.bind(this, this.callbacks?.onPenAuthorized)
    });

    // device Status Set

    this.pens.push(controller);
    this.controller = controller;
  };


  /**
   * @returns {boolean}
   */
  isConnected() {
    return this.writeCharacteristic;
  }

  isConnectedOrConnecting = (device: BluetoothDevice) => {
    return this.pens.some((pen) => pen.device.id === device.id) || this.connectingQueue.includes(device.id);
  };

  addDeviceToConnectingQueue = (device: BluetoothDevice) => {
    this.connectingQueue.push(device.id);
  };

  removeDeviceFromConnectingQueue = (device: BluetoothDevice) => {
    this.connectingQueue = this.connectingQueue.filter(id => id !== device.id);
  };

  debugMode = (bool: boolean) => {
    NLog.setDebug(bool);
  };

  /**
   * MARK: Dot Event Callback - callback function for processing dots that arrive through the pen.
   *
   * @param {OnDot} onDot
   * @param {Dot} dot
   */
  private handleDot(onDot: OnDot | null, dot: Dot): void {
    const pageId = buildPageId(dot.pageInfo);
    const dotStorage = (this.dotStorage[pageId] ?? (this.dotStorage[pageId] = []));

    dotStorage.push(dot);

    // Check if it's a platePage and then set the isPlate value
    this.isPlate = isPlatePaper(dot.pageInfo);

    // REVIEW: Previously there was a check here, that handled 'page change' only in case of `dot.type === DotTypes.PAGE_DOWN`.
    //         Double-check if it's a correct approach to handle any dot type here.
    if (!isSamePage(dot.pageInfo, this.page)) {
      this.page = dot.pageInfo;
      this.callbacks?.onPage!(this.page);
      return;
    }

    onDot!(dot);
  };

  private onPenAuthorized(onPenAuthorized: OnPenAuthorized | null) {
    NLog.log("PenHelper PEN_AUTHORIZED");
    // Ed: I guess we request here data stored on the pen.
    this.controller.RequestAvailableNotes();
    onPenAuthorized!();
  }

  /**
   * Logic for scanning Bluetooth devices for pen connection
   *
   * @returns {boolean}
   */
  async scanPen() {
    if (!await this.isSupportedBLE())
      return;

    const filters = [{services: [serviceUuid]}, {services: [PEN_SERVICE_UUID_128]}];
    const options: Options = {filters: undefined};
    options.filters = filters;

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
   *
   * @param {BluetoothDevice} device
   * @returns
   */
  connectDevice = async (device: BluetoothDevice) => {
    if (!device) return;

    if (!this.isConnectedOrConnecting(device)) {
      NLog.log("Connect start", device);
      try {
        this.addDeviceToConnectingQueue(device);

        const server = (await device.gatt?.connect()) as BluetoothRemoteGATTServer;
        NLog.log("service", server);
        this.serviceBinding_16(server, device);
        this.serviceBinding_128(server, device);
      } catch (err) {
        NLog.log("err conect", err);
      } finally {
        this.removeDeviceFromConnectingQueue(device);
      }
    } else {
      NLog.log("Already connected or connecting");
    }
  };

  /**
   * Bluetooth 16bit UUID service를 binding 하기 위한 로직
   *
   * @param {BluetoothRemoteGATTServer} server
   * @param {BluetoothDevice} device
   */
  serviceBinding_16 = async (server: BluetoothRemoteGATTServer, device: BluetoothDevice) => {
    try {
      const service_16 = await server.getPrimaryService(serviceUuid);
      NLog.log("service_16", service_16);
      const characteristicNoti = await service_16.getCharacteristic(characteristicUuidNoti);
      const characteristicWrite = await service_16.getCharacteristic(characteristicUuidWrite);
      this.characteristicBinding(characteristicNoti, characteristicWrite, device);
    } catch (err) {
      NLog.log("not support service uuid", err);
    }
  };

  /**
   * Bluetooth 128bit UUID service를 binding 하기 위한 로직
   *
   * @param {BluetoothRemoteGATTService} server
   * @param {BluetoothDevice} device
   */
  serviceBinding_128 = async (server: BluetoothRemoteGATTServer, device: BluetoothDevice) => {
    try {
      const service_128 = await server.getPrimaryService(PEN_SERVICE_UUID_128);
      NLog.log("service_128", service_128);
      const characteristicNoti = await service_128.getCharacteristic(PEN_CHARACTERISTICS_NOTIFICATION_UUID_128);
      const characteristicWrite = await service_128.getCharacteristic(PEN_CHARACTERISTICS_WRITE_UUID_128);
      this.characteristicBinding(characteristicNoti, characteristicWrite, device);
    } catch (err) {
      NLog.log("not support service uuid", err);
    }
  };

  /**
   * Disconnected Callback function
   *
   * @param {PenController} controller
   * @param {any} event
   */
  onDisconnected = (controller: PenController, event: any) => {
    NLog.log("device disconnect", controller, event);
    this.pens = this.pens.filter(pen => pen !== controller);

    controller.OnDisconnected();
  };

  /**
   * Disconnect Action
   *
   * @param {PenController} penController
   */
  disconnect = (penController: PenController) => {
    penController.device.gatt.disconnect();
  };
}

const shared = new PenHelper();

export default shared;
