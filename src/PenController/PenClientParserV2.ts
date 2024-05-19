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
import {Dot, DotTypes, FirmwareUpgradeFailureReason, PageInfo, Paper} from "../Util/type";
import PUIController, {isPUI, isPUIOnPage} from "../API/PUIController";
import PageDot from "../API/PageDot";
import StrokeHandler from "../Util/StrokeHandler";

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

type PenData = {
  eventCount: number;
  timestamp: number;
  penTipType?: PenTipType; // 'down' property
  penTipColor?: number; // 'down' property
  dotCount?: number; // 'up' property
}

type DotData = {
  eventCount: number;
  timeDiff: number;
  force: number;
  x: number;
  y: number;
  angle: {
    tx: number;
    ty: number;
    twist: number;
  };
};

const NEW_PEN_DOT_EVENTS = [
  CMD.ONLINE_NEW_PEN_DOT_EVENT,
  CMD.ONLINE_NEW_PEN_DOWN_EVENT,
  CMD.ONLINE_NEW_PEN_UP_EVENT,
  CMD.ONLINE_NEW_PAPER_INFO_EVENT,
  CMD.ONLINE_NEW_PEN_ERROR_EVENT,
];

function parsePenData(cmd: number, packet: Packet): PenData {
  const eventCount = NEW_PEN_DOT_EVENTS.includes(cmd)
      ? packet.GetByte()
      : 0;

  const timestamp = packet.GetLong();
  let penTipType = null;
  let penTipColor = null;
  let dotCount = null;

  switch (cmd) {
    case CMD.ONLINE_NEW_PEN_DOWN_EVENT:
    case CMD.ONLINE_PEN_UPDOWN_EVENT: // TODO: Double-check with the commented logic in PenUpDown.
      penTipType = packet.GetByte() === 0x00
          ? PenTipType.Normal : PenTipType.Eraser;
      penTipColor = packet.GetInt();
      break;

    case CMD.ONLINE_NEW_PEN_UP_EVENT:
      dotCount = packet.GetShort(); //dotCount
      packet.GetShort(); //totalImageCount
      packet.GetShort(); //procImageCount
      packet.GetShort(); //successImageCount
      packet.GetShort(); //sendImageCount
      break;
  }

  return {
    eventCount, timestamp, penTipType, penTipColor, dotCount,
  };
}

function parseDotPacketHeader(cmd: number, packet: Packet) {
  const eventCount = NEW_PEN_DOT_EVENTS.includes(cmd)
      ? packet.GetByte()
      : 0;

  const timeDiff = packet.GetByte();
  const force = cmd !== CMD.ONLINE_PEN_HOVER_EVENT
      ? packet.GetShort()
      : 0;

  return { eventCount, timeDiff, force };
}

function parseDotPacket(cmd: number, packet: Packet): DotData {
  const header = parseDotPacketHeader(cmd, packet);

  const xBase = packet.GetShort();
  const yBase = packet.GetShort();
  const fx = packet.GetByte();
  const fy = packet.GetByte();
  const x = xBase + fx * 0.01;
  const y = yBase + fy * 0.01;
  const angle = cmd !== CMD.ONLINE_PEN_HOVER_EVENT
      ? {
        tx: packet.GetByte(),
        ty: packet.GetByte(),
        twist: packet.GetShort(),
      }
      : {
        tx: 0,
        ty: 0,
        twist: 0
      };

  return {
    ...header,
    x,
    y,
    angle,
  };
}

const packetCommands = Object.entries(CMD)
    .reduce((acc, [key, value]) => ({...acc, [value]: key}), {});

export default class PenClientParserV2 {
  private readonly penController: PenController;
  private readonly paper: Paper;
  private readonly state: PenState;
  private mBuffer: any = null;
  private offline: any;
  private isUploading: boolean;

  constructor(penController: PenController) {
    this.penController = penController;

    this.paper = {
      section: -1,
      owner: -1,
      book: -1,
      page: -1,
      time: -1,
      timeDiff: 0,
    };

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

    this.offline = {
      totalOfflineStrokes: -1,
      receivedOfflineStrokes: 0,
      totalOfflineDataSize: -1,
    };

    // REVIEW: This is rather weird.
    this.isUploading = true;
  }

