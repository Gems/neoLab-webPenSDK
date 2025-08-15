// noinspection JSUnusedGlobalSymbols

import ByteUtil, {GetSectionOwnerByte} from "../Util/ByteUtil";
import * as Converter from "../Util/Converter";
import * as NLog from "../Util/NLog";
import CMD from "./CMD";
import zlib from "zlib";

import {FirmwareStatusType, ProfileType, SettingType} from "../API/PenMessageType";
import {PenController} from "..";
import {RequestPacketBuilder} from "./Packet";

type DefaultConfig = {
  SupportedProtocolVersion: string;
  PEN_PROFILE_SUPPORT_PROTOCOL_VERSION: number;
  DEFAULT_PASSWORD: string;
};

/**
 * - Profiles are currently using fixed values as they need to be authenticated through NeoLab.
 * @param type
 */
function createProfileRequestPacketBuilder(type: ProfileType/*, name?: string, password?: string*/): RequestPacketBuilder {
  // const neoStudioProfileName = "neonote2";
  // const neoStudioProfilePassword = [0xd3, 0x69, 0xde, 0xcd, 0xb6, 0xa, 0x96, 0x1f];
  // const neoNoteProfileName = "neolab";
  // const neoNoteProfilePassword = [0x6b, 0xca, 0x6b, 0x50, 0x5d, 0xec, 0xa7, 0x8c];

  const requiredPassword = type !== ProfileType.InfoProfile && type !== ProfileType.ReadProfileValue;

  //const nameBytes = Converter.toUTF8Array(name);
  //const passwordBytes = Converter.toUTF8Array(password ?? "");
  const nameBytes = Converter.toUTF8Array("neolab");
  const passwordBytes = requiredPassword
      ? new Uint8Array([0x6b, 0xca, 0x6b, 0x50, 0x5d, 0xec, 0xa7, 0x8c])
      : new Uint8Array([]);

  return new RequestPacketBuilder(CMD.PEN_PROFILE_REQUEST)
      .PutArray(nameBytes)
      .Put(type)
      .PutArray(passwordBytes);
}

export default class PenRequestV2 {
  penController: PenController;
  defaultConfig: DefaultConfig;
  state: { isFwCompress: boolean; fwPacketSize: number; fwFile: ByteUtil | null };
  settingChanges: any = {};

  constructor(penController: PenController) {
    this.penController = penController;
    this.defaultConfig = Object.freeze({
      SupportedProtocolVersion: "2.18",
      PEN_PROFILE_SUPPORT_PROTOCOL_VERSION: 2.18,
      DEFAULT_PASSWORD: "0000",
    });

    this.state = {
      isFwCompress: false,
      fwPacketSize: 0,
      fwFile: null,
    };
  }

  //
  // Request
  //
  /**
   * Function to create a buffer to request version information for the pen and transmit it.
   * - The first task to be performed when connecting the pen successfully
   */
  ReqVersion() {
    // TODO 정상적으로 넘어오는지 확인이 필요하다 - It is necessary to check if it is coming normally.
    const StrAppVersion = Converter.toUTF8Array("0.0.0.0");
    const StrProtocolVersion = Converter.toUTF8Array(this.defaultConfig.SupportedProtocolVersion);

    const packet = new RequestPacketBuilder(CMD.VERSION_REQUEST)
        .PutNull(16)
        // .Put(0x12) // Was commented out before
        .Put(0xf0)
        .Put(0x01)
        .PutArray(StrAppVersion) //, 16)
        .PutArray(StrProtocolVersion) //, 8)

    this.Send(packet);
  }

  // NOTE: SendPen
  ReqVersionTask() {
    // TODO: a make thread for try 3times
    setTimeout(() => this.ReqVersion(), 500);
  }

