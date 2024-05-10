// noinspection JSUnusedGlobalSymbols

import PenClientParserV2 from "./PenClientParserV2";
import PenRequestV2 from "./PenRequestV2";
import {
  PenCallbacks,
  VersionInfo,
  DotErrorInfo,
  PenConfigurationInfo,
  AuthorizationRequest,
  FirmwareUpgradeFailureReason, PenPointer, Dot, PageInfo, DotTypes
} from "../Util/type";
import * as NLog from "../Util/NLog";
import {ErrorType, SettingType} from "../API/PenMessageType";

type WriteHandle = (u8: Uint8Array) => void;

const dotErrorTypes = Object.entries(ErrorType)
    .reduce((acc, [key, value]) => ({ ...acc, [value]: key }), {});

const dotTypes = Object.entries(DotTypes)
    .reduce((acc, [key, value]) => ({ ...acc, [value]: key }), {});

export default class PenController {
  readonly id: string;
  info: VersionInfo;
  configurationInfo: PenConfigurationInfo | null = null;

  private writer: WriteHandle | null = null;
  private readonly writingBuffer: Array<Uint8Array> = [];

  clientParser: PenClientParserV2;
  clientCaller: PenRequestV2;

  private callbacks: PenCallbacks | null = null;

  constructor(id: string) {
    this.id = id;
    this.clientParser = new PenClientParserV2(this);
    this.clientCaller = new PenRequestV2(this);
    this.info = {} as VersionInfo;
  }

  /**
   * @memberof PenController
   */
  setCallbacks(callbacks: PenCallbacks) {
    this.callbacks = callbacks;
  }

  setWriter(writeHandle: WriteHandle) {
    if (!this.writingBuffer.length) {
      this.writer = writeHandle;
      return;
    }

    let intervalId: any;
    intervalId = setInterval(() => this.handleWritingBuffer(writeHandle, intervalId), 10);
  }

  private handleWritingBuffer(writeHandle: WriteHandle, intervalId: any) {
    if (!this.writingBuffer.length) {
     this.writer = writeHandle;
     return clearInterval(intervalId);
    }

    writeHandle(this.writingBuffer.shift());
  }

  writeData(buff: Uint8Array) {
    this.writer
        ? this.writer(buff)
        : this.writingBuffer.push(buff);
  }

  /**
   * Step3 Send Data from Pen
   * @param {array} buff - Uint8Array
   */
  handleData(buff: Uint8Array) {
    this.clientParser.ProtocolParse(buff);
  }

  // Error process
  /**
   * 도트 에러 발생 시 메시지 출력을 위한 함수
   * - 해당 함수가 기능하기 위해서는 onMessage를 구현해야 한다.
   * @param {DotErrorInfo} errorInfo
   */
  onErrorDetected(errorInfo: DotErrorInfo) {
    // @ts-ignore
    NLog.error("Dot Error Detected: ", "type: ", dotErrorTypes[errorInfo.ErrorType], errorInfo);
    this.callbacks?.onDotError?.(errorInfo);
  }

  //SDK Local logic
  // step1
  localProcessSetRTCTime() {
    this.SetRtcTime();
  }

  // Step2
  localProcessPenSettingInfo() {
    this.RequestPenStatus();
  }

  // MARK: Request
  //Request Version Info
  // /**
  //  * 현재 버전을 요청하는 함수
  //  * @returns
  //  */
  // RequestVersionInfo() {
  //   return this.mParserV2.penVersionInfo;
  // }

  // Request
  /**
   * 펜에 설정된 비밀번호를 변경 요청하는 함수
   * @param {string} oldPassword
   * @param {string} [newPassword=""]
   * @memberof PenController
   */
  SetPassword(oldPassword: string, newPassword: string = "") {
    if (newPassword === this.clientCaller.defaultConfig.DEFAULT_PASSWORD) {
      this.callbacks?.onAuthenticationIllegalPassword?.();
      return;
    }

    this.clientParser.AuthorizationPassword(newPassword);
    this.clientCaller.ReqSetUpPassword(oldPassword, newPassword);
  }

  /**
   * Function to transmit the password to the pen.
   * @param {string} password
   */
  AuthorizeWithPassword(password: string): boolean {
    return this.clientCaller.AuthorizeWithPassword(password);
  }

  /**
   * 펜에 대한 각종 설정 확인을 요청하는 함수
   */
  RequestPenStatus() {
    this.clientCaller.ReqPenStatus();
  }

  /**
   * 펜 설정 중 시각을 변경 요청하는 함수
   * - 1970년 1월 1일부터 millisecond tick (지금은 현재 시각으로 변경)
   */
  SetRtcTime() {
    this.clientCaller.ReqSetupTime();
  }

