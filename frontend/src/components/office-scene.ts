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
const deskTop = { min: [5.45, 4.7, 0.78] as Point, max: [6.4, 6.3, 0.88] as Point }
const playerRadius = 0.2
export const phonePosition: Point = [deskTop.min[0] + 0.15, 5.50, deskTop.max[2] + 0.10]
export const officeSpawn: OfficeCamera = { x: 2, y: 5.5, angle: 0, pitch: -0.03 }
export const deskCamera: OfficeCamera = { x: 5.02, y: 5.48, angle: 0.06, pitch: -0.34, height: 1.28 }

export function officePhoneInReach({ x, y }: OfficeCamera) {
  return x <= deskTop.min[0] && Math.hypot(phonePosition[0] - x, phonePosition[1] - y) <= 1.6
}

export function officeWalkable(x: number, y: number) {
  const insideRoom = x > 1 + playerRadius && x < 7 - playerRadius &&
    y > 1 + playerRadius && y < 7 - playerRadius
  const hitsDesk = x > deskTop.min[0] - playerRadius && x < deskTop.max[0] + playerRadius &&
    y > deskTop.min[1] - playerRadius && y < deskTop.max[1] + playerRadius
  return insideRoom && !hitsDesk
}

function officeGeometry() {
  const vertices: number[] = []
  function face(a: Point, b: Point, c: Point, d: Point, paint: number, material: number, shade = 1) {
    const rgb = [paint >> 16 & 255, paint >> 8 & 255, paint & 255]
    const tint = rgb.map((value) => value / 255 * shade)
    for (const point of [a, b, c, a, c, d]) vertices.push(...point, ...tint, material)
  }

  function box(min: Point, max: Point, paint: number, material = 0) {
    const [x, y, z] = min
    const [X, Y, Z] = max
    face([x, y, z], [x, Y, z], [x, Y, Z], [x, y, Z], paint, material, 0.87)
    face([X, Y, z], [X, y, z], [X, y, Z], [X, Y, Z], paint, material, 0.82)
    face([X, y, z], [x, y, z], [x, y, Z], [X, y, Z], paint, material, 0.73)
    face([x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z], paint, material, 0.91)
    face([x, y, Z], [x, Y, Z], [X, Y, Z], [X, y, Z], paint, material)
    face([x, y, z], [X, y, z], [X, Y, z], [x, Y, z], paint, material, 0.67)
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
  return new Float32Array(vertices)
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

  const geometry = officeGeometry()
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
    draw({ x, y, angle, pitch = -0.08, height = eyeHeight }: OfficeCamera, flash: boolean) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniform3f(eye, x, y, height)
      gl.uniform4f(direction, Math.cos(angle), Math.sin(angle), Math.cos(pitch), Math.sin(pitch))
      gl.uniform1f(aspect, canvas.width / canvas.height)
      gl.uniform1f(ringFlash, Number(flash))
      gl.drawArrays(gl.TRIANGLES, 0, geometry.length / 7)
    },
    dispose() {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}