  //
  // Password
  //
  /**
   * Function to create a buffer to request to change the secret password set on the pen and transmit it.
   * @param {string} oldPassword
   * @param {string} newPassword
   * @returns
   */
  ReqSetUpPassword(oldPassword: string, newPassword: string = "") {
    if (!oldPassword)
      return false;

    //NLog.log("ReqSetUpPassword", oldPassword, newPassword);

    if (newPassword === this.defaultConfig.DEFAULT_PASSWORD)
      return false;

    if (oldPassword === newPassword)
      return false;

    const oldPasswordBytes = Converter.toUTF8Array(oldPassword);
    const newPasswordBytes = Converter.toUTF8Array(newPassword);

    const packet = new RequestPacketBuilder(CMD.PASSWORD_CHANGE_REQUEST)
        .Put(newPassword === "" ? 0 : 1)
        .PutArray(oldPasswordBytes) //.PutArray(oldPasswordBytes, 16)
        .PutArray(newPasswordBytes); //.PutArray(newPasswordBytes, 16)

    return this.Send(packet);
  }

  /**
   * Function to create a buffer to transmit a request to send the secret password set on the pen
   * @param {string} password
   * @returns
   */
  AuthorizeWithPassword(password: string): boolean {
    if (!password)
      return false;

    if (password === this.defaultConfig.DEFAULT_PASSWORD)
      return false;

    const passwordBytes = Converter.toUTF8Array(password);
    const packet = new RequestPacketBuilder(CMD.PASSWORD_REQUEST)
        .PutArray(passwordBytes); //.PutArray(passwordBytes, 16)

    this.Send(packet);
    return true;
  }

  /**
   * Function to create a buffer to request various settings confirmation for the pen and transmit it
   * @returns
   */
  ReqPenStatus() {
    const packet= new RequestPacketBuilder(CMD.SETTING_INFO_REQUEST);

    return this.Send(packet);
  }

  /**
   * Function to create a buffer to request various settings changes for the pen and transmit it.
   * @param {number} settingType - `SettingType` represents the type of setting that needs to be changed.
   * @param {any} value
   * @returns
   */
  RequestChangeSetting(settingType: number, value: any) {
    const packet = new RequestPacketBuilder(CMD.SETTING_CHANGE_REQUEST);
    this.settingChanges[settingType] = value;

    switch (settingType) {
      case SettingType.TimeStamp:
        packet
            //.PutShort(9)
            .Put(settingType)
            .PutLong(value);
        break;

      case SettingType.AutoPowerOffTime:
        packet
            //.PutShort(3)
            .Put(settingType)
            .PutShort(value);
        break;

      case SettingType.LedColor:
        const b = Converter.intToByteArray(value);
        const nBytes = new Uint8Array([b[3], b[2], b[1], b[0]]);
        packet
            //.PutShort(5)
            .Put(settingType)
            .PutArray(nBytes); //.PutArray(nBytes, 4)

        //packet.PutShort(5).Put((byte)stype).PutInt((int)value);
        break;

      case SettingType.PenCapOff:
      case SettingType.AutoPowerOn:
      case SettingType.Beep:
      case SettingType.Hover:
      case SettingType.OfflineData:
      case SettingType.DownSampling:
        packet
            //.PutShort(2)
            .Put(settingType)
            .Put(value ? 1 : 0);

        break;
      case SettingType.Sensitivity:
        packet
            //.PutShort(2)
            .Put(settingType)
            .Put(value);
        break;
      case SettingType.UsbMode:
        packet
            //.PutShort(2)
            .Put(settingType)
            .Put(value);
        break;
      case SettingType.BtLocalName:
        const bytes = Converter.toUTF8Array(value);
        packet
            //.PutShort(18)
            .Put(settingType)
            .Put(16)
            .PutArray(bytes); //.PutArray(bytes, 16)

        break;
      case SettingType.FscSensitivity:
        packet
            //.PutShort(2)
            .Put(settingType)
            .PutShort(value);

        break;
      case SettingType.DataTransmissionType:
        packet
            //.PutShort(2)
            .Put(settingType)
            .Put(value);

        break;
      case SettingType.BeepAndLight:
        packet
            //.PutShort(2)
            .Put(settingType)
            .Put(0x00);

        break;
      case SettingType.InitDisk:
        packet
            //.PutShort(5)
            .Put(settingType)
            .PutInt(0x4f1c0b42);

        break;
      default:
        NLog.log("undefined setting type");
    }

    // NLog.log("RequestChangeSetting", bf)
    return this.Send(packet);
  }

