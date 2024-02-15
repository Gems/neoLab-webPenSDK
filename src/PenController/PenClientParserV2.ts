// noinspection JSUnusedGlobalSymbols

import ByteUtil, {GetSectionOwner} from "../Util/ByteUtil";
import {Packet, PacketBuilder, RequestPacketBuilder} from "./Packet";
import * as Converter from "../Util/Converter";
import * as NLog from "../Util/NLog";
import CMD from "./CMD";
import CONST from "./Const";
import * as Res from "../Model/Response";
import zlib from "zlib";
import {ErrorType, FirmwareStatusType, PenTipType, SettingType} from "../API/PenMessageType";
import PenController from "./PenController";
import DotFilter from "../Util/DotFilter";
import {Dot, DotTypes, FirmwareUpgradeFailureReason, Paper, PenConfigurationInfo} from "../Util/type";
import PUIController, {isPUI, isPUIOnPage} from "../API/PUIController";
import PageDot from "../API/PageDot";

type PenState = {
  penTipType: number;
  penTipColor: number;
  isStartWithDown: boolean;
  dotCount: number;
  authenticationRequired: boolean;
  password: string | null;
  prevDot: PageDot;
  isBeforeMiddle: boolean;
  isStartWithPaperInfo: boolean;
  sessionTs: number;
  eventCount: number;
  isPUI: boolean;
  cmdCheck: boolean;
};

export default class PenClientParserV2 {
  private readonly penController: PenController;
  private readonly currentPaper: Paper;
  private state: PenState | null;
  private mBuffer: any;
  private offline: any;
  private isUploading: boolean;

  constructor(penController: PenController) {
    this.penController = penController;

    this.currentPaper = {
      section: -1,
      owner: -1,
      note: -1,
      page: -1,
      time: -1,
      timeDiff: 0,
    };

    this.state = null;
    this.mBuffer = null;

    this.offline = {
      totalOfflineStrokes: -1,
      receivedOfflineStrokes: 0,
      totalOfflineDataSize: -1,
    };

    this.isUploading = true;
  }

  private resetState() {
    this.currentPaper.time = -1;
    this.currentPaper.timeDiff = 0;
    this.state.sessionTs = -1;
    this.state.isStartWithDown = false;
    this.state.isBeforeMiddle = false;
    this.state.isStartWithPaperInfo = false;
    this.state.isPUI = false;
    this.state.dotCount = 0;
    this.state.prevDot = null;
  }

