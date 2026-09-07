// let the editor know that `Chart` is defined by some code
// included in another file (in this case, `index.html`)
// Note: the code will still work without this line, but without it you
// will see an error in the editor
/* global THREE */
/* global TransformStream */
/* global TextEncoderStream */
/* global TextDecoderStream */
'use strict';

import * as THREE from 'three';

let port;
let reader;
let inputDone;
let outputDone;
let inputStream;
let outputStream;
let showCalibration = false;

let orientation = [0, 0, 0];
let quaternion = [1, 0, 0, 0];
let calibration = [0, 0, 0, 0];

// Motor thrust vectors, one [x, y, z] per motor, expressed in the
// quadcopter's own body frame (same frame the model itself rotates in).
// Order: [Front Right, Front Left, Rear Left, Rear Right]
let motorVectors = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

// Last raw PWM value (µs) received per motor, or null if the last data
// received was a full [x,y,z] vector rather than a PWM scalar.
let motorPWM = [null, null, null, null];

// Standard hobby ESC pulse-width range: ~1000us = motor off/idle,
// ~2000us = full throttle. Adjust these if your firmware uses a
// different PWM range (e.g. 0-255 duty cycle, or a different µs range).
const MOTOR_PWM_MIN = 1000;
const MOTOR_PWM_MAX = 2000;

// How much a unit of parsed motor data should visually stretch its arrow.
// With PWM input, thrust is normalized to 0-1 first, so this is roughly
// "arrow length at full throttle". Tune to taste.
const MOTOR_VECTOR_SCALE = 5;
const MOTOR_ARROW_MIN_LENGTH = 0.4;
const MOTOR_ARROW_MAX_LENGTH = 6;

const maxLogLength = 100;
const baudRates = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000];
const log = document.getElementById('log');
const butConnect = document.getElementById('butConnect');
const butClear = document.getElementById('butClear');
const baudRate = document.getElementById('baudRate');
const autoscroll = document.getElementById('autoscroll');
const showTimestamp = document.getElementById('showTimestamp');
const angleType = document.getElementById('angle_type');
const lightSS = document.getElementById('light');
const darkSS = document.getElementById('dark');
const darkMode = document.getElementById('darkmode');
const canvas = document.querySelector('#canvas');
const calContainer = document.getElementById('calibration');
const logContainer = document.getElementById("log-container");
const motorBoxes = [
  document.getElementById('motorBox0'),
  document.getElementById('motorBox1'),
  document.getElementById('motorBox2'),
  document.getElementById('motorBox3'),
];

fitToContainer(canvas);

function fitToContainer(canvas){
  // Make it visually fill the positioned parent
  canvas.style.width ='100%';
  canvas.style.height='100%';
  // ...then set the internal size to match
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}

document.addEventListener('DOMContentLoaded', async () => {
  butConnect.addEventListener('click', clickConnect);
  butClear.addEventListener('click', clickClear);
  autoscroll.addEventListener('click', clickAutoscroll);
  showTimestamp.addEventListener('click', clickTimestamp);
  baudRate.addEventListener('change', changeBaudRate);
  angleType.addEventListener('change', changeAngleType);
  darkMode.addEventListener('click', clickDarkMode);

  if ('serial' in navigator) {
    const notSupported = document.getElementById('notSupported');
    notSupported.classList.add('hidden');
  }

  if (isWebGLAvailable()) {
    const webGLnotSupported = document.getElementById('webGLnotSupported');
    webGLnotSupported.classList.add('hidden');
  }

  initBaudRate();
  loadAllSettings();
  updateTheme();
  await finishDrawing();
  await render();
});

/**
 * @name connect
 * Opens a Web Serial connection to a micro:bit and sets up the input and
 * output stream.
 */
async function connect() {
  // - Request a port and open a connection.
  port = await navigator.serial.requestPort();
  // - Wait for the port to open.toggleUIConnected
  await port.open({ baudRate: baudRate.value });

  let decoder = new TextDecoderStream();
  inputDone = port.readable.pipeTo(decoder.writable);
  inputStream = decoder.readable
    .pipeThrough(new TransformStream(new LineBreakTransformer()));

  reader = inputStream.getReader();
  readLoop().catch(async function(error) {
    toggleUIConnected(false);
    await disconnect();
  });
}

