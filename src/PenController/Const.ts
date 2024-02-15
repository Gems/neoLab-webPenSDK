// Defines
const CONST = {
  /**Start value of the packet */
  PK_STX: 0xc0,
  /**End value of the packet */
  PK_ETX: 0xc1,
  /**Value for escape processing when STX, ETX are included in the actual data value of the packet */
  PK_DLE: 0x7d,

  PK_POS_CMD: 1,
  PK_POS_RESULT: 2,
  PK_POS_LENG1: 2,
  PK_POS_LENG2: 3,

  PK_HEADER_SIZE: 3,

  DEF_LIMIT: 1000,
  DEF_GROWTH: 1000,
};

export default CONST;