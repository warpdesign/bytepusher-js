## This is a vanilla JS implementation of the [BytePusher VM](https://esolangs.org/wiki/BytePusher)

## Introduction

The BytePusher is a very simple yet capable Virtual Machine that has a [ByteByteJump](https://esolangs.org/wiki/ByteByteJump) CPU which is a One (1!) instruction CPU.

Here are the full specifications:

- CPU: ByteByteJump with 3-byte addresses (Big Endian)
- CPU speed: 65536 instructions per frame (3932160 instructions per second, ~3.93 MHz).
- Memory:	16 MiB RAM
- Graphics:	256*256 pixels, 1 byte per pixel, 216 (that's not a typo!) fixed colors
- Sound: 8-bit mono, signed values. 256 samples per frame (15360 samples per second)
- Keyboard:	16 keys, organized into 4 rows by 4 columns

This is my take at the implementation of this VM in vanilla JavaScript + DOM.

The full source code is around 250 lines, including DOM/Web-platform specific code which is quite big compared to other implementations. But the goal was not to generate less code, but rather to learn, and write something easy to read/understand.

## Implementing the CPU

### Memory layout and access

Since the CPU is big-endian, I'll be using an ArrayBuffer and either access the memory as byte, or use JavaScript [DataView](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) so that this code runs properly in little-endian (most computers today) as well as big-endian (who knows? maybe the future is big endian...).

The CPU is a very simple object:

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

The memory is stored as a flat 16MiB (0x1000008) ArrayBuffer.

I have added several methods to read/write from memory different byte-sized data: this avoids directly poking into the memory and also correctly handles the fact that this CPU is big endian. Since all DataView methods dealing with 16/32 bit expect big-endian data, there is nothing to do to make the code work on today's x64/aarch64 which are little-endian.

I added basic bound checks that prevent accessing data outside of the BytePusher's 16MiB address space. Removing them would reduce the code's size.

### CPU Loop: 60fps

The CPU must be executed 60 times a second and 65536 instructions per frame have to be executed.

In JavaScript there are several functions that allow to execute code at a particular rate:

- setInterval: call a function at least each ms
- setTimeout: call a function after a minimum delay
- requestAnimationFrame: request the browser to call a function before the next repaint

`setInterval` calls may not happen in order if the function takes too much time to be executed, plus it's not very precise.

`setTimeout` is not precise either, and the delay may be longer than the request one depending on browser load.

`requestAnimationFrame` is synced to the refresh rate and appear to be the perfect candidate since most displays are refreshed at 60fps. That said, monitors with 120Hz or 140hz refresh rate are more and more common (ProMotion on Mac laptops, most highend smartphones, gaming monitors) so the requestAnimationFrame callback can be called quicker. Since the browser will lower the refresh rate when the tab/browser is not active, it can also be called at a lower rate.

Fortunately, the callback that's called receives a timing parameter that allows to bail out of rendering and only call the method once 16.66ms have passed.

The loop looks like this:

```

  let fps = 60
  let lastFrameTime = 0
  let frameDuration = 1000 / fps // 15.66ms
  // ...
  const loop = (time) => {
    running && requestAnimationFrame(loop)

    const delta = time - lastFrameTime
    if (delta >= frameDuration)  {
      lastFrameTime = time - (delta % frameDuration)
      
      // update keyboard state
      // run cpu loop
      // render graphics
      // render audio audio
    }
  }
```

### Executing instructons
The CPU loop that's executed 60 times a second looks like this:

```
cpuLoop() {
    let pc = this.readUint24(2)
    for (let i = 0; i < 65536; i++) {
        this.writeByte(pc, pc + 3)
        pc = this.readUint24(pc + 6)
    }
},    
```

Nothing special about it: it reads the source address, then writes to the destination address that's stored at address 3. Finally, it sets the PC (Program Counter) to the address in PC + 6.

## Graphics

### Framebuffer

From the documentation:

> 	A value of ZZ means: pixel(XX, YY) is at address ZZYYXX.

Basically it means than `0xZZ0000` is the start address of the framebuffer, and contains the value of pixel (0,0).

Address `0xZZ0100` contains the address of the first pixel of the second scanline (0, 1), and so on...

Since the resolution is `256 x 256` pixels, it means the last pixel of the screen will be at address `0xZZFFFF`.

### Palette

The `pixel` that's stored is the index of the pixel in the [web safe](https://www.colorhexa.com/web-safe-colors) color palette.

In `initPalette` the palette is pre-calculated using Canvas'pixel format `RGBA`:

```
let i = 0
// Generate websafe 216 color palette see: https://www.colorhexa.com/web-safe-colors
for (var r = 0; r <= 0xff; r += 0x33)
    for (var g = 0; g <= 0xff; g += 0x33)
        for (var b = 0; b <= 0xff; b += 0x33)
            view.setUint32(i++ * 4, r << 24 | g << 16 | b << 8 | 0xff)
```

Then, drawing the BytePusher's screen on a canvas is as simple as filling the canvas'buffer with the pixel from the palette:

```
  updateBuffer(framebuffer) {
    const length = this.width * this.height
    const array32 = new Uint32Array(this.buffer.data.buffer)

    for (let i = 0; i < length; i++) {
      array32[i] = this.palette[framebuffer[i]]
    }
  },
```

Note that since there are only 216 possible colors in BytePusher, but the pixel data is a byte so can be up to 255, the palette is set to 256 colors, and colors 216 to 255 are set to black:

```
for (let i = 216; i < 256; i++) {
    view.setUint32(i++ * 4, 0x000000ff)
}
```

Finally, after each cpu loop, the canvas can be updated with the new pixels by calling `ctx.putImageData`:

```
draw() {
    this.ctx.putImageData(this.buffer, 0, 0)
}
```

## Audio

### Audio Buffer

BytePusher has a 256 samples signed 8-bit buffer and a sample rate of `15360`Hz.
Since having an audio buffer as small as 256 bytes would required much precision (requestAnimationFrame calls aren't precise), a 2 second audio buffer is created, and partially filled after each frame. When it's full, it is then filled again from the start.

To have an endless stream of audio, the audio node's loop property is simply set to true and loopEnd to the size of the buffer.

```
  init (bufferDuration) {
    // this is the bytepusher's sample rate
    const sampleRate = 15360
    const totalSamples = bufferDuration * sampleRate
    this.buffer = new AudioBuffer({
      length: totalSamples,
      sampleRate,
      numberOfChannels: 1,
    })        
    const source = this.audioCtx.createBufferSource({
      length: totalSamples,
      sampleRate,
      numberOfChannels: 1,
    })
    source.buffer = this.buffer
    source.loop = true
    source.loopEnd = bufferDuration
    source.loopStart = 0
    this.source = source
  },
```

Since the audio cannot start before the user interacts with the page, the source is connected to the destination after a click is detected on the page:

### Updating the WebAudio buffer

After each CPU loop, the canvas audio buffer is partially filled with the updated audio data from BytePusher's memory. Since BytePusher's native audio format is 8-bit signed (integer in the [-128,127] range), and WebAudio's 16-bit floating point (32-bit floating point in the [-1.0, 1.0]), the webaudio sample can be converted with the formula:

> webaudio_sample = bytepusher_sample / 128.0

The update method looks like this:

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

The BytePusher's keyboard is a 16 keys keyboard that is stored as two bytes, each bit giving the state of a single key. It means that multiple keys can be pressed at the same time.

To easily convert web key presses to BytePusher's memory, this simple map has been created:

```
  // map first memory word (16-bit/big endian) to key
  keymap: {
    '1': 0x2,
    '2': 0x4,
    '3': 0x8,
    '4': 0x10,
    '5': 0x20,
    '6': 0x40,
    '7': 0x80,
    '8': 0x100,
    '9': 0x200,
    'a': 0x400,
    'b': 0x800,
    'c': 0x1000,
    'd': 0x2000,
    'e': 0x4000,
    'f': 0x8000
  },
```

Each key maps to its bit, so the entire keyboard state in stored in an integer variable, and setting the pressed/released state of a specific key is as simple as:

```
    document.addEventListener('keydown', (e) => {
      const key = this.keymap[e.key]
      if (typeof key !== 'undefined') {
        this.keyState |= key
      }
    })

    document.addEventListener('keyup', (e) => {
      const key = this.keymap[e.key]
      if (typeof key !== 'undefined') {
        this.keyState &= ~key
      }
    })
```

Before each CPU loop, the keystate variable is simple written to the 0x5 address of BytePusher:

```
    BytePusher.writeUint16(0, Keyboard.keyState)
```