/**
 * @name disconnect
 * Closes the Web Serial connection.
 */
async function disconnect() {
  if (reader) {
    await reader.cancel();
    await inputDone.catch(() => {});
    reader = null;
    inputDone = null;
  }

  if (outputStream) {
    await outputStream.getWriter().close();
    await outputDone;
    outputStream = null;
    outputDone = null;
  }

  await port.close();
  port = null;
  showCalibration = false;
}

/**
 * @name readLoop
 * Reads data from the input stream and displays it on screen.
 */
async function readLoop() {
  while (true) {
    const {value, done} = await reader.read();
    if (value) {
      let plotdata;
      if (value.substr(0, 12) == "Orientation:") {
        orientation = value.substr(12).trim().split(",").map(x=>+x);
      }
      if (value.substr(0, 11) == "Quaternion:") {
        quaternion = value.substr(11).trim().split(",").map(x=>+x);
      }
      if (value.substr(0, 12) == "Calibration:") {
        calibration = value.substr(12).trim().split(",").map(x=>+x);
        if (!showCalibration) {
          showCalibration = true;
          updateTheme();
        }
      }
      const motorPrefixMatch = value.match(/^motors?:/i);
      if (motorPrefixMatch) {
        const motorData = value.substr(motorPrefixMatch[0].length).trim().split(",").map(x=>+x);
        parseMotorVectors(motorData);
      }
    }
    if (done) {
      console.log('[readLoop] DONE', done);
      reader.releaseLock();
      break;
    }
  }
}

function logData(line) {
  // Update the Log
  if (showTimestamp.checked) {
    let d = new Date();
    let timestamp = d.getHours() + ":" + `${d.getMinutes()}`.padStart(2, 0) + ":" +
        `${d.getSeconds()}`.padStart(2, 0) + "." + `${d.getMilliseconds()}`.padStart(3, 0);
    log.innerHTML += '<span class="timestamp">' + timestamp + ' -> </span>';
    d = null;
  }
  log.innerHTML += line+ "<br>";

  // Remove old log content
  if (log.textContent.split("\n").length > maxLogLength + 1) {
    let logLines = log.innerHTML.replace(/(\n)/gm, "").split("<br>");
    log.innerHTML = logLines.splice(-maxLogLength).join("<br>\n");
  }

  if (autoscroll.checked) {
    log.scrollTop = log.scrollHeight
  }
}

/**
 * @name updateTheme
 * Sets the theme to  Adafruit (dark) mode. Can be refactored later for more themes
 */
function updateTheme() {
  // Disable all themes
  document
    .querySelectorAll('link[rel=stylesheet].alternate')
    .forEach((styleSheet) => {
      enableStyleSheet(styleSheet, false);
    });

  if (darkMode.checked) {
    enableStyleSheet(darkSS, true);
  } else {
    enableStyleSheet(lightSS, true);
  }

  if (showCalibration && !logContainer.classList.contains('show-calibration')) {
    logContainer.classList.add('show-calibration')
  } else if (!showCalibration && logContainer.classList.contains('show-calibration')) {
    logContainer.classList.remove('show-calibration')
  }
}

function enableStyleSheet(node, enabled) {
  node.disabled = !enabled;
}


/**
 * @name reset
 * Reset the Plotter, Log, and associated data
 */
async function reset() {
  // Clear the data
  log.innerHTML = "";
}

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 */
async function clickConnect() {
  if (port) {
    await disconnect();
    toggleUIConnected(false);
    return;
  }

  await connect();

  reset();

  toggleUIConnected(true);
}

/**
 * @name clickAutoscroll
 * Change handler for the Autoscroll checkbox.
 */
async function clickAutoscroll() {
  saveSetting('autoscroll', autoscroll.checked);
}

/**
 * @name clickTimestamp
 * Change handler for the Show Timestamp checkbox.
 */
async function clickTimestamp() {
  saveSetting('timestamp', showTimestamp.checked);
}

/**
 * @name changeBaudRate
 * Change handler for the Baud Rate selector.
 */
async function changeBaudRate() {
  saveSetting('baudrate', baudRate.value);
}


