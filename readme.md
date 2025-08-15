# Neo Smartpen SDK for Web Platform

# Web Pen SDK
This document is written for using the `web_pen_sdk` for NeoSmartPen.

## Installation 
``` sh
# web_pen_sdk setting

$ npm install web_pen_sdk
$ yarn add web_pen_sdk
```

## Description
### **PenHelper**
> startScan, connectDevice, serviceBinding_16, serviceBinding_128, characteristicBinding, disconnect, dotCallback, handleDot, messageCallback, handleMessage, ncodeToScreen, ncodeToScreen_smartPlate, isSamePage

### [Pen Connection Setup/Release]

### 1-1. startScan
This logic scans devices for Bluetooth pen connection.
```ts
/** This function scans the device for a Bluetooth pen connection. */
startScan = async () => { ... }
```
```ts
// Usage with React hook

const startScan = () => {
  PenHelper.startScan();
};

<Button onClick={startScan}></Button>
```

### 1-2. connectDevice
Attempts to establish a connection with the actual Bluetooth device.
```ts
connectDevice = async (device: any) => { ... }
```

### 1-3. serviceBinding_16, serviceBinding_128
Binds Bluetooth services to 16-bit/128-bit UUIDs.
```ts
serviceBinding_16 = async (service: any, device: any) => { ... }
serviceBinding_128 = async (service: any, device: any) => { ... }
```

### 1-4. characteristicBinding
Sets up the PenController to handle pen events that occur after the Bluetooth pen device is connected.
All pen events, including information about the connected pen and dot processing, are handled through PenController.
This penController is stored in PenHelper.pens[].
```ts
characteristicBinding = (read: any, write: any, device: any) => { ... }
```
```ts
// PenHelper.ts
this.pens = [penController, penController, ...];

// Refer to penController usage scene 2-1
```


### 1-5. disconnect
Disconnects the Bluetooth device connection.
```ts
disconnect = (penController: any) => { ... }
```
```ts
// Usage with React hook

const disconnectPen = () => {
  PenHelper.disconnect(controller);
}
```

### [Pen Event Information]
### 2-1. messageCallback, handleMessage
Handles events from the Bluetooth pen.
```ts
handleMessage = (controller: any, type: any, args: any) => { ... }
```
| Type (Hex) | Title | Description | |
|-----------|-------|-------------| - |
| 1 (0x01) | PEN_AUTHORIZED | Pen authorization successful | - |
| 2 (0x02) | PEN_PASSWORD_REQUEST | Password request | - |
| 4 (0x04) | PEN_DISCONNECTED | Pen disconnected | - |
| 6 (0x06) | PEN_CONNECTION_SUCCESS | Pen connection successful | - |
| 17 (0x11) | PEN_SETTING_INFO | Pen status information (battery, memory, etc.) | Battery information during pen charging -> 128 |
| 18 (0x12) | PEN_SETUP_SUCCESS | Pen setup change successful | - |
| 19 (0x13) | PEN_SETUP_FAILURE | Pen setup change failed | - |
| 26 (0x1a) | PEN_USING_NOTE_SET_RESULT | Real-time handwriting data request result | - |
| 82 (0x52) | PASSWORD_SETUP_SUCCESS | Password setup successful | - |
| 83 (0x53) | PASSWORD_SETUP_FAILURE | Password setup failed | - |
| 84 (0x54) | PEN_ILLEGAL_PASSWORD_0000 | Restriction on new password 0000 | - |
| 99 (0x63) | EVENT_LOW_BATTERY | Low battery event | - |
| 100 (0x64) | EVENT_POWER_OFF | Power off event | - |
| 34 (0x22) | PEN_FW_UPGRADE_STATUS | Pen firmware upgrade status | - |
| 35 (0x23) | PEN_FW_UPGRADE_SUCCESS | Pen firmware upgrade successful | - |
| 36 (0x24) | PEN_FW_UPGRADE_FAILURE | Pen firmware upgrade failed | 1=Same version/2=Space insufficient/3=Failure/4=Compression not supported |
| 37 (0x25) | PEN_FW_UPGRADE_SUSPEND | Pen firmware upgrade suspended | - |
| 48 (0x30) | OFFLINE_DATA_NOTE_LIST | Offline data note list | - |
| 49 (0x31) | OFFLINE_DATA_PAGE_LIST | Offline data page list | - |
| 50 (0x32) | OFFLINE_DATA_SEND_START | Offline data send start | - |
| 51 (0x33) | OFFLINE_DATA_SEND_STATUS | Offline data sending status | - |
| 52 (0x34) | OFFLINE_DATA_SEND_SUCCESS | Offline data send successful | - |
| 53 (0x35) | OFFLINE_DATA_SEND_FAILURE | Offline data send failed | - |
| 165 (0xa5) | OFFLINE_DATA_DELETE_RESPONSE | Offline data deletion status | - |
| 84 (0x54) | PEN_CONNECTION_FAILURE_BTDUPLICATE | Failure when attempting to connect duplicate Bluetooth pens | - |
| 193 (0xc1) | PEN_PROFILE | Pen profile | - |
| 115 (0x73) | RES_PDS | Pen PDS | - |
| 104 (0x68) | EVENT_DOT_ERROR | Pen Dot event error | - |
| 105 (0x69) | EVENT_DOT_PUI | Pen Dot PUI information | - |
| 244 (0xf4) | RES_LOG_INFO | Pen log information | - |
| 245 (0xf5) | RES_LOG_DATA | Pen log data | - |