  private resetState(hard?: boolean) {
    this.paper.time = -1;
    this.paper.timeDiff = 0;
    
    this.state.sessionTs = -1;
    this.state.isStartWithDown = false;
    this.state.isBeforeMiddle = false;
    this.state.isStartWithPaperInfo = false;
    this.state.isPUI = false;
    this.state.dotCount = 0;
    this.state.prevDot = null;

    if (hard) {
      this.state.penTipType = 0;
      this.state.penTipColor = -1;
      this.state.dotCount = -1;
      this.state.eventCount = -1;
      this.state.cmdCheck = false;

      this.state.authenticationRequired = false;
      this.state.password = null;
    }
  }

  private makeDot(dotData: DotData, dotType: DotTypes) {
    return PageDot.MakeDot(
        this.paper,
        dotData.x,
        dotData.y,
        dotData.force,
        dotType,
        this.state.penTipType,
        this.state.penTipColor,
        dotData.angle);
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
    // @ts-ignore
    NLog.debug("ParsePacket", cmd, "0x" + cmd.toString(16), " - ", packetCommands["" + cmd] || "Unknown");
    NLog.debug("ParsePacket", packet.Data);

    if (packet.Result > 0) {
      NLog.error("Packet result failed", packet);
      return;
    }

    switch (cmd) {
      case CMD.VERSION_RESPONSE:
        const versionInfo = Res.versionInfo(packet);

        NLog.debug("ParsePacket Version Info", versionInfo);
        this.isUploading = false;
        this.penController.handleConnection(versionInfo);
        break;

      case CMD.SHUTDOWN_EVENT:
        const shutdownReason = packet.GetByte();
        NLog.log("ParsePacket power off", shutdownReason);

        this.penController.handleShutdown(shutdownReason);
        break;

      case CMD.LOW_BATTERY_EVENT:
        const battery = packet.GetByte();

        this.penController.handleLowBattery(battery);
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
        NLog.debug("ParsePacket SETTING_INFO_RESPONSE", configurationInfo);

        this.penController.handleConfigurationInfo(configurationInfo);
        break;

      case CMD.SETTING_CHANGE_RESPONSE:
        const settingChange = Res.SettingChange(packet);
        this.penController.handleSettingChange(settingChange);
        break;

      // Password
      case CMD.PASSWORD_RESPONSE:
        const authenticationResult = Res.Password(packet);
        NLog.debug("ParsePacket PASSWORD_RESPONSE", authenticationResult);

        const noPassword = !this.state.authenticationRequired;
        this.state.authenticationRequired = false;

        authenticationResult.status === 1
            ? this.penController.handleSuccessfulAuthentication(noPassword)
            : this.penController.handleFailedAuthentication(authenticationResult);

        break;

      case CMD.PASSWORD_CHANGE_RESPONSE:
        const passwordChange = Res.PasswordChange(packet);

        if (passwordChange.status === 0) {
          this.state.authenticationRequired = true;
          const noPassword= !this.penController.AuthorizeWithPassword(this.state.password);

          if (noPassword)
            // Successful setup of password-less login.
            this.penController.handleSuccessfulAuthentication(noPassword);

          break;
        }

        // Ed: we reset password on a failed attempt (?)
        this.state.password = "";
        this.penController.handleFailedAuthentication(passwordChange);

        break;

      // MARK: CMD Offline
      case CMD.OFFLINE_NOTE_LIST_RESPONSE:
        const noteList = Res.NoteList(packet);
        this.penController.handleOfflineNoteListData(noteList);

        break;
      case CMD.OFFLINE_PAGE_LIST_RESPONSE:
        const pageList = Res.PageList(packet);
        this.penController.handleOfflinePageListData(pageList);

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

        NLog.debug("OFFLINE_DATA_RESPONSE ", offlineInfo);

        // REVIEW: Double-check the total data size check logic. Failing on 0 size doesn't look good.
        packet.Result !== 0x00 || this.offline.totalOfflineDataSize === 0
            ? this.penController.handleOfflineDataRetrievalFailure()
            : this.penController.handleOfflineDataRetrievalProgress(0);

        break;

      case CMD.OFFLINE_PACKET_REQUEST:
        this.ResOfflineData(packet);

        break;

      case CMD.OFFLINE_DATA_DELETE_RESPONSE:
        // NLog.log("OFFLINE_DATA_DELETE_RESPONSE", packet);
        packet.Result !== 0x00
            ? this.penController.handleOfflineDataRetrievalFailure()
            : this.penController.handleOfflineDataDeleteSuccess();

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
            ? status === 0 && this.penController.handleFirmwareUpgradeProgress(0)
            : this.penController.handleFirmwareUpgradeFailure(status as FirmwareUpgradeFailureReason);

        break;

      case CMD.FIRMWARE_PACKET_REQUEST:
        const firmwareRes = {
          status: packet.GetByte(),
          offset: packet.GetInt(),
        };

        this.ResponseChunkRequest(firmwareRes.offset, firmwareRes.status);

        break;

      case CMD.ONLINE_DATA_RESPONSE:
        NLog.debug("Using Note Set", packet.Result);

        const realtimeDataEnabled = packet.Result === 0x00;
        this.penController.handleRealtimeDataStatus(realtimeDataEnabled);

        break;

      case CMD.RES_PDS:
        const pointer = Res.PDS(packet);
        this.penController.handlePenPointer(pointer);

        break;

      case CMD.PEN_PROFILE_RESPONSE:
        const profile = Res.ProfileData(packet);
        this.penController.handleProfileData(profile);

        break;

      default:
        NLog.log("ParsePacket: not implemented yet", packet);
        break;
    }
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

      console.error("Event Count Check Failed", extraData);

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
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null)
      this.MakeUpDot(true);