  // MARK: ParsePacket
  /**
   * After checking the command byte of the delivered packet, it connects the packet to each command.
   * The second step of packet parsing, ProtocolParse operation is required to call this function.
   * @param {Packet} packet
   * @returns
   */
  ParsePacket(packet: Packet) {
    const cmd = packet.Cmd;
    NLog.log("ParsePacket", cmd, "0x" + cmd.toString(16));
    NLog.log("ParsePacket", packet.Data);

    if (packet.Result > 0) {
      NLog.error("Packet result failed", packet);
      return;
    }

    switch (cmd) {
      case CMD.VERSION_RESPONSE:
        const versionInfo = Res.versionInfo(packet);
        this.penController.info = versionInfo;
        this.isUploading = false;
        this.state.eventCount = 0;

        NLog.log("ParsePacket Version Info", versionInfo);

        this.penController.callbacks?.onPenConnected!(versionInfo);
        this.ReqPenStatus();
        break;

      case CMD.SHUTDOWN_EVENT:
        const shutdownReason = packet.GetByte();
        NLog.log("ParsePacket power off", shutdownReason);

        this.penController.callbacks?.onPowerOffEvent!(shutdownReason);
        break;

      case CMD.LOW_BATTERY_EVENT:
        const battery = packet.GetByte();

        this.penController.callbacks?.onBatteryLowEvent!(battery);
        break;

      // MARK: CMD Up & Down New
      case CMD.ONLINE_NEW_PEN_DOWN_EVENT:
        this.NewPenDown(packet);
        break;

      case CMD.ONLINE_NEW_PEN_UP_EVENT:
        this.NewPenUp(packet);
        break;

      // MARK: CMD Up & Down Old
      case CMD.ONLINE_PEN_UPDOWN_EVENT:
        this.PenUpDown(packet);
        break;

      // MARK: CMD Dot
      case CMD.ONLINE_PEN_DOT_EVENT:
      case CMD.ONLINE_NEW_PEN_DOT_EVENT:
        this.PenDotEvent(cmd, packet);
        break;

      case CMD.ONLINE_PEN_HOVER_EVENT:
        this.PenHoverEvent(packet);
        break;

      case CMD.ONLINE_PAPER_INFO_EVENT:
      case CMD.ONLINE_NEW_PAPER_INFO_EVENT:
        this.PaperInfoEvent(cmd, packet);
        break;

      case CMD.ONLINE_PEN_ERROR_EVENT:
      case CMD.ONLINE_NEW_PEN_ERROR_EVENT:
        this.PenErrorDot(cmd, packet);
        break;

      case CMD.SETTING_INFO_RESPONSE:
        const configurationInfo = Res.penConfigurationInfo(packet);
        NLog.log("ParsePacket SETTING_INFO_RESPONSE", configurationInfo, "first Connection?", !this.state);

        configurationInfo.MacAddress = this.penController.info.MacAddress;

        this.penController.hoverMode = configurationInfo.HoverMode;
        this.penController.callbacks?.onConfigurationInfo!(configurationInfo);

        // First Connection
        if (!this.state)
          this.initPenState(configurationInfo);

        break;

      case CMD.SETTING_CHANGE_RESPONSE:
        const settingChange = Res.SettingChange(packet);

        !!settingChange.result
            ? this.penController.callbacks?.onPenSettingChangeSuccess!(settingChange.settingType)
            : this.penController.callbacks?.onPenSettingChangeFailure!(settingChange.settingType);

        break;

      // Password
      case CMD.PASSWORD_RESPONSE:
        const authenticationResult = Res.Password(packet);
        NLog.log("ParsePacket PASSWORD_RESPONSE", authenticationResult);

        if (this.state.authenticationRequired) {
          this.state.authenticationRequired = false;

          authenticationResult.status === 1
              ? this.penController.callbacks?.onAuthenticationSuccess!(false)
              : this.penController.callbacks?.onAuthenticationFailure!(authenticationResult);

          break;
        }

        authenticationResult.status === 1
            ? this.penController.callbacks?.onPenAuthorized!()
            : this.penController.callbacks?.onAuthenticationRequest!(authenticationResult);

        break;

      case CMD.PASSWORD_CHANGE_RESPONSE:
        const passwordChange = Res.PasswordChange(packet);

        if (passwordChange.status === 0) {
          this.state.authenticationRequired = true;
          const noPassword= !this.penController.AuthorizeWithPassword(this.state.password);

          if (noPassword)
            // Successful setup of password-less login.
            this.penController.callbacks?.onAuthenticationSuccess!(noPassword);

          break;
        }

        // Ed: we reset password on a failed attempt (?)
        this.state.password = "";
        this.penController.callbacks?.onAuthenticationFailure!(passwordChange);

        break;

      // MARK: CMD Offline
      case CMD.OFFLINE_NOTE_LIST_RESPONSE:
        const noteList = Res.NoteList(packet);
        this.penController.callbacks?.onOfflineNoteListData!(noteList);

        break;
      case CMD.OFFLINE_PAGE_LIST_RESPONSE:
        const pageList = Res.PageList(packet);
        this.penController.callbacks?.onOfflinePageListData!(pageList);

        break;
      case CMD.OFFLINE_DATA_RESPONSE:

        const offlineInfo = {
          strokes: packet.GetInt(),
          bytes: packet.GetInt(),
          isCompressed: packet.GetByte() === 1,
        };

        this.offline.totalOfflineStrokes = offlineInfo.strokes;
        this.offline.totalOfflineDataSize = offlineInfo.bytes;
        this.offline.receivedOfflineStrokes = 0;

        NLog.log("OFFLINE_DATA_RESPONSE ", offlineInfo);

        // REVIEW: Double-check the total data size check logic. Failing on 0 size doesn't look good.
        packet.Result !== 0x00 || this.offline.totalOfflineDataSize === 0
            ? this.penController.callbacks?.onOfflineDataRetrievalFailure!()
            : this.penController.callbacks?.onOfflineDataRetrievalProgress!(0);

        break;

      case CMD.OFFLINE_PACKET_REQUEST:
        this.ResOfflineData(packet);

        break;

      case CMD.OFFLINE_DATA_DELETE_RESPONSE:
        // NLog.log("OFFLINE_DATA_DELETE_RESPONSE", packet);
        packet.Result !== 0x00
            ? this.penController.callbacks?.onOfflineDataDeleteFailure!()
            : this.penController.callbacks?.onOfflineDataDeleteSuccess!();

        break;

      // MARK: CMD Firmware Response
      case CMD.FIRMWARE_UPLOAD_RESPONSE:
        // 0: Receive transmission
        // 1: Firmware version mismatch
        // 2: Pen disk space insufficient
        // 3: Failure
        // 4: Compression support not available.
        const status = packet.GetByte(); // 0: 전송받음 / 1: firmwareVersion 동일 / 2: 펜 디스크 공간 부족 / 3: 실패 / 4: 압축지원 안함

        (this.isUploading = packet.Result === 0 && status === 0)
            ? status === 0 && this.penController.callbacks?.onFirmwareUpgradeProgress!(0)
            : this.penController.callbacks?.onFirmwareUpgradeFailure!(status as FirmwareUpgradeFailureReason);

        break;

      case CMD.FIRMWARE_PACKET_REQUEST:
        const firmwareRes = {
          status: packet.GetByte(),
          offset: packet.GetInt(),
        };

        this.ResponseChunkRequest(firmwareRes.offset, firmwareRes.status);

        break;

      case CMD.ONLINE_DATA_RESPONSE:
        NLog.log("Using Note Set", packet.Result);

        const realtimeDataEnabled = packet.Result === 0x00;
        this.penController.callbacks?.onRealtimeDataStatus!(realtimeDataEnabled)

        break;

      case CMD.RES_PDS:
        const pointer = Res.PDS(packet);
        this.penController.callbacks?.onPenPointer!(pointer);

        break;

      case CMD.PEN_PROFILE_RESPONSE:
        const profile = Res.ProfileData(packet);
        this.penController.callbacks?.onPenProfileData!(profile);

        break;

      default:
        NLog.log("ParsePacket: not implemented yet", packet);
        break;
    }
  }

