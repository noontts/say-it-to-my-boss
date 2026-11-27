export type OfficeCamera = {
  x: number
  y: number
  angle: number
  pitch?: number
  height?: number
}

const vertexSource = `
  attribute vec3 position;
  attribute vec3 paint;
  attribute float material;
  uniform vec3 eye;
  uniform vec4 direction;
  uniform float aspect;
  varying vec3 world;
  varying vec3 color;
  varying float surface;
  varying float distanceFromEye;

  void main() {
    vec3 relative = position - eye;
    float forward = dot(relative.xy, direction.xy);
    float sideways = dot(relative.xy, vec2(-direction.y, direction.x));
    float up = direction.z * relative.z - direction.w * forward;
    float depth = direction.z * forward + direction.w * relative.z;
    gl_Position = vec4(1.6 * sideways / aspect, 1.6 * up, 1.008 * depth - 0.08, depth);
    world = position;
    color = paint;
    surface = material;
    distanceFromEye = depth;
  }
`

const fragmentSource = `
  precision mediump float;
  varying vec3 world;
  varying vec3 color;
  varying float surface;
  varying float distanceFromEye;
  uniform float ringFlash;

  void main() {
    vec3 result = color;
    vec3 pixel = floor(world * 42.0 + 0.01);
    float variation = fract(dot(pixel, vec3(0.7549, 0.5698, 0.4302)));
    if (surface > 0.5 && surface < 1.5) {
      float tile = mod(floor(world.x * 2.0) + floor(world.y * 2.0), 2.0);
      vec2 seam = fract(world.xy * 2.0);
      result *= (0.92 + 0.13 * tile + 0.05 * variation) * mix(0.68, 1.0, step(0.04, min(seam.x, seam.y)));
    } else if (surface < 2.5) {
      float line = step(0.98, fract(world.z * 4.0));
      result *= 0.94 + 0.10 * variation - 0.09 * line;
    } else if (surface < 3.5) {
      result *= 0.87 + 0.12 * fract(pixel.x * 0.3819 + pixel.z * 0.6181) + 0.07 * variation;
    } else if (surface > 4.5) {
      result = mix(result, vec3(1.0, 0.83, 0.29), ringFlash);
    }
    float fog = clamp((distanceFromEye - 1.4) * 0.073, 0.0, 0.48);
    gl_FragColor = vec4(mix(result, vec3(0.10, 0.16, 0.15), fog), 1.0);
  }
`

export type Point = [number, number, number]

const eyeHeight = 1.55
type Box = { min: Point; max: Point }
const deskTop: Box = { min: [5.45, 4.7, 0.78], max: [6.4, 6.3, 0.88] }
const workstation: Box = { min: [5.04, 3.02, 0.73], max: [5.87, 4.32, 0.83] }
const chair: Box = { min: [4.50, 3.42, 0.41], max: [4.99, 3.92, 0.49] }
const cabinet: Box = { min: [6.35, 2.12, 0.03], max: [6.95, 2.89, 1.48] }
const planter: Box = { min: [6.32, 3.70, 0.35], max: [6.85, 4.23, 0.42] }
const furniture = [deskTop, workstation, chair, cabinet, planter]
const playerRadius = 0.2
const typingCycle = [0, 1, 0, 2]
export const phonePosition: Point = [deskTop.min[0] + 0.15, 5.50, deskTop.max[2] + 0.10]
export const officeSpawn: OfficeCamera = { x: 2, y: 5.5, angle: 0, pitch: -0.03 }
export const deskCamera: OfficeCamera = { x: 5.02, y: 5.48, angle: 0.06, pitch: -0.34, height: 1.28 }

export function officePhoneInReach({ x, y }: OfficeCamera) {
  return x <= deskTop.min[0] && Math.hypot(phonePosition[0] - x, phonePosition[1] - y) <= 1.6
}

export function officeWalkable(x: number, y: number) {
  const insideRoom = x > 1 + playerRadius && x < 7 - playerRadius &&
    y > 1 + playerRadius && y < 7 - playerRadius
  return insideRoom && !furniture.some(({ min, max }) =>
    x > min[0] - playerRadius && x < max[0] + playerRadius &&
    y > min[1] - playerRadius && y < max[1] + playerRadius,
  )
}