    const penData = parsePenData(CMD.ONLINE_NEW_PEN_DOWN_EVENT, packet);
    penData.eventCount && this.CheckEventCount(penData.eventCount);

    this.state.penTipType = penData.penTipType;
    this.state.penTipColor = penData.penTipColor;
    this.state.sessionTs = this.paper.time = penData.timestamp;

    this.state.isBeforeMiddle = false;
    this.state.isStartWithDown = true;
    this.state.isStartWithPaperInfo = false;
    this.state.isPUI = false;
    this.state.dotCount = 0;
    this.state.prevDot = null;

    const x = -1;
    const y = -1;
    const f = 0;
    const downDot = PageDot.MakeDot(
      this.paper,
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
    const penData = parsePenData(CMD.ONLINE_NEW_PEN_UP_EVENT, packet);
    penData.eventCount && this.CheckEventCount(penData.eventCount);

    if (!this.state.isStartWithDown || !this.state.isBeforeMiddle)
        // That is, do not send the UP dot when down or up only is pressed (without moving the pen)
      return this.penController.onErrorDetected({
        ErrorType: this.state.isStartWithDown
            // Do not send the UP dot when down or up only is pressed without moving the pen
            ? ErrorType.MissingPenMove
            // That is, do not send the UP dot when down or up only is pressed (without moving the pen)
            : ErrorType.MissingPenDownPenMove,
        TimeStamp: this.state.sessionTs,
      });

    // Ed: We make a 'pen up' dot from the previous dot.
    this.state.prevDot &&
      this.ProcessDot(this.state.prevDot.Clone(DotTypes.PEN_UP));

    this.resetState();
  }