  /**
   * 펜 설정 중 자동종료 시간을 변경 요청하는 함수
   * 분 단위 (v2.17 = 5 ~ 3600 // v2.18 = 1 ~ 3600)
   * @param {number} minute
   */
  SetAutoPowerOffTime(minute: number) {
    this.clientCaller.ReqSetupPenAutoShutdownTime(minute);
  }

  /**
   * 펜 설정 중 펜 뚜껑을 닫을 경우 전원이 꺼지는 기능을 변경 요청하는 함수
   * @param {boolean} enable - on / off
   */
  SetPenCapPowerOnOffEnable(enable: boolean) {
    this.clientCaller.ReqSetupPenCapPower(enable);
  }

  /**
   * 펜 설정 중 펜 뚜껑 혹은 펜 필기 시 자동으로 전원이 켜지는 기능을 변경 요청하는 함수
   * @param {boolean} enable - on / off
   */
  SetAutoPowerOnEnable(enable: boolean) {
    this.clientCaller.ReqSetupPenAutoPowerOn(enable);
  }

  /**
   * 펜 설정 중 비프음 기능을 변경 요청하는 함수
   * @param {boolean} enable - on / off
   */
  SetBeepSoundEnable(enable: boolean) {
    this.clientCaller.ReqSetupPenBeep(enable);
  }

  /**
   * 펜 설정 중 호버 모드 기능을 변경 요청하는 함수
   * - 호버기능 : 펜의 위치를 penDown 전에 미리 가늠해 볼 수 있도록 시각적인 dot를 표시하는 기능
   * @param {boolean} enable - on / off
   */
  SetHoverEnable(enable: boolean) {
    this.clientCaller.ReqSetupHoverMode(enable);
  }

  /**
   * 펜 설정 중 오프라인 저장 기능을 변경 요청하는 함수
   * @param {boolean} enable - on / off
   */
  SetOfflineDataEnable(enable: boolean) {
    this.clientCaller.ReqSetupOfflineData(enable);
  }

  /**
   * 펜 설정 중 펜 LED 색을 변경 요청하는 함수
   * @param {number} color - argb
   */
  SetColor(color: number) {
    this.clientCaller.ReqSetupPenColor(color);
  }

  /**
   * 펜 설정 중 펜의 필압 민감도를 변경 요청하는 함수
   * - FSR 필압 센서가 달린 모델에서만 이용
   * @param {number} step - 0 ~ 4 ( 0이 가장 민감 )
   */
  SetSensitivity(step: number) {
    this.clientCaller.ReqSetupPenSensitivity(step);
  }

  /**
   * 펜 설정 중 펜의 디스크를 초기화 요청하는 함수
   */
  RequestInitPenDisk() {
    this.clientCaller.ReqInitPenDisk();
  }

  /**
   * Function to request the transmission of real-time writing data from the pen.
   * Ed: Probably this function does not request real-time data, but the data stored on the pen.
   * @param {Array} sections
   * @param {Array} owners
   * @param {Array} notes - If null, notes are not differentiated.
   */
  RequestAvailableNotes(sections?: number[], owners?: number[], notes?: number[]) {
    this.clientCaller.ReqAddUsingNotes(sections, owners, notes);
  }

  // Offline List
  // section or owner  = null : All Note
  /**
   * 펜에 저장된 오프라인 필기 데이터의 종이 정보(note)를 요청하는 함수
   * - section, owner 모두 0일 경우 저장된 모든 note ID 리스트 (최대 64개)를 요청한다.
   * @param {number} section
   * @param {number} owner
   */
  RequestOfflineNoteList(section: number, owner: number) {
    this.clientCaller.ReqOfflineNoteList(section, owner);
  }

  /**
   * 펜에 저장된 오프라인 필기 데이터의 종이 정보(page)를 요청하는 함수
   * - section, owner, note 와 일치하는 하나의 노트의 page ID 리스트 (최대 128개)를 요청한다.
   * @param {number} section
   * @param {number} owner
   * @param {number} note
   */
  RequestOfflinePageList(section: number, owner: number, note: number) {
    this.clientCaller.ReqOfflinePageList(section, owner, note);
  }

  // Offline Data
  /**
   * 펜에 저장된 오프라인 필기 데이터를 한 note ID 혹은 다수의 page ID로 요청하는 함수
   * @param {number} section
   * @param {number} owner
   * @param {number} note
   * @param {boolean} deleteOnFinished - true일 경우 전송한 데이터 삭제, false일 경우 전송한 데이터 삭제 안함
   * @param {array} pages - 빈 배열일 경우 노트 내 모든 page를 요청
   * @returns
   */
  RequestOfflineData(section: number, owner: number, note: number, deleteOnFinished: boolean = false, pages: any = []) {
    this.clientCaller.ReqOfflineData(section, owner, note, deleteOnFinished, pages);
  }

