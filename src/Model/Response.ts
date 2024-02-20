import {ProfileType} from "../API/PenMessageType";
import {Packet} from "../PenController/Packet";
import {GetSectionOwner, toHexString} from "../Util/ByteUtil";
import {PenConfigurationInfo, PenPointer, VersionInfo} from "../Util/type";

/**
 * The function that parses the returned device version (information) packet from the pen.
 * @param {Packet} packet
 * @returns
 */
export function versionInfo(packet: Packet) {
  const DeviceName = packet.GetString(16);
  const FirmwareVersion = packet.GetString(16);
  const ProtocolVersion = packet.GetString(8);
  const SubName = packet.GetString(16);
  const DeviceType = packet.GetShort();
  const MacAddress = toHexString(packet.GetBytes(6));
  const PressureSensorType = packet.GetByte();

  return {
    DeviceName,
    FirmwareVersion,
    ProtocolVersion,
    SubName,
    DeviceType,
    MacAddress,
    PressureSensorType,
  } as VersionInfo;
}

/**
 * A function that parses the pen configuration information packet returned from the pen.
 * @param {Packet} packet
 * @returns
 */
export function penConfigurationInfo(packet: Packet) {
  // Whether to use a password
  const lockyn = packet.GetByte() === 1;
  // Maximum number of password input attempts
  const pwdMaxRetryCount = packet.GetByte();
  // Password entry attempt count
  const pwdRetryCount = packet.GetByte();
  // Millisecond tick since January 1, 1970
  const time = packet.GetLong();
  // Time (in minutes) until automatic power-off when not in use
  const autoPowerOffTime = packet.GetShort();
  // Maximum pressure sensitivity
  const maxForce = packet.GetShort();
  // Current memory usage
  const usedStorage = packet.GetByte();
  // Whether the pen's power is automatically turned off by closing the pen cap
  const penCapOff = packet.GetByte() === 1;
  // Whether the pen automatically turns on when starting to write on a turned-off pen
  const autoPowerON = packet.GetByte() === 1;
  // Whether sound is enabled
  const beep = packet.GetByte() === 1;
  // Whether hover functionality is enabled
  const hover = packet.GetByte() === 1;
  // Remaining battery level
  const batteryLeft = packet.GetByte();
  // Whether offline data storage is enabled
  const useOffline = packet.GetByte() === 1;
  // Pressure sensitivity step setting (0~4) where 0 is the most sensitive
  const fsrStep = packet.GetByte();

  return {
    Locked: lockyn,
    ResetCount: pwdMaxRetryCount,
    RetryCount: pwdRetryCount,
    TimeStamp: time,
    AutoShutdownTime: autoPowerOffTime,
    MaxForce: maxForce,
    Battery: batteryLeft,
    UsedMem: usedStorage,
    UseOfflineData: useOffline,
    AutoPowerOn: autoPowerON,
    PenCapPower: penCapOff,
    HoverMode: hover,
    Beep: beep,
    PenSensitivity: fsrStep,
  } as PenConfigurationInfo;
}

/**
 * Parsing function for the success status of pen configuration changes returned by the pen
 * @param {Packet} packet
 * @returns {{SettingType: number, result: boolean}}
 */
export function SettingChange(packet: Packet): { settingType: number; result: boolean; } {
  const settingType = packet.GetByte();
  // REVIEW: The logic was reversed from the original code. Is this correct?
  //         It was: const result = packet.GetByte() === 0;
  const result = packet.GetByte() !== 0;

  return { settingType, result };
}

/**
 * Parsing function for the result of the entered password returned by the pen.
 * @param {Packet} packet - The packet containing the password result
 * @returns {{status: number, retryCount: number, resetCount: number}} - status: 0 = Password required / 1 = Password not required or Password success / 2 = Exceeded input limit, reset / 3 = Error
 */
export function Password(packet: Packet): { status: number; retryCount: number; resetCount: number; } {
  const status = packet.GetByte();
  const retryCount = packet.GetByte();
  const resetCount = packet.GetByte();

  return { status, retryCount, resetCount };
}

/**
 * Parsing function for the result of password change returned by the pen
 * @param {Packet} packet - The packet containing the password change result
 * @returns {{retryCount: number, resetCount:number, status: number}} - status: 0 = Success / 1 = Incorrect old password / 2 = Exceeded input limit, reset / 3 = Error
 */