  /**
   * 실시간으로 펜 Up, Down 시, 전달된 패킷에서 시각, 펜의 타입, 펜의 색상을 파싱하고, 펜 이벤트의 설정 값들을 초기화하는 함수
   * - 펜 펌웨어 버전이 2.13 이전일 때 사용
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * Function to parse the time, pen type, and pen color from the packet delivered when the pen is up and down in real time,
   * and initialize the pen event settings.
   * - Used when the pen firmware version is prior to 2.13
   * - The final stage of packet parsing, the ParsePacket operation is required to call this function.
   * @param {Packet} packet
   */
  PenUpDown(packet: Packet) {
    // Ed: Parsing "old" "up-down" event.
    const isDown = packet.GetByte() === 0x00;
    const isInStrokeCollectionState = this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null;

    if (isInStrokeCollectionState)
      this.MakeUpDot();

    if (!this.state.isBeforeMiddle && !isDown)
      return this.penController.onErrorDetected({
        ErrorType: this.state.isStartWithDown
            // 무브없이 다운-업만 들어올 경우 UP dot을 보내지 않음
            // If only down-up (without move) comes in, do not send UP dot.
            ? ErrorType.MissingPenMove
            // 즉 다운업(무브없이) 혹은 업만 들어올 경우 UP dot을 보내지 않음
            // If only down-up (without move) or up comes in, do not send UP dot.
            : ErrorType.MissingPenDownPenMove,
        TimeStamp: this.state.sessionTs,
      });

    // REVIEW: The previous logic was tricky.
    // this.currentPaper.time = isDown ? packet.GetLong() : -1;
    // this.state.penTipType = packet.GetByte() === 0x00 ? PenTipType.Normal : PenTipType.Eraser;
    // this.state.penTipColor = packet.GetInt();

    // TODO: We reset isStartWithPaperInfo here: how does it correlate with `this.paper` setting?
    this.resetState();

    const penData = parsePenData(CMD.ONLINE_PEN_UPDOWN_EVENT, packet);
    penData.eventCount && this.CheckEventCount(penData.eventCount);

    this.state.sessionTs = this.paper.time = penData.timestamp;
    this.state.penTipType = penData.penTipType;
    this.state.penTipColor = penData.penTipColor;
    this.state.isStartWithDown = isDown;

    // REVIEW: Probably we can just set 0 in all the cases.
    !isDown && (this.paper.timeDiff = 0);

    const dummyDot = { eventCount: 0, timeDiff: 0, x: -1, y: -1, force: 0, angle: { tx: 0, ty: 0, twist: 0} };

    // @ts-ignore
    this.ProcessDot(this.makeDot(dummyDot, DotTypes.PEN_DOWN));
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
    const dotData = parseDotPacket(cmd, packet);
    dotData.eventCount && this.CheckEventCount(dotData.eventCount);

    // Ed: Apparently here we track a events above PUI.
    if (this.state.dotCount === 0 && this.paper && isPUIOnPage(this.paper, dotData.x, dotData.y)) {
      this.state.isPUI = true;
      PUIController
          .getInstance()
          .getPuiCommand(this.paper, dotData.x, dotData.y)
          .then(this.penController.handlePuiCommand);

      return;
    }

    this.paper.time += (this.paper.timeDiff = dotData.timeDiff);
    this.state.sessionTs = this.paper.time;

    const isHoverMode = this.penController.isHoverModeEnabled();
    const didItStartWithDown = this.state.isStartWithDown;
    const doWeHavePaperInfo = this.state.isStartWithPaperInfo;

    if (!didItStartWithDown && !isHoverMode) {
      // 펜 다운 없이 페이퍼 정보 있고 무브가 오는 현상(다운 - 무브 - 업 - 다운X - 무브)
      // Phenomenon where there is paper information and a move comes without pen down (down - move - up - no down - move).
      this.penController.onErrorDetected({
        ErrorType: doWeHavePaperInfo ? ErrorType.MissingPenDown : ErrorType.MissingPageChange,
        Dot: doWeHavePaperInfo ? this.makeDot(dotData, DotTypes.PEN_ERROR) : null,
        TimeStamp: Date.now(),
      });

      this.state.isStartWithDown = doWeHavePaperInfo;

      return; // REVIEW: Should we return here or let the dot to be processed?
    }

    // Ed: Apparently here is the following logic:
    //     if we're already tracking but time is shitty, then it's an error.
    if (didItStartWithDown && this.paper.time < 10000) {
      this.UpDotTimerCallback();
      this.penController.onErrorDetected({
        ErrorType: ErrorType.InvalidTime,
        TimeStamp: this.state.sessionTs,
      });
    }

    const dotType = didItStartWithDown ? DotTypes.PEN_MOVE : DotTypes.PEN_HOVER;
    const dot = this.makeDot(dotData, dotType);

    this.ProcessDot(dot);

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
    const dotData = parseDotPacket(CMD.ONLINE_PEN_HOVER_EVENT, pk);
    dotData.eventCount && this.CheckEventCount(dotData.eventCount);

    this.paper.time += (this.paper.timeDiff = dotData.timeDiff);
    this.state.sessionTs = this.paper.time;

    const isHoverMode = this.penController.isHoverModeEnabled();
    const didItStartWithDown = this.state.isStartWithDown;

    // Ed: Apparently here is the following logic:
    //     If we are in 'hover moder' and we didn't track 'pen down' yet, we can draw a highlighter.
    if (isHoverMode && !didItStartWithDown)
      this.ProcessDot(this.makeDot(dotData, DotTypes.PEN_HOVER));
  };

