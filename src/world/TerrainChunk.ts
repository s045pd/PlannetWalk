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
  mesh.matrixAutoUpdate = false;
  return mesh;
}
