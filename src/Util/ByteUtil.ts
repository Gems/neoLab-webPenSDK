// noinspection JSUnusedGlobalSymbols

import * as Converter from "./Converter";
import CONST from "../PenController/Const";

export default class ByteUtil {
  mBuffer: number[];
  mPosRead: number;

  constructor() {
    this.mBuffer = [];
    this.mPosRead = 0;
  }

  get Size() {
    return this.mBuffer.length;
  }

  Clear() {
    this.mPosRead = 0;
    this.mBuffer = []; //new Uint8Array(this.mBuffer.length);
  }

  /**
   * Puts data into the buffer.
   * @param {number} input
   */
  PutByte(input: number) {
    this.mBuffer.push(input);
    return this;
  }

  PutBool(input: boolean) {
    return this.PutByte(input ? 1 : 0);
  }

  /**
   * Puts data into the buffer and checks for escape characters.
   * @param {number} input
   * @param {boolean} escapeIfExist - false = do not escape when adding to the beginning and end of the buffer.
   * @returns
   */
  Put(input: number, escapeIfExist: boolean = true) {
    return escapeIfExist
        ? this.PutArray(new Uint8Array(this.Escape(input)))
        : this.PutByte(input);
  }

  /**
   * Puts a specific length of an array into the buffer.
   * @param {array} inputs
   * @param {number} length
   * @returns
   */
  PutArray(inputs: Uint8Array, length?: number) {
    return (!length || length === inputs.length ? inputs : inputs.slice(0, length))
        .reduce((_, byte) => _.PutByte(byte), this);
  }

  /**
   * Puts a specific length of null values into the buffer.
   * @param {number} length
   * @returns
   */
  PutNull(length: number) {
    for (let i = 0; i < length; ++i)
      this.PutByte(0x00);

    return this;
  }

  /**
   * Puts a 4-byte value into the buffer.
   * @param {number} input
   * @returns
   */
  PutInt(input: number) {
    const arr = Converter.intToByteArray(input);
    return this.PutArray(arr, arr.length);
  }

  /**
   * Puts an 8-byte value into the buffer.
   * @param {number} input
   * @returns
   */
  PutLong(input: number) {
    const arr = Converter.longToByteArray(input);
    // NLog.log("put long", arr)
    return this.PutArray(arr, arr.length);
  }

  /**
   * Puts a 2-byte value into the buffer.
   * @param {number} input
   * @returns
   */
  PutShort(input: number) {
    const arr = Converter.shortToByteArray(input);
    return this.PutArray(arr, arr.length);
  }

  //
  // Get
  //
  /**
   * Gets the desired byte size from the buffer and updates the byte position value.
   * @param {number} size
   * @returns
   */
  GetBytes(size?: number) {
    const length = size ?? (this.mBuffer.length - this.mPosRead);
    const result = this.mBuffer.slice(this.mPosRead, this.mPosRead + length);
    this.mPosRead += length;

    return new Uint8Array(result);
  }

  /**
   * Gets a 1-byte value from the buffer.
   * @returns
   */
  GetByte() {
    return this.GetBytes(1)[0];
  }

  /**
   * Gets a 4-byte value from the buffer.
   * @returns
   */
  GetInt() {
    return Converter.byteArrayToInt(this.GetBytes(4));
  }

  /**
   * Function to retrieve a 2-byte value from the buffer
   * @returns
   */
  GetShort() {
    return Converter.byteArrayToShort(this.GetBytes(2));
  }

  /**
   * Function to retrieve an 8-byte value from the buffer
   * @returns
   */
  GetLong() {
    return Converter.byteArrayToLong(this.GetBytes(8));
  }

  /**
   * Function to retrieve a value of the desired byte size from the buffer
   * @param {number} length
   * @returns
   */
  GetString(length: number) {
    const bytes = Array.from(this.GetBytes(length));
    return String.fromCharCode(...bytes).trim();
  }

  /**
   * Function to retrieve a value from the buffer at the specified position with the desired byte size
   * @param {number} offset
   * @param {number} size
   * @returns
   */
  GetBytesWithOffset(offset: number, size: number) {
    const packetSize = offset + size > this.mBuffer.length
        ? this.mBuffer.length - offset
        : size;

    const result = this.mBuffer.slice(offset, offset + packetSize);

    return new Uint8Array(result);
  }

  /**
   * Function to return the checksum of the buffer for a specified length
   * @param {number} length
   * @returns
   */
  GetCheckSum(length: number) {
    const bytes = this.mBuffer.slice(this.mPosRead, this.mPosRead + length);

    return this.GetCheckSumData(new Uint8Array(bytes));
  }

  /**
   * Function to return the checksum of the entire buffer
   * @returns {number}
   */
  GetCheckSumBF(): number {
    return this.GetCheckSumData(new Uint8Array(this.mBuffer));
  }

  /**
   * Function to return the checksum of the specified data buffer
   * @param {Uint8Array} data
   * @returns {number}
   */
  GetCheckSumData(data: Uint8Array): number {
    return data.reduce((checkSum, num) => checkSum + num & 0xff, 0) & 0xff;
  }

  /**
   * Function to convert the current buffer to a Uint8Array array
   * @returns {Uint8Array}
   */
  ToU8Array(): Uint8Array {
    return new Uint8Array(this.mBuffer);
  }

  /**
   * Function for escaping STX, ETX, or DLE characters in the packet's actual data values
   * @param {number} input
   * @returns {array}
   */
  Escape(input: number): number[] {
    return (input === CONST.PK_STX || input === CONST.PK_ETX || input === CONST.PK_DLE)
        ? [CONST.PK_DLE, input ^ 0x20]
        : [input];
  }
}

/**
 * Function to convert bytes to a hexadecimal string
 * @param {array} bytes
 * @returns
 */
export function toHexString(bytes: Uint8Array) {
  return Array
      .from(bytes)
      .map((x) => (x as any).toString(16).padStart(2, "0"))
      .join("");
}

/**
 * Function to convert section and owner to 4-byte data
 * @param {number} section
 * @param {number} owner
 * @returns
 */
export function GetSectionOwnerByte(section: number, owner: number) {
  const ownerByte = Converter.intToByteArray(owner);
  ownerByte[3] = section & 0xff;
  return ownerByte;
}

// 4-byte array
/**
 * Function to substitute the 4-byte data extracted from the packet with section and owner information
 * @param {array} bytes
 * @returns
 */
export function GetSectionOwner(bytes: Uint8Array): { section: number, owner: number } {
  const section = bytes[3] & 0xff;
  const owner = bytes[0] + bytes[1] * 256 + bytes[2] * 65536;

  return { section, owner };
}
