export type BookInfo = {
  book: number;
  owner: number;
  section: number;
}

export type PageInfo = BookInfo & {
  page: number;
};

export type PaperSize = {
  margin: number[],
  width: number;
  height: number;
  Xmin: number;
  Xmax: number;
  Ymin: number;
  Ymax: number;
};

export type PaperBase = {
  Xmin: number;
  Ymin: number;
};

export interface ScreenDot {
  x: number;
  y: number;
}

export enum ScreenMode {
  PORTRAIT = 0,
  LANDSCAPE = 1,
}

export enum DotTypes {
  PEN_DOWN = 0,
  PEN_MOVE = 1,
  PEN_UP =  2,
  PEN_HOVER = 3,
  PEN_INFO = 4,
  PEN_ERROR = 5,
}

export enum PenTipTypes {
  NORMAL = 0,
  ERASER = 1,
}

export type Angle = {
  tx: number;
  ty: number;
  twist: number;
}

export interface Dot extends ScreenDot {
  angle: Angle;
  color: number;
  dotType: DotTypes;
  f: number;
  pageInfo: PageInfo;
  penTipType: PenTipTypes;
  timeDiff: number;
  timeStamp: number;

  Clone(dotType?: DotTypes): Dot;
}

export interface PenPointer {
  section: number;
  owner: number;
  note: number;
  page: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
}

export type View = {
  width: number;
  height: number;
};

export type Paper = {
  section: number;
  owner: number;
  book: number;
  page: number;
  time?: number;
  timeDiff?: number;
  strokeCount?: number;
};

export type VersionInfo = {
  DeviceName: string;
  FirmwareVersion: string;
  ProtocolVersion: string;
  SubName: string;
  DeviceType: number;
  MacAddress: string;
  PressureSensorType: number;
};

export type PenConfigurationInfo = {
  Locked: boolean;
  ResetCount: number;
  RetryCount: number;
  TimeStamp: number;
  AutoShutdownTime: number;
  MaxForce: number;
  Battery: number;
  UsedMem: number;
  UseOfflineData: boolean;
  AutoPowerOn: boolean;
  PenCapPower: boolean;
  HoverMode: boolean;
  Beep: boolean;
  PenSensitivity: number;
};

export type DotErrorInfo = {
  ErrorType: number;
  Dot?: Dot;
  TimeStamp: number;
  ExtraData?: string;
  ImageProcessErrorInfo?: any;
};

export type OnPenConnected = (versionInfo: VersionInfo) => void;
export type OnPenDisconnected = () => void;
export type OnPenAuthorized = () => void;

export type OnConfigurationInfo = (configurationInfo: PenConfigurationInfo) => void;
export type OnSetupSuccess = () => void;

export type AuthorizationRequest = { retryCount: number, resetCount: number };
export type OnAuthenticationRequest = (request: AuthorizationRequest) => void;

export type OnAuthenticationSuccess = (noPassword: boolean) => void;
export type OnAuthenticationFailure = (request: AuthorizationRequest) => void;
export type OnAuthenticationIllegalPassword = () => void;

export type OnOfflineNoteListData = (noteList: Array<{ section: number, owner: number, note: number }> ) => void;
export type OnOfflinePageListData = (pageList: { section: number, owner: number, note: number, pages: number[] } ) => void;

export type OnOfflineDataRetrievalProgress = (progress: number) => void;
export type OnOfflineDataRetrievalFailure = () => void;
export type OnOfflineDataRetrievalSuccess = (strokes: Array<{ dots: Dot[] }>) => void;

export type OnOfflineDataDeleteFailure = () => void;
export type OnOfflineDataDeleteSuccess = () => void;

export enum FirmwareUpgradeFailureReason {
  VersionMismatch = 1,
  InsufficientDiskSpace = 2,
  Failure = 3,
  CompressionNotSupported = 4,
}
export type OnFirmwareUpgradeProgress = (progress: number) => void;
export type OnFirmwareUpgradeFailure = (reason: FirmwareUpgradeFailureReason) => void;
export type OnFirmwareUpgradeSuccess = () => void;

export type OnRealtimeDataStatus = (enabled: boolean) => void;
export type OnPenPointer = (pointer: PenPointer) => void;
export type OnPuiCommand = (command: string) => void;
export type OnDotError = (errorInfo: DotErrorInfo) => void;
export type OnPage = (page: PageInfo) => void;
export type OnDot = (dot: Dot) => void;
export type OnStroke = (stroke: Dot[]) => void;

export type OnPenProfileData = (profileData: any) => void; // TODO: Clarify data type

export type OnPenSettingChangeSuccess = (settingType: number, settingValue: any) => void;
export type OnPenSettingChangeFailure = (settingType: number) => void;

export type OnPowerOffEvent = (shutdownReason: number) => void;
export type OnBatteryLowEvent = (battery: number) => void;

export type PenCallbacks = {
  onConfigurationInfo?: OnConfigurationInfo;
  onSetupSuccess?: OnSetupSuccess;
  onPenConnected?: OnPenConnected;
  onPenDisconnected?: OnPenDisconnected;
  onPenAuthorized?: OnPenAuthorized;

  onAuthenticationRequest?: OnAuthenticationRequest;

  onAuthenticationSuccess?: OnAuthenticationSuccess;
  onAuthenticationFailure?: OnAuthenticationFailure;
  onAuthenticationIllegalPassword?: OnAuthenticationIllegalPassword;

  onOfflineNoteListData?: OnOfflineNoteListData;
  onOfflinePageListData?: OnOfflinePageListData;

  onOfflineDataRetrievalProgress?: OnOfflineDataRetrievalProgress;
  onOfflineDataRetrievalFailure?: OnOfflineDataRetrievalFailure;
  onOfflineDataRetrievalSuccess?: OnOfflineDataRetrievalSuccess;

  onOfflineDataDeleteFailure?: OnOfflineDataDeleteFailure;
  onOfflineDataDeleteSuccess?: OnOfflineDataDeleteSuccess;
  onFirmwareUpgradeProgress?: OnFirmwareUpgradeProgress;
  onFirmwareUpgradeFailure?: OnFirmwareUpgradeFailure;
  onFirmwareUpgradeSuccess?: OnFirmwareUpgradeSuccess;

  onRealtimeDataStatus?: OnRealtimeDataStatus;
  onPenPointer?: OnPenPointer;
  onPuiCommand?: OnPuiCommand;
  onDotError?: OnDotError;
  onPage?: OnPage;
  onDot?: OnDot;
  onStroke?: OnStroke;

  onPenProfileData?: OnPenProfileData;

  onPenSettingChangeSuccess?: OnPenSettingChangeSuccess;
  onPenSettingChangeFailure?: OnPenSettingChangeFailure;

  onPowerOffEvent?: OnPowerOffEvent;
  onBatteryLowEvent?: OnBatteryLowEvent;
};
