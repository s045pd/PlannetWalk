import * as THREE from 'three';
import type { ChunkResult } from './terrain.worker';

/** 地表共享材质：顶点色生物群系 + 片元细节噪声 + 玻璃化区低粗糙度 + 雨天湿润 */
export function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const uniforms = {
    uOriginOff: { value: new THREE.Vector2(0, 0) },
    uWetness: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aGlass;
         varying float vGlass;
         varying vec3 vWP;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vGlass = aGlass;
         vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec2 uOriginOff;
         uniform float uWetness;
         varying float vGlass;
         varying vec3 vWP;
         float pwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
         float pwNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(pwHash(i), pwHash(i + vec2(1, 0)), f.x),
             mix(pwHash(i + vec2(0, 1)), pwHash(i + vec2(1, 1)), f.x),
             f.y);
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec2 tw = vWP.xz + uOriginOff;
           float d = pwNoise(tw * 0.35) * 0.6 + pwNoise(tw * 2.7) * 0.4;
           diffuseColor.rgb *= 0.82 + 0.36 * d;
           diffuseColor.rgb *= 1.0 - 0.25 * uWetness;
         }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           // 程序细节法线：双尺度噪声梯度扰动，随距离淡出防远处闪烁
           vec2 tw = vWP.xz + uOriginOff;
           float fade = 1.0 - smoothstep(30.0, 90.0, length(vViewPosition));
           if (fade > 0.01) {
             float e = 0.35;
             float s1 = 1.1;
             float h0 = pwNoise(tw * s1) + pwNoise(tw * 4.3) * 0.4;
             float hx = pwNoise((tw + vec2(e, 0.0)) * s1) + pwNoise((tw + vec2(e, 0.0)) * 4.3) * 0.4;
             float hz = pwNoise((tw + vec2(0.0, e)) * s1) + pwNoise((tw + vec2(0.0, e)) * 4.3) * 0.4;
             vec3 grad = vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e);
             // vWP 空间的扰动近似映射到视空间法线
             vec3 wn = normalize(vec3(grad.x, grad.y * 1.6, grad.z));
             vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
             normal = normalize(mix(normal, vn, 0.26 * fade));
           }
         }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(roughnessFactor - vGlass * 0.55 - uWetness * 0.35, 0.05, 1.0);`,
      );
  };
  // 供外部更新 uniform（onBeforeCompile 闭包共享同一对象）
  (mat.userData as Record<string, unknown>).uniforms = uniforms;
  return mat;
}

export function buildChunkMesh(data: ChunkResult, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setAttribute('aGlass', new THREE.BufferAttribute(data.glass, 1));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const size = data.size;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(size / 2, 0, size / 2), size * 1.5);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = data.res >= 32; // 近/中景块参与地形自阴影
  mesh.matrixAutoUpdate = false;
  return mesh;
}