  /**
   * 펜에 저장된 오프라인 필기 데이터에 대한 삭제를 요청하는 함수
   * - 노트 단위 삭제, 최대 64개
   * @param {number} section
   * @param {number} owner
   * @param {array} notes
   */
  RequestOfflineDelete(section: number, owner: number, notes: number[]) {
    this.clientCaller.ReqOfflineDelete(section, owner, notes);
  }

  // Firmware Update
  /**
   * 펜에 설치된 펌웨어를 업그레이드하기 위해 펜에게 질의하는 함수
   * @param {File} file
   * @param {string} version
   * @param {boolean} isCompressed
   */
  RequestFirmwareInstallation(file: File, version: string, isCompressed: boolean) {
    return this.clientCaller.ReqPenSwUpgrade(file, version, isCompressed);
  }

  /**
   * 펜에 펌웨어 데이터를 업로드하는 함수
   * @param {number} offset
   * @param {Uint8Array} data
   * @param {number} status
   */
  RequestFirmwareUpload(offset: number, data: Uint8Array, status: number) {
    return this.clientCaller.ReqPenSwUpload(offset, data, status);
  }

  /**
   * 펜에 프로파일 생성을 요청하는 함수
   * - 프로파일은 네오랩을 통해 인증받은 뒤에 사용가능하기에, 현재는 고정값을 이용
   */
  RequestProfileCreate(/*name: string, password: string*/) {
    this.clientCaller.ReqProfileCreate();
  };

  /**
   * 펜에 설정된 프로파일 제거를 요청하는 함수
   * - 프로파일은 네오랩을 통해 인증받은 뒤에 사용가능하기에, 현재는 고정값을 이용
   */
  RequestProfileDelete(/*name: string, password: string*/) {
    this.clientCaller.ReqProfileDelete();
  };

  /**
   * 펜에 설정된 프로파일 정보를 요청하는 함수
   * - 프로파일은 네오랩을 통해 인증받은 뒤에 사용가능하기에, 현재는 고정값을 이용
   */
  RequestProfileInfo(/*name: string*/) {
    this.clientCaller.ReqProfileInfo();
  };

  /**
   * 펜에 설정된 프로파일 내 데이터 작성을 요청하는 함수
   * - 프로파일은 네오랩을 통해 인증받은 뒤에 사용가능하기에, 현재는 고정값을 이용
   * @param {Array} data
   */
  RequestProfileWriteValue(/*name: string, password: string,*/ data: { [key: string]: any }) {
    this.clientCaller.ReqProfileWriteValue(data);
  };

  /**
   * 펜에 설정된 프로파일 내 데이터 정보를 요청하는 함수
   * - 프로파일은 네오랩을 통해 인증받은 뒤에 사용가능하기에, 현재는 고정값을 이용
   * @param {Array} keys
   */
  RequestProfileReadValue(/*name: string,*/ keys: string[]) {
    this.clientCaller.ReqProfileReadValue(keys);
  };

  /**
   * 펜에 설정된 프로파일 내 데이터 제거를 요청하는 함수
   * - 프로파일은 네오랩을 통해 인증받은 뒤에 사용가능하기에, 현재는 고정값을 이용
   * @param {Array} keys
   */
  RequestProfileDeleteValue = (/*name: string, password: string,*/ keys: string[]) => {
    this.clientCaller.ReqProfileDeleteValue(keys);
  };

  RequestVersion() {
    this.clientCaller.ReqVersionTask();
  }

  getNextChunk(offset: number): { data: Uint8Array, currentChunk: number, totalChunks: number } | null {
    return this.clientCaller.getNextChunk(offset);
  }

  handleDisconnect() {
    this.clientCaller.OnDisconnected();
    this.clientParser.OnDisconnected();

    this.callbacks?.onPenDisconnected?.();
  }

  handleConfigurationInfo(configurationInfo: PenConfigurationInfo) {
    this.configurationInfo = configurationInfo;
    this.callbacks?.onConfigurationInfo?.(configurationInfo);

    !configurationInfo.Locked
        ? this.handlePenAuthorized()
        : this.handleAuthenticationRequest();
  }

  private handleAuthenticationRequest() {
    this.callbacks?.onAuthenticationRequest?.({
      retryCount: this.configurationInfo.RetryCount,
      resetCount: this.configurationInfo.ResetCount,
    });
  }