  /**
   * 펜 설정 중 시각을 변경하기 위한 함수
   * - 1970년 1월 1일부터 millisecond tick (지금은 현재 시각으로 변경)
   * @returns
   */
  ReqSetupTime() {
    return this.RequestChangeSetting(SettingType.TimeStamp, Date.now());
  }

  /**
   * 펜 설정 중 자동종료 시간을 변경하기 위한 함수
   * 분 단위 (v2.17 = 5 ~ 3600 // v2.18 = 1 ~ 3600)
   * @param {number} minute
   * @returns
   */
  ReqSetupPenAutoShutdownTime(minute: number) {
    return this.RequestChangeSetting(SettingType.AutoPowerOffTime, minute);
  }

  /**
   * 펜 설정 중 펜 뚜껑을 닫을 경우 전원이 꺼지는 기능을 on / off 로 변경하기 위한 함수
   * @param {boolean} enable - on / off
   * @returns
   */
  ReqSetupPenCapPower(enable: boolean) {
    return this.RequestChangeSetting(SettingType.PenCapOff, enable);
  }

  /**
   * 펜 설정 중 펜 뚜껑 혹은 펜 필기 시 자동으로 전원이 켜지는 기능을 on / off 로 변경하기 위한 함수
   * @param {boolean} enable - on / off
   * @returns
   */
  ReqSetupPenAutoPowerOn(enable: boolean) {
    return this.RequestChangeSetting(SettingType.AutoPowerOn, enable);
  }

  /**
   * 펜 설정 중 비프음 기능을 on / off 로 변경하기 위한 함수
   * @param {boolean} enable - on / off
   * @returns
   */
  ReqSetupPenBeep(enable: boolean) {
    return this.RequestChangeSetting(SettingType.Beep, enable);
  }

  /**
   * 펜 설정 중 호버 모드 기능을 on / off 로 변경하기 위한 함수
   * - 호버기능 : 펜의 위치를 penDown 전에 미리 가늠해 볼 수 있도록 시각적인 dot를 표시하는 기능
   * @param {boolean} enable - on / off
   * @returns
   */
  ReqSetupHoverMode(enable: boolean) {
    return this.RequestChangeSetting(SettingType.Hover, enable);
  }

  /**
   * 펜 설정 중 오프라인 저장 기능을 on / off 로 변경하기 위한 함수
   * @param {boolean} enable - on / off
   * @returns
   */
  ReqSetupOfflineData(enable: boolean) {
    return this.RequestChangeSetting(SettingType.OfflineData, enable);
  }

  /**
   * 펜 설정 중 펜 LED 색을 변경하기 위한 함수
   * @param {number} color - argb
   * @returns
   */
  ReqSetupPenColor(color: number) {
    return this.RequestChangeSetting(SettingType.LedColor, color);
  }

  /**
   * 펜 설정 중 펜의 필압 민감도를 변경하기 위한 함수
   * - FSR 필압 센서가 달린 모델에서만 이용
   * @param {number} step - 0 ~ 4 ( 0이 가장 민감 )
   * @returns
   */
  ReqSetupPenSensitivity(step: number) {
    return this.RequestChangeSetting(SettingType.Sensitivity, step);
  }

  /**
   * 펜 설정 중 USB 모드 설정을 변경하기 위한 함수
   * @param {number} mode - 0 or 1
   * @returns
   */
  ReqSetupUsbMode(mode: number) {
    return this.RequestChangeSetting(SettingType.UsbMode, mode);
  }