  private initPenState(configurationInfo: PenConfigurationInfo): void {
    this.state = {
      penTipType: 0,
      penTipColor: -1,
      isPUI: false,
      isStartWithDown: false,
      dotCount: -1,
      authenticationRequired: false,
      password: null,
      prevDot: null,
      isBeforeMiddle: false,
      isStartWithPaperInfo: false,
      sessionTs: -1,
      eventCount: -1,
      cmdCheck: false,
    };

    !configurationInfo.Locked
        ? this.penController.callbacks?.onPenAuthorized!()
        : this.penController.callbacks?.onAuthenticationRequest!(
          { retryCount: configurationInfo.RetryCount, resetCount: configurationInfo.ResetCount });
  }

  AuthorizationPassword(password: string): void {
    this.state.password = password;
  }

  /**
   * Function to check whether the packet is correctly received in sequence when it is returned.
   * @param {number} eventCount
   */
  CheckEventCount(eventCount: number) {
    //Debug.WriteLine("COUNT : " + eventCount + ", " + EventCount);

    if (eventCount - this.state.eventCount !== 1 && (eventCount !== 0 || this.state.eventCount !== 255)) {
      const errorDot = this.state.prevDot?.Clone(DotTypes.PEN_ERROR);
      const extraData = eventCount - this.state.eventCount > 1
          ? "missed event count " + (this.state.eventCount + 1) + "-" + (eventCount - 1)
          : eventCount < this.state.eventCount
              ? "invalid event count " + this.state.eventCount + "," + eventCount
              : null;

      if (extraData)
        this.penController.onErrorDetected({
          ErrorType: ErrorType.InvalidEventCount,
          Dot: errorDot,
          TimeStamp: this.state.sessionTs,
          ExtraData: extraData,
        });
    }

    this.state.eventCount = eventCount;
  }
  // MARK: Parse (Up & Down)
  /**
   * 실시간으로 펜 DOWN 시, 전달된 패킷에서 시각, 펜의 타입, 펜의 색상을 파싱하고, 펜 이벤트의 설정 값들을 초기화하는 함수
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {Packet} packet
   */
  NewPenDown(packet: Packet) {
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null) {
      this.MakeUpDot();
    }
    const eventCount = packet.GetByte();
    this.CheckEventCount(eventCount);

    this.currentPaper.time = packet.GetLong();

    this.state.penTipType = packet.GetByte() === 0x00 ? PenTipType.Normal : PenTipType.Eraser;
    this.state.penTipColor = packet.GetInt();
    this.state.isStartWithDown = true;
    this.state.sessionTs = this.currentPaper.time;
    this.state.isBeforeMiddle = false;
    this.state.isStartWithPaperInfo = false;
    this.state.isPUI = false;
    this.state.dotCount = 0;
    this.state.prevDot = null;

    const x = -1;
    const y = -1;
    const f = 0;
    const downDot = PageDot.MakeDot(
      this.currentPaper,
      x,
      y,
      f,
      DotTypes.PEN_DOWN,
      this.state.penTipType,
      this.state.penTipColor,
      { tx: 0, ty: 0, twist: 0 }
    );