function officeGeometry() {
  const vertices: number[] = []
  function face(a: Point, b: Point, c: Point, d: Point, paint: number, material: number, shade = 1) {
    const rgb = [paint >> 16 & 255, paint >> 8 & 255, paint & 255]
    const tint = rgb.map((value) => value / 255 * shade)
    for (const point of [a, b, c, a, c, d]) vertices.push(...point, ...tint, material)
  }

  function box(min: Point, max: Point, paint: number, material = 0, rise = 0) {
    const [x, y, z] = min
    const [X, Y, Z] = max
    const farBottom = z + rise
    const farTop = Z + rise
    face([x, y, z], [x, Y, z], [x, Y, Z], [x, y, Z], paint, material, 0.87)
    face([X, Y, farBottom], [X, y, farBottom], [X, y, farTop], [X, Y, farTop], paint, material, 0.82)
    face([X, y, farBottom], [x, y, z], [x, y, Z], [X, y, farTop], paint, material, 0.73)
    face([x, Y, z], [X, Y, farBottom], [X, Y, farTop], [x, Y, Z], paint, material, 0.91)
    face([x, y, Z], [x, Y, Z], [X, Y, farTop], [X, y, farTop], paint, material)
    face([x, y, z], [X, y, farBottom], [X, Y, farBottom], [x, Y, z], paint, material, 0.67)
  }

  const height = 2.75
  face([1, 1, 0], [7, 1, 0], [7, 7, 0], [1, 7, 0], 0x6b7158, 1)
  face([1, 1, height], [7, 1, height], [7, 7, height], [1, 7, height], 0x788574, 1, 0.8)
  for (const x of [1, 7]) {
    face([x, 1, 0], [x, 7, 0], [x, 7, height], [x, 1, height], 0x9fa386, 2)
    const edge = x === 1 ? [1, 1.035] : [6.965, 7]
    box([edge[0], 1, 0.03], [edge[1], 7, 0.15], 0x4a5140, 3)
    box([edge[0], 1, 0.15], [edge[1], 7, 0.95], 0x52665c, 2)
    box([edge[0], 1, 0.95], [edge[1], 7, 0.985], 0x777a58, 3)
  }
  for (const y of [1, 7]) {
    face([1, y, 0], [7, y, 0], [7, y, height], [1, y, height], 0x8d977c, 2)
    const edge = y === 1 ? [1, 1.035] : [6.965, 7]
    box([1, edge[0], 0.03], [7, edge[1], 0.15], 0x4a5140, 3)
    box([1, edge[0], 0.15], [7, edge[1], 0.95], 0x50635a, 2)
    box([1, edge[0], 0.95], [7, edge[1], 0.985], 0x777a58, 3)
  }

  // Window, skyline, and mullions on the wall facing the player at entry.
  box([6.89, 4.0, 1.05], [6.99, 6.64, 2.37], 0x324e4a, 4)
  box([6.87, 4.07, 1.12], [6.9, 6.56, 2.30], 0x819985, 4)
  for (const [y, width, tall] of [[4.12, 0.42, 0.43], [4.54, 0.37, 0.28], [4.97, 0.45, 0.59], [5.52, 0.39, 0.40], [5.94, 0.51, 0.32]]) {
    box([6.856, y, 1.12], [6.865, y + width, 1.12 + tall], 0x637e70, 4)
    for (let offset = 0.12; offset < width - 0.06; offset += 0.16) {
      box([6.842, y + offset, 1.24], [6.85, y + offset + 0.055, 1.28], 0xb7af75, 4)
    }
  }
  for (const y of [4.04, 4.9, 5.74, 6.58]) {
    box([6.82, y, 1.08], [6.89, y + 0.035, 2.32], 0x404f44, 4)
  }
  box([6.78, 3.98, 1.055], [6.91, 6.65, 1.115], 0x607560, 4)
  box([6.81, 4.02, 1.99], [6.90, 6.62, 2.02], 0x404f44, 4)
  box([6.81, 4.02, 2.31], [6.90, 6.62, 2.35], 0x404f44, 4)

  // Door and bulletin boards sit flush with the walls.
  box([3.6, 1.038, 0.02], [4.71, 1.09, 2.19], 0x394a3d, 3)
  box([3.66, 1.092, 0.02], [4.65, 1.115, 2.125], 0x6d7556, 3)
  box([3.72, 1.116, 0.97], [3.87, 1.155, 1.022], 0xa9a272, 4)
  box([1.55, 6.91, 1.03], [3.22, 6.964, 2.05], 0x665d3d, 3)
  box([1.61, 6.888, 1.09], [3.16, 6.909, 1.99], 0x8f8158, 3)
  for (const [x, z, color] of [[1.76, 1.57, 0xc2b783], [2.20, 1.38, 0xa6ac7e], [2.69, 1.60, 0xbea878]]) {
    box([x, 6.865, z], [x + 0.32, 6.887, z + 0.26], color, 4)
  }
  for (const y of [2.3, 5.4]) {
    box([2.65, y - 0.10, 2.67], [5.25, y + 0.1, 2.75], 0x566453, 4)
    box([2.72, y - 0.055, 2.656], [5.18, y + 0.055, 2.685], 0xe9dca0, 4)
  }

  // The second workstation sits to the left of the path to the phone.
  box(workstation.min, workstation.max, 0xa7855d, 3)
  for (const x of [workstation.min[0] + 0.06, workstation.max[0] - 0.15]) {
    for (const y of [workstation.min[1] + 0.06, workstation.max[1] - 0.15]) {
      box([x, y, 0.02], [x + 0.09, y + 0.09, workstation.min[2]], 0x485349)
    }
  }
  box([5.52, 3.19, 0.83], [5.79, 3.61, 0.87], 0x585950)
  box([5.63, 3.23, 0.87], [5.77, 3.58, 1.22], 0x77766a)
  box([5.59, 3.09, 1.14], [5.83, 3.72, 1.59], 0xa29b80)
  box([5.58, 3.14, 1.19], [5.59, 3.67, 1.54], 0x313f3d, 4)
  box([5.57, 3.17, 1.22], [5.58, 3.64, 1.51], 0x325a57, 4)
  for (const [z, width] of [[1.43, 0.29], [1.37, 0.38], [1.31, 0.19]]) {
    box([5.56, 3.21, z], [5.57, 3.21 + width, z + 0.018], 0x95b7a0, 4)
  }
  box([5.12, 3.39, 0.83], [5.37, 3.83, 0.86], 0x777b68)
  for (const x of [5.15, 5.22, 5.29]) {
    box([x, 3.42, 0.86], [x + 0.03, 3.80, 0.866], 0x414d43, 4)
  }
  box([5.22, 3.87, 0.83], [5.52, 4.18, 0.86], 0xa66a49, 3)
  box([5.23, 3.88, 0.86], [5.51, 4.15, 0.88], 0xd0bd89, 4)
  box([5.40, 3.89, 0.88], [5.43, 4.12, 0.90], 0x485349, 4)

  box(chair.min, chair.max, 0x53736a)
  box([4.51, 3.42, 0.48], [4.61, 3.92, 0.96], 0x394c45)
  box([4.50, 3.44, 0.64], [4.65, 3.90, 1.04], 0x53736a)
  box([4.69, 3.62, 0.09], [4.81, 3.72, 0.41], 0x373e37)
  box([4.53, 3.63, 0.04], [4.97, 3.71, 0.12], 0x373e37)
  box([4.71, 3.44, 0.04], [4.79, 3.90, 0.12], 0x373e37)

  box([6.40, cabinet.min[1], cabinet.min[2]], cabinet.max, 0x58686a)
  for (const z of [0.12, 0.45, 0.78, 1.11]) {
    box([6.37, 2.17, z], [6.40, 2.84, z + 0.29], 0x7d938f)
    box([cabinet.min[0], 2.42, z + 0.17], [6.37, 2.59, z + 0.205], 0xb7ac8a, 4)
    box([6.36, 2.447, z + 0.10], [6.37, 2.56, z + 0.145], 0xc8bda0, 4)
  }

  box([6.35, 3.73, 0.01], [6.82, 4.20, 0.40], 0x9c694a, 3)
  box(planter.min, planter.max, 0xbb8258, 3)
  box([6.37, 3.75, 0.42], [6.80, 4.18, 0.427], 0x443e30)
  box([6.56, 3.94, 0.42], [6.60, 3.98, 1.21], 0x52734b)
  for (const [angle, height, length, tipHeight, paint] of [
    [0.4, 0.53, 0.31, 0.84, 0x5a824f],
    [2.5, 0.61, 0.36, 0.87, 0x76965a],
    [4.2, 0.68, 0.37, 0.98, 0x658d56],
    [1.7, 0.80, 0.38, 1.08, 0x6f9258],
    [3.2, 0.92, 0.33, 1.21, 0x86a565],
    [5.5, 1.02, 0.27, 1.34, 0x739854],
    [2.0, 1.12, 0.19, 1.42, 0x8ba867],
  ]) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const middleX = 6.58 + dx * length * 0.55
    const middleY = 3.96 + dy * length * 0.55
    const middleZ = (height + tipHeight) / 2
    const base: Point = [6.58, 3.96, height]
    const ridge: Point = [middleX, middleY, middleZ + 0.06]
    const tip: Point = [6.58 + dx * length, 3.96 + dy * length, tipHeight]
    face(base, [middleX - dy * 0.10, middleY + dx * 0.10, middleZ], tip, ridge, paint, 4)
    face(base, ridge, tip, [middleX + dy * 0.10, middleY - dx * 0.10, middleZ], paint, 4, 0.79)
  }

  // Desk, chunky monitor, paper, and the ringing handset.
  box(deskTop.min, deskTop.max, 0x9b7650, 3)
  for (const y of [4.73, 6.19]) {
    box([5.51, y, 0.02], [5.61, y + 0.08, 0.78], 0x485349)
    box([6.25, y, 0.02], [6.35, y + 0.08, 0.78], 0x485349)
  }
  box([6.01, 4.78, 0.30], [6.30, 5.14, 0.775], 0x495a4f)
  for (const z of [0.43, 0.58, 0.72]) {
    box([5.99, 4.90, z], [6.02, 5.02, z + 0.025], 0xa6a07c, 4)
  }
  box([5.98, 5.94, 0.881], [6.30, 6.26, 0.924], 0x506259)
  box([6.06, 5.95, 0.923], [6.34, 6.27, 1.24], 0x76816b)
  box([6.046, 5.985, 0.972], [6.059, 6.235, 1.209], 0x263934, 4)
  box([6.038, 6.005, 0.99], [6.045, 6.215, 1.187], 0x4f826d, 4)
  for (let z = 1.037; z < 1.18; z += 0.042) {
    box([6.031, 6.037, z], [6.037, z > 1.14 ? 6.11 : 6.17, z + 0.010], 0x8ba984, 4)
  }
  box([5.55, 4.89, 0.881], [5.86, 5.19, 0.903], 0xc6b788, 4)
  for (const x of [5.60, 5.66, 5.72, 5.78]) {
    box([x, 4.945, 0.904], [x + 0.018, 5.136, 0.907], 0x8b9477, 4)
  }
  box([5.49, 5.27, 0.881], [5.86, 5.7, 0.952], 0x3d4e44, 4)
  box([5.55, 5.28, 0.952], [5.67, 5.69, 1.002], 0x293c36, 4)
  for (const y of [5.26, 5.60]) box([5.52, y, 0.953], [5.71, y + 0.11, 1.031], 0x314a3d, 4)
  box([5.495, 5.45, 0.953], [5.543, 5.55, 0.958], 0x98593e, 5)
  for (const x of [5.725, 5.767, 5.809]) {
    for (const y of [5.43, 5.48, 5.53, 5.58]) {
      box([x, y, 0.953], [x + 0.023, y + 0.024, 0.959], 0x879273, 4)
    }
  }
  // The coworker sits inside the chair's footprint and faces the monitor.
  const shirt = 0x6c8199
  const skin = 0xc08965
  const hair = 0x3b3029
  const trousers = 0x414957
  for (const y of [3.48, 3.69]) {
    box([4.74, y, 0.48], [5.15, y + 0.16, 0.63], trousers)
    box([5.00, y, 0.13], [5.15, y + 0.15, 0.50], trousers)
    box([4.99, y, 0.02], [5.23, y + 0.15, 0.13], 0x363734)
  }
  box([4.68, 3.46, 0.59], [4.94, 3.87, 1.10], shirt)
  box([4.70, 3.42, 1.03], [4.96, 3.91, 1.13], shirt)
  box([4.72, 3.56, 1.13], [4.91, 3.77, 1.22], skin)
  box([4.68, 3.51, 1.21], [4.98, 3.80, 1.49], skin)
  box([4.65, 3.50, 1.40], [4.99, 3.81, 1.54], hair)
  box([4.65, 3.50, 1.30], [4.80, 3.81, 1.41], hair)
  box([4.69, 3.53, 1.54], [4.94, 3.78, 1.57], hair)
  box([4.81, 3.79, 1.31], [4.89, 3.83, 1.39], skin)
  box([4.98, 3.62, 1.32], [5.009, 3.69, 1.38], skin)
  for (const y of [3.55, 3.72]) {
    box([4.98, y, 1.38], [4.989, y + 0.036, 1.40], 0x44372f, 4)
  }

  const roomVertexCount = vertices.length / 7
  // Bake the poses into the scene buffer so typing never uploads geometry per frame.
  const typingPoses = [0, 1, 2].map((raisedHand) => {
    const start = vertices.length / 7
    for (const [index, y] of [3.44, 3.72].entries()) {
      const lift = raisedHand === index + 1 ? 0.065 : 0
      box([4.76, y, 0.95], [4.95, y + 0.15, 1.11], shirt, 0, -0.04)
      box([4.90, y + 0.02, 0.93], [5.15, y + 0.13, 1.02], shirt, 0, lift - 0.035)
      box([5.14, y + 0.02, 0.895 + lift], [5.26, y + 0.125, 0.974 + lift], skin, 0, -0.027)
    }
    return { start, count: vertices.length / 7 - start }
  })
  return { geometry: new Float32Array(vertices), roomVertexCount, typingPoses }
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