  // MARK: Parse Paper
  /**
   * 실시간으로 필기 데이터 전송 시, 전달된 패킷에서 입력된 종이의 정보(section, owner, note, page)를 파싱하는 함수
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {number} cmd - packetCount 추가된 패킷인지 확인하기 위한 커맨드
   * @param {Packet} packet
   */
  PaperInfoEvent(cmd: number, packet: Packet) {
    // 미들도트 중에 페이지가 바뀐다면 강제로 펜업을 만들어 준다.
    // If a page is changed during middle dot, it will create a 'pen up'' forcefully.
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null)
      this.MakeUpDot();

    if (cmd === CMD.ONLINE_NEW_PAPER_INFO_EVENT) {
      const eventCount = packet.GetByte();
      this.CheckEventCount(eventCount);
    }

    const owner = Converter.byteArrayToInt(
        new Uint8Array(Array.from(packet.GetBytes(3)).concat(0x00)));
    const section = packet.GetByte() & 0xff;
    const book = packet.GetInt();
    const page = packet.GetInt();

    const info = { section, owner, book, page };

    Object.assign(this.paper, info);

    this.state.dotCount = 0;
    this.state.isStartWithPaperInfo = true;

    if (isPUI(this.paper as PageInfo)) {
      this.state.isPUI = true;
      this.state.cmdCheck = true;
    }

    // REVIEW: 'pen info' event IMHO shouldn't be treated as 'pen down'.
    // const x = -1;
    // const y = -1;
    // const f = 0;
    // const downDot = PageDot.MakeDot(
    //   this.paper,
    //   x,
    //   y,
    //   f,
    //   DotTypes.PEN_INFO,
    //   this.state.penTipType,
    //   this.state.penTipColor,
    //   { tx: 0, ty: 0, twist: 0 }
    // );
    // this.ProcessDot(downDot);

