import './style.css'

let running = false

const BytePusher = {
  mem: new DataView(new ArrayBuffer(0x1000008)),
  debugIO() {
    console.log('keyboard:', this.readByte(0).toString(2).padStart(8, '0'), this.readByte(1).toString(2).padStart(8, '0'))
    console.log('pc:', '0x' + this.readUint24(2).toString(16).padStart(6, '0'))
    console.log('framebuffer start:', '0x' + this.readByte(5).toString(16).padStart(2, '0').padEnd(6, '0'))
    console.log('audio start:', '0x' + this.readUint24(6).toString(16).padStart(4, '0').padEnd(6, '0'))
  },
  cpuLoop() {
    let pc = this.readUint24(2)
    for (let i = 0; i < 65536; i++) {
      this.writeByte(pc, pc + 3)
      pc = this.readUint24(pc + 6)
    }
  },
  setMemory (buffer) {
    if (buffer.byteLength > 0x1000008) {
      throw new Error(`Image is too large to fit in Memory (${buffer.byteLength})`)
    }
    this.mem = new DataView(buffer.transfer(0x1000008))
  },
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
    if (addr > 0xFFFFFF) {
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
  getFramebufferStartAddress() {
    return this.readByte(5) << 16
  }
}

const Keyboard = {
  keyState: 0,
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
  init() {
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
  }
}

const Screen = {
  canvas: document.getElementById('framebuffer'),
  ctx: document.getElementById('framebuffer').getContext('2d'),
  width: 256,
  height: 256,
  buffer: new ImageData(256, 256),
  palette: new Uint32Array(256),
  updateBuffer(framebuffer) {
    const length = this.width * this.height
    const array32 = new Uint32Array(this.buffer.data.buffer)
    const array8 = new Uint8Array(this.buffer.data.buffer)
    for (let i = 0; i < length; i++) {
      array32[i] = this.palette[framebuffer[i]]
    }
  },
  initPalette() {
    const view = new DataView(this.palette.buffer)
    let i = 0
    // generate websafe 216 color palette see: https://www.colorhexa.com/web-safe-colors
    for (var r = 0; r <= 0xff; r += 0x33)
      for (var g = 0; g <= 0xff; g += 0x33)
          for (var b = 0; b <= 0xff; b += 0x33)
              view.setUint32(i++ * 4, r << 24 | g << 16 | b << 8 | 0xff)

    // set colors 216->255 to black as required by BytePusher specs:
    // this way we may avoid checking for out of bounds colors
    for (let i = 216; i < 256; i++) {
      view.setUint32(i++ * 4, 0x000000ff)
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

  const loadDemo = async (demo) => {
    try {
      const response = await fetch(demo)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const buffer = await response.arrayBuffer()
      BytePusher.setMemory(buffer)
      BytePusher.debugIO()
    } catch(e) {
      console.error('Error loading demo:', e)
    }
  }

  const updateState = () => {
      document.getElementById('current_state').innerText = running ? 'Running' : 'Stopped'
  }

  const setupDOMListeners = () => {
    document.getElementById('toggle_state').addEventListener('click', () => {
      running = !running
      running && requestAnimationFrame(loop)
      updateState()
    })
    updateState()
  }

  const setupScreen = () => {
    Screen.initPalette()
  }

  const setupKeyboard = () => {
    Keyboard.init()
  }

  const loop = (time) => {
    running && requestAnimationFrame(loop)

    const delta = time - lastFrameTime
    if (delta >= frameDuration)  {
      lastFrameTime = time - (delta % frameDuration)
      
      BytePusher.writeUint16(0, Keyboard.keyState)
      BytePusher.cpuLoop()
      Screen.updateBuffer(new Uint8Array(BytePusher.mem.buffer, BytePusher.getFramebufferStartAddress()))
      Screen.draw()
      // TODO: update audio device
    }
  }

  setupDOMListeners()
  setupScreen()
  setupKeyboard()
  loadDemo('demos/keyboard.bp').then(() => {
    running && requestAnimationFrame(loop)
  })
}

main()