  /**
   * 펜 설정 중 다운 샘플링 기능을 on / off 로 변경하기 위한 함수
   * @param {boolean} enable - on / off
   * @returns
   */
  ReqSetupDownSampling(enable: boolean) {
    return this.RequestChangeSetting(SettingType.DownSampling, enable);
  }

  /**
   * 펜 설정 중 블루투스 로컬 네임을 변경하기 위한 함수
   * @param {string} btLocalName
   * @returns
   */
  ReqSetupBtLocalName(btLocalName: string) {
    return this.RequestChangeSetting(SettingType.BtLocalName, btLocalName);
  }

  /**
   * 펜 설정 중 펜의 필압 민감도를 변경하기 위한 함수
   * - FSC 필압 센서가 달린 모델에서만 이용
   * @param {number} step - 0 ~ 4 ( 0이 가장 민감 )
   * @returns
   */
  ReqSetupPenFscSensitivity(step: number) {
    return this.RequestChangeSetting(SettingType.FscSensitivity, step);
  }

  /**
   * 펜 설정 중 펜의 데이터 전송 방식을 변경하기 위한 함수
   * - 현재 사용하지 않음
   * @param {number} type - 0 or 1
   * @returns
   */
  ReqSetupDataTransmissionType(type: number) {
    return this.RequestChangeSetting(SettingType.DataTransmissionType, type);
  }

  /**
   * 펜 설정 중 펜의 비프음과 LED를 변경하기 위한 함수
   * F90 펜 전용
   * @returns
   */
  ReqBeepAndLight() {
    return this.RequestChangeSetting(SettingType.BeepAndLight, null);
  }

  /**
   * 펜 설정 중 펜의 디스크를 초기화하기 위한 함수
   * @returns
   */
  ReqInitPenDisk() {
    return this.RequestChangeSetting(SettingType.InitDisk, null);
  }

  /**
   * 현재 지원 가능한 펜인지 버전을 비교해 확인하는 함수
   * @returns
   */
  IsSupportPenProfile() {
    const temp = this.penController.info.ProtocolVersion.split(".");
    const tempVer = (temp.length === 1 ? temp[0] : temp.length >= 2 ? temp[0] + "." + temp[1] : "");
    const ver = parseFloat(tempVer);

    return ver >= this.defaultConfig.PEN_PROFILE_SUPPORT_PROTOCOL_VERSION;
  }

  /**
   * Function to create and send a buffer for requesting real-time pen writing data transmission.
   *
   * @param {Array} sectionIds - Array of section IDs
   * @param {Array} ownerIds - Array of owner IDs
   * @param {Array} noteIds - If null, notes are not differentiated.
   *
   * @returns {boolean} - Returns true if the buffer is created and sent successfully.
   */
  ReqAddUsingNotes(sectionIds?: number[], ownerIds?: number[], noteIds?: number[]): boolean {
    const packet = new RequestPacketBuilder(CMD.ONLINE_DATA_REQUEST);

    if (sectionIds && ownerIds && sectionIds.length === ownerIds.length) {
      packet
          //.PutShort(2 + sectionIds.length * 8)
          .PutShort(sectionIds.length);

      for (let i = 0; i < sectionIds.length; i++) {
        const section = sectionIds[i];
        const owner = ownerIds[i];
        const noteId = noteIds ? noteIds[i] : 0xffffffff;

        packet
            .PutArray(GetSectionOwnerByte(section, owner)) //, 4);
            .PutInt(noteId);
      }
    } else
      packet
          //.PutShort(2)
          .Put(0xff)
          .Put(0xff);

    return this.Send(packet);
  }

