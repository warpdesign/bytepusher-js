import './style.css'

let running = true

const BytePusher = {
  pc: 0,
  mem: new DataView(new ArrayBuffer(0x1000008)),
  setMemory (buffer) {
    this.mem = new DataView(buffer.slice())
  },
  readUint24(addr) {
    if (addr > 0xFFFFFF) {
      throw new Error('Address out of bounds')
    }
    return this.mem.getUint32(addr) >> 8
  },
  readByte(addr) {
    if (addr > 0xFFFFFF) {
      throw new Error('Address out of bounds')
    }
    return this.mem.getUint8(addr)    
  },
  writeByte(src, dest) {
    if (src > 0xFFFFFF || dest > 0xFFFFFF) {
      throw new Error('Address out of bounds')
    }
    this.mem.setUint8(dest, this.mem.getUint8(src))
  }
}

const Screen = {
  canvas: document.getElementById('framebuffer'),
  ctx: document.getElementById('framebuffer').getContext('2d'),
  width: 256,
  height: 256,
  buffer: new ImageData(256, 256),
  palette: new Uint32Array(256),
  initPalette() {
    let i = 0
    // generate websafe 216 color palette see: https://www.colorhexa.com/web-safe-colors
    for (var r = 0; r <= 0xff; r += 0x33)
      for (var g = 0; g <= 0xff; g += 0x33)
          for (var b = 0; b <= 0xff; b += 0x33)
              this.palette[i++] = 0xff000000 | b << 16 | g << 8 | r;

    // set colors 216->255 to black as required by BytePusher specs
    for (let i = 216; i < 256; i++) {
      this.palette[i] = 0xff000000
    }
  },
  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height)
  },
  draw() {
    this.ctx.putImageData(this.buffer, 0, 0)
  }
}

const main = () => {
  let fps = 60
  let lastFrameTime = 0
  let frameDuration = 1000 / fps
  let myTime = new Date().getTime()

  const setupListeners = () => {
    document.getElementById('toggle_state').addEventListener('click', () => {
      running = !running
      document.getElementById('current_state').innerText = running ? 'Running' : 'Stopped'
    })
  }

  const loop = (time) => {
    running && requestAnimationFrame(loop)

    const delta = time - lastFrameTime
    if (delta >= frameDuration)  {
      // run cpu loop
      lastFrameTime = time - (delta % frameDuration)
      // executeLoop()
    }

    myTime = new Date().getTime()
  }

  setupListeners()
  requestAnimationFrame(loop)
}

main()