const CMD = {
  /**Command to request version (information) of the device, performed first when connected to the pen*/
  VERSION_REQUEST: 0x01,
  /**Command that returns the version (information) of the device */
  VERSION_RESPONSE: 0x81,

  /**Command to enter password, use determined by device version information*/
  PASSWORD_REQUEST: 0x02,
  /**Command that returns the result value of the entered password */
  PASSWORD_RESPONSE: 0x82,

  /**Command to request password change, can only be used when connected with password */
  PASSWORD_CHANGE_REQUEST: 0x03,
  /**Command that returns the result value of password change */
  PASSWORD_CHANGE_RESPONSE: 0x83,

  /**Command to request information about various pen settings */
  SETTING_INFO_REQUEST: 0x04,
  /**Command that returns pen setting information, refer to PenConfigurationInfo*/
  SETTING_INFO_RESPONSE: 0x84,

  /**Command returned when a battery alarm occurs */
  LOW_BATTERY_EVENT: 0x61,
  /**Command that returns the reason when the power is turned off */
  SHUTDOWN_EVENT: 0x62,

  /**Command to request changes to various pen settings */
  SETTING_CHANGE_REQUEST: 0x05,
  /**Command that returns the success of pen setting changes */
  SETTING_CHANGE_RESPONSE: 0x85,

  /**Command to request real-time handwriting data */
  ONLINE_DATA_REQUEST: 0x11,
  /**Command that returns the response to the request for real-time handwriting data */
  ONLINE_DATA_RESPONSE: 0x91,

  /**Command that returns the time of pen UP/DOWN, type of pen, color of pen */
  ONLINE_PEN_UPDOWN_EVENT: 0x63,
  /**Command that returns the information of the paper where the pen is currently entered */
  ONLINE_PAPER_INFO_EVENT: 0x64,
  /**Command that returns various Dot information (coordinate value, slope, etc.) when the pen is entered */
  ONLINE_PEN_DOT_EVENT: 0x65,
  /**Command that returns time difference between Dots, brightness of image coming in through pen camera, exposure time, NADC (ncode processing module) error code, etc. when an error occurs when the pen is entered */
  ONLINE_PEN_ERROR_EVENT: 0x68,

  /**Command that returns the time of pen DOWN, type of pen, color of pen, added count element */
  ONLINE_NEW_PEN_DOWN_EVENT: 0x69,
  /**Command that returns the time of pen UP, number of transmitted and processed dots, number of images, added count element */
  ONLINE_NEW_PEN_UP_EVENT: 0x6a,
  /**Command that returns the information of the paper where the pen is currently entered, added count element */
  ONLINE_NEW_PAPER_INFO_EVENT: 0x6b,
  /**Command that returns various Dot information (coordinate value, slope, etc.) when the pen is entered, added count element */
  ONLINE_NEW_PEN_DOT_EVENT: 0x6c,
  /**Command that returns time difference between Dots, brightness of image coming in through pen camera, exposure time, NADC (ncode processing module) error code, etc. when an error occurs when the pen is entered, added count element */
  ONLINE_NEW_PEN_ERROR_EVENT: 0x6d,
  /**Command that returns various Dot information (coordinate value, slope, etc.) when the pen is in hover Mode*/
  ONLINE_PEN_HOVER_EVENT: 0x6f,

  /**Command to request a list of offline data paper information (section, owner, note) */
  OFFLINE_NOTE_LIST_REQUEST: 0x21,
  /**Command that returns a list of offline data paper information (section, owner, note) */
  OFFLINE_NOTE_LIST_RESPONSE: 0xa1,

  /**Command to request a list of offline data paper information (page) */
  OFFLINE_PAGE_LIST_REQUEST: 0x22,
  /**Command that returns a list of offline data paper information (page)*/
  OFFLINE_PAGE_LIST_RESPONSE: 0xa2,

  /**Command to request transmission of offline data handwriting information*/
  OFFLINE_DATA_REQUEST: 0x23,
  /**Command that returns the response to the request for transmission of offline data handwriting information  */
  OFFLINE_DATA_RESPONSE: 0xa3,
  /**Command to transmit offline data handwriting information, PEN->APP */
  OFFLINE_PACKET_REQUEST: 0x24,
  /**Command that returns the result value for the transmission of offline data handwriting information, APP->PEN */
  OFFLINE_PACKET_RESPONSE: 0xa4,

  /**Command to request deletion of offline data, note unit deletion */
  OFFLINE_DATA_DELETE_REQUEST: 0x25,
  /**Command that returns the response to the request for deletion of offline data */
  OFFLINE_DATA_DELETE_RESPONSE: 0xa5,

  /**Command to request firmware update */
  FIRMWARE_UPLOAD_REQUEST: 0x31,
  /**Command that returns the response to the firmware update request */
  FIRMWARE_UPLOAD_RESPONSE: 0xb1,
  /**Command to receive file for firmware update, PEN->APP */
  FIRMWARE_PACKET_REQUEST: 0x32,
  /**Command to transmit file for firmware update, APP->PEN */
  FIRMWARE_PACKET_RESPONSE: 0xb2,

  /**Command to request creation, deletion, inquiry, etc. of profile registered in pen*/
  PEN_PROFILE_REQUEST: 0x41,
  /**Command that returns the response to the profile request */
  PEN_PROFILE_RESPONSE: 0xc1,

  // Only Touch and play
  RES_PDS: 0x73,
  REQ_LOG_INFO: 0x74,
  RES_LOG_INFO: 0xf4,
  REQ_LOG_DATA: 0x75,
  RES_LOG_DATA: 0xf5,
};

export default CMD;