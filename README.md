# Adafruit WebSerial 3D Model Viewer (Quadcopter Motor Vector Edition)
Source files for the Adafruit WebSerial 3D Model Viewer available at: https://adafruit.github.io/Adafruit_WebSerial_3DModelViewer/. This is the web end for the Adafruit AHRS calibrated_orientation sketch.

This fork replaces the bunny model with a procedurally-built quadcopter and
adds support for visualizing per-motor thrust/force vectors as arrows on
each motor, in addition to the original whole-body orientation display.

## Adafruit Learn Guide
To learn how to use the 3D Model Viewer, check out the learn guide at https://learn.adafruit.com/how-to-fuse-motion-sensor-data-into-ahrs-orientation-euler-quaternions

## Motor Vectors

In addition to the existing `Orientation:`, `Quaternion:`, and
`Calibration:` serial line prefixes, this viewer understands a
`motor:`/`Motors:` prefix (case-insensitive) for driving the four
motor-vector arrows drawn on the quadcopter model. Send a comma-separated
line in one of two formats:

- **ESC PWM per motor (4 numbers)** — this is the format the
  microcontroller sketch actually prints, `motor: M1_PWM, M2_PWM, M3_PWM,
  M4_PWM`, e.g.:
  ```
  motor: 1500, 1520, 1480, 1600
  ```
  Each value is assumed to be a standard hobby ESC pulse width in
  microseconds (~1000us = off, ~2000us = full throttle). It's normalized
  to a 0-1 thrust value and drawn straight up along the motor's local Y
  axis. If your firmware uses a different PWM range (e.g. 0-255 duty
  cycle), adjust `MOTOR_PWM_MIN`/`MOTOR_PWM_MAX` near the top of
  `js/script.js`.
- **Full vectors (12 numbers)** — an `[x, y, z]` force/thrust vector per
  motor, expressed in the quadcopter's own body frame, for firmware that
  already computes a direction and magnitude per motor:
  ```
  Motors:0,10,0, 2,9,0, 0,10,-1, -1,9,0
  ```

Motor order is `[Front Right, Front Left, Rear Left, Rear Right]` (M1-M4),
matching the color-coded motor pods on the model (red, green, blue,
yellow respectively). Each motor's card below the 3D view shows the raw
PWM and derived thrust percentage (or the vector components/magnitude, if
using the 12-number format). If your data uses a very different numeric
range, tweak `MOTOR_PWM_MIN`, `MOTOR_PWM_MAX`, `MOTOR_VECTOR_SCALE`,
`MOTOR_ARROW_MIN_LENGTH`, and `MOTOR_ARROW_MAX_LENGTH` near the top of
`js/script.js` to rescale the arrows.