  //
  // MARK: Offline Data
  //
  /**
   * Function to create a buffer for requesting the note information of offline writing data stored in the pen and transmit it.
   * - In case both the section and owner are 0, request all the note ID lists (up to 64 maximum) stored in the pen.
   * @param {number} section
   * @param {number} owner
   * @returns
   */
  ReqOfflineNoteList(section: number = 0, owner: number = 0) {
    const pInfo= section > 0 && owner > 0
        ? GetSectionOwnerByte(section, owner)
        : new Uint8Array([0xff, 0xff, 0xff, 0xff]);

    const packet = new RequestPacketBuilder(CMD.OFFLINE_NOTE_LIST_REQUEST)
        //.PutShort(4)
        .PutArray(pInfo); //, 4);

    return this.Send(packet);
  }

  /**
   * Function to create a buffer for requesting the page information of offline writing data stored in the pen and transmit it.
   * - Requests a list of page IDs (up to 128 ) that match the section, owner, and note values in the pen
   * @param {number} section
   * @param {number} owner
   * @param {number} note
   * @returns
   */
  ReqOfflinePageList(section: number, owner: number, note: number) {
    // NLog.log("ReqOfflinePageList", section, owner, note)
    const packet = new RequestPacketBuilder(CMD.OFFLINE_PAGE_LIST_REQUEST)
        //.PutShort(8)
        .PutArray(GetSectionOwnerByte(section, owner)) //, 4)
        .PutInt(note);

    // NLog.log("Packet Info", bf)
    return this.Send(packet);
  }

  /**
   * Function to create a buffer for requesting offline writing data stored in the pen with a single note ID
   * or multiple page IDs and transmit it.
   * @param {number} section
   * @param {number} owner
   * @param {number} note
   * @param {boolean} deleteOnFinished - If true, delete the transmitted data after transmission,
   *                                     otherwise do not delete the transmitted data.
   * @param {array} pages - If the empty array, request all pages in a single note.
   * @returns
   */
  ReqOfflineData(section: number, owner: number, note: number, deleteOnFinished: boolean = true, pages: number[] = []) {
    //const length = 14 + pages.length * 4;
    const packet = new RequestPacketBuilder(CMD.OFFLINE_DATA_REQUEST)
        //.PutShort(length)
        .Put(deleteOnFinished ? 1 : 2)
        .Put(0x01)
        .PutArray(GetSectionOwnerByte(section, owner)) //, 4)
        .PutInt(note)
        .PutInt(pages.length)
        .PutArray(Converter.intArrayToByteArray(pages));

    pages.forEach(packet.PutInt);

    // NLog.log("ReqOfflineData", bf);
    return this.Send(packet);
  }

  /**
   * Create a buffer to request deletion of offline note data stored in the pen, and transmit it.
   * - Delete notes one by one, up to a maximum of 64.
   * @param {number} section
   * @param {number} owner
   * @param {array} notes
   * @returns
   */
  ReqOfflineDelete(section: number, owner: number, notes: number[]) {
    const packet = new RequestPacketBuilder(CMD.OFFLINE_DATA_DELETE_REQUEST)
        //.PutShort(5 + notes.length * 4)
        .PutArray(GetSectionOwnerByte(section, owner)) //, 4)
        .Put(notes.length)
        .PutArray(Converter.intArrayToByteArray(notes));

    // NLog.log("ReqOfflineDelete", bf);
    return this.Send(packet);
  }