export function createOfficeScene(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false })
  if (!gl) return null
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  if (!vertex || !fragment || !program || !buffer) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    return null
  }

  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    return null
  }

  const { geometry, roomVertexCount, typingPoses } = officeGeometry()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW)
  gl.useProgram(program)
  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(0.10, 0.16, 0.15, 1)
  for (const { name, size, offset } of [
    { name: 'position', size: 3, offset: 0 },
    { name: 'paint', size: 3, offset: 3 },
    { name: 'material', size: 1, offset: 6 },
  ]) {
    const location = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset * 4)
  }
  const eye = gl.getUniformLocation(program, 'eye')
  const direction = gl.getUniformLocation(program, 'direction')
  const aspect = gl.getUniformLocation(program, 'aspect')
  const ringFlash = gl.getUniformLocation(program, 'ringFlash')

  return {
    draw({ x, y, angle, pitch = -0.08, height = eyeHeight }: OfficeCamera, flash: boolean, time?: number) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniform3f(eye, x, y, height)
      gl.uniform4f(direction, Math.cos(angle), Math.sin(angle), Math.cos(pitch), Math.sin(pitch))
      gl.uniform1f(aspect, canvas.width / canvas.height)
      gl.uniform1f(ringFlash, Number(flash))
      gl.drawArrays(gl.TRIANGLES, 0, roomVertexCount)
      const step = time === undefined ? 0 : Math.floor(time / 120) % typingCycle.length
      const pose = typingPoses[typingCycle[step]]
      gl.drawArrays(gl.TRIANGLES, pose.start, pose.count)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}
