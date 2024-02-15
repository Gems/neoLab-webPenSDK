function toUTF8Array(str: string): Uint8Array {
  const utf8 = [];

  for (let i = 0; i < str.length; i++) {
    let charCode = str.charCodeAt(i);

    if (charCode < 0x80)
      utf8.push(charCode);
    else if (charCode < 0x800)
      utf8.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
    else if (charCode < 0xd800 || charCode >= 0xe000)
      utf8.push(0xe0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3f), 0x80 | (charCode & 0x3f));

    // surrogate pair
    else {
      i++;
      // UTF-16 encodes 0x10000-0x10FFFF by
      // subtracting 0x10000 and splitting the
      // 20 bits of 0x0-0xFFFFF into two halves
      charCode = 0x10000 + (((charCode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charCode >> 18),
        0x80 | ((charCode >> 12) & 0x3f),
        0x80 | ((charCode >> 6) & 0x3f),
        0x80 | (charCode & 0x3f)
      );
    }
  }

  return new Uint8Array(utf8);
}

/**
 * Converts byte values to an integer (int).
 * @param {array} bytes
 * @returns
 */
function byteArrayToInt(bytes: Uint8Array) {
  let arr = new Uint8Array(bytes);
  let dv = new DataView(arr.buffer);
  return dv.getUint32(0, true);
}

/**
 * Converts an integer (int) to a 4-byte array.
 * @param {number} input
 * @returns
 */
function intToByteArray(input: number) {
  let arr = new Uint8Array(4);
  let dv = new DataView(arr.buffer);
  dv.setUint32(0, input, true);
  return Uint8Array.from(arr);
}

/**
 * Converts byte values to a short integer.
 * @param {array} bytes
 * @returns
 */
function byteArrayToShort(bytes: Uint8Array) {
  let arr = new Uint8Array(bytes);
  let dv = new DataView(arr.buffer);
  return dv.getUint16(0, true);
}

/**
 * Converts a short integer to a 2-byte array.
 * @param {number} input
 * @returns
 */
function shortToByteArray(input: number) {
  let arr = new Uint8Array(2);
  let dv = new DataView(arr.buffer);
  dv.setUint16(0, input, true);
  return Uint8Array.from(arr);
}

/**
 * Converts byte values to a long integer.
 * @param {array} bytes
 * @returns {number} bicInt64
 */
function byteArrayToLong(bytes: Uint8Array) {
  var byte = new Uint8Array(bytes);
  var view = new DataView(byte.buffer);
  var hi = view.getUint32(0, true);
  let low = view.getUint32(4, true);
  var intValue = hi + low * 4294967296; // 2 ^ 32
  return intValue;
}

/**
 * Converts a long integer to an 8-byte array.
 * @param {number} input
 * @returns
 */
function longToByteArray(input: number) {
  let long = input;
  var byteArray = [0, 0, 0, 0, 0, 0, 0, 0];
  for (var index = 0; index < byteArray.length; index++) {
    var byte = long & 0xff;
    byteArray[index] = byte;
    long = (long - byte) / 256;
  }
  return Uint8Array.from(byteArray);
}

function intArrayToByteArray(intArray: number[]): Uint8Array {
  const buffer = new ArrayBuffer(intArray.length * 4);
  const view = new DataView(buffer);

  intArray.forEach((int, i) => view.setInt32(i * 4, int));

  return new Uint8Array(buffer); // Step 4
}

export {
  toUTF8Array,
  byteArrayToInt,
  byteArrayToShort,
  intToByteArray,
  shortToByteArray,
  byteArrayToLong,
  longToByteArray,
  intArrayToByteArray,
};