    this.penController.handlePageInfo(info);
  }

  /**
   * 실시간으로 필기 데이터 전송에 실패했을 경우, 전달된 패킷에서 에러 환경에 대한 정보 값을 파싱하는 함수
   * - 패킷 파싱의 마지막 단계, 해당 함수를 호출하기 위해서는 ParsePacket 작업이 필요하다.
   * @param {number} cmd - packetCount 추가된 패킷인지 확인하기 위한 커맨드
   * @param {Packet} packet
   */
  PenErrorDot(cmd: number, packet: Packet) {
    const header = parseDotPacketHeader(cmd, packet);

    const brightness = packet.GetByte();
    const exposureTime = packet.GetByte();
    const ndacProcessTime = packet.GetByte();
    const labelCount = packet.GetShort();
    const ndacErrorCode = packet.GetByte();
    const classType = packet.GetByte();
    const errorCount = packet.GetByte();

    this.paper.time += (this.paper.timeDiff = header.timeDiff);

    const newInfo = {
      ...header,
      TimeStamp: this.paper.time,
      brightness,
      exposureTime,
      ndacProcessTime,
      ndacErrorCode,
      classType,
      labelCount,
      errorCount,
    };

    this.penController.onErrorDetected({
      ErrorType: ErrorType.ImageProcessingError,
      TimeStamp: this.state.sessionTs,
      ImageProcessErrorInfo: newInfo,
    });
  }

  /**
   * 펜의 블루투스 연결이 끊어졌을 경우, 펜 이벤트의 설정 값들을 초기화하는 함수
   */
  OnDisconnected() {
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null) {
      this.MakeUpDot(true);
      this.resetState(true);
    }
  }

  /**
   * 펜 다운 후 도트 들어올 때 정상적인 시간 값이 아닐 경우, 펜 이벤트 설정 값들을 초기화하는 함수
   */
  UpDotTimerCallback() {
    if (this.state.isStartWithDown && this.state.isBeforeMiddle && this.state.prevDot !== null) {
      this.MakeUpDot(true);
      this.resetState();
    }
  }

  /**
   * Function to forcefully generate a pen event and transmit an error message when necessary.
   * @param {boolean} isError
   */
  MakeUpDot(isError: boolean = false) {
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
    const book = packet.GetInt();
    const strokeCount = packet.GetShort();
    const data = packet.GetBytes();
    let u8 = new Uint8Array(data);

    const paper = {
      section,
      owner,
      book,
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
    let progress = 100;

    if (transferState !== 2) {
      this.offline.receivedOfflineStrokes += strokeCount;
      // NLog.log("OFFLINE_DATA_RECEIVE", strokeCount, this.offline.mReceivedOfflineStroke);
      this.ReqOfflineData2(packetId, true, false);
      progress = (this.offline.receivedOfflineStrokes * 100) / this.offline.totalOfflineStrokes;
    }

    this.penController.handleOfflineDataRetrievalProgress(progress);
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
    this.penController.handleOfflineDataRetrievalSuccess(strokes);
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
    NLog.debug("Parsing Process Start", buff);

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
    NLog.debug("[FW] received pen upgrade status : " + status);
    const nextChunk = this.penController.getNextChunk(offset);

    this.isUploading = false;

    // noinspection FallThroughInSwitchStatementJS
    switch (status) {
      case FirmwareStatusType.STATUS_CONTINUE:
        if (nextChunk) {
          this.isUploading = true;
          this.penController.RequestFirmwareUpload(offset, nextChunk.data, status);

          break;
        }

        NLog.error("[FW] Illegal state: received STATUS_CONTINUE but no data for the next chunk is available");

      case FirmwareStatusType.STATUS_END:
        if (!nextChunk) {
          this.penController.handleFirmwareUpgradeProgress(100);
          this.penController.handleFirmwareUpgradeSuccess();

          break;
        }

        NLog.error("[FW] Illegal state: received STATUS_END but data for the next chunk is available");

      default:
        NLog.error("[FW] Failed chunk response status: ", status);
        this.penController.handleFirmwareUpgradeFailure(FirmwareUpgradeFailureReason.Failure);
        break;
    }

    if (!this.isUploading)
      return;

    const progress = Math.ceil((nextChunk.currentChunk * 100) / nextChunk.totalChunks);

    NLog.log("[FW] send progress: ", progress, " => total: ", nextChunk.totalChunks, ", current: ", nextChunk.currentChunk);

    this.penController.handleFirmwareUpgradeProgress(progress);
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
    dot.dotType === DotTypes.PEN_HOVER || dot.dotType === DotTypes.PEN_INFO || dot.dotType === DotTypes.PEN_ERROR
        ? this.SendDotReceiveEvent(dot)
        : this.strokeHandler.handleDot(dot);

    //   if (dot.dotType !== DotTypes.PEN_ERROR)
    //     // Should we continue stroke here? (this is suggested by the client code from the reference library (PenBasic)
  }

  /**
   * 세팅된 도트가 그려지기 위해 펜 콘트롤러의 onDot로 전달하는 함수
   * - 해당 함수가 기능하기 위해서는 onDot를 구현해야 한다.
   * @param {Dot} dot
   */
  SendDotReceiveEvent = (dot: Dot) => {
    this.penController.handleDot(dot);
  };

  //dotFilter = new DotFilter(this.SendDotReceiveEvent);

  private handleStroke = (stroke: Dot[]) => {
    this.penController.handleStroke(stroke);
  }

  strokeHandler = new StrokeHandler(this.handleStroke);

  // Send to Pen
  /**
   * Function to pass the created buffer (for pen write request) to the pen controller's handleWrite handle.
   * - In order to call this function, the handleWrite implementation is necessary.
   * @param {RequestPacketBuilder} packet
   * @returns {boolean}
   */
  private Send(packet: RequestPacketBuilder): boolean {
    this.penController.writeData(packet.build());
    return true;
  }
}