    this.ProcessDot(downDot);
  }

  /**
   * 실시간으로 펜 UP 시, 전달된 패킷에서 시각, 전송 및 처리 된 도트, 이미지 개수를 파싱하고, 펜 이벤트의 설정 값들을 초기화하는 함수
   * - 정상적으로 PenDown -> PenMove -> PenUp 의 동작을 수행했다면 Up Dot를 전달한다.
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {Packet} packet
   */
  NewPenUp(packet: Packet) {
    const eventCount = packet.GetByte();
    this.CheckEventCount(eventCount);

    const timeStamp = packet.GetLong();
    new Date(timeStamp);
    // NLog.log("ONLINE_NEW_PEN_UP_EVENT timestamp", new Date(timestamp));

    packet.GetShort(); //dotCount
    packet.GetShort(); //totalImageCount
    packet.GetShort(); //procImageCount
    packet.GetShort(); //successImageCount
    packet.GetShort(); //sendImageCount

    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null)
      this.ProcessDot(this.state.prevDot.Clone(DotTypes.PEN_UP));

    else if (!this.state.isStartWithDown && !this.state.isBeforeMiddle)
      // That is, do not send the UP dot when down or up only is pressed (without moving the pen)
      this.penController.onErrorDetected({
        ErrorType: ErrorType.MissingPenDownPenMove,
        TimeStamp: -1,
      });

    else if (!this.state.isBeforeMiddle)
      // Do not send the UP dot when down or up only is pressed without moving the pen
      this.penController.onErrorDetected({
        ErrorType: ErrorType.MissingPenMove,
        TimeStamp: this.state.sessionTs,
      });

    this.resetState();
  }

  /**
   * 실시간으로 펜 Up, Down 시, 전달된 패킷에서 시각, 펜의 타입, 펜의 색상을 파싱하고, 펜 이벤트의 설정 값들을 초기화하는 함수
   * - 펜 펌웨어 버전이 2.13 이전일 때 사용
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {Packet} packet
   */
  PenUpDown(packet: Packet) {
    const IsDown = packet.GetByte() === 0x00;

    if (IsDown) {
      if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null)
        this.MakeUpDot();

      this.state.isStartWithDown = true;
      this.currentPaper.time = packet.GetLong();
      this.state.sessionTs = this.currentPaper.time;

    } else {
      if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null)
        this.MakeUpDot(false);

      else if (!this.state.isStartWithDown && !this.state.isBeforeMiddle)
        // 즉 다운업(무브없이) 혹은 업만 들어올 경우 UP dot을 보내지 않음
        this.penController.onErrorDetected({
          ErrorType: ErrorType.MissingPenDownPenMove,
          TimeStamp: -1,
        });
      else if (!this.state.isBeforeMiddle)
        // 무브없이 다운-업만 들어올 경우 UP dot을 보내지 않음
        this.penController.onErrorDetected({
          ErrorType: ErrorType.MissingPenMove,
          TimeStamp: this.state.sessionTs,
        });

      this.state.isStartWithDown = false;
      this.currentPaper.time = -1;
      this.currentPaper.timeDiff = 0;
      this.state.sessionTs = -1;
    }

    this.state.penTipType = packet.GetByte() === 0x00 ? PenTipType.Normal : PenTipType.Eraser;
    this.state.penTipColor = packet.GetInt();
    this.state.isBeforeMiddle = false;
    this.state.isStartWithPaperInfo = false;
    this.state.dotCount = 0;
    this.state.prevDot = null;
  }

  /**
   * 실시간으로 필기 데이터 전송에 실패했을 경우, 전달된 패킷에서 에러 환경에 대한 정보 값을 파싱하는 함수
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {number} cmd - packetCount 추가된 패킷인지 확인하기 위한 커맨드
   * @param {Packet} packet
   */
  PenErrorDot(cmd: number, packet: Packet) {
    if (cmd === CMD.ONLINE_NEW_PEN_ERROR_EVENT) {
      const eventCount = packet.GetByte();
      this.CheckEventCount(eventCount);
    }

    const timeDiff = packet.GetByte();
    this.currentPaper.time += timeDiff;
    this.currentPaper.timeDiff = timeDiff;

    const force = packet.GetShort();
    const brightness = packet.GetByte();
    const exposureTime = packet.GetByte();
    const ndacProcessTime = packet.GetByte();
    const labelCount = packet.GetShort();
    const ndacErrorCode = packet.GetByte();
    const classType = packet.GetByte();
    const errorCount = packet.GetByte();

    const errorDot = this.state.prevDot?.Clone(DotTypes.PEN_ERROR);
    const newInfo = {
      TimeStamp: this.currentPaper.time,
      force,
      brightness,
      exposureTime,
      ndacProcessTime,
      labelCount,
      ndacErrorCode,
      classType,
      errorCount,
    };

    this.penController.onErrorDetected({
      ErrorType: ErrorType.ImageProcessingError,
      Dot: errorDot,
      TimeStamp: this.state.sessionTs,
      ImageProcessErrorInfo: newInfo,
    });
  }

  // MARK: Parse Paper
  /**
   * 실시간으로 필기 데이터 전송 시, 전달된 패킷에서 입력된 종이의 정보(section, owner, note, page)를 파싱하는 함수
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {number} cmd - packetCount 추가된 패킷인지 확인하기 위한 커맨드
   * @param {Packet} packet
   */
  PaperInfoEvent(cmd: number, packet: Packet) {
    if (cmd === CMD.ONLINE_NEW_PAPER_INFO_EVENT) {
      const eventCount = packet.GetByte();
      this.CheckEventCount(eventCount);
    }

    // 미들도트 중에 페이지가 바뀐다면 강제로 펜업을 만들어 준다.
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null)
      this.MakeUpDot(false);

    const rb = packet.GetBytes(4);

    const section = rb[3] & 0xff;
    const owner = Converter.byteArrayToInt(new Uint8Array([rb[0], rb[1], rb[2], 0x00]));
    const book = packet.GetInt();
    const page = packet.GetInt();
    this.currentPaper.section = section;
    this.currentPaper.owner = owner;
    this.currentPaper.note = book;
    this.currentPaper.page = page;

    this.state.dotCount = 0;
    this.state.isStartWithPaperInfo = true;

    if (isPUI({ section: section, owner: owner, book: book, page: page })) {
      this.state.isPUI = true;
      this.state.cmdCheck = true;
    }

    const x = -1;
    const y = -1;
    const f = 0;
    const downDot = PageDot.MakeDot(
      this.currentPaper,
      x,
      y,
      f,
      DotTypes.PEN_INFO,
      this.state.penTipType,
      this.state.penTipColor,
      { tx: 0, ty: 0, twist: 0 }
    );

    this.ProcessDot(downDot);
  }

  // MARK: Parse Dot
  /**
   * 실시간으로 필기 데이터 전송 시, 전달된 패킷에서 입력된 Dot의 각종 값(좌표, 기울기, 필압 등)을 파싱하는 함수
   * - 정상적으로 PenDown -> PenMove, PageInfo 를 수행했다면 moveDot를 Move Dot를 전달한다.
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {number} cmd - packetCount 추가된 패킷인지 확인하기 위한 커맨드
   * @param {Packet} packet
   */
  PenDotEvent(cmd: number, packet: Packet) {
    if (cmd === CMD.ONLINE_NEW_PEN_DOT_EVENT) {
      const eventCount = packet.GetByte();
      this.CheckEventCount(eventCount);
    }

    const timeDiff = packet.GetByte();
    this.currentPaper.time += timeDiff;
    this.currentPaper.timeDiff = timeDiff;

    const force = packet.GetShort();
    const xBase = packet.GetShort();
    const yBase = packet.GetShort();
    const fx = packet.GetByte();
    const fy = packet.GetByte();
    const x = xBase + fx * 0.01;
    const y = yBase + fy * 0.01;
    const tx = packet.GetByte();
    const ty = packet.GetByte();
    const twist = packet.GetShort();
    const angel = {
      tx,
      ty,
      twist,
    };

    let dot: PageDot = null;

    if (this.state.dotCount === 0 && this.currentPaper && isPUIOnPage(this.currentPaper, x, y)) {
      this.state.isPUI = true;
      this.state.cmdCheck = true;
    }

    if (this.state.isPUI && this.state.dotCount === 0 && this.state.cmdCheck) {
      PUIController
          .getInstance()
          .getPuiCommand(this.currentPaper, x, y)
          .then(this.penController.callbacks?.onPuiCommand);

      this.state.cmdCheck = false;
      return;
    }

    if (!this.penController.hoverMode && !this.state.isStartWithDown) {
      if (!this.state.isStartWithPaperInfo)
        // Occurrence of a phenomenon where there is no pen down (no move),
        // but the paper information is empty and the move (down-move-up-downX-move) occurs.
        this.penController.onErrorDetected({
          ErrorType: ErrorType.MissingPenDown,
          TimeStamp: -1,
        });
      else {
        this.currentPaper.time = Date.now();
        this.state.sessionTs = this.currentPaper.time;

        const errorDot = PageDot.MakeDot(
          this.currentPaper,
          x,
          y,
          force,
          DotTypes.PEN_ERROR,
          this.state.penTipType,
          this.state.penTipColor,
          angel
        );

        //펜 다운 없이 페이퍼 정보 있고 무브가 오는 현상(다운 - 무브 - 업 - 다운X - 무브)
        this.penController.onErrorDetected({
          ErrorType: ErrorType.MissingPenDown,
          Dot: errorDot,
          TimeStamp: this.state.sessionTs,
        });

        this.state.isStartWithDown = true;
        this.state.isStartWithPaperInfo = true;
      }
    }

    if (this.penController.hoverMode && !this.state.isStartWithDown)
      dot = PageDot.MakeDot(
        this.currentPaper,
        x,
        y,
        force,
        DotTypes.PEN_HOVER,
        this.state.penTipType,
        this.state.penTipColor,
        angel
      );
    else if (this.state.isStartWithDown) {
      if (this.currentPaper.time < 10000) {
        this.UpDotTimerCallback();
        this.penController.onErrorDetected({
          ErrorType: ErrorType.InvalidTime,
          TimeStamp: this.state.sessionTs,
        });
      }

      if (this.state.isStartWithPaperInfo)
        dot = PageDot.MakeDot(
          this.currentPaper,
          x,
          y,
          force,
          // this.state.mDotCount === 0 ? Dot.DotTypes.PEN_DOWN : Dot.DotTypes.PEN_MOVE,
          DotTypes.PEN_MOVE,
          this.state.penTipType,
          this.state.penTipColor,
          angel
        );
      else
        //펜 다운 이후 페이지 체인지 없이 도트가 들어왔을 경우
        this.penController.onErrorDetected({
          ErrorType: ErrorType.MissingPageChange,
          TimeStamp: this.state.sessionTs,
        });
    }

    dot && this.ProcessDot(dot);

    this.state.isBeforeMiddle = true;
    this.state.prevDot = dot;
    this.state.dotCount++;
  }

  /**
   * 실시간으로 필기 데이터 전송 시, 전달된 패킷에서 호버중인 Dot의 각종 값(좌표, 기울기)을 파싱하는 함수
   * - 정상적으로 PenDown -> PenMove, PageInfo 를 수행했다면 moveDot를 Move Dot를 전달한다.
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {Packet} pk
   */
  PenHoverEvent = (pk: Packet) => {
    const timeDiff = pk.GetByte();
    this.currentPaper.time += timeDiff;
    this.currentPaper.timeDiff = timeDiff;

    const xBase = pk.GetShort();
    const yBase = pk.GetShort();
    const fx = pk.GetByte();
    const fy = pk.GetByte();
    const x = xBase + fx * 0.01;
    const y = yBase + fy * 0.01;

    let dot = null;

    if (this.penController.hoverMode && !this.state.isStartWithDown)
      dot = PageDot.MakeDot(
        this.currentPaper,
        x,
        y,
        0,
        DotTypes.PEN_HOVER,
        this.state.penTipType,
        this.state.penTipColor,
        { tx: 0, ty: 0, twist: 0 }
      );

    dot && this.ProcessDot(dot);
  };

  /**
   * 펜의 블루투스 연결이 끊어졌을 경우, 펜 이벤트의 설정 값들을 초기화하는 함수
   */
  OnDisconnected() {
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null) {
      this.MakeUpDot();
      this.resetState();
    }
  }

  /**
   * 펜 다운 후 도트 들어올 때 정상적인 시간 값이 아닐 경우, 펜 이벤트 설정 값들을 초기화하는 함수
   */
  UpDotTimerCallback() {
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null) {
      this.MakeUpDot();
      this.resetState();
    }
  }

  /**
   * Function to forcefully generate a pen event and transmit an error message when necessary.
   * @param {boolean} isError
   */
  MakeUpDot(isError: boolean = true) {
    if (isError)
      this.penController.onErrorDetected({
        ErrorType: ErrorType.MissingPenUp,
        Dot: this.state.prevDot.Clone(DotTypes.PEN_ERROR),
        TimeStamp: this.state.sessionTs,
      });

    // REVIEW: I guess we process 'dot up' here despite the error to close state machine tracking dots.
    this.ProcessDot(this.state.prevDot.Clone(DotTypes.PEN_UP));
  }

  // MARK: Parse Offline
  /**
   * Function to parse offline data such as compression, transmission location, paper information, and pen data
   * when transmitting data through a network.
   * - In the final stage of packet parsing, a call to this function is necessary after the ParsePacket operation is completed.
   * @param {Packet} packet
   */
  ResOfflineData(packet: Packet) {
    const packetId = packet.GetShort();
    const isCompressed = packet.GetByte() === 1;
    const beforeSize = packet.GetShort();
    const afterSize = packet.GetShort();
    const transferState = packet.GetByte(); // 0: start, 1: middle, 2: end
    const rb = packet.GetBytes(4);
    const { section, owner } = GetSectionOwner(rb);
    const note = packet.GetInt();
    const strokeCount = packet.GetShort();
    const data = packet.GetBytes();
    let u8 = new Uint8Array(data);

    const paper = {
      section,
      owner,
      note,
    } as Paper;

    // NLog.log("offlineData info", offlineInfo);
    if (isCompressed)
      new Promise<Uint8Array>((resolve, reject) =>
          zlib.unzip(u8, (err, res) =>
              err ? reject(err) : resolve(new Uint8Array(res))))
          .then(data => u8 = data)
          .catch(message => {
            throw new Error(message);
          });

    this.ParseSDK2OfflinePenData(u8, paper, strokeCount);
    let percent = 100;

    if (transferState !== 2) {
      this.offline.receivedOfflineStrokes += strokeCount;
      // NLog.log("OFFLINE_DATA_RECEIVE", strokeCount, this.offline.mReceivedOfflineStroke);
      this.ReqOfflineData2(packetId, true, false);
      percent = (this.offline.receivedOfflineStrokes * 100) / this.offline.totalOfflineStrokes;
    }

    this.penController.callbacks?.onOfflineDataRetrievalProgress!(percent);
  }

  /**
   * Function to parse offline data such as stroke data (PenUpDown timing, pen type, pen color, dot coordinates, etc.)
   * and add it to a stroke array when transmitting offline data through a network.
   * - Paper ⊃ Stroke ⊃ Dot
   * - In order to call this function, the ResOfflineData operation is necessary.
   * @param {array} u8
   * @param {any} paper - A paper composed of offline data
   * @param strokeCount
   */
  ParseSDK2OfflinePenData(u8: Uint8Array, paper: Paper, strokeCount: number) {
    // NLog.log("OfflineStrokeParser", u8);
    const strokes = [];
    const packet = new PacketBuilder().data(u8).Build();

    for (let strokeIdx = 0; strokeIdx < strokeCount; strokeIdx++) {
      const page = packet.GetInt();
      const downTime = packet.GetLong();
      packet.GetLong(); // upTime
      const penTipType = packet.GetByte(); // penTipType
      const penTipColor = packet.GetInt();
      const dotCount = packet.GetShort();
      const dots = [];

      paper.page = page;
      paper.time = downTime;

      for (let dotIdx = 0; dotIdx < dotCount; dotIdx++) {
        const nTimeDelta = packet.GetByte();
        const force = packet.GetShort();
        const xBase = packet.GetShort();
        const yBase = packet.GetShort();
        const fx = packet.GetByte();
        const fy = packet.GetByte();
        const x = xBase + fx * 0.01;
        const y = yBase + fy * 0.01;
        const xTilt = packet.GetByte();
        const yTilt = packet.GetByte();
        const twist = packet.GetShort();

        packet.GetShort(); // reserved
        packet.GetByte(); // nCheckSum -- Ed: Not needed to be checked? :)

        const angle = {
          tx: xTilt,
          ty: yTilt,
          twist: twist,
        };

        const dotType: DotTypes =
            dotIdx === 0
                ? DotTypes.PEN_DOWN  // If it's a first dot
                : dotIdx === dotCount - 1
                    ? DotTypes.PEN_UP // If it's a last dot
                    : DotTypes.PEN_MOVE; // Everything in between

        dots.push(PageDot.MakeDot(paper, x, y, force, dotType, penTipType, penTipColor, angle));
        paper.time += nTimeDelta;
      }

      strokes.push({ dots });
    }

    // NLog.log(strokes)
    this.penController.callbacks?.onOfflineDataRetrievalSuccess!(strokes);
  }

  // NOTE: Request(Offline Receive Response)
  /**
   * Function to return the transmission status and other information (such as pen up or down) when receiving offline data.
   * - In order to call this function, the ResOfflineData operation is necessary.
   * @param {number} index
   * @param {boolean} isSuccess
   * @param {boolean} end - If true, stop transmission, otherwise continue transmission.
   */
  ReqOfflineData2(index: number, isSuccess: boolean = true, end: boolean = false): boolean {
    const packet = new RequestPacketBuilder(CMD.OFFLINE_PACKET_RESPONSE)
        .PutCode(isSuccess ? 0 : 1)
        .PutShort(index)
        .Put(end ? 0 : 1);

    // NLog.log("ReqOfflineData2", bf);
    return this.Send(packet);
  }

  // NOTE: Request(PenStatus)
  /**
   * Function to request various pen settings information.
   * @returns
   */
  ReqPenStatus() {
    const packet = new RequestPacketBuilder(CMD.SETTING_INFO_REQUEST);

    return this.Send(packet);
  }

  // NOTE: Request(SetupTime)
  /**
   * Function to request a time change for pen settings currently in progress.
   * @returns
   */
  ReqSetupTime() {
    const packet = new RequestPacketBuilder(CMD.SETTING_CHANGE_REQUEST)
        .Put(SettingType.TimeStamp)
        .PutLong(Date.now());

    return this.Send(packet);
  }

  // MARK: Parse Start(Step 1)
  /**
   * Step3 Send Data from Pen
   * Function to create a buffer space and handle escape processing when a packet arrives.
   * - First step of packet parsing.
   * @param {array} buff - Uint8Array
   */
  ProtocolParse(buff: Uint8Array) {
    NLog.log("Parsing Process Start", buff);

    const size = buff.length;
    for (let i = 0; i < size; i++) {
      if (buff[i] === CONST.PK_STX) {
        // Start of a packet
        this.mBuffer = new ByteUtil();
      } else if (buff[i] === CONST.PK_ETX) {
        // End of a packet
        const builder = new PacketBuilder();
        const cmd = this.mBuffer.GetByte();

        // event command is 0x6X and PDS 0x73
        const result_size = cmd >> 4 !== 0x6 && cmd !== 0x73 && cmd !== 0x24 && cmd !== 0x32 ? 1 : 0;
        const result = result_size > 0 ? this.mBuffer.GetByte() : -1;
        const length = this.mBuffer.GetShort();
        const data = this.mBuffer.GetBytes();

        builder
            .cmd(cmd)
            .result(result)
            .data(data)
            .length(length);

        this.mBuffer.Clear();
        this.mBuffer = null;

        const packet = builder.Build();
        this.ParsePacket(packet);
      } else if (buff[i] === CONST.PK_DLE) {
        if (i < size - 1) {
          this.mBuffer.Put(buff[i + 1] ^ 0x20, false);
          i++;
        }
      } else {
        this.mBuffer.Put(buff[i]);
      }
    }
  }

  /**
   * Function to process pen data and transmit a request to update the pen software
   * based on the state and position values transmitted from the pen.
   * @param {number} offset
   * @param {number} status - status: 0 = Start / 1 = Midway / 2 = End / 3 = Error
   */
  ResponseChunkRequest(offset: number, status: number) {
    const fwBf = this.penController.mClientV2.state.fwFile as ByteUtil;
    const packetSize = this.penController.mClientV2.state.fwPacketSize;
    const data = fwBf.GetBytesWithOffset(offset, packetSize);

    NLog.log("[FW] received pen upgrade status : " + status);

    // noinspection FallThroughInSwitchStatementJS
    switch (status) {
      case FirmwareStatusType.STATUS_END:
        if (data !== null)
          this.penController.RequestFirmwareUpload(offset, data, status);

        this.penController.callbacks?.onFirmwareUpgradeProgress!(100);
        this.penController.callbacks?.onFirmwareUpgradeSuccess!();
        this.isUploading = false;

        break;

      case FirmwareStatusType.STATUS_START:
      case FirmwareStatusType.STATUS_CONTINUE:
        this.isUploading = true;
        this.penController.RequestFirmwareUpload(offset, data, status);
        break;

      case FirmwareStatusType.STATUS_ERROR:
        this.isUploading = false;
        // Ed: After refactoring this looks suspicious. Is it retry?
        this.penController.RequestFirmwareUpload(offset, data, status);

      default:
        this.isUploading = false;
        this.penController.callbacks?.onFirmwareUpgradeFailure!(FirmwareUpgradeFailureReason.Failure);

        break;
    }

    if (!this.isUploading)
      return;

    const maximum = fwBf.Size / packetSize  + (fwBf.Size % packetSize == 0 ? 0 : 1);
    const index = offset / packetSize;

    NLog.log("[FW] send progress => Maximum : " + maximum + ", Current : " + index);

    const percent = (index * 100) / maximum;
    this.penController.callbacks?.onFirmwareUpgradeProgress!(percent);
  }

  /**
   * Function to handle escape processing when the start (STX) and end (ETX) values of a packet are included in the packet data.
   * @param {number} input
   * @returns {array}
   */
  Escape(input: number): Array<number> {
    return (input === CONST.PK_STX || input === CONST.PK_ETX || input === CONST.PK_DLE)
        ? [CONST.PK_DLE, input ^ 0x20]
        : [input];
  }

  // Send Dot
  ProcessDot(dot: Dot) {
    dot.dotType === DotTypes.PEN_HOVER
        ? this.SendDotReceiveEvent(dot)
        : this.dotFilter.put(dot);
  }

  /**
   * 세팅된 도트가 그려지기 위해 펜 콘트롤러의 onDot로 전달하는 함수
   * - 해당 함수가 기능하기 위해서는 onDot를 구현해야 한다.
   * @param {Dot} dot
   */
  SendDotReceiveEvent = (dot: Dot) => {
    // NLog.log(dot);
    this.penController.callbacks?.onDot!(dot);
    NLog.log("ParseDot ] X:", dot.x, " Y:", dot.y, " f:", dot.f, " DotType:", dot.dotType, " Page: ", dot.pageInfo);
  };

  dotFilter = new DotFilter(this.SendDotReceiveEvent);

  // Send to Pen
  /**
   * Function to pass the created buffer (for pen write request) to the pen controller's handleWrite handle.
   * - In order to call this function, the handleWrite implementation is necessary.
   * @param {RequestPacketBuilder} packet
   * @returns {boolean}
   */
  private Send(packet: RequestPacketBuilder): boolean {
    // Ed: Not sure about this implementation but some of the calling methods expected a boolean return value.
    if (!this.penController.handleWrite)
      return false;

    this.penController.handleWrite!(packet.build());

    return true;
  }
}