  handlePenAuthorized() {
    NLog.log("Pen Authorized");
    // Ed: I guess we request here data stored on the pen.
    this.RequestAvailableNotes();
    this.callbacks?.onPenAuthorized?.();
  }

  isHoverModeEnabled() {
    return this.configurationInfo?.HoverMode;
  }

  handleSettingChange(response: { settingType: number, result: boolean }) {
    const settingValue = this.clientCaller.settingChanges[response.settingType];
    delete this.clientCaller.settingChanges[response.settingType];

    console.log("Handle Setting Change:", response.settingType, ", value: ", settingValue, ", result: ", response.result);

    if (!response.result)
      return this.callbacks?.onPenSettingChangeFailure?.(response.settingType);

    switch (response.settingType) {
      case SettingType.Beep:
        this.configurationInfo.Beep = !!settingValue;
        break;
      case SettingType.Hover:
        this.configurationInfo.HoverMode = !!settingValue;
        break;
      case SettingType.TimeStamp:
        this.configurationInfo.TimeStamp = settingValue;
        break;
      case SettingType.AutoPowerOn:
        this.configurationInfo.AutoPowerOn = !!settingValue;
        break;
      case SettingType.AutoPowerOffTime:
        this.configurationInfo.AutoShutdownTime = settingValue;
        break;
    }

    this.callbacks?.onPenSettingChangeSuccess?.(response.settingType, settingValue);
  }

  handleConnection(versionInfo: VersionInfo) {
    this.info = versionInfo;
    this.callbacks?.onPenConnected?.(versionInfo);

    this.clientCaller.ReqPenStatus();
  }

  handleShutdown(shutdownReason: number) {
    this.callbacks?.onPowerOffEvent?.(shutdownReason);
  }

  handleLowBattery(battery: number) {
    this.callbacks?.onBatteryLowEvent?.(battery);
  }

  handleSuccessfulAuthentication(noPassword: boolean) {
    // REVIEW: This event is a bit strange here. Especially considering the one below. Consider removing it.
    //         Also, most probably 'successful authorization handling is required on 'noPassword'.
    this.callbacks?.onAuthenticationSuccess?.(noPassword);

    if (noPassword)
      this.handlePenAuthorized();
  }

  handleFailedAuthentication(authenticationResult: AuthorizationRequest) {
    this.callbacks?.onAuthenticationFailure?.(authenticationResult);
  }

  handleOfflineNoteListData(noteList: Array<{ section: number; owner: number; note: number }>) {
    this.callbacks?.onOfflineNoteListData?.(noteList);
  }

  handleOfflinePageListData(pageList: { section: number; owner: number; note: number; pages: number[] }) {
    this.callbacks?.onOfflinePageListData?.(pageList)
  }

  handleOfflineDataRetrievalFailure() {
    this.callbacks?.onOfflineDataRetrievalFailure?.();
  }

  handleOfflineDataRetrievalProgress(progress: number) {
    this.callbacks?.onOfflineDataRetrievalProgress?.(progress);
  }

  handleOfflineDataDeleteSuccess() {
    this.callbacks?.onOfflineDataDeleteSuccess?.();
  }

  handleFirmwareUpgradeProgress(progress: number) {
    this.callbacks?.onFirmwareUpgradeProgress?.(progress);
  }

  handleFirmwareUpgradeFailure(status: FirmwareUpgradeFailureReason) {
    this.callbacks?.onFirmwareUpgradeFailure?.(status);
  }

  handleRealtimeDataStatus(enabled: boolean) {
    this.callbacks?.onRealtimeDataStatus?.(enabled);
  }

  handlePenPointer(pointer: PenPointer) {
    this.callbacks?.onPenPointer?.(pointer);
  }

  handleProfileData(profile: any) {
    this.callbacks?.onPenProfileData?.(profile);
  }

  handlePuiCommand(command: string) {
    this.callbacks?.onPuiCommand?.(command);
  }

  handleOfflineDataRetrievalSuccess(strokes: Array<{ dots: Dot[] }>) {
    this.callbacks?.onOfflineDataRetrievalSuccess?.(strokes);
  }

  handleFirmwareUpgradeSuccess() {
    this.callbacks?.onFirmwareUpgradeSuccess?.();
  }

  handleDot(dot: Dot) {
    // @ts-ignore
    NLog.debug(`Handle Dot: (type: ${dotTypes[dot.dotType]})`, dot);
    this.callbacks?.onDot?.(dot);
  }

  handlePageInfo(pageInfo: PageInfo){
    NLog.debug("Handle PageInfo: ", pageInfo);
    this.callbacks?.onPage?.(pageInfo);
  }

  handleStroke(stroke: Dot[]) {
    this.callbacks?.onStroke?.(stroke);
  }
}