/**
 * @name changeAngleType
 * Change handler for the Baud Rate selector.
 */
async function changeAngleType() {
  saveSetting('angletype', angleType.value);
}

/**
 * @name clickDarkMode
 * Change handler for the Dark Mode checkbox.
 */
async function clickDarkMode() {
  updateTheme();
  saveSetting('darkmode', darkMode.checked);
}

/**
 * @name clickClear
 * Click handler for the clear button.
 */
async function clickClear() {
  reset();
}

async function finishDrawing() {
  return new Promise(requestAnimationFrame);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @name LineBreakTransformer
 * TransformStream to parse the stream into lines.
 */
class LineBreakTransformer {
  constructor() {
    // A container for holding stream data until a new line.
    this.container = '';
  }

  transform(chunk, controller) {
    this.container += chunk;
    const lines = this.container.split('\n');
    this.container = lines.pop();
    lines.forEach(line => {
      controller.enqueue(line)
      logData(line);
    });
  }

  flush(controller) {
    controller.enqueue(this.container);
  }
}

function convertJSON(chunk) {
  try {
    let jsonObj = JSON.parse(chunk);
    jsonObj._raw = chunk;
    return jsonObj;
  } catch (e) {
    return chunk;
  }
}

function toggleUIConnected(connected) {
  let lbl = 'Connect';
  if (connected) {
    lbl = 'Disconnect';
  }
  butConnect.textContent = lbl;
  updateTheme()
}

function initBaudRate() {
  for (let rate of baudRates) {
    var option = document.createElement("option");
    option.text = rate + " Baud";
    option.value = rate;
    baudRate.add(option);
  }
}

function loadAllSettings() {
  // Load all saved settings or defaults
  autoscroll.checked = loadSetting('autoscroll', true);
  showTimestamp.checked = loadSetting('timestamp', false);
  baudRate.value = loadSetting('baudrate', 9600);
  angleType.value = loadSetting('angletype', 'quaternion');
  darkMode.checked = loadSetting('darkmode', false);
}

function loadSetting(setting, defaultValue) {
  let value = JSON.parse(window.localStorage.getItem(setting));
  if (value == null) {
    return defaultValue;
  }

  return value;
}

let isWebGLAvailable = function() {
  try {
    var canvas = document.createElement( 'canvas' );
    return !! (window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}


/**
 * @name parseMotorVectors
 * Parses incoming motor data into 4 [x, y, z] thrust vectors, one per
 * motor, and updates motorPWM for the on-screen readout.
 *
 * Accepts two formats over serial, sent after a "motor:"/"Motors:"
 * prefix (case-insensitive):
 *  - 4 comma-separated numbers: an ESC PWM pulse width per motor, in
 *    microseconds (standard hobby range ~1000-2000us), e.g.
 *    "motor: 1500, 1520, 1480, 1600"
 *    This is normalized to a 0-1 thrust value using MOTOR_PWM_MIN/MAX,
 *    then drawn straight up along the quad's local Y axis.
 *  - 12 comma-separated numbers: a full [x,y,z] force/thrust vector per
 *    motor, in the quadcopter's body frame, e.g.
 *    "Motors:0,10,0, 2,9,0, 0,10,-1, -1,9,0"
 */
function parseMotorVectors(values) {
  if (!values || values.length === 0 || values.some(v => Number.isNaN(v))) {
    return;
  }

  if (values.length >= 12) {
    for (let i = 0; i < 4; i++) {
      motorVectors[i] = [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]];
      motorPWM[i] = null;
    }
  } else if (values.length >= 4) {
    for (let i = 0; i < 4; i++) {
      const pwm = values[i];
      motorPWM[i] = pwm;
      const normalizedThrust = THREE.MathUtils.clamp(
        (pwm - MOTOR_PWM_MIN) / (MOTOR_PWM_MAX - MOTOR_PWM_MIN),
        0,
        1
      );
      motorVectors[i] = [0, normalizedThrust, 0];
    }
  }
}

/**
 * @name updateMotorInfo
 * Updates the on-screen motor readout boxes with the latest parsed data:
 * raw PWM + derived thrust % when driven by PWM, or vector components +
 * magnitude when driven by full [x,y,z] vectors.
 */
function updateMotorInfo() {
  for (let i = 0; i < 4; i++) {
    const box = motorBoxes[i];
    if (!box) continue;

    const line1 = box.querySelector('.motor-pwm');
    const line2 = box.querySelector('.motor-thrust');

    if (motorPWM[i] != null) {
      const normalizedThrust = THREE.MathUtils.clamp(
        (motorPWM[i] - MOTOR_PWM_MIN) / (MOTOR_PWM_MAX - MOTOR_PWM_MIN),
        0,
        1
      );
      line1.textContent = `PWM: ${motorPWM[i].toFixed(0)} \u00B5s`;
      line2.textContent = `Thrust: ${(normalizedThrust * 100).toFixed(0)}%`;
    } else {
      const [x, y, z] = motorVectors[i];
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      line1.textContent = `x: ${x.toFixed(2)}, y: ${y.toFixed(2)}, z: ${z.toFixed(2)}`;
      line2.textContent = `|F| = ${magnitude.toFixed(2)}`;
    }
  }
}

/**
 * @name updateMotorArrows
 * Updates each motor's ArrowHelper direction/length from motorVectors.
 * The arrows are children of the quadcopter model, so they're defined
 * (and rotate) in the model's own local/body coordinate frame.
 */
function updateMotorArrows() {
  if (!motorArrows) return;
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = motorVectors[i];
    const vec = new THREE.Vector3(x, y, z);
    const magnitude = vec.length();
    const arrow = motorArrows[i];
    if (magnitude < 1e-6) {
      arrow.visible = false;
      continue;
    }
    arrow.visible = true;
    arrow.setDirection(vec.normalize());
    const length = THREE.MathUtils.clamp(
      magnitude * MOTOR_VECTOR_SCALE,
      MOTOR_ARROW_MIN_LENGTH,
      MOTOR_ARROW_MAX_LENGTH
    );
    arrow.setLength(length, length * 0.25, length * 0.15);
  }
}

function updateCalibration() {
  // Update the Calibration Container with the values from calibration
  const calMap = [
    {caption: "Uncalibrated",         color: "#CC0000"},
    {caption: "Partially Calibrated", color: "#FF6600"},
    {caption: "Mostly Calibrated",    color: "#FFCC00"},
    {caption: "Fully Calibrated",     color: "#009900"},
  ];
  const calLabels = [
    "System", "Gyro", "Accelerometer", "Magnetometer"
  ]

  calContainer.innerHTML = "";
  for (var i = 0; i < calibration.length; i++) {
    let calInfo = calMap[calibration[i]];
    let element = document.createElement("div");
    element.innerHTML = calLabels[i] + ": " + calInfo.caption;
    element.style = "color: " + calInfo.color;
    calContainer.appendChild(element);
  }
}

function saveSetting(setting, value) {
  window.localStorage.setItem(setting, JSON.stringify(value));
}

let quad;
let motorArrows;

const renderer = new THREE.WebGLRenderer({canvas});

const camera = new THREE.PerspectiveCamera(45, canvas.width/canvas.height, 0.1, 100);
camera.position.set(0, 0, 30);

const scene = new THREE.Scene();
scene.background = new THREE.Color('black');
{
  const skyColor = 0xB1E1FF;  // light blue
  const groundColor = 0x666666;  // black
  const intensity = 0.5;
  const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
  scene.add(light);
}

{
  const color = 0xFFFFFF;
  const intensity = 1;
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(0, 10, 0);
  light.target.position.set(-5, 0, 0);
  scene.add(light);
  scene.add(light.target);
}

{
  const built = buildQuadcopter();
  quad = built.quad;
  motorArrows = built.motorArrows;
  scene.add(quad);
}

/**
 * @name buildQuadcopter
 * Procedurally builds a simple quadcopter model in X configuration:
 * a central hub, four arms reaching out to color-coded motor pods, and
 * one THREE.ArrowHelper per motor (added as a child of the model so it
 * shares the model's body-frame orientation) used to visualize each
 * motor's thrust/force vector.
 *
 * Motor order/colors: [0] Front Right (red), [1] Front Left (green),
 * [2] Rear Left (blue), [3] Rear Right (yellow). "Front" is -Z, "up" is +Y.
 */
function buildQuadcopter() {
  const quad = new THREE.Group();

  const armLength = 5;
  const motorPositions = [
    new THREE.Vector3(armLength, 0, -armLength),  // Front Right
    new THREE.Vector3(-armLength, 0, -armLength), // Front Left
    new THREE.Vector3(-armLength, 0, armLength),  // Rear Left
    new THREE.Vector3(armLength, 0, armLength),   // Rear Right
  ];
  const motorColors = [0xCC3333, 0x33AA33, 0x3366CC, 0xCCAA00];

  // Central hub
  const hubGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.8, 16);
  const hubMat = new THREE.MeshPhongMaterial({color: 0x444444});
  const hub = new THREE.Mesh(hubGeo, hubMat);
  quad.add(hub);

  // Small marker on top of the hub pointing toward the front (-Z), so
  // orientation is easy to read at a glance.
  const noseGeo = new THREE.ConeGeometry(0.4, 1, 8);
  const noseMat = new THREE.MeshPhongMaterial({color: 0xEEEEEE});
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.4, -1.8);
  quad.add(nose);

  const armMat = new THREE.MeshPhongMaterial({color: 0x888888});
  const motorArrows = [];

  motorPositions.forEach((pos, i) => {
    // Arm: a thin box stretching from the hub to the motor position.
    const armLen = pos.length();
    const armGeo = new THREE.BoxGeometry(0.5, 0.3, armLen);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.copy(pos.clone().multiplyScalar(0.5));
    arm.lookAt(pos);
    quad.add(arm);

    // Motor pod: a short color-coded cylinder at the end of the arm.
    const motorGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.6, 16);
    const motorMat = new THREE.MeshPhongMaterial({color: motorColors[i]});
    const motor = new THREE.Mesh(motorGeo, motorMat);
    motor.position.copy(pos);
    quad.add(motor);

    // Propeller disc: a flat, semi-transparent circle above the motor.
    const propGeo = new THREE.CircleGeometry(1.6, 24);
    const propMat = new THREE.MeshPhongMaterial({
      color: motorColors[i],
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const prop = new THREE.Mesh(propGeo, propMat);
    prop.rotation.x = -Math.PI / 2;
    prop.position.copy(pos).add(new THREE.Vector3(0, 0.35, 0));
    quad.add(prop);

    // Motor vector arrow: origin at the motor, default direction up,
    // updated every frame from the parsed motor vector data.
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      pos.clone().add(new THREE.Vector3(0, 0.35, 0)),
      MOTOR_ARROW_MIN_LENGTH,
      motorColors[i],
      MOTOR_ARROW_MIN_LENGTH * 0.25,
      MOTOR_ARROW_MIN_LENGTH * 0.15
    );
    arrow.visible = false;
    quad.add(arrow);
    motorArrows.push(arrow);
  });

  return {quad, motorArrows};
}

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}

async function render() {
  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  if (quad != undefined) {
    if (angleType.value == "euler") {
      if (showCalibration) {
          // BNO055
        let rotationEuler = new THREE.Euler(
          THREE.MathUtils.degToRad(360 - orientation[2]),
          THREE.MathUtils.degToRad(orientation[0]),
          THREE.MathUtils.degToRad(orientation[1]),
          'YZX'
        );
        quad.setRotationFromEuler(rotationEuler);
      } else {
        let rotationEuler = new THREE.Euler(
          THREE.MathUtils.degToRad(orientation[2]),
          THREE.MathUtils.degToRad(orientation[0]-180),
          THREE.MathUtils.degToRad(-orientation[1]),
          'YZX'
        );
        quad.setRotationFromEuler(rotationEuler);
      }
    } else {
      let rotationQuaternion = new THREE.Quaternion(quaternion[1], quaternion[3], -quaternion[2], quaternion[0]);
      quad.setRotationFromQuaternion(rotationQuaternion);
    }
  }

  updateMotorArrows();

  renderer.render(scene, camera);
  updateCalibration();
  updateMotorInfo();
  await sleep(10); // Allow 10ms for UI updates
  await finishDrawing();
  await render();
}