```ts
// Usage with React hook

const [controller, setController] = useState();
const [penVersionInfo, setPenVersionInfo] = useState();
const [battery, setBattery] = useState();

useEffect(() => {
  PenHelper.messageCallback = async (mac, type, args) => {
    messageProcess(mac, type, args);
  }
}, []);

const messageProcess = (mac, type, args) => {
  switch(type) {
    case PenMessageType.PEN_SETTING_INFO:
      const _controller = PenHelper.pens.filter((c) => c.info.MacAddress === mac)[0];
      setController(_controller);  // Register the controller of the corresponding pen.
      setBattery(args.Battery);  // Save battery status information -> Display 128 when charging
      ...
      break;
    case PenMessageType.PEN_DISCONNECTED:  // Reset all state values when the pen is disconnected
      setController(null);
      setPenInfo(null);
      setBattery(null);
      break;
    case PenMessageType.PEN_PASSWORD_REQUEST: ...  // Handling password request
      onPasswordRequired(args);
      break;
    case PenMessageType.PEN_SETUP_SUCCESS:  // Processing when pen connection is successful
      if (controller) {
        setPenVersionInfo(controller.info);
      }
      ...
      break;
  }
}

...

const onPasswordRequired = (args: any) => {
  const password = input();
  ...
  if (args.RetryCount >= 10) {
    alert('All information on the pen will be reset.');
  }
  ...
  controller.InputPassword(password);  // Pass the password using the registered pen controller.
}
...
```

### [Pen Dot Processing]
### 3-1. dotCallback, handleDot
The dot data coming from the pen is processed through the registered callback function `handleDot` in the penController.
```ts
handleDot = (controller: any, args: any) => { ... }
```

### 3-2. ncodeToScreen
This logic is used to convert general ncode dot coordinate values according to the view size so that they can be displayed in the view.
```ts
/**
 * This function is to convert the general ncode dot coordinate values ​​according to the view size in order to be shown in the view.
 * 
 * @param {Dot} dot
 * @param {View} view
 * @param {PaperSize} paperSize
 * @returns {ScreenDot}
 */
ncodeToScreen = (dot: Dot, view: View, paperSize: PaperSize) => { 
  ... 
}
```

### 3-3. ncodeToScreen_smartPlate
This logic is used to convert SmartPlate's ncode dot coordinate values ​​according to the view size so that they can be displayed in the view.
```ts
/**
 * This function is to convert the SmartPlate ncode dot coordinate values ​​according to the view size in order to be shown in the view.
 * 
 * @param {Dot} dot
 * @param {View} view
 * @param {number} angle - possible angle value [0', 90', 180', 270']
 * @param {PaperSize} paperSize
 * @returns {ScreenDot}
 */
ncodeToScreen_smartPlate = (dot: Dot, view: View, angle: number, paperSize: PaperSize) => {
  ...
}
```

