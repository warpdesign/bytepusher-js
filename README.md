## Vanilla JavaScript Implementation of the [BytePusher VM](https://esolangs.org/wiki/BytePusher)

## Introduction

The BytePusher is a simple yet capable Virtual Machine that features a [ByteByteJump](https://esolangs.org/wiki/ByteByteJump) CPU, which is a one-instruction CPU.

Here are its full specifications:

- **CPU**: ByteByteJump with 3-byte addresses (Big Endian)
- **CPU Speed**: 65536 instructions per frame (3932160 instructions per second, ~3.93 MHz)
- **Memory**: 16 MiB RAM
- **Graphics**: 256×256 pixels, 1 byte per pixel, 216 fixed colors
- **Sound**: 8-bit mono, signed values, 256 samples per frame (15360 samples per second)
- **Keyboard**: 16 keys, organized into 4 rows by 4 columns

This project is an implementation of the BytePusher VM in vanilla JavaScript and the DOM. 

The full source code is approximately 250 lines, including DOM/Web-platform-specific code. While this is larger than some other implementations, the goal was to create something easy to read, understand, and learn from, rather than minimizing code size.

## Implementing the CPU

### Memory Layout and Access

The CPU is big-endian, so memory is represented using an `ArrayBuffer` and accessed either as bytes or through JavaScript's [DataView](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView). This ensures compatibility with both little-endian (most modern computers) and big-endian systems.

The CPU is implemented as a simple object:

```
const BytePusher = {
  mem: new DataView(new ArrayBuffer(0x1000008)),
  readUint24(addr) {
    if (addr > 0xFFFFFF) {
      throw new Error('Address out of bounds')
    }
    return this.mem.getUint32(addr) >> 8
  },
  writeUint16(src, value) {
    if (src > 0xFFFFFF) {
      throw new Error('Address out of bounds')
    }
    this.mem.setUint16(src, value)
  },
  readByte(addr) {
    if (addr > 0xFFFFFF){
      throw new Error('Address out of bounds')
    }
    return this.mem.getUint8(addr)    
  },
  writeByte(src, dest) {
    if (src > 0xFFFFFF || dest > 0xFFFFFF) {
      throw new Error('Address out of bounds')
    }
    this.mem.setUint8(this.readUint24(dest), this.mem.getUint8(this.readUint24(src)))
  },
}
```

Memory is a flat 16 MiB (`0x1000008`) `ArrayBuffer`. 

Methods are provided to read and write memory in different byte sizes. These methods abstract direct memory access and handle the CPU's big-endian nature. Since `DataView` methods for 16/32-bit values already expect big-endian data, the code works seamlessly on little-endian architectures (e.g., x64, ARM).

Basic bounds checks prevent accessing memory outside the BytePusher's 16 MiB address space. Removing these checks would reduce code size but could lead to undefined behavior.

### CPU Loop: 60 FPS

The CPU runs 60 times per second, executing 65536 instructions per frame.

JavaScript provides several ways to execute code at specific intervals:

- **`setInterval`**: Calls a function at least every specified millisecond interval. However, calls may not occur in order if the function takes too long to execute.
- **`setTimeout`**: Calls a function after a minimum delay. Like `setInterval`, it is not very precise.
- **`requestAnimationFrame`**: Requests the browser to call a function before the next repaint. This is synced to the display's refresh rate, making it ideal for rendering tasks.

`requestAnimationFrame` is the best choice for this project. Modern displays often refresh at rates other than 60 Hz (e.g., 120 Hz, 144 Hz), and inactive browser tabs may reduce the refresh rate. The callback receives a timestamp, allowing the CPU loop to run at the correct rate (16.66 ms per frame).

The loop is implemented as follows:

```
let fps = 60
let lastFrameTime = 0
let frameDuration = 1000 / fps // ~16.66 ms
// ...
const loop = (time) => {
  running && requestAnimationFrame(loop)

  const delta = time - lastFrameTime
  if (delta >= frameDuration) {
    lastFrameTime = time - (delta % frameDuration)
    
    // Update keyboard state
    // Run CPU loop
    // Render graphics
    // Render audio
  }
}
```

### Executing Instructions

The CPU loop, executed 60 times per second, looks like this:

```
cpuLoop() {
  let pc = this.readUint24(2)
  for (let i = 0; i < 65536; i++) {
    this.writeByte(pc, pc + 3)
    pc = this.readUint24(pc + 6)
  }
},
```

The loop reads the source address, writes to the destination address stored at offset 3, and updates the program counter (PC) to the address at offset 6.

## Graphics

### Framebuffer

From the documentation:

> A value of ZZ means: pixel(XX, YY) is at address ZZYYXX.

This means that `0xZZ0000` is the start address of the framebuffer and contains the value of pixel (0,0). Address `0xZZ0100` contains the value of the first pixel in the second scanline (0,1), and so on. The last pixel of the screen is at address `0xZZFFFF`.

### Palette

The pixel value is an index into the [web-safe color palette](https://www.colorhexa.com/web-safe-colors). The palette is precomputed in `initPalette` using the RGBA format:

```
let i = 0
// Generate web-safe 216-color palette
for (let r = 0; r <= 0xff; r += 0x33)
  for (let g = 0; g <= 0xff; g += 0x33)
    for (let b = 0; b <= 0xff; b += 0x33)
      view.setUint32(i++ * 4, r << 24 | g << 16 | b << 8 | 0xff)
```

Drawing the BytePusher screen on a canvas involves filling the canvas buffer with pixels from the palette:

```
updateBuffer(framebuffer) {
  const length = this.width * this.height
  const array32 = new Uint32Array(this.buffer.data.buffer)

  for (let i = 0; i < length; i++) {
    array32[i] = this.palette[framebuffer[i]]
  }
},
```

Since BytePusher supports only 216 colors but uses a byte (256 possible values) for pixels, colors 216–255 are set to black:

```
for (let i = 216; i < 256; i++) {
  view.setUint32(i++ * 4, 0x000000ff)
}
```

After each CPU loop, the canvas is updated with the new pixels using `ctx.putImageData`:

```
draw() {
  this.ctx.putImageData(this.buffer, 0, 0)
}
```

## Audio

### Audio Buffer

BytePusher has a 256-sample, signed 8-bit buffer with a sample rate of 15360 Hz. To handle this, a 2-second audio buffer is created and partially filled after each frame. When full, it loops back to the start.

The audio node's `loop` property is set to `true`, and `loopEnd` is set to the buffer's duration:

```
init(bufferDuration) {
  const sampleRate = 15360
  const totalSamples = bufferDuration * sampleRate
  this.buffer = new AudioBuffer({
    length: totalSamples,
    sampleRate,
    numberOfChannels: 1,
  })
  const source = this.audioCtx.createBufferSource()
  source.buffer = this.buffer
  source.loop = true
  source.loopEnd = bufferDuration
  source.loopStart = 0
  this.source = source
},
```

Audio playback starts after user interaction (e.g., a click).

### Updating the WebAudio Buffer

After each CPU loop, the audio buffer is updated with new data from BytePusher's memory. BytePusher's 8-bit signed samples (range: [-128, 127]) are converted to WebAudio's 32-bit floating-point format (range: [-1.0, 1.0]) using:

```
webaudio_sample = bytepusher_sample / 128.0
```

The update method:

```
updateBuffer(audioBuffer) {
  const data = this.buffer.getChannelData(0)
  const start = (this.currentSample + audioBuffer.length) < data.length ? this.currentSample : 0
  this.currentSample = start + audioBuffer.length
  for (let i = 0; i < audioBuffer.length; ++i) {
    data[start + i] = audioBuffer[i] / 128.0
  }
},
```

## Keyboard

The BytePusher keyboard has 16 keys stored as two bytes, with each bit representing a key's state. Multiple keys can be pressed simultaneously.

A simple mapping converts web key presses to BytePusher memory:

```
keymap: {
  '1': 0x2, '2': 0x4, '3': 0x8, '4': 0x10,
  '5': 0x20, '6': 0x40, '7': 0x80, '8': 0x100,
  '9': 0x200, 'a': 0x400, 'b': 0x800, 'c': 0x1000,
  'd': 0x2000, 'e': 0x4000, 'f': 0x8000
},
```

Key states are updated on `keydown` and `keyup` events:

```
document.addEventListener('keydown', (e) => {
  const key = this.keymap[e.key]
  if (key !== undefined) {
    this.keyState |= key
  }
})

document.addEventListener('keyup', (e) => {
  const key = this.keymap[e.key]
  if (key !== undefined) {
    this.keyState &= ~key
  }
})
```

Before each CPU loop, the keyboard state is written to BytePusher memory:

```
BytePusher.writeUint16(0, Keyboard.keyState)
```