  /**
   * Function to create a buffer to ask the pen to update its software installed, and transmit it.
   * @param {File} file
   * @param {string} version
   * @param {boolean} isCompressed
   * @returns
   */
  async ReqPenSwUpgrade(file: File, version: string, isCompressed: boolean) {
    const deviceName = this.penController.info.DeviceName;
    const deviceNameBytes = Converter.toUTF8Array(deviceName);
    const versionBytes = Converter.toUTF8Array(version);

    const fileSize = file.size;
    const fwBf = new ByteUtil();
    const fwBuf = (await this.ReadFileAsync(file)) as ArrayBuffer;

    fwBf.PutArray(new Uint8Array(fwBuf)) //, fwBufView.length);

    const packetSize =
           deviceName === "NSP-D100"
        || deviceName === "NSP-D101"
        || deviceName === "NSP-C200"
        || deviceName === "NWP-F121"
        || deviceName === "NWP-F121C"
            ? 64 : 256;

    const shouldCompress = isCompressed
        && deviceName !== "NEP-E100"
        && deviceName !== "NEP-E101"
        && deviceName !== "NSP-D100"
        && deviceName !== "NSP-D101"
        && deviceName !== "NSP-C200"
        && deviceName !== "NPP-P201";

    this.state.isFwCompress = !!shouldCompress;
    this.state.fwPacketSize = packetSize;
    this.state.fwFile = fwBf;

    const packet = new RequestPacketBuilder(CMD.FIRMWARE_UPLOAD_REQUEST)
        //.PutShort(42)
        .PutArray(deviceNameBytes) //, 16)
        .PutArray(versionBytes) //, 16)
        .PutInt(fileSize)
        .PutInt(packetSize)
        .PutBool(shouldCompress)  // Whether the packet is compressed:
                          // 1 means compression, 0 means uncompressed (X),
                          // and if the response is 4, it means the compression is not supported.
        .Put(fwBf.GetCheckSumBF()); // Checksum of the entire uncompressed file

    //NLog.log("ReqPenSwUpgrade", packet);
    return this.Send(packet);
  }

  /**
   * Function to create a buffer to upload the appropriate software data according to the pen's approval of an update,
   * and transmit it.
   * @param {number} offset
   * @param {Uint8Array} data
   * @param {number} status
   * @returns
   */
  async ReqPenSwUpload(offset: number, data: Uint8Array, status: number) {
    const packet = new RequestPacketBuilder(CMD.FIRMWARE_PACKET_RESPONSE);

    if (status === FirmwareStatusType.STATUS_ERROR)
      return this.Send(packet.PutCode(1));

    const shouldCompress = this.state.isFwCompress;
    const compressedData = shouldCompress
        ? await this.Compress(data) : null;

    packet
        .PutCode(0) //ErrorCode ( 0 = 정상 )
        //.PutShort(14 + payload.data.length)
        .Put(0) // 전송여부 0 : 1            //STATUS_END 이면 1로 바꾸는 것이 좋을까?
        .PutInt(offset)
        .Put(packet.GetCheckSumData(data))
        .PutInt(data.length)
        .PutInt( shouldCompress ? compressedData.length : 0)
        .PutArray(shouldCompress ? compressedData : data); // File (data?)

    // NLog.log("ReqPenSwUpload", bf);
    return this.Send(packet);
  }

  /**
   * Function to create a buffer to request pen profile creation and transmit it.
   * - The profile is not available after authentication through NeoLab,
   *   but it can be used temporarily using a fixed value.
   * @returns
   */
  ReqProfileCreate(/*name: string, password: string*/) {
    const packet = createProfileRequestPacketBuilder(ProfileType.CreateProfile/*, name, password*/)
        .PutShort(Math.pow(2, 5)) //sector size
        .PutShort(Math.pow(2, 7)); //sector number

    return this.Send(packet);
  };

  /**
   * Create a buffer to request removal of profiles set on the pen, and transmit it.
   * - Profiles are currently using fixed values as they need to be authenticated through NeoLab.
   * @returns
   */
  ReqProfileDelete(/*name: string, password: string*/) {
    const packet = createProfileRequestPacketBuilder(ProfileType.DeleteProfile/*, name, password*/);

    // NLog.log("ReqProfileDelete", packet);
    return this.Send(packet);
  };

  /**
   * Create a buffer to request information on the set profiles on the pen, and transmit it.
   * - Profiles are currently using fixed values as they need to be authenticated through NeoLab.
   * @returns
   */
  ReqProfileInfo(/*name: string*/) {
    const packet = createProfileRequestPacketBuilder(ProfileType.InfoProfile/*, name*/);

    // NLog.log("ReqProfileInfo", bf);
    return this.Send(packet);
  };