```ts
// Usage with React hook

useEffect(() => {
  PenHelper.dotCallback = async (mac, dot) => {
    strokeProcess(dot);
  }
}, []);

const strokeProcess = (dot: Dot) => {
  ...
  const view = { width: canvasFb.width, height: canvasFb.height };

  let screenDot: ScreenDot;
  if (PenHelper.isSamePage(dot.pageInfo, PlateNcode_3)) {  // SmartPlate
    screenDot = PenHelper.ncodeToScreen_smartPlate(dot, view, angle, paperSize);
  } else {  // Default
    screenDot = PenHelper.ncodeToScreen(dot, view, paperSize);
  }
  ...
}
```

### 4. isSamePage
Logic to distinguish whether it is the same page based on different ncode page information (SOBP). SOBP is information to distinguish pages and stands for Section/Owner/Book/Page.
```ts
/**
 * This function is to distinguish whether it is the same page based on different ncode page information (SOBP).
 * 
 * @param {PageInfo} page1
 * @param {PageInfo} page2
 * @returns {boolean}
 */
isSamePage = (page1: PageInfo, page2: PageInfo) => {
  ...
}
```



### **NoteServer**
> extractMarginInfo, getNoteImage, setNprojInPuiController

### 1. extractMarginInfo
This logic extracts the margin info of the ncode page from the nproj based on the pageInfo received from the pen.
```ts
/**
 * This function is to extract the margin info of the ncode page from nproj based on pageInfo.
 * 
 * @param {string || null} url
 * @param {PageInfo} pageInfo
 * @returns {PaperSize}
 */
const extractMarginInfo = async (url:string | null, pageInfo: PageInfo) => {
  ...
}
```

### 2. getNoteImage
This logic is used to retrieve the image of the note based on the pageInfo received from the pen.
```ts
/**
 * This function is to get the note image based on pageInfo.
 * 
 * @param {PageInfo} pageInfo
 * @param {React.dispatch} setImageBlobUrl
 * @returns {boolean} - success -> setImageBlobUrl(imageBlobUrl)
 */
const getNoteImage = async (pageInfo: PageInfo, setImageBlobUrl: any) => {
  ...
}
```

### 3. setNprojInPuiController
This logic sets the PUI information on the page based on the pageInfo and the url of the nproj file received from the pen.
Once registered, this PUI will be returned through the messageCallback when a SmartPen is input.
```ts
/**
 * This function is to set the PUI in Page based on pageInfo.
 * 
 * @param {string || null} url
 * @param {PageInfo} pageInfo
 */
const setNprojInPuiController  = async (url: string | null, pageInfo: PageInfo) => {
  ...
}
```

```ts
// Usage with React hook

const [imageBlobUrl, setImageBlobUrl] = useState<string>();
const [paperSize, setPaperSize] = useState<PaperSize>();

useEffect(() => {
  async function getNoteImageUsingAPI(pageInfo) {
    await NoteServer.setNprojInPuiController(pageInfo);
    await NoteServer.getNoteImage(pageInfo, setImageBlobUrl);
    const paperSize: PaperSize = await NoteServer.extractMarginInfo(url, pageInfo);
    setPaperSize(paperSize);
  }

  if (pageInfo) {
    getNoteImageUsingAPI(pageInfo);
  }
}, [pageInfo]);
```

### **PenController**
> RequestVersionInfo, SetPassword, InputPassword, RequestPenStatus, SetRtcTime, SetAutoPowerOffTime, SetPenCapPowerOnOffEnable,
SetAutoPowerOnEnable, SetBeepSoundEnable, SetHoverEnable, SetOfflineDataEnable, SetColor, RequestAvailableNotes, RequestOfflineNoteList, RequestOfflinePageList, RequestOfflineData, RequestOfflineDelete, RequestFirmwareInstallation, RequestFirmwareUpload, RequestProfileInfo.., RequestProfileReadValue..