export function PasswordChange(packet: Packet): { status: number; retryCount: number; resetCount: number; } {
  const retryCount = packet.GetByte();
  const resetCount = packet.GetByte();
  const status = packet.GetByte();

  return { status, retryCount, resetCount };
}

/**
 * Parsing function for coordinate data for PDS (Pen Display System)
 * @param {Packet} packet - The packet containing the coordinate data
 * @returns {Object} - Parsed coordinate data
 */
export function PDS(packet: Packet): PenPointer {
  const owner = packet.GetInt();
  const section = packet.GetInt();
  const note = packet.GetInt();
  const page = packet.GetInt();
  const x = packet.GetInt();
  const y = packet.GetInt();
  const fx = packet.GetShort();
  const fy = packet.GetShort();

  return { section, owner, note, page, x, y, fx, fy };
}

/**
 * Parsing function for the list of paper information (section, owner, note) of offline data returned by the pen
 * @param {Packet} packet - The packet containing the paper information list
 * @returns {Array} - Array of parsed paper information objects
 */
export function NoteList(packet: Packet): Array<{ section: number, owner: number, note: number }> {
  const length = packet.GetShort();
  const result = [];

  for (let i = 0; i < length; i++) {
    const rb = packet.GetBytes(4);
    const  { section, owner } = GetSectionOwner(rb);
    const note = packet.GetInt();

    result.push({ section, owner, note });
  }

  return result;
}

/**
 * Parsing function for the list of paper information (page) of offline data returned by the pen
 * @param {Packet} packet - The packet containing the paper information list
 * @returns {Array} - Array of parsed page information objects
 */
export function PageList(packet: Packet): { section: number, owner: number, note: number, pages: number[] } {
  const rb = packet.GetBytes(4);
  const { section, owner } = GetSectionOwner(rb);
  const note = packet.GetInt();
  const length = packet.GetShort();
  const pages = [];

  for (let i = 0; i < length; i++)
    pages.push(packet.GetInt());

 return { section, owner, note, pages, };
}

/**
 * Parsing function for the profile data returned by the pen
 * @param {Packet} packet - The packet containing the profile data
 * @returns {Object} - Object with status indicating the result of the profile data parsing
 *                   - status: 0 = Success / 1 = Failure / 10 = Profile already exists / 11 = No profile found /
 *                             21 = Key not found in the profile / 30 = Unauthorized (Incorrect password) / 40 = Buffer size mismatch
 */
export const ProfileData = (packet: Packet): object => {
  const profileName = packet.GetString(8);
  const ptype = packet.GetByte();

  const values = [];
  const result: any = {
    profileName: profileName,
    type: "0x" + ptype.toString(16),
  };

  let keyCount = 0;
  let key = "";
  let status = 0;

  switch (ptype) {
    case ProfileType.CreateProfile:
      result.status = "0x" + packet.GetByte().toString(16);
      break;
    case ProfileType.DeleteProfile:
      result.status = "0x" + packet.GetByte().toString(16);
      break;

    case ProfileType.InfoProfile:
      result.status = "0x" + packet.GetByte().toString(16);
      result.allSectorCount = packet.GetShort();
      result.sectorSize = packet.GetShort();
      result.usedSectorCount = packet.GetShort();
      result.usedKeySectorCount = packet.GetShort();
      break;

    case ProfileType.WriteProfileValue:
      keyCount = packet.GetByte();

      for (let i = 0; i < keyCount; i++) {
        key = packet.GetString(16);
        status = packet.GetByte();
        values.push({ key: key, status: "0x" + status.toString(16) });
      }

      result.keyCount = keyCount;
      result.values = values;
      break;

    case ProfileType.ReadProfileValue:
      keyCount = packet.GetByte();

      for (let i = 0; i < keyCount; i++) {
        key = packet.GetString(16);
        status = packet.GetByte();
        const dataLength = packet.GetShort();
        const data = packet.GetBytes(dataLength);
        const str = String.fromCharCode(...data);
        values.push({ key: key, status: "0x" + status.toString(16), dataLength: dataLength, data: str });
      }

      result.keyCount = keyCount;
      result.values = values;
      break;

    case ProfileType.DeleteProfileValue:
      keyCount = packet.GetByte();

      for (let i = 0; i < keyCount; i++) {
        key = packet.GetString(16);
        status = packet.GetByte();
        values.push({ key: key, status: "0x" + status.toString(16) });
      }

      result.keyCount = keyCount;
      result.values = values;
      break;
  }

  return result;
};