  /**
   * Create a buffer to request writing of data in the set profiles on the pen, and transmit it.
   * - Profiles are currently using fixed values as they need to be authenticated through NeoLab.
   * @param {Array} data
   * @returns
   */
  ReqProfileWriteValue(/*name: string, password: string,*/ data: { [key: string]: any }) {
    const dataArray = Object
        .entries(data)
        .map(([key, value]) => [ Converter.toUTF8Array(key), Converter.toUTF8Array(value) ]);

    const packet = createProfileRequestPacketBuilder(ProfileType.WriteProfileValue/*, name, password*/)
      .Put(dataArray.length);

    dataArray.forEach(([key, value]) => packet
        .PutArray(key) //, 16)
        .PutShort(value.length)
        .PutArray(value)); //, value.length);

    // NLog.log("ReqProfileWriteValue", bf);
    return this.Send(packet);
  };

  /**
   * Create a buffer to request information on the data inside the set profiles on the pen, and transmit it.
   * - Profiles are currently using fixed values as they need to be authenticated through NeoLab.
   * @param {Array} keys
   * @returns
   */
  ReqProfileReadValue(/*name: string,*/ keys: string[]) {
    const keyArray = keys.map(Converter.toUTF8Array);

    const packet = createProfileRequestPacketBuilder(ProfileType.ReadProfileValue/*, name*/)
        .Put(keyArray.length);

    keyArray.forEach(packet.PutArray);

    // NLog.log("ReqProfileReadValue", bf);
    return this.Send(packet);
  };

  /**
   * Create a buffer to request removal of data inside the set profiles on the pen, and transmit it.
   * - Profiles are currently using fixed values as they need to be authenticated through NeoLab.
   * @param {Array} keys
   * @returns
   */
  ReqProfileDeleteValue(/*name: string, password: string,*/ keys: string[]) {
    const keyArray = keys.map(Converter.toUTF8Array);

    const packet = createProfileRequestPacketBuilder(ProfileType.DeleteProfileValue/*, name, password*/)
        .Put(keyArray.length);

    keyArray.forEach(packet.PutArray);

    // NLog.log("ReqProfileDeleteValue", bf);
    return this.Send(packet);
  };

  OnDisconnected() {
    // console.log("TODO: Disconnect ")//
  }

  /**
   * A function to compress data using zlib.
   * @param {Uint8Array} data
   * @returns
   */
  Compress = async (data: Uint8Array): Promise<Uint8Array> => new Promise((resolve, reject) =>
      zlib.deflate(new Uint8Array(data), { level: 9 }, async (err, res) => {
        if (!err) {
          resolve(new Uint8Array(res));
        } else {
          NLog.log("zip error", err);
          reject(err);
        }
      }));

  /**
   * A function for asynchronous processing during pen software update files or the like read operation.
   * @param file
   * @returns
   */
  ReadFileAsync = async (file: File): Promise<string|ArrayBuffer> => new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = reject;
      reader.onload = () => resolve(reader.result);

      reader.readAsArrayBuffer(file);
    });

  // MARK: Util
  /**
   * Function to pass the created buffer (for pen request) to the handleWrite of the pen controller
   * - To make this function work, handleWrite must be implemented.
   * @param {RequestPacketBuilder} packet - The buffer created for pen request
   * @returns {boolean}
   */
  private Send(packet: RequestPacketBuilder): boolean {
    this.penController.writeData(packet.build());
    return true;
  }

  getNextChunk(offset: number): { data: Uint8Array, currentChunk: number, totalChunks: number } | null {
    if (!this.state.fwFile)
      return null;

    const packetSize = this.state.fwPacketSize;
    const totalSize = this.state.fwFile.Size;

    const totalChunks = Math.ceil(totalSize / packetSize);
    const currentChunk = offset / packetSize;
    const data = this.state.fwFile.GetBytesWithOffset(offset, packetSize);

    return { data, currentChunk, totalChunks };
  }
}