| Methods | Parameters |Description |
| --- | --- |--- |
| RequestVersionInfo | | Request the current version of the pen |
| SetPassword | oldone: string, newone: string | Request to change the password set on the pen |
| InputPassword | password: string | Send a password to the pen | 
| RequestPenStatus | | Request confirmation of various pen settings |
| SetRtcTime | | Request to change the pen's set time to the current time |
| SetAutoPowerOffTime | minute: number | Request to change the pen's set auto shutdown time (up to 3600 minutes) | 
| SetPenCapPowerOnOffEnable | enable: boolean | Request to change the function of turning on/off the pen using the pen cap |
| SetAutoPowerOnEnable | enable: boolean | Request to change the function of turning on the pen using the pen cap or writing |
| SetBeepSoundEnable | enable: boolean | Request to change the beep sound function of the pen |
| SetHoverEnable | enable: boolean | Request to change the hover function of the pen <br/> ( Hover: Visual dot display function for estimating writing position) |
| SetOfflineDataEnable | enable: boolean | Request to change the function of storing offline writing data on the pen |
| SetColor | color: number | Request to change the LED color of the pen (argb) |
| RequestAvailableNotes | sections: number[ ], owners: number[ ], <br/> notes: number[ ] \| null| Request transmission of real-time writing data to the pen <br/> (If notes is null, request without distinguishing notes) |
| RequestOfflineNoteList | section: number, owner: number | Request for page information (book) of offline writing data stored on the pen <br/> (If SO is 0, return all note lists) |
| RequestOfflinePageList | section: number, owner: number, <br/> note: number | Request for page information (page) of offline writing data stored on the pen <br/> (As long as SOB matches, it's a page of the note) |
| RequestOfflineData | section: number, owner: number, <br/>note: number,  deleteOnFinished: boolean,<br/> pages: number[ ] | Request for offline writing data stored on the pen <br/> (If P is an empty array, request all pages in the note) <br/> (If deleteOnFinished is true, delete the transmitted data when finished)|
| RequestOfflineDelete | section: number, owner: number, <br/> notes: number[ ] | Request for deletion of offline writing data stored on the pen |
| RequestFirmwareInstallation | file: file, version: string, <br/> isCompressed: boolean | Query to upgrade the installed firmware on the pen |
| RequestFirmwareUpload | offset: number, data: Uint8Array, <br/> status: number | Upload firmware data to the pen | 
| RequestProfileCreate | name: string, password: string | Request to create a profile on the pen |
| ReqeustProfileDelete | name: string, password: string | Request to remove the configured profile on the pen |
| RequestProfileInfo | name: string | Request for information about the configured profile on the pen |
| RequestProfileWriteValue | name: string, passsword: string, <br/> data: { [key: string]: any } | Request to write data in the configured profile on the pen |
| RequestProfileReadValue | name: string, keys: string[ ] | Request for information about the data in the configured profile on the pen |
| RequestProfileDeleteValue | name: string, password: string, <br/> keys: string [ ] | Request to delete data in the configured profile on the pen |

## Overall Flow
### Library Set
```ts
import { PenHelper, NoteServer, PenMessageType } from 'web_pen_sdk';
```

### Step1: Connect the pen using PenHelper.startScan().
```ts
/** Connect SmartPen to Web service */
PenHelper.startScan();
```

### Step2: Handle events (connection, battery information, etc.) from the pen.
```ts
useEffect(() => {
  PenHelper.messageCallback = async (mac, type, args) => {
    messageProcess(mac, type, args)
  }
});

const messageProcess = (mac, type, args) => {
  switch(type) {
    case PenMessageType.x:
    ...
  }
}
```

### Step3: Receive real-time dot data from the pen.
```ts
/** Data Parsing from SmartPen */
PenHelper.dotCallback = (mac, dot) => {
  strokeProcess(dot);
}

const strokeProcess = (dot: Dot) => {
  ...
}
```

### Step4: Use NoteServer.extractMarginInfo() to get size information of the ncode paper.
```ts
/** Use NoteServer.extractMarginInfo() function to get size information of the ncode paper. */
const [paperSize, setPaperSize] = useState<PaperSize>();

const paperSize: PaperSize = await NoteServer.extractMarginInfo(url, pageInfo);
```

### Step5: Use NoteServer.getNoteImage() to get image url of the note.
```ts
/** Use NoteServer.getNoteImage() function to get image url of the note. */
const [imageBlobUrl, setImageBlobUrl] = useState<string>();

await NoteServer.getNoteImage(pageInfo, setImageBlobUrl);
```

### Step6: Transform the received ncode dot data according to the view size and use it.
```ts
/**
 * Draw on Canvas with SmartPen
 * Coordinate Transformation with ncode_dot based on view_size, ncode_size
 */ 
const strokeProcess = (dot: Dot) => {
  const view = { width: canvasFb.width, height: canvasFb.height };

  // case Default:
  const screenDot = PenHelper.ncodeToScreen(dot, view, paperSize);
  // case SmartPlate:
  const screenDot = PenHelper.ncodeToScreen_smartPlate(dot, view, angle, paperSize)

  /** Create path data using screenDot */
const path = new Path(screenDot.x, screenDot.y);
}
```

### Step6: Set the information of the PUI icons on the page that will be touched by the SmartPen.
```ts
/**
 * Set the information for the PUI icon on the page
 * Async-await calls are optional, as they are not directly utilized on page changes
 */ 
(await) NoteServer.setNprojInPuiController(pageInfo)
```

## 🐾 Sample Page
> [https://github.com/neostudio-team/WebSDKSample](https://github.com/neostudio-team/WebSDKSample)

## 📑 web_pen_sdk Official Documentation
> ### [Google Docs](https://docs.google.com/document/d/12ZSPQ-CVEOq4yxvNn2jcI9L_SZ01zJkMvbWBVfJCHWQ/edit?usp=sharing)

## 📜 License
#### **Copyright(c) 2022, NeoLAB Convergence INC. No license allowed.**

<br />

Release Note
=====
**~2022. 05. 05.** (MHCHOI)
-----
### Updates
- Released web_pen_sdk package
- Created a sample page

**2022. 05. 06.** (MHCHOI)
-----
### New Features
- **Pen Event Handler** - Added logic to handle events from the pen (connection, disconnection, password request, etc.)
### Updates
- Updated readme to reflect the addition of Pen Event Handler
- Added pen disconnection feature and updated the sample page to display battery information
- Clarified that the battery status is 128 when the pen is charging

**2022. 05. 09.** (WONHO)
-----
### New Features
- **PenConfigurationInfo, VersionInfo** - Added type declarations
### Updates
- Updated code according to the definition of PenConfigurationInfo, VersionInfo types
- Updated any type within PenHelper

**2022. 05. 13.** (WONHO, ver.0.5.2)
-----
### New Features
- **DotErrorInfo** - Added type declaration
- Error handling for abnormal TimeStamps in Dot events
### Updates
- Added and modified messageType related to pen password setting, change, and release
- Added and modified messageType related to offline and real-time data
- All Dots except hover go through DotFilter
- Modified Packet Escape logic

**2022. 05. 16.** (WONHO, ver.0.5.3)
-----
### Updates
- Modified SupportedProtocolVersion

**2022. 05. 17.** (WONHO, ver.0.5.4)
-----
### New Features
- **PEN_CONNECTION_SUCCESS** - Added MessageType declaration
- **ONLINE_PEN_HOVER_EVENT** - Added logic for pen hover events for v2.18
### Updates
- Modified SupportedProtocolVersion

**2022. 05. 18.** (WONHO, ver.0.5.5)
-----
### Updates
- Modified the SDK to not automatically setHover

**2022. 05. 31.** (WONHO, ver.0.5.6)
-----
### New Features
- **Profile Feature** - Added logic for creating, deleting, and querying pen profiles and creating, deleting, and querying items in profiles
- **Firmware Feature** - Added logic for firmware update
- **PenDisk Init** - Added request for initializing the pen disk
### Updates
- Added code to prevent errors due to overlapping connections during Bluetooth write in a busy communication state

**2022. 06. 27.** (WONHO, ver.0.5.7)
-----
### New Features
- **PUI Feature** - Added logic to display a message when clicking on a Smart Class Kit (Boogie Board) PUI with the pen

**2022. 07. 04.** (WONHO, ver.0.6.6)
-----
### New Features
- **PUI Feature** - Hardcoded PUI coordinates

**2022. 07. 05.** (WONHO, ver.0.6.7)
-----
### New Features
- **PUI Feature** - Converted PUI coordinates from nproj to json for use

**2023. 12. 01.** (WONHO, ver.0.6.8)
-----
### New Features
- **PUI Feature** - Rolled back to PUI nproj, added support for PUI on note pages

**2024. 01. 06.** (WONHO, ver.0.7.2)
-----
### New Features
- **PUI Feature** - Added url as a parameter to setNprojInPuiController and extractMarginInfo